// Web Push: who may register, what gets sent, and — end to end — that what leaves the server is
// correctly encrypted and signed. No real push service is contacted.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const https = require('node:https')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const Database = require('better-sqlite3')
const { load, plain } = require('./load-ts.cjs')

const validate = load('src/lib/push/validate.ts')
const payloadLib = load('src/lib/push/payload.ts')

/** What a browser's PushSubscription holds: a P-256 key pair and a 16-byte auth secret. */
function deviceKeys() {
  const ecdh = crypto.createECDH('prime256v1')
  ecdh.generateKeys()
  return { ecdh, p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') }
}

// ─── Who may register ────────────────────────────────────────────────────────

test('endpoint: only the real push services are accepted', () => {
  const good = [
    'https://fcm.googleapis.com/fcm/send/abc123',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGxyz',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://eu.push.apple.com/abc',
  ]
  for (const url of good) assert.equal(plain(validate.validateEndpoint(url)).ok, true, url)
})

test('endpoint: internal addresses, look-alikes and odd forms are refused (the server will call this address)', () => {
  const bad = [
    'http://fcm.googleapis.com/fcm/send/abc',            // not https
    'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://169.254.169.254/latest/meta-data',
    'https://[::1]/x', 'https://0x7f000001/x',
    'https://fcm.googleapis.com.evil.com/x',             // look-alike
    'https://evil.com/fcm.googleapis.com',
    'https://evilfcm.googleapis.com/x',                  // not an exact allowed host
    'https://notify.windows.com.evil.com/x',
    'https://fcm.googleapis.com:8443/x',                 // unusual port
    'https://user:pass@fcm.googleapis.com/x',            // credentials
    'ftp://fcm.googleapis.com/x', 'javascript:alert(1)', 'file:///etc/passwd',
    '', 'not a url', 42, null, undefined, {}, 'https://fcm.googleapis.com/' + 'a'.repeat(1100),
  ]
  for (const value of bad) assert.equal(plain(validate.validateEndpoint(value)).ok, false, String(value).slice(0, 60))
})

test('endpoint: an admin can add one more service by exact hostname', () => {
  assert.equal(plain(validate.validateEndpoint('https://push.example.org/x')).ok, false)
  assert.equal(plain(validate.validateEndpoint('https://push.example.org/x', [' Push.Example.org '])).ok, true)
  assert.equal(plain(validate.validateEndpoint('https://other.example.org/x', ['push.example.org'])).ok, false)
})

test('keys: real browser-style keys pass, malformed ones do not', () => {
  const { p256dh, auth } = deviceKeys()
  assert.equal(plain(validate.validateKeys(p256dh, auth)).ok, true)
  assert.equal(plain(validate.validateKeys(p256dh.slice(0, -4), auth)).ok, false)         // wrong length
  assert.equal(plain(validate.validateKeys(p256dh, crypto.randomBytes(8).toString('base64url'))).ok, false)
  assert.equal(plain(validate.validateKeys('*'.repeat(87), auth)).ok, false)               // not base64url
  assert.equal(plain(validate.validateKeys(Buffer.concat([Buffer.from([2]), crypto.randomBytes(64)]).toString('base64url'), auth)).ok, false) // not an uncompressed point
  assert.equal(plain(validate.validateKeys(undefined, auth)).ok, false)
  assert.equal(plain(validate.validateKeys(p256dh, 5)).ok, false)
})

test('subscription body: validated as a whole, with a readable device name', () => {
  const { p256dh, auth } = deviceKeys()
  const body = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh, auth } }
  const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
  assert.deepEqual(plain(validate.validateSubscriptionInput(body, ua)), { ok: true, value: { endpoint: body.endpoint, p256dh, auth, label: 'Chrome on Android' } })
  assert.equal(plain(validate.validateSubscriptionInput(null, ua)).ok, false)
  assert.equal(plain(validate.validateSubscriptionInput({ endpoint: body.endpoint }, ua)).ok, false)
  assert.equal(plain(validate.validateSubscriptionInput({ ...body, endpoint: 'https://127.0.0.1/x' }, ua)).ok, false)
})

