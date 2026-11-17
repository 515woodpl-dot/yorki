const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const Database = require('better-sqlite3')

function inviteFixture() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, full_name TEXT, display_name TEXT, email TEXT, role TEXT, is_active INTEGER, password_hash TEXT, updated_at TEXT);
    CREATE TABLE invites (id TEXT, user_id TEXT, token TEXT UNIQUE, expires_at TEXT, used_at TEXT, created_at TEXT);
    CREATE TABLE sessions (id TEXT, user_id TEXT);
    INSERT INTO users VALUES ('u1', 'User', 'User', 'user@example.com', 'admin', 1, 'old', NULL);
    INSERT INTO sessions VALUES ('existing', 'u1');`)
  let authorized = false
  const source = ts.transpileModule(fs.readFileSync('src/lib/actions/invite.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  vm.runInNewContext(source, { exports, process, require(name) {
    if (name === '@/lib/db') return { getDb: () => db }
    if (name === '@/lib/auth') return {
      requireRole: async () => { if (!authorized) throw new Error('Access denied'); return { role: 'admin' } },
      hashPassword: async (password) => { await new Promise(resolve => setImmediate(resolve)); return `hashed:${password}` },
    }
    return require(name)
  } })
  return { db, actions: exports, authorize: () => { authorized = true } }
}

test('anonymous/staff callers cannot mint password reset invites', async () => {
  const f = inviteFixture()
  try {
    await assert.rejects(f.actions.createInvite('u1'), /Access denied/)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM invites').get().n, 0)
    f.authorize()
    const { token } = await f.actions.createInvite('u1')
    assert.ok(token)
    f.db.prepare('UPDATE users SET is_active = 0').run()
    await assert.rejects(f.actions.createInvite('u1'), /Active user not found/)
    assert.equal(await f.actions.validateInvite(token), null)
    assert.equal((await f.actions.acceptInvite(token, 'password123')).success, false)
  } finally { f.db.close() }
})

test('concurrent invite acceptance succeeds once and revokes sessions', async () => {
  const f = inviteFixture()
  try {
    f.authorize()
    const { token } = await f.actions.createInvite('u1')
    const results = await Promise.all([
      f.actions.acceptInvite(token, 'first-password'),
      f.actions.acceptInvite(token, 'second-password'),
    ])
    assert.equal(results.filter(r => r.success).length, 1)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0)
    assert.equal((await f.actions.acceptInvite(token, 'third-password')).success, false)
    assert.equal(f.db.prepare('SELECT password_hash FROM users').get().password_hash, 'hashed:first-password')
  } finally { f.db.close() }
})

test('revoking an invite while its password is hashing prevents reset', async () => {
  const f = inviteFixture()
  try {
    f.authorize()
    const { token } = await f.actions.createInvite('u1')
    const pending = f.actions.acceptInvite(token, 'password123')
    await Promise.resolve()
    f.db.prepare('DELETE FROM invites').run()
    assert.equal((await pending).success, false)
    assert.equal(f.db.prepare('SELECT password_hash FROM users').get().password_hash, 'old')
  } finally { f.db.close() }
})

test('service worker bypasses private GET and RSC responses', () => {
  const listeners = {}
  vm.runInNewContext(fs.readFileSync('public/sw.js', 'utf8'), {
    URL, self: { registration: { scope: 'https://example.com/task/' }, location: { origin: 'https://example.com' },
      addEventListener: (name, fn) => { listeners[name] = fn } },
  })
  for (const pathname of ['/task/dashboard?_rsc=123', '/task/admin/users', '/task/api/attachments/a', '/task/request/secret']) {
    let intercepted = false
    listeners.fetch({ request: { method: 'GET', url: `https://example.com${pathname}`, mode: 'cors' },
      respondWith: () => { intercepted = true } })
    assert.equal(intercepted, false, pathname)
  }
})

