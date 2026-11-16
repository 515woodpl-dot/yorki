#!/usr/bin/env node
// Run with the service stopped, after a verified backup. Never deletes originals.
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const Database = require('better-sqlite3')
const { loadEnvConfig } = require('@next/env')
loadEnvConfig(process.cwd(), false)
const dbPath = path.resolve(process.env.YORKI_DB_PATH?.trim() || path.join(process.env.YORKI_DB_DIR?.trim() || 'data', 'yorki.db'))
const publicRoot = path.join(process.cwd(), 'public', 'uploads')
const db = new Database(dbPath, { fileMustExist: true })
try {
  const rows = db.prepare('SELECT id, storage_path FROM attachments WHERE deleted_at IS NULL').all()
  const updates = []
  for (const row of rows) {
    const source = path.resolve(row.storage_path)
    if (!source.startsWith(publicRoot + path.sep)) continue
    if (!fs.existsSync(source)) throw new Error(`Missing attachment ${row.id}; migration stopped`)
    const targetDir = path.join(path.dirname(dbPath), 'uploads', 'legacy')
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 })
    const target = path.join(targetDir, randomUUID())
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
    fs.chmodSync(target, 0o600)
    updates.push({ id: row.id, target })
  }
  db.transaction(() => {
    const update = db.prepare('UPDATE attachments SET storage_path = ?, public_url = ? WHERE id = ?')
    for (const row of updates) update.run(row.target, `/api/attachments/${encodeURIComponent(row.id)}`, row.id)
  })()
  console.log(`[uploads] Migrated ${updates.length} legacy attachments to private storage; originals retained.`)
} finally { db.close() }
