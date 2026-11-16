/** Explicit operator-only password reset. Never prints the password. */
const Database = require('better-sqlite3')
const bcrypt = require('bcryptjs')
const path = require('node:path')

const email = process.env.YORKI_ADMIN_EMAIL?.trim().toLowerCase()
const password = process.env.YORKI_ADMIN_PASSWORD
if (!email || !password || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
  console.error('Set YORKI_ADMIN_EMAIL and YORKI_ADMIN_PASSWORD (12+ characters, at most 72 UTF-8 bytes).')
  process.exit(1)
}
const dbPath = process.env.YORKI_DB_PATH?.trim()
  || path.join(process.env.YORKI_DB_DIR?.trim() || path.join(__dirname, '..', 'data'), 'yorki.db')
const db = new Database(dbPath, { fileMustExist: true })
try {
  const hash = bcrypt.hashSync(password, 12)
  db.transaction(() => {
    const user = db.prepare('SELECT id FROM users WHERE LOWER(email) = ? AND is_active = 1').get(email)
    if (!user) throw new Error('Active user not found; initialize the app database first.')
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(hash, new Date().toISOString(), user.id)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)
    db.prepare('DELETE FROM invites WHERE user_id = ?').run(user.id)
  })()
  console.log(`Password reset and existing sessions/invites revoked for ${email}`)
} finally {
  db.close()
}