test('device names', () => {
  const l = validate.labelFromUserAgent
  assert.equal(l('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'), 'Safari on iPhone')
  assert.equal(l('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'), 'Edge on Windows')
  assert.equal(l('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0'), 'Firefox on Mac')
  assert.equal(l('Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1'), 'Chrome on iPad')
  assert.equal(l(undefined), 'Unknown device')
  assert.equal(l('x'.repeat(5000)), 'Unknown device')
})

// ─── What gets sent ──────────────────────────────────────────────────────────

test('messages: wording for each kind, and the tap target', () => {
  const b = (o) => plain(payloadLib.buildPushPayload({ showPreview: true, unread: 3, now: 1000, ...o }))
  assert.deepEqual(b({ type: 'mention', actorName: 'Ana Reyes', taskTitle: 'Fix gate', snippet: 'Can you check @Mia?', taskId: 't1' }),
    { v: 1, title: 'Ana Reyes mentioned you', body: 'Can you check @Mia?', path: '/dashboard?task=t1', tag: 'yorki-mention-t1', type: 'mention', unread: 3, ts: 1000 })
  assert.deepEqual([b({ type: 'comment', actorName: 'Ana', taskTitle: 'Fix gate', snippet: 'Done', taskId: 't1' }).title, b({ type: 'comment', actorName: 'Ana', taskTitle: 'Fix gate', snippet: 'Done', taskId: 't1' }).body], ['Ana commented', '“Fix gate”: Done'])
  assert.equal(b({ type: 'assigned', actorName: 'Ana', taskTitle: 'Fix gate', taskId: 't1' }).title, 'Ana assigned you a task')
  assert.equal(b({ type: 'completed', actorName: 'Ana', taskTitle: 'Fix gate', taskId: 't1' }).body, '“Fix gate” was completed by Ana')
  assert.equal(b({ type: 'test' }).title, 'Yorki notifications are on')
  assert.equal(b({ type: 'test' }).path, '/dashboard')
})

test('messages: with previews off, the lock screen shows no names or titles', () => {
  const p = plain(payloadLib.buildPushPayload({ type: 'mention', actorName: 'Ana Reyes', taskTitle: 'Secret bid', snippet: 'private words', taskId: 't1', showPreview: false, unread: 1 }))
  assert.equal(p.title, 'Yorki')
  assert.equal(p.body, 'You have a new notification.')
  assert.doesNotMatch(JSON.stringify(p), /Ana|Secret|private/)
  assert.equal(p.path, '/dashboard?task=t1') // tapping still opens the right card
})

test('messages: long, messy and hostile text is tidied', () => {
  const p = plain(payloadLib.buildPushPayload({ type: 'mention', actorName: 'A'.repeat(200), snippet: `line1\n\n  line2‮\u0007${'x'.repeat(500)}`, taskId: 'a b&c', showPreview: true, unread: -4.7 }))
  assert.ok(p.title.length <= 60 && p.body.length <= 120, `${p.title.length}/${p.body.length}`)
  assert.doesNotMatch(p.body, /[\u0000-\u001f‮]/)
  assert.match(p.body, /^line1 line2/)
  assert.equal(p.unread, 0)
  assert.equal(p.path, '/dashboard?task=a%20b%26c')
})

// ─── Server: devices, preferences, sending ───────────────────────────────────

