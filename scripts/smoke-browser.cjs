// Run after npm run build. Uses an isolated DB and local port; never the live site.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { chromium } = require('playwright')
const Database = require('better-sqlite3')
const bcrypt = require('bcryptjs')
const assert = require('node:assert/strict')

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yorki-browser-'))
  const dbPath = path.join(dir, 'yorki.db')
  const port = process.env.TEST_PORT || '3100'
  const base = `http://127.0.0.1:${port}/task`
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', port], {
    env: { ...process.env, NODE_ENV: 'production', YORKI_DB_PATH: dbPath }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  server.stdout.on('data', chunk => { logs += chunk })
  server.stderr.on('data', chunk => { logs += chunk })
  let browser
  try {
    let ready = false
    for (let i = 0; i < 80; i++) {
      if (server.exitCode !== null) throw new Error(logs)
      try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    assert.ok(ready, logs)
    const health = await fetch(`${base}/api/health`)
    assert.equal(health.headers.get('cache-control'), 'no-store')
    assert.deepEqual(Object.keys(await health.json()).sort(), ['status', 'time'])
    const db = new Database(dbPath)
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + 3600000).toISOString()
    db.prepare('UPDATE users SET email = ?, password_hash = ? WHERE id = ?')
      .run('admin@example.com', bcrypt.hashSync('Test-password-1234', 12), '11111111-1111-1111-1111-111111111111')
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run('staff@example.com', '22222222-2222-2222-2222-222222222222')
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run('staff-test-session', '22222222-2222-2222-2222-222222222222', now, expires)
    db.prepare('INSERT INTO comments VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('private-note', 't-2', '11111111-1111-1111-1111-111111111111', 'SECRET-INTERNAL-NOTE', 1, now, now, null)
    const privateFile = path.join(dir, 'private.txt')
    fs.writeFileSync(privateFile, 'PRIVATE-ATTACHMENT')
    const insertAttachment = db.prepare('INSERT INTO attachments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    insertAttachment.run('admin-file', 't-1', '11111111-1111-1111-1111-111111111111', 'private.txt', 18, 'text/plain', privateFile, '/api/attachments/admin-file', now, null)
    insertAttachment.run('staff-file', 't-2', '11111111-1111-1111-1111-111111111111', 'private.txt', 18, 'text/plain', privateFile, '/api/attachments/staff-file', now, null)
    db.prepare("UPDATE tasks SET custom_fields = ? WHERE id = 't-1'").run(JSON.stringify({ share_token: 'test-public-share' }))
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] })
    const anonymous = await browser.newContext({ serviceWorkers: 'block' })
    const page = await anonymous.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    for (const route of ['/dashboard', '/admin/users', '/archive', '/submit']) {
      const response = await fetch(base + route, { redirect: 'manual' })
      assert.equal(response.status, 307, route)
      assert.equal(response.headers.get('location'), '/task/login', route)
    }
    await page.goto(base + '/admin/users')
    await page.waitForURL('**/task/login')
    await page.locator('input[type=email]').fill('admin@example.com')
    await page.locator('input[type=password]').fill('Test-password-1234')
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL('**/task/dashboard')
    await page.getByText('Finalize Yorki board polish', { exact: true }).filter({ visible: true }).waitFor()
    assert.equal((await anonymous.request.get(base + '/api/attachments/admin-file')).status(), 200)
    await page.goto(base + '/admin/users')
    await page.getByText('admin@example.com', { exact: true }).first().waitFor()
    assert.equal((await page.content()).includes('password_hash'), false)
    const staffContext = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } })
    await staffContext.addCookies([{ name: 'yorki_session', value: 'staff-test-session', url: base }])
    const staffPage = await staffContext.newPage()
    staffPage.on('pageerror', error => errors.push(error.message))
    await staffPage.goto(base + '/dashboard')
    await staffPage.getByRole('button', { name: 'Pending (1)', exact: true }).click()
    await staffPage.getByText('Clarify mobile nav behavior', { exact: true }).filter({ visible: true }).waitFor()
    const staffHtml = await staffPage.content()
    assert.equal(staffHtml.includes('SECRET-INTERNAL-NOTE'), false)
    assert.equal(staffHtml.includes('Finalize Yorki board polish'), false)
    assert.equal((await staffContext.request.get(base + '/api/attachments/admin-file')).status(), 403)
    const fileResponse = await staffContext.request.get(base + '/api/attachments/staff-file')
    assert.equal(fileResponse.status(), 200)
    assert.equal(await fileResponse.text(), 'PRIVATE-ATTACHMENT')
    assert.ok(fileResponse.headers()['cache-control'].includes('no-store'))
    const upload = await staffContext.request.post(base + '/api/upload', { multipart: {
      task_id: 't-2', file: { name: 'staff.txt', mimeType: 'text/plain', buffer: Buffer.from('test-upload') },
    } })
    assert.equal(upload.status(), 200)
    const deniedUpload = await staffContext.request.post(base + '/api/upload', { multipart: {
      task_id: 't-1', file: { name: 'denied.txt', mimeType: 'text/plain', buffer: Buffer.from('denied') },
    } })
    assert.equal(deniedUpload.status(), 403)
    await staffPage.goto(base + '/admin/users')
    await staffPage.waitForURL('**/task/dashboard')
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run('22222222-2222-2222-2222-222222222222')
    await staffPage.goto(base + '/dashboard')
    await staffPage.waitForURL('**/task/login')
    const logout = await anonymous.request.post(base + '/signout')
    assert.equal(logout.status(), 200)
    await page.goto(base + '/dashboard')
    await page.waitForURL('**/task/login')
    assert.equal((await anonymous.request.get(base + '/api/attachments/admin-file')).status(), 403)
    assert.equal((await anonymous.request.get(base + '/api/attachments/admin-file?token=test-public-share')).status(), 200)
    assert.deepEqual(errors, [])
    db.close()
    console.log('Browser smoke passed: anonymous guards, admin login/users, mobile staff visibility, internal notes, attachments/uploads/sharing, deactivation, logout; no page errors.')
  } catch (err) {
    console.error(logs.slice(-3000))
    throw err
  } finally {
    if (browser) await browser.close()
    server.kill('SIGTERM')
    await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve) })
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
