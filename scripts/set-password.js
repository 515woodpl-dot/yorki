/**
 * Run once after first server start to set George's password:
 *   node scripts/set-password.js
 */
const Database = require('better-sqlite3')
const bcrypt   = require('bcryptjs')
const path     = require('path')

const DB_PATH = path.join(__dirname, '..', 'data', 'yorki.db')
const db      = new Database(DB_PATH)

const email    = 'george@yorki'
const password = 'yorki1234'
const hash     = bcrypt.hashSync(password, 12)

const result = db.prepare(
  'UPDATE users SET password_hash = ? WHERE email = ?'
).run(hash, email)

if (result.changes > 0) {
  console.log(`✓ Password set for ${email}`)
  console.log(`  Login with: ${email} / ${password}`)
} else {
  console.log(`✗ User not found: ${email} — make sure the server has run at least once`)
}

db.close()