function fixture({ envKeys = null } = {}) {
  const db = new Database(':memory:')
  const fs = require('node:fs')
  const dbSource = fs.readFileSync('src/lib/db.ts', 'utf8')
  const ddl = (name) => dbSource.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\n    \\);`))[0]
  db.exec(`
    CREATE TABLE settings (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, value TEXT NOT NULL DEFAULT '{}', updated_by TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, deleted_at TEXT);
    ${ddl('notifications')}
    ${ddl('push_subscriptions')}
    ${ddl('push_prefs')}
    INSERT INTO tasks VALUES ('t1', 'Fix the gate', NULL), ('t2', 'Order tiles', NULL);
  `)
  const users = {
    ana: { id: 'ana', full_name: 'Ana Reyes', is_active: true },
    mia: { id: 'mia', full_name: 'Mia Porter', is_active: true },
    old: { id: 'old', full_name: 'Old Timer', is_active: false },
  }
  const saved = { ...process.env }
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_SUBJECT; delete process.env.APP_URL
  if (envKeys) { process.env.VAPID_PUBLIC_KEY = envKeys.publicKey; process.env.VAPID_PRIVATE_KEY = envKeys.privateKey }
  const emailSetting = { current: null }
  const push = load('src/lib/push/server.ts', {
    '@/lib/db': { getDb: () => db },
    '@/lib/local-data': { findUser: (id) => users[id] ?? null, getSetting: async (key, fallback) => (key === 'email' ? emailSetting.current ?? fallback : fallback) },
  })
  const calls = []
  let respond = async () => ({ statusCode: 201 })
  push.setPushTransport(async (target, body, options) => { calls.push({ target: plain(target), payload: JSON.parse(body), options: plain(options) }); return respond(target) })
  const sub = (userId, n = 1, host = 'fcm.googleapis.com') => {
    const k = deviceKeys()
    return push.saveSubscription(userId, { endpoint: `https://${host}/fcm/send/${userId}-${n}-${crypto.randomBytes(3).toString('hex')}`, p256dh: k.p256dh, auth: k.auth, label: 'Chrome on Android' })
  }
  return {
    db, push, calls, sub, emailSetting,
    respondWith: (fn) => { respond = fn },
    restore: () => { process.env = saved },
    notify: (o) => push.sendPushForNotifications([{ userId: 'ana', actorId: 'mia', taskId: 't1', type: 'mention', snippet: 'hello', ...o }]),
  }
}

test('keys: created once, kept in the database, and stable', async () => {
  const f = fixture()
  try {
    const a = await f.push.getVapid()
    assert.match(a.publicKey, /^[A-Za-z0-9_-]{87}$/)
    assert.match(a.privateKey, /^[A-Za-z0-9_-]{43}$/)
    f.push.resetPushCache()
    assert.deepEqual(await f.push.getVapid(), a) // read back from the database, not regenerated
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'push_vapid'").get().n, 1)
  } finally { f.restore() }
})

test('keys: your own keys in .env win, and the contact address is sensible', async () => {
  const mine = require('web-push').generateVAPIDKeys()
  const f = fixture({ envKeys: mine })
  try {
    const v = await f.push.getVapid()
    assert.equal(v.publicKey, mine.publicKey)
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'push_vapid'").get().n, 0)
    assert.equal(v.subject, 'mailto:admin@yorki.local')
    f.push.resetPushCache(); f.emailSetting.current = { notification_to: 'office@goldenstone.com' }
    assert.equal((await f.push.getVapid()).subject, 'mailto:office@goldenstone.com')
    f.push.resetPushCache(); process.env.APP_URL = 'https://tasks.goldenstone.com/task'
    assert.equal((await f.push.getVapid()).subject, 'https://tasks.goldenstone.com')
    f.push.resetPushCache(); process.env.VAPID_SUBJECT = 'mailto:boss@goldenstone.com'
    assert.equal((await f.push.getVapid()).subject, 'mailto:boss@goldenstone.com')
    f.push.resetPushCache(); process.env.VAPID_SUBJECT = 'javascript:alert(1)'; process.env.APP_URL = 'http://insecure.example'
    assert.equal((await f.push.getVapid()).subject, 'mailto:office@goldenstone.com') // invalid values are ignored
  } finally { f.restore() }
})

