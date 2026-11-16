#!/usr/bin/env node
// Run from the deployed app directory. Pause writes for a consistent DB/files pair.
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { loadEnvConfig } = require('@next/env')

async function main() {
  loadEnvConfig(process.cwd(), false)
  const dbPath = path.resolve(process.env.YORKI_DB_PATH?.trim()
    || path.join(process.env.YORKI_DB_DIR?.trim() || 'data', 'yorki.db'))
  const dbDir = path.dirname(dbPath)
  const root = path.resolve(process.env.BACKUP_ROOT || '/var/backups/yorki')
  if (root === dbDir || root.startsWith(dbDir + path.sep)) throw new Error('Backup location must be outside the data directory.')
  const target = path.join(root, new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid)
  fs.mkdirSync(target, { recursive: true, mode: 0o700 })
  fs.chmodSync(target, 0o700)
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    // Online backup API folds committed WAL into one standalone DB snapshot.
    await db.backup(path.join(target, 'yorki.db'))
  } finally { db.close() }
  const snapshot = new Database(path.join(target, 'yorki.db'))
  try {
    snapshot.pragma('journal_mode = DELETE')
    const integrity = snapshot.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw new Error('Snapshot integrity check failed')
  } finally { snapshot.close() }
  fs.chmodSync(path.join(target, 'yorki.db'), 0o600)
  for (const [source, name] of [[path.join(dbDir, 'uploads'), 'uploads'], [path.join(process.cwd(), 'public/uploads'), 'legacy-public-uploads']]) {
    if (fs.existsSync(source)) fs.cpSync(source, path.join(target, name), { recursive: true })
  }
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    if (fs.existsSync(name)) {
      fs.copyFileSync(name, path.join(target, name))
      fs.chmodSync(path.join(target, name), 0o600)
    }
  }
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({
    createdAt: new Date().toISOString(), dbPath, appDir: process.cwd(),
    databaseFile: 'yorki.db', includesWal: false,
    note: 'Restore this standalone DB without any old -wal or -shm files. Pause writes while pairing DB and uploads.',
  }, null, 2), { mode: 0o600 })
  fs.writeFileSync(path.join(target, 'COMPLETE'), 'ok\n', { mode: 0o600 })
  fs.writeFileSync(path.join(root, 'LATEST'), target + '\n', { mode: 0o600 })
  console.log(`[backup] Complete, integrity verified: ${target}`)
}
main().catch(err => { console.error('[backup] Failed:', err.message); process.exitCode = 1 })
