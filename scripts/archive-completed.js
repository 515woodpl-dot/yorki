const Database = require('better-sqlite3')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')

function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return

  const raw = fs.readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue

    const key = trimmed.slice(0, separator).trim()
    if (!key || process.env[key] !== undefined) continue

    let value = trimmed.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

loadEnvFile()

function resolveDbPath() {
  const explicitPath = process.env.YORKI_DB_PATH && process.env.YORKI_DB_PATH.trim()
  if (explicitPath) return path.resolve(explicitPath)

  const explicitDir = process.env.YORKI_DB_DIR && process.env.YORKI_DB_DIR.trim()
  if (explicitDir) return path.join(path.resolve(explicitDir), 'yorki.db')

  return path.join(process.cwd(), 'data', 'yorki.db')
}

const dbPath = resolveDbPath()
if (!fs.existsSync(dbPath)) {
  console.error(`[archive-completed] Database not found at ${dbPath}`)
  process.exit(1)
}

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const now = new Date().toISOString()
const archiveColumn = db.prepare(`
  SELECT id
  FROM columns
  WHERE is_archive = 1 AND deleted_at IS NULL
  ORDER BY position ASC
  LIMIT 1
`).get()

if (!archiveColumn) {
  console.error('[archive-completed] Archive column not found.')
  process.exit(1)
}

const completedTasks = db.prepare(`
  SELECT id
  FROM tasks
  WHERE deleted_at IS NULL
    AND status = 'completed'
    AND column_id != ?
`).all(archiveColumn.id)

if (!completedTasks.length) {
  console.log('[archive-completed] No completed tasks to archive.')
  process.exit(0)
}

const updateTask = db.prepare(`
  UPDATE tasks
  SET status = 'archived',
      column_id = ?,
      updated_at = ?
  WHERE id = ?
`)

const logActivity = db.prepare(`
  INSERT INTO activity_logs (id, actor_id, task_id, entity_type, entity_id, action, metadata, created_at)
  VALUES (?, NULL, ?, 'task', ?, 'task_archived', ?, ?)
`)

const transaction = db.transaction(() => {
  for (const task of completedTasks) {
    updateTask.run(archiveColumn.id, now, task.id)
    logActivity.run(
      crypto.randomUUID(),
      task.id,
      task.id,
      JSON.stringify({ automated: true, reason: 'Friday 9pm archive job' }),
      now,
    )
  }
})

transaction()
console.log(`[archive-completed] Archived ${completedTasks.length} completed task(s).`)