test('preferences: everything on by default; only real booleans for known keys are saved', () => {
  const f = fixture()
  try {
    assert.deepEqual(plain(f.push.getPrefs('ana')), { mention: true, comment: true, assigned: true, completed: true, show_preview: true })
    f.push.savePrefs('ana', { comment: false, show_preview: false, bogus: false, mention: 'no', assigned: 0 })
    assert.deepEqual(plain(f.push.getPrefs('ana')), { mention: true, comment: false, assigned: true, completed: true, show_preview: false })
    f.push.savePrefs('ana', { comment: true })
    assert.equal(f.push.getPrefs('ana').show_preview, false) // untouched
    assert.deepEqual(plain(f.push.getPrefs('mia')), { mention: true, comment: true, assigned: true, completed: true, show_preview: true }) // per person
    f.push.savePrefs('ana', null); f.push.savePrefs('ana', 'x')
  } finally { f.restore() }
})

test('devices: re-registering updates; a shared phone moves to whoever turned alerts on last; own devices only', () => {
  const f = fixture()
  try {
    const k = deviceKeys()
    const input = { endpoint: 'https://web.push.apple.com/shared-phone', p256dh: k.p256dh, auth: k.auth, label: 'Safari on iPhone' }
    const { id } = f.push.saveSubscription('ana', input)
    assert.equal(f.push.listDevices('ana').length, 1)
    f.push.saveSubscription('ana', input)
    assert.equal(f.push.listDevices('ana').length, 1) // same device, not duplicated
    f.push.saveSubscription('mia', input) // Mia signs in on the same phone and turns alerts on
    assert.equal(f.push.listDevices('ana').length, 0)
    assert.equal(f.push.listDevices('mia').length, 1)
    assert.equal(f.push.removeSubscription('ana', id), false) // can't remove someone else's
    assert.equal(f.push.listDevices('mia').length, 1)
    assert.equal(f.push.removeSubscription('mia', input.endpoint), true) // by address works too
    assert.equal(f.push.listDevices('mia').length, 0)
  } finally { f.restore() }
})

test('devices: a person keeps at most 10, newest first', () => {
  const f = fixture()
  try {
    for (let i = 0; i < 13; i++) {
      f.db.prepare("UPDATE push_subscriptions SET created_at = '2020-01-01' WHERE 0") // (no-op; keep order by insertion time)
      f.sub('ana', i)
    }
    assert.equal(f.push.listDevices('ana').length, 10)
  } finally { f.restore() }
})

test('sending: goes to every device of the person, with the right text and badge count', async () => {
  const f = fixture()
  try {
    f.sub('ana', 1); f.sub('ana', 2); f.sub('mia', 1)
    f.db.prepare("INSERT INTO notifications VALUES ('n1','ana','mia','t1',NULL,'mention','hello','2026-01-01',NULL), ('n2','ana','mia','t1',NULL,'comment','x','2026-01-02',NULL), ('n3','ana','mia','t1',NULL,'comment','x','2026-01-03','2026-01-04')").run()
    const result = await f.notify({})
    assert.deepEqual(plain(result), { sent: 2, removed: 0, failed: 0 })
    assert.equal(f.calls.length, 2)
    assert.ok(f.calls.every((c) => c.payload.title === 'Mia Porter mentioned you' && c.payload.body === 'hello' && c.payload.unread === 2 && c.payload.path === '/dashboard?task=t1'))
    assert.equal(f.calls[0].options.urgency, 'high')
    assert.equal(f.calls[0].options.ttl, 86400)
    assert.match(f.calls[0].options.vapid.publicKey, /^[A-Za-z0-9_-]{87}$/)
    // Never anything for Mia's device (she wasn't notified).
    assert.ok(f.calls.every((c) => /ana-/.test(c.target.endpoint)))
    assert.ok(f.db.prepare('SELECT last_success_at FROM push_subscriptions WHERE user_id = ?').all('ana').every((r) => r.last_success_at))
  } finally { f.restore() }
})

