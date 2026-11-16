/**
 * db.ts — SQLite database layer
 *
 * Single connection, WAL mode for concurrent reads.
 * All schema creation is idempotent (CREATE TABLE IF NOT EXISTS).
 * JSON columns store arrays/objects as serialised strings.
 */

import Database from 'better-sqlite3'
import fs from 'node:fs'
import { YORKI_DB_DIR, YORKI_DB_PATH } from './db-config'

// Ensure data directory exists
fs.mkdirSync(YORKI_DB_DIR, { recursive: true })

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db

  const db = new Database(YORKI_DB_PATH)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 5000')
    db.transaction(() => migrate(db)).immediate()
    _db = db
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

// ─── Schema ───────────────────────────────────────────────────────────────────

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      slug        TEXT NOT NULL,
      description TEXT,
      is_default  INTEGER NOT NULL DEFAULT 0,
      created_by  TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      deleted_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS columns (
      id         TEXT PRIMARY KEY,
      board_id   TEXT NOT NULL,
      name       TEXT NOT NULL,
      color      TEXT,
      position   REAL NOT NULL DEFAULT 1000,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_archive INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      full_name    TEXT,
      display_name TEXT,
      email        TEXT,
      department   TEXT,
      role         TEXT NOT NULL DEFAULT 'staff',
      avatar_url   TEXT,
      is_active     INTEGER NOT NULL DEFAULT 1,
      password_hash TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      email TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      first_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_login_attempts_time ON login_attempts(first_at);

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id              TEXT PRIMARY KEY,
      board_id        TEXT NOT NULL,
      column_id       TEXT NOT NULL,
      title           TEXT NOT NULL,
      description     TEXT,
      status          TEXT NOT NULL DEFAULT 'new',
      priority        TEXT NOT NULL DEFAULT 'normal',
      position        REAL NOT NULL DEFAULT 1000,
      submitted_by    TEXT NOT NULL,
      assigned_to     TEXT,
      due_date        TEXT,
      has_real_due_date INTEGER NOT NULL DEFAULT 0,
      completed_at    TEXT,
      labels          TEXT NOT NULL DEFAULT '[]',
      watchers        TEXT NOT NULL DEFAULT '[]',
      google_calendar_event_id TEXT,
      custom_fields   TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      deleted_at      TEXT
    );

    CREATE TABLE IF NOT EXISTS comments (
      id          TEXT PRIMARY KEY,
      task_id     TEXT NOT NULL,
      author_id   TEXT NOT NULL,
      body        TEXT NOT NULL,
      is_internal INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      deleted_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id           TEXT PRIMARY KEY,
      task_id      TEXT NOT NULL,
      uploaded_by  TEXT NOT NULL,
      file_name    TEXT NOT NULL,
      file_size    INTEGER,
      file_type    TEXT,
      storage_path TEXT NOT NULL,
      public_url   TEXT,
      created_at   TEXT NOT NULL,
      deleted_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id          TEXT PRIMARY KEY,
      actor_id    TEXT,
      task_id     TEXT,
      entity_type TEXT NOT NULL,
      entity_id   TEXT,
      action      TEXT NOT NULL,
      metadata    TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id         TEXT PRIMARY KEY,
      key        TEXT NOT NULL UNIQUE,
      value      TEXT NOT NULL DEFAULT '{}',
      updated_by TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invites (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      token      TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at    TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_board    ON tasks(board_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_column   ON tasks(column_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_deleted  ON tasks(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_comments_task  ON comments(task_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);
    CREATE INDEX IF NOT EXISTS idx_activity_task  ON activity_logs(task_id);
    CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token);
  `)

  const duplicateEmails = db.prepare(`
    SELECT LOWER(email) AS email, COUNT(*) AS count
    FROM users
    WHERE email IS NOT NULL AND TRIM(email) != ''
    GROUP BY LOWER(email)
    HAVING COUNT(*) > 1
  `).all() as Array<{ email: string; count: number }>

  if (duplicateEmails.length > 0) {
    throw new Error(`Duplicate user emails detected: ${duplicateEmails.map((row) => row.email).join(', ')}`)
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
    ON users(LOWER(email))
    WHERE email IS NOT NULL AND TRIM(email) != '';
  `)

  ensureColumn(db, 'tasks', 'google_calendar_event_id', 'TEXT')

  // Seed if empty
  const boardCount = (db.prepare('SELECT COUNT(*) as n FROM boards').get() as { n: number }).n
  if (boardCount === 0) seedDb(db)
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

function seedDb(db: Database.Database) {
  const now = new Date().toISOString()
  const BOARD_ID = '00000000-0000-0000-0000-000000000001'
  const USER_ID  = '11111111-1111-1111-1111-111111111111'
  const USER2_ID = '22222222-2222-2222-2222-222222222222'

  db.prepare(`INSERT INTO boards VALUES (?,?,?,?,?,?,?,?,?)`).run(
    BOARD_ID,'Yorki Workspace','default','Local-first workspace.',1,USER_ID,now,now,null
  )

  const cols = [
    ['c-inbox',    BOARD_ID,'Inbox',    '#3b82f6',1000,1,0],
    ['c-pending',  BOARD_ID,'Pending',  '#f59e0b',2000,0,0],
    ['c-completed',BOARD_ID,'Completed','#10b981',3000,0,0],
    ['c-archive',  BOARD_ID,'Archive',  '#6b7280',4000,0,1],
  ]
  const insCol = db.prepare(`INSERT INTO columns VALUES (?,?,?,?,?,?,?,?,?,?)`)
  for (const c of cols) insCol.run(...c, now, now, null)

  db.prepare(`INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    USER_ID,'George','George','george@yorki',null,'super_admin',null,1,null,now,now
  )
  db.prepare(`INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    USER2_ID,'Mia Porter','Mia','mia@yorki.local',null,'staff',null,1,null,now,now
  )

  const insTask = db.prepare(`INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  insTask.run('t-1',BOARD_ID,'c-inbox','Finalize Yorki board polish',
    'Tighten spacing, interaction feel, and visual hierarchy.',
    'new','high',1000,USER_ID,null,null,0,null,
    '["design"]',JSON.stringify([USER_ID]),null,'{}',now,now,null)
  insTask.run('t-2',BOARD_ID,'c-pending','Clarify mobile nav behavior',
    'Make the bottom nav feel deliberate.',
    'pending','normal',1000,USER2_ID,USER_ID,null,0,null,
    '["ux"]',JSON.stringify([USER_ID]),null,'{}',now,now,null)
  insTask.run('t-3',BOARD_ID,'c-completed','Rename app to Yorki',
    'Update visible branding defaults.',
    'completed','low',1000,USER_ID,USER_ID,null,0,now,
    '["branding"]',JSON.stringify([USER_ID]),null,'{}',now,now,null)

  db.prepare(`INSERT INTO comments VALUES (?,?,?,?,?,?,?,?)`).run(
    'cm-1','t-1',USER_ID,
    "Let's keep polishing the board before we wire permissions back in.",
    0,now,now,null
  )

  // Default settings
  const insSetting = db.prepare(`INSERT INTO settings VALUES (?,?,?,?,?)`)
  insSetting.run('s-1','theme',JSON.stringify({default_mode:'auto'}),USER_ID,now)
  insSetting.run('s-2','email',JSON.stringify({
    notification_to:'team@yorki.local',reply_to:null,
    subject_prefix:'[Yorki]',notify_on_submit:true,
    notify_on_complete:true,notify_on_comment:false
  }),USER_ID,now)
}
