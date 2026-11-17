// Sign in, sign out and user management with JavaScript turned OFF in the browser:
// these are plain forms, so they must work even when a page's scripts never load.
const { chromium } = require('playwright')
const Database = require('better-sqlite3')
const bcrypt = require('bcryptjs')
const BASE = 'http://127.0.0.1:3100/task'
const results = []
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`)

;(async () => {
  const db = new Database(`${process.env.SP}/db/yorki.db`)
  const hash = bcrypt.hashSync('Passw0rd!x', 4)
  db.prepare("UPDATE users SET password_hash=? WHERE role='super_admin'").run(hash)
  const now = new Date().toISOString()
  db.prepare("INSERT INTO users (id,full_name,display_name,email,role,is_active,password_hash,created_at,updated_at) VALUES ('u-t1','Test One','Test','t1@yorki.local','staff',1,?,?,?)").run(hash, now, now)

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: process.env.CHROMIUM_PATH ? ['--no-sandbox'] : [] })
  for (const js of [false, true]) {
    const tag = js ? '(JS on)' : '(JS off)'
    const ctx = await browser.newContext({ javaScriptEnabled: js, viewport: { width: 1300, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/login`)
    await page.fill('#email', 'george@yorki'); await page.fill('#password', 'wrong-password')
    await page.click('button[type=submit]'); await page.waitForURL(/login\?/)
    check(`sign in ${tag}: wrong password shows a message`, /Incorrect email or password/.test(await page.locator('p[role=alert]').innerText()))
    await page.fill('#email', 'nobody@yorki.local'); await page.fill('#password', 'x')
    await page.click('button[type=submit]'); await page.waitForURL(/login\?/)
    check(`sign in ${tag}: unknown account shows a message`, (await page.locator('p[role=alert]').count()) === 1)
    await page.fill('#email', 'george@yorki'); await page.fill('#password', 'Passw0rd!x')
    await page.click('button[type=submit]'); await page.waitForURL(/dashboard/)
    check(`sign in ${tag}: correct password lands on the board`, /dashboard/.test(page.url()))

    await page.goto(`${BASE}/admin/users`)
    await page.locator('select[aria-label="Role for Mia"]').selectOption('admin')
    await page.locator('li', { hasText: 'mia@yorki.local' }).getByRole('button', { name: 'Save role' }).click()
    await page.waitForSelector('p[role=status]')
    check(`users ${tag}: role change saves with a visible message`, /Role saved: Admin/.test(await page.locator('p[role=status]').innerText()))
    check(`users ${tag}: role stays after reload`, db.prepare("SELECT role FROM users WHERE id='22222222-2222-2222-2222-222222222222'").get().role === 'admin')
    await page.locator('select[aria-label="Role for Mia"]').selectOption('staff')
    await page.locator('li', { hasText: 'mia@yorki.local' }).getByRole('button', { name: 'Save role' }).click(); await page.waitForSelector('p[role=status]')

    const uid = js ? 'u-t2' : 'u-t1'
    if (js) db.prepare("INSERT INTO users (id,full_name,display_name,email,role,is_active,password_hash,created_at,updated_at) VALUES ('u-t2','Test Two','Test2','t2@yorki.local','staff',1,?,?,?)").run(hash, now, now)
    await page.goto(`${BASE}/admin/users?delete=${uid}`)
    await page.getByRole('button', { name: 'Yes, delete permanently' }).click(); await page.waitForSelector('p[role=status]')
    check(`users ${tag}: delete asks first, then deletes`, !db.prepare('SELECT 1 FROM users WHERE id=?').get(uid) && /deleted/.test(await page.locator('p[role=status]').innerText()))

    await page.goto(`${BASE}/dashboard`)
    await page.locator('summary[aria-label="Account menu"]').first().click()
    await page.getByRole('button', { name: 'Sign out' }).first().click()
    await page.waitForURL(/login/, { timeout: 15000 })
    await page.goto(`${BASE}/dashboard`)
    check(`sign out ${tag}: leaves you signed out`, /login/.test(page.url()))
    await ctx.close()
  }
  await browser.close()
  console.log(results.join('\n'))
  process.exit(results.some((line) => line.startsWith('FAIL')) ? 1 : 0)
})().catch((error) => { console.log(results.join('\n')); console.error(error); process.exit(1) })