test('sending: respects what each person switched off, and skips deactivated people', async () => {
  const f = fixture()
  try {
    f.sub('ana'); f.sub('old')
    f.push.savePrefs('ana', { comment: false })
    assert.equal((await f.notify({ type: 'comment' })).sent, 0)
    assert.equal((await f.notify({ type: 'assigned' })).sent, 1)
    assert.equal((await f.notify({ userId: 'old' })).sent, 0) // deactivated
    assert.equal((await f.notify({ userId: 'nobody' })).sent, 0)
    assert.equal(f.calls.length, 1)
    f.push.savePrefs('ana', { show_preview: false })
    await f.notify({ type: 'assigned' })
    assert.equal(f.calls[1].payload.title, 'Yorki')
    assert.doesNotMatch(JSON.stringify(f.calls[1].payload), /Fix the gate|Mia/)
  } finally { f.restore() }
})

test('sending: dead devices are forgotten; flaky ones are retried, then dropped', async () => {
  const f = fixture()
  try {
    f.sub('ana', 'gone'); f.sub('ana', 'flaky')
    f.respondWith(async (t) => {
      if (/gone/.test(t.endpoint)) throw Object.assign(new Error('Gone'), { statusCode: 410 })
      throw Object.assign(new Error('Server error'), { statusCode: 503 })
    })
    const first = plain(await f.notify({}))
    assert.deepEqual(first, { sent: 0, removed: 1, failed: 1 })
    const left = f.push.listDevices('ana')
    assert.equal(left.length, 1)
    assert.equal(left[0].failures, 1)
    assert.equal(f.db.prepare('SELECT last_error FROM push_subscriptions').get().last_error, 'HTTP 503')
    f.respondWith(async () => ({ statusCode: 201 })) // it recovers → counter resets
    await f.notify({})
    assert.equal(f.push.listDevices('ana')[0].failures, 0)
    f.respondWith(async () => { throw Object.assign(new Error('boom'), { code: 'ECONNRESET' }) })
    for (let i = 0; i < f.push.MAX_FAILURES; i++) await f.notify({})
    assert.equal(f.push.listDevices('ana').length, 0) // dropped after too many in a row
  } finally { f.restore() }
})

test('sending: a 404 from the push service also removes the device; one bad device does not block the others', async () => {
  const f = fixture()
  try {
    f.sub('ana', 'a'); f.sub('ana', 'b'); f.sub('ana', 'c')
    f.respondWith(async (t) => { if (/-b-/.test(t.endpoint)) throw Object.assign(new Error('x'), { statusCode: 404 }); return { statusCode: 201 } })
    assert.deepEqual(plain(await f.notify({})), { sent: 2, removed: 1, failed: 0 })
  } finally { f.restore() }
})

test('test notification: counts devices, uses the test wording', async () => {
  const f = fixture()
  try {
    assert.deepEqual(plain(await f.push.sendTestPush('ana')), { sent: 0, removed: 0, failed: 0, devices: 0 })
    f.sub('ana')
    const r = plain(await f.push.sendTestPush('ana'))
    assert.deepEqual(r, { sent: 1, removed: 0, failed: 0, devices: 1 })
    assert.equal(f.calls[0].payload.type, 'test')
    assert.equal(f.calls[0].options.urgency, 'high')
  } finally { f.restore() }
})

// ─── End to end: encryption and signature, checked independently ────────────

/** RFC 8291 (aes128gcm) decryption, written from the spec — not using the library under test. */
function decryptAes128gcm(body, ecdh, authSecret) {
  const salt = body.subarray(0, 16)
  const idLen = body[20]
  const serverPublic = body.subarray(21, 21 + idLen)
  const ciphertext = body.subarray(21 + idLen)
  const sharedSecret = ecdh.computeSecret(serverPublic)
  const clientPublic = ecdh.getPublicKey()
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), clientPublic, serverPublic])
  const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, Buffer.from(authSecret, 'base64url'), keyInfo, 32))
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce)
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16))
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()])
  const end = padded.lastIndexOf(0x02) // padding delimiter for the last record
  return padded.subarray(0, end).toString('utf8')
}

