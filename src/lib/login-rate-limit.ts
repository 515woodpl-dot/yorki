import type Database from 'better-sqlite3'

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000

// Reserve an attempt before the asynchronous password check. SQLite serializes
// the transaction across workers, so simultaneous requests cannot bypass it.
export function reserveLoginAttempt(db: Database.Database, email: string, now = Date.now()) {
  return db.transaction(() => {
    db.prepare('DELETE FROM login_attempts WHERE first_at <= ?').run(now - WINDOW_MS)
    const row = db.prepare('SELECT count, first_at FROM login_attempts WHERE email = ?')
      .get(email) as { count: number; first_at: number } | undefined
    if (row && row.count >= MAX_ATTEMPTS) {
      return { allowed: false, remainingMs: WINDOW_MS - (now - row.first_at) }
    }
    db.prepare(`INSERT INTO login_attempts (email, count, first_at) VALUES (?, 1, ?)
      ON CONFLICT(email) DO UPDATE SET count = count + 1`).run(email, now)
    return { allowed: true }
  }).immediate()
}

export function clearLoginAttempts(db: Database.Database, email: string) {
  db.prepare('DELETE FROM login_attempts WHERE email = ?').run(email)
}