test('user profiles never expose password hashes', async () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE users (id TEXT, password_hash TEXT, is_active INTEGER, created_at TEXT);
    INSERT INTO users VALUES ('u1', 'sensitive-hash', 1, '2026-01-01');`)
  const exports = {}
  const source = ts.transpileModule(fs.readFileSync('src/lib/local-data.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  vm.runInNewContext(source, { exports, require(name) {
    if (name === './db') return { getDb: () => db }
    return require(name)
  } })
  try {
    const users = await exports.getAllUsers()
    assert.equal(users.length, 1)
    assert.equal(Object.hasOwn(users[0], 'password_hash'), false)
    assert.equal(Object.hasOwn(exports.findUser('u1'), 'password_hash'), false)
  } finally { db.close() }
})

function loadTs(file, dependencies = {}) {
  if (dependencies['@/lib/local-data']) {
    dependencies['@/lib/local-data'] = {
      TaskConflictError: class TaskConflictError extends Error {},
      getLatestBoardEventSeq: () => 0,
      recordBoardEvent: () => {},
      ...dependencies['@/lib/local-data'],
    }
  }
  const exports = {}
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(source, { exports, process, console, Buffer, require(name) {
    if (name === '@/lib/collab') return loadTs('src/lib/collab.ts', dependencies)
    if (name === '@/lib/notifications') return { notifyAssigned() {}, notifyCompleted() {} }
    return Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)
  } })
  return exports
}

test('SQLite login reservations share limits across connections and survive reconnect', () => {
  const os = require('node:os')
  const path = require('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yorki-limit-'))
  const file = path.join(dir, 'test.db')
  const limiter = loadTs('src/lib/login-rate-limit.ts')
  let db = new Database(file)
  db.exec('CREATE TABLE login_attempts (email TEXT PRIMARY KEY, count INTEGER NOT NULL, first_at INTEGER NOT NULL)')
  try {
    for (let i = 0; i < 5; i++) assert.equal(limiter.reserveLoginAttempt(db, 'u@example.com', 1000).allowed, true)
    db.close()
    db = new Database(file)
    assert.equal(limiter.reserveLoginAttempt(db, 'u@example.com', 2000).allowed, false)
    assert.equal(limiter.reserveLoginAttempt(db, 'other@example.com', 2000).allowed, true)
    assert.equal(limiter.reserveLoginAttempt(db, 'u@example.com', 901000).allowed, true)
    limiter.clearLoginAttempts(db, 'u@example.com')
    assert.equal(limiter.reserveLoginAttempt(db, 'u@example.com', 901001).allowed, true)
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('staff board excludes unrelated tasks and internal notes; edits preserve assignment and sharing', async () => {
  const task = { id: 'mine', board_id: 'board', column_id: 'inbox', status: 'new', submitted_by: 'staff',
    assigned_to: 'other', custom_fields: { assigned_user_ids: ['other'], share_token: 'secret', address: 'old' } }
  let includeInternal
  let saved
  const data = {
    DEFAULT_BOARD_ID: 'board',
    getActiveColumns: async () => [{ id: 'inbox', board_id: 'board' }],
    getActiveTasks: async () => [task, { ...task, id: 'unrelated', submitted_by: 'other' }],
    getTaskComments: async (id, include) => { includeInternal = include; return include ? ['internal'] : [] },
    getTaskAttachments: async () => [],
    findUser: () => null,
    getTaskById: async () => task,
    updateTask: async (id, updates, options) => { options?.guard?.(task); saved = typeof updates === 'function' ? updates(task) : updates; return { ...task, ...saved } },
    createActivityLog: async () => {},
  }
  const actions = loadTs('src/lib/actions/tasks.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/auth': { requireRole: async () => ({ id: 'staff', role: 'staff' }) },
    '@/lib/local-data': data,
    './email': {},
    '@/lib/integrations/google-calendar': { upsertGoogleCalendarEvent: async () => ({ status: 'skipped' }) },
    '@/lib/utils': { getAssignedUserIds: () => [], isTaskAssignedToUser: () => false },
  })
  const board = await actions.getBoardData()
  assert.equal(board.columns[0].tasks.length, 1)
  assert.equal(includeInternal, false)
  const result = await actions.updateTask({ id: 'mine', custom_fields: { address: 'new', share_token: 'attacker', assigned_user_ids: ['staff'] } })
  assert.equal(result.success, true)
  assert.equal(saved.custom_fields.address, 'new')
  assert.equal(saved.custom_fields.share_token, 'secret')
  assert.deepEqual(Array.from(saved.custom_fields.assigned_user_ids), ['other'])
})

test('backup captures committed WAL data and private uploads and restores independently', async () => {
  const os = require('node:os')
  const path = require('node:path')
  const { execFileSync } = require('node:child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yorki-backup-'))
  const dataDir = path.join(dir, 'data')
  fs.mkdirSync(path.join(dataDir, 'uploads', 'task'), { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'uploads', 'task', 'test.txt'), 'private-content')
  const db = new Database(path.join(dataDir, 'yorki.db'))
  db.pragma('journal_mode=WAL')
  db.exec("CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES ('committed-in-wal')")
  try {
    execFileSync(process.execPath, [path.resolve('scripts/backup-state.cjs')], {
      cwd: dir, env: { ...process.env, YORKI_DB_DIR: dataDir, YORKI_DB_PATH: '', BACKUP_ROOT: path.join(dir, 'backups') },
    })
    const backup = fs.readFileSync(path.join(dir, 'backups', 'LATEST'), 'utf8').trim()
    assert.equal(fs.existsSync(path.join(backup, 'COMPLETE')), true)
    assert.equal(fs.existsSync(path.join(backup, 'yorki.db-wal')), false)
    assert.equal(fs.readFileSync(path.join(backup, 'uploads', 'task', 'test.txt'), 'utf8'), 'private-content')
    const restored = new Database(path.join(backup, 'yorki.db'), { readonly: true })
    try { assert.equal(restored.prepare('SELECT value FROM marker').get().value, 'committed-in-wal') }
    finally { restored.close() }
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('admins cannot mint a reset invite for a super admin', async () => {
  const f = inviteFixture()
  try {
    f.authorize()
    f.db.prepare("UPDATE users SET role = 'super_admin'").run()
    await assert.rejects(f.actions.createInvite('u1'), /Only a super admin/)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM invites').get().n, 0)
  } finally { f.db.close() }
})

test('legacy migration copies attachments privately and preserves originals', () => {
  const os = require('node:os')
  const path = require('node:path')
  const { execFileSync } = require('node:child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yorki-legacy-'))
  const live = path.join(dir, 'app')
  const dataDir = path.join(dir, 'data')
  fs.mkdirSync(path.join(live, 'public', 'uploads'), { recursive: true })
  fs.mkdirSync(dataDir)
  const source = path.join(live, 'public', 'uploads', 'private.txt')
  fs.writeFileSync(source, 'legacy-content')
  const dbPath = path.join(dataDir, 'yorki.db')
  const db = new Database(dbPath)
  db.exec('CREATE TABLE attachments (id TEXT, storage_path TEXT, public_url TEXT, deleted_at TEXT)')
  db.prepare('INSERT INTO attachments VALUES (?, ?, ?, NULL)').run('legacy-id', source, '/uploads/private.txt')
  try {
    execFileSync(process.execPath, [path.resolve('scripts/migrate-private-uploads.cjs')], {
      cwd: live, env: { ...process.env, YORKI_DB_PATH: dbPath },
    })
    const row = db.prepare('SELECT * FROM attachments').get()
    assert.equal(row.public_url, '/api/attachments/legacy-id')
    assert.ok(row.storage_path.startsWith(path.join(dataDir, 'uploads', 'legacy') + path.sep))
    assert.equal(fs.readFileSync(row.storage_path, 'utf8'), 'legacy-content')
    assert.equal(fs.readFileSync(source, 'utf8'), 'legacy-content')
    // Running twice leaves the migrated path untouched.
    execFileSync(process.execPath, [path.resolve('scripts/migrate-private-uploads.cjs')], {
      cwd: live, env: { ...process.env, YORKI_DB_PATH: dbPath },
    })
    assert.equal(db.prepare('SELECT storage_path FROM attachments').get().storage_path, row.storage_path)
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('board dates respect business timezone and completed tasks are not overdue', () => {
  const view = loadTs('src/lib/board-view.ts', { './utils': { APP_TIME_ZONE: 'America/Los_Angeles' } })
  assert.equal(view.taskDay('2026-11-16'), '2026-11-16')
  assert.equal(view.taskDay('2026-11-16T07:00:00Z'), '2026-11-15')
  assert.equal(view.taskDay('invalid'), '')
  const task = { status: 'pending', due_date: '2026-11-15', has_real_due_date: true }
  assert.equal(view.taskIsOverdue(task, '2026-11-16'), true)
  assert.equal(view.taskIsOverdue({ ...task, status: 'completed' }, '2026-11-16'), false)
  assert.equal(view.taskIsOverdue({ ...task, has_real_due_date: false }, '2026-11-16'), false)
  assert.equal(view.taskDueLabel({ ...task, due_date: '2026-11-16' }, '2026-11-16'), 'Today')
  assert.equal(view.taskDueLabel({ ...task, due_date: '2026-11-17' }, '2026-11-16'), 'Tomorrow')
})

test('archiving revokes public sharing and lifecycle actions reject invalid replays', async () => {
  let task = {
    id: 'shared', board_id: 'board', column_id: 'inbox', status: 'pending', submitted_by: 'admin',
    assigned_to: null, custom_fields: { share_token: 'public-secret', recipient_email: 'client@example.com', keep: 'yes' },
  }
  const columns = [
    { id: 'inbox', board_id: 'board', name: 'Inbox', is_default: true, is_archive: false },
    { id: 'completed', board_id: 'board', name: 'Completed', is_default: false, is_archive: false },
    { id: 'archive', board_id: 'board', name: 'Archive', is_default: false, is_archive: true },
  ]
  const actions = loadTs('src/lib/actions/tasks.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/auth': { requireRole: async () => ({ id: 'admin', role: 'super_admin', email: 'admin@example.com' }) },
    '@/lib/local-data': {
      DEFAULT_BOARD_ID: 'board', getTaskById: async () => task, getTaskByShareToken: async token => task.custom_fields.share_token === token ? task : null,
      getActiveColumns: async (_board, includeArchive) => columns.filter(column => includeArchive || !column.is_archive),
      getTaskAttachments: async () => [], findUser: () => null, createActivityLog: async () => {},
      updateTask: async (_id, updates, options) => { options?.guard?.(task); task = { ...task, ...(typeof updates === 'function' ? updates(task) : updates) }; return task },
    },
    './email': { sendTaskCompletedEmail: async () => {} },
    '@/lib/integrations/google-calendar': { upsertGoogleCalendarEvent: async () => ({ status: 'skipped' }), deleteGoogleCalendarEvent: async () => ({ status: 'skipped' }) },
    '@/lib/utils': { getAssignedUserIds: () => [], isTaskAssignedToUser: () => false },
  })
  assert.equal((await actions.archiveTask('shared')).success, true)
  assert.equal(task.status, 'archived')
  assert.equal(task.custom_fields.share_token, undefined)
  assert.equal(task.custom_fields.recipient_email, undefined)
  assert.equal(task.custom_fields.keep, 'yes')
  assert.equal(await actions.getSharedTaskData('public-secret'), null)
  assert.equal((await actions.reopenTask('shared')).success, false)
  assert.equal((await actions.completeTask('shared')).success, false)
  assert.equal((await actions.restoreTask('shared', 'inbox')).success, true)
  assert.equal(task.status, 'new')
  assert.equal((await actions.restoreTask('shared', 'inbox')).success, false)
})

test('task actions reject blank or corrupt values before writing', async () => {
  let writes = 0
  const task = { id: 't', board_id: 'board', column_id: 'inbox', status: 'new', submitted_by: 'admin', assigned_to: null, custom_fields: {} }
  const actions = loadTs('src/lib/actions/tasks.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/auth': { requireRole: async () => ({ id: 'admin', role: 'super_admin' }) },
    '@/lib/local-data': {
      DEFAULT_BOARD_ID: 'board', getTaskById: async () => task,
      getActiveColumns: async () => [{ id: 'inbox', board_id: 'board', is_default: true, is_archive: false }],
      getActiveTasks: async () => [], findUser: () => null, createActivityLog: async () => {},
      createTask: async () => { writes++; return task }, updateTask: async () => { writes++; return task },
    },
    './email': {},
    '@/lib/integrations/google-calendar': { upsertGoogleCalendarEvent: async () => ({ status: 'skipped' }) },
    '@/lib/utils': { getAssignedUserIds: () => [], isTaskAssignedToUser: () => false },
  })
  assert.equal((await actions.createTask({ title: '   ', priority: 'normal' })).success, false)
  assert.equal((await actions.createTask({ title: 'Valid', priority: 'nuclear' })).success, false)
  assert.equal((await actions.updateTask({ id: 't', status: 'banana' })).success, false)
  assert.equal((await actions.updateTask({ id: 't', priority: 'nuclear' })).success, false)
  assert.equal((await actions.updateTask({ id: 't', due_date: 'not-a-date' })).success, false)
  assert.equal((await actions.updateTask({ id: 't', column_id: 'missing' })).success, false)
  assert.equal((await actions.updateTask({ id: 't', status: 'completed' })).success, false)
  assert.equal(writes, 0)
})