/** RFC 8292: "vapid t=<jwt>, k=<public key>" — verify the ES256 signature and claims. */
function verifyVapid(header, expected) {
  const m = /^vapid t=([^,\s]+),\s*k=([^,\s]+)$/.exec(header)
  assert.ok(m, `Authorization header shape: ${header}`)
  const [h, c, sig] = m[1].split('.')
  assert.equal(m[2], expected.publicKey)
  const pub = Buffer.from(m[2], 'base64url')
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' })
  assert.equal(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), true, 'signature must verify with the public key')
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString())
  assert.equal(JSON.parse(Buffer.from(h, 'base64url').toString()).alg, 'ES256')
  return claims
}

test('end to end: what leaves the server is encrypted for the device and signed by us', async () => {
  const f = fixture()
  const received = []
  // Real push services are always HTTPS (the library refuses plain http), so the fake one is too,
  // with a throwaway certificate that only this test trusts.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yorki-push-test-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
    '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
  const cert = fs.readFileSync(path.join(dir, 'cert.pem'))
  const previousCa = https.globalAgent.options.ca
  https.globalAgent.options.ca = [cert]
  const server = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert }, (req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => { received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(201); res.end() })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const phone = deviceKeys()
    const endpoint = `https://127.0.0.1:${server.address().port}/push/device-1`
    // (The address allow-list applies when a browser registers, so insert directly to aim at our fake service.)
    f.db.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, label, created_at) VALUES (?,?,?,?,?,?,?)')
      .run('dev1', 'ana', endpoint, phone.p256dh, phone.auth, 'Test phone', new Date().toISOString())
    f.push.setPushTransport(null) // the real web-push sender this time
    process.env.APP_URL = 'https://tasks.example.com/task'; f.push.resetPushCache()

    const summary = await f.notify({ type: 'assigned', snippet: null })
    assert.deepEqual(plain(summary), { sent: 1, removed: 0, failed: 0 })
    assert.equal(received.length, 1)
    const req = received[0]
    assert.equal(req.url, '/push/device-1')
    assert.equal(req.headers['content-encoding'], 'aes128gcm')
    assert.equal(req.headers.ttl, '86400')
    assert.equal(req.headers.urgency, 'high')

    // 1. Only the phone can read it.
    const message = JSON.parse(decryptAes128gcm(req.body, phone.ecdh, phone.auth))
    assert.equal(message.title, 'Mia Porter assigned you a task')
    assert.equal(message.body, 'Fix the gate')
    assert.equal(message.path, '/dashboard?task=t1')
    assert.equal(message.type, 'assigned')
    assert.doesNotMatch(req.body.toString('latin1'), /Fix the gate|assigned/) // not readable on the wire
    // 2. A different device's key cannot read it.
    assert.throws(() => decryptAes128gcm(req.body, deviceKeys().ecdh, phone.auth))
    assert.throws(() => decryptAes128gcm(req.body, phone.ecdh, crypto.randomBytes(16).toString('base64url')))
    // 3. It is signed with our key, aimed at this service, and not reusable for long.
    const vapid = await f.push.getVapid()
    const claims = verifyVapid(req.headers.authorization, vapid)
    assert.equal(claims.aud, `https://127.0.0.1:${server.address().port}`)
    assert.equal(claims.sub, 'https://tasks.example.com')
    const now = Math.floor(Date.now() / 1000)
    assert.ok(claims.exp > now && claims.exp <= now + 24 * 3600, `exp ${claims.exp - now}s from now`)
  } finally {
    server.close(); f.restore()
    https.globalAgent.options.ca = previousCa
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
