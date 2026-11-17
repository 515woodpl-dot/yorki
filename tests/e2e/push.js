// Push notifications in a real browser.
//  A. the API: who may register what (security) and settings;
//  B. the service worker: a pushed message is shown / suppressed / opens the right card
//     (delivered to the real worker through Chrome DevTools — no push service involved);
//  C. the settings page, in each situation (can turn on / blocked / iPhone not installed / devices).
// NOT covered here: delivery through Google/Apple/Mozilla's servers (see tests/push.test.cjs for the
// encryption + signature check, and docs/PUSH.md for the manual phone check).
const { chromium, devices } = require('playwright')
const crypto = require('node:crypto')
const ORIGIN = 'http://127.0.0.1:3100'
const BASE = `${ORIGIN}/task`
const results = []
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`)
const pageErrors = []

async function until(fn, ms = 8000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)) }
  return false
}
const subscriptionBody = (suffix = crypto.randomBytes(4).toString('hex'), endpoint) => {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys()
  return { endpoint: endpoint ?? `https://fcm.googleapis.com/fcm/send/e2e-${suffix}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } }
}

;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: process.env.CHROMIUM_PATH ? ['--no-sandbox'] : [] })
  const open = async (sid, options = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options })
    if (sid) await ctx.addCookies([{ name: 'yorki_session', value: sid, domain: '127.0.0.1', path: '/' }])
    ctx.on('page', (p) => p.on('pageerror', (e) => pageErrors.push(e.message)))
    return ctx
  }
  const json = { 'Content-Type': 'application/json' }

  // ─── A · the API ───────────────────────────────────────────────────────────
  {
    const anon = await open(null)
    check('api: signed-out visitors are refused', (await anon.request.get(`${BASE}/api/push/state`)).status() === 401)
    check('api: …for every endpoint', (await anon.request.post(`${BASE}/api/push/subscribe`, { headers: json, data: subscriptionBody() })).status() === 401 && (await anon.request.put(`${BASE}/api/push/prefs`, { headers: json, data: {} })).status() === 401)
    await anon.close()

    const ana = await open('sess-ana'); const mia = await open('sess-mia')
    const state = await (await ana.request.get(`${BASE}/api/push/state`)).json()
    check('api: public key is handed out, private key never', /^[A-Za-z0-9_-]{87}$/.test(state.publicKey) && !JSON.stringify(state).includes('privateKey'))
    check('api: everything on by default, no devices', Object.values(state.prefs).every(Boolean) && state.devices.length === 0)

    const post = (ctx, body, headers = json) => ctx.request.post(`${BASE}/api/push/subscribe`, { headers, data: body })
    for (const [label, endpoint] of [['plain http', 'http://fcm.googleapis.com/fcm/send/x'], ['localhost', 'https://localhost/x'], ['an internal address', 'https://169.254.169.254/latest/meta-data'], ['a look-alike host', 'https://fcm.googleapis.com.evil.com/x'], ['an unknown service', 'https://evil.example/x']]) {
      const res = await post(ana, subscriptionBody('bad', endpoint))
      check(`api: refuses ${label}`, res.status() === 400, `(${res.status()})`)
    }
    check('api: refuses malformed keys', (await post(ana, { endpoint: 'https://fcm.googleapis.com/fcm/send/k', keys: { p256dh: 'abc', auth: 'def' } })).status() === 400)
    check('api: refuses an empty / junk body', (await post(ana, {})).status() === 400 && (await ana.request.post(`${BASE}/api/push/subscribe`, { headers: json, data: 'not json{' })).status() === 400)
    check('api: nothing was stored by the refusals', (await (await ana.request.get(`${BASE}/api/push/state`)).json()).devices.length === 0)

    check('api: refuses a request from another website', (await post(ana, subscriptionBody(), { ...json, Origin: 'https://evil.example' })).status() === 403)
    check('api: refuses a non-JSON (form) request', (await post(ana, subscriptionBody(), { 'Content-Type': 'application/x-www-form-urlencoded' })).status() === 415)
    check('api: accepts a same-site request', (await post(ana, subscriptionBody(), { ...json, Origin: ORIGIN })).status() === 200)

    const ok = await post(ana, subscriptionBody('mine'))
    const body = await ok.json()
    const devices = (await (await ana.request.get(`${BASE}/api/push/state`)).json()).devices
    check('api: a valid device is saved with a readable name', ok.status() === 200 && devices.length === 2 && /Chrome on Linux/.test(devices[0].label), `(${devices.map((d) => d.label).join(', ')})`)
    check('api: it is private to the person', (await (await mia.request.get(`${BASE}/api/push/state`)).json()).devices.length === 0)

    const miaRemoves = await mia.request.delete(`${BASE}/api/push/subscribe`, { headers: json, data: { id: body.id } })
    check("api: someone else can't remove my device", (await miaRemoves.json()).removed === false && (await (await ana.request.get(`${BASE}/api/push/state`)).json()).devices.length === 2)
    const own = await ana.request.delete(`${BASE}/api/push/subscribe`, { headers: json, data: { id: body.id } })
    check('api: I can remove my own', (await own.json()).removed === true)

    const put = await ana.request.put(`${BASE}/api/push/prefs`, { headers: json, data: { comment: false, show_preview: false, hacker: true, mention: 'nope' } })
    const prefs = (await put.json()).prefs
    check('api: preferences are saved (known keys, real booleans only)', prefs.comment === false && prefs.show_preview === false && prefs.mention === true && !('hacker' in prefs))
    check('api: …and remembered', (await (await ana.request.get(`${BASE}/api/push/state`)).json()).prefs.comment === false)
    check("api: …per person", (await (await mia.request.get(`${BASE}/api/push/state`)).json()).prefs.comment === true)

    const first = await mia.request.post(`${BASE}/api/push/test`, { headers: json, data: {} })
    check('api: test with no device says so', first.status() === 409)
    check('api: test is rate-limited', (await mia.request.post(`${BASE}/api/push/test`, { headers: json, data: {} })).status() === 429)
    // clean up for later parts
    for (const d of (await (await ana.request.get(`${BASE}/api/push/state`)).json()).devices) await ana.request.delete(`${BASE}/api/push/subscribe`, { headers: json, data: { id: d.id } })
    await ana.request.put(`${BASE}/api/push/prefs`, { headers: json, data: { comment: true, show_preview: true } })
    await ana.close(); await mia.close()
  }

  // ─── B · the service worker ────────────────────────────────────────────────
  {
    const ctx = await open('sess-ana')
    await ctx.grantPermissions(['notifications'], { origin: ORIGIN })
    const app = await ctx.newPage()
    await app.goto(`${BASE}/dashboard`)
    await app.evaluate(() => navigator.serviceWorker.ready)
    check('worker: the service worker is running', await until(async () => (await app.evaluate(() => !!navigator.serviceWorker.controller)) || (await app.reload().then(() => app.evaluate(() => !!navigator.serviceWorker.controller)))))
    const other = await ctx.newPage()
    await other.goto('about:blank')

    const cdp = await ctx.newCDPSession(app)
    let registrations = []
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => { registrations = e.registrations })
    await cdp.send('ServiceWorker.enable')
    await until(async () => registrations.length > 0, 4000)
    const registrationId = registrations.find((r) => r.scopeURL.includes('/task/'))?.registrationId
    check('worker: found its registration', Boolean(registrationId))

    const push = (payload, raw) => cdp.send('ServiceWorker.deliverPushMessage', { origin: ORIGIN, registrationId, data: raw ?? JSON.stringify(payload) })
    const shown = async () => {
      const worker = ctx.serviceWorkers().find((w) => w.url().includes('/task/sw.js'))
      return worker ? worker.evaluate(() => self.registration.getNotifications().then((list) => list.map((n) => ({ title: n.title, body: n.body, tag: n.tag, path: n.data && n.data.path })))) : []
    }
    const clear = async () => { const w = ctx.serviceWorkers().find((x) => x.url().includes('/task/sw.js')); if (w) await w.evaluate(() => self.registration.getNotifications().then((l) => l.forEach((n) => n.close()))) }
    const mention = { v: 1, title: 'Mia Porter mentioned you', body: 'Can you check the spacing?', path: '/dashboard?task=t-1', tag: 'yorki-mention-t-1', type: 'mention', unread: 2, ts: Date.now() }

    // App in the background → a system notification appears.
    await other.bringToFront()
    await push(mention)
    check('worker: shows a notification when the app is not in front', await until(async () => (await shown()).length === 1))
    const n = (await shown())[0] ?? {}
    check('worker: with the right text and destination', n.title === mention.title && n.body === mention.body && n.path === '/dashboard?task=t-1' && n.tag === 'yorki-mention-t-1', JSON.stringify(n))

    // Same task again → replaces, doesn't stack.
    await push({ ...mention, body: 'Second message' })
    await new Promise((r) => setTimeout(r, 600))
    const stacked = await shown()
    check('worker: the same task replaces the earlier alert (no pile-up)', stacked.length === 1 && stacked[0].body === 'Second message', `(${stacked.length} shown)`)

    // Tapping it while the app is open: focus + go to the card, no reload.
    await app.goto(`${BASE}/dashboard`)
    // Let the app finish starting (it attaches its listener for "go to this card" messages once it has loaded).
    await app.waitForLoadState('networkidle').catch(() => {})
    await app.getByRole('region', { name: 'Quick add' }).waitFor()
    await other.bringToFront()
    await ctx.serviceWorkers().find((w) => w.url().includes('/task/sw.js')).evaluate(async () => {
      const [notification] = await self.registration.getNotifications()
      self.dispatchEvent(new NotificationEvent('notificationclick', { notification, action: '' }))
    })
    // A real tap also brings the app to the front (focus() needs a genuine tap, which a simulated one isn't).
    await app.bringToFront()
    check('worker: tapping it opens the right card in the open app', await until(async () => /[?&]task=t-1/.test(app.url())), `(${app.url()})`)
    check('worker: …and the alert goes away', await until(async () => (await shown()).length === 0))

    // App in front → the in-app bell is enough; no system banner (Chrome allows this; iPhone does not, and always shows).
    await app.bringToFront()
    const focused = await app.evaluate(() => document.hasFocus())
    await push({ ...mention, tag: 'yorki-mention-focused' })
    await new Promise((r) => setTimeout(r, 700))
    if (focused) check('worker: no duplicate banner while you are looking at the app', (await shown()).length === 0)
    else check('worker: (focus not emulated here — suppression not checked)', true)
    await push({ v: 1, title: 'Yorki notifications are on', body: 'This is a test.', path: '/dashboard', tag: 'yorki-test-general', type: 'test', unread: 0, ts: Date.now() })
    check('worker: a test notification always shows, even when the app is in front', await until(async () => (await shown()).some((x) => x.tag === 'yorki-test-general')))
    await clear()

    // Hostile or broken messages.
    await other.bringToFront()
    await push({ ...mention, tag: 'evil', path: '//evil.example/steal' })
    await until(async () => (await shown()).some((x) => x.tag === 'evil'))
    check('worker: a link to another website is replaced by the dashboard', (await shown()).find((x) => x.tag === 'evil')?.path === '/dashboard')
    await clear()
    await push(null, 'this is not json')
    check('worker: unreadable data still shows something (iPhone requires it)', await until(async () => (await shown()).some((x) => x.title === 'Yorki')))
    await clear()
    await push({ title: 'x'.repeat(5000), body: 'y'.repeat(5000), path: '/dashboard', tag: 't'.repeat(500) })
    await until(async () => (await shown()).length > 0)
    const huge = (await shown())[0] ?? { title: '', body: '', tag: '' }
    check('worker: oversized text is cut down', huge.title.length <= 120 && huge.body.length <= 300 && huge.tag.length <= 80, `(${huge.title.length}/${huge.body.length}/${huge.tag.length})`)
    await clear()
    await ctx.close()
  }

  // ─── C · the settings page ─────────────────────────────────────────────────
  {
    // Can turn on (the push service itself is not reachable from this test environment, so a real subscribe fails politely).
    const ctx = await open('sess-mia')
    await ctx.grantPermissions(['notifications'], { origin: ORIGIN })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/notifications`)
    check('page: offers to turn alerts on', await until(async () => (await page.getByRole('button', { name: 'Turn on alerts on this device' }).count()) > 0))
    await page.getByRole('button', { name: 'Turn on alerts on this device' }).click()
    check('page: turning on ends in a clear result, never a broken page', await until(async () =>
      (await page.getByText('On for this device').count()) > 0 || (await page.getByText(/Couldn’t reach your browser’s notification service|Alerts are on/).count()) > 0, 20000))

    // Preferences stick.
    const commentSwitch = page.getByRole('switch', { name: 'Someone comments on a card I’m on' })
    await commentSwitch.click()
    check('page: a switch flips immediately', (await commentSwitch.getAttribute('aria-checked')) === 'false')
    await page.reload()
    check('page: and is remembered', await until(async () => (await page.getByRole('switch', { name: 'Someone comments on a card I’m on' }).getAttribute('aria-checked')) === 'false'))
    await page.getByRole('switch', { name: 'Someone comments on a card I’m on' }).click() // restore

    // Devices list + remove.
    await ctx.request.post(`${BASE}/api/push/subscribe`, { headers: json, data: subscriptionBody('listed') })
    await page.reload()
    check('page: lists my devices', await until(async () => (await page.getByRole('button', { name: /^Remove Chrome on Linux/ }).count()) > 0))
    await page.getByRole('button', { name: /^Remove Chrome on Linux/ }).first().click()
    check('page: a device can be removed', await until(async () => (await page.getByText('No device has alerts turned on yet.').count()) > 0))

    // Bell nudge + link.
    await page.goto(`${BASE}/dashboard`)
    await page.locator('button[aria-label^="Notifications"]:visible').first().click()
    check('bell: invites you to turn alerts on', await until(async () => (await page.getByRole('link', { name: /Get alerts when Yorki is closed|Notification settings/ }).count()) > 0))
    await ctx.close()

    // Blocked.
    const blocked = await open('sess-mia')
    await blocked.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'denied' }))
    const bp = await blocked.newPage()
    await bp.goto(`${BASE}/notifications`)
    check('page: explains how to unblock when notifications are blocked', await until(async () => (await bp.getByText(/blocked/i).count()) > 0) && (await bp.getByRole('button', { name: 'Turn on alerts on this device' }).count()) === 0)
    await blocked.close()

    // iPhone, not installed.
    const phone = await open('sess-mia', { ...devices['iPhone 14'] })
    const pp = await phone.newPage()
    await pp.goto(`${BASE}/notifications`)
    check('page: iPhone in Safari is told to add Yorki to the Home Screen first', await until(async () => (await pp.getByText(/alerts work once Yorki is on your Home Screen/).count()) > 0) && (await pp.getByRole('button', { name: 'Turn on alerts on this device' }).count()) === 0)
    await phone.close()
  }

  // ─── D · a real action in the app triggers a push (and switching it off stops it) ─────────
  {
    // Mia has a (fake) device. A fake device can't receive anything, so "the server tried to deliver" shows up as
    // a recorded failure — or, if the push service answers "no such device", the device is forgotten.
    const mia = await open('sess-mia'); const george = await open('sess-george')
    const device = await (await mia.request.post(`${BASE}/api/push/subscribe`, { headers: json, data: subscriptionBody('wired') })).json()
    const devicesOf = async () => (await (await mia.request.get(`${BASE}/api/push/state`)).json()).devices
    const tried = async () => { const d = (await devicesOf()).find((x) => x.id === device.id); return !d || d.failures > 0 }

    const page = await george.newPage()
    const assign = async (text) => {
      await page.goto(`${BASE}/dashboard`)
      const box = page.getByRole('textbox', { name: 'Describe what needs to be done' })
      await box.fill(text)
      await page.getByRole('button', { name: 'Create card' }).waitFor()
      await box.press('Enter')
      await page.getByText(/card created in Inbox/i).first().waitFor()
    }

    await assign('Mia should review the quote')
    const startedAt = Date.now()
    const attempted = await until(tried, 30000)
    const took = Date.now() - startedAt
    check('wired: assigning a card makes the server try to push to the person’s device', attempted, `(after ${took} ms)`)

    // Turn "assigned" off for Mia, re-add a fresh device, assign again: nothing is attempted.
    await mia.request.put(`${BASE}/api/push/prefs`, { headers: json, data: { assigned: false } })
    const second = await (await mia.request.post(`${BASE}/api/push/subscribe`, { headers: json, data: subscriptionBody('muted') })).json()
    await assign('Mia should call the supplier')
    // Wait comfortably longer than an attempt took above, so "nothing happened" is meaningful.
    await new Promise((r) => setTimeout(r, Math.max(6000, took * 3)))
    const untouched = (await devicesOf()).find((x) => x.id === second.id)
    check('wired: with that kind switched off, nothing is sent', Boolean(untouched) && untouched.failures === 0 && !untouched.last_success_at)
    for (const d of await devicesOf()) await mia.request.delete(`${BASE}/api/push/subscribe`, { headers: json, data: { id: d.id } })
    await mia.close(); await george.close()
  }

  await browser.close()
  if (pageErrors.length) results.push(`FAIL  no JavaScript errors — ${Array.from(new Set(pageErrors)).slice(0, 3).join(' | ')}`)
  else results.push('PASS  no JavaScript errors in the browser')
  console.log(results.join('\n'))
  process.exit(results.some((line) => line.startsWith('FAIL')) ? 1 : 0)
})().catch((error) => { console.log(results.join('\n')); console.error(error); process.exit(1) })
