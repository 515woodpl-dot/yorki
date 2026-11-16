const { chromium } = require('playwright')
const BASE = 'http://127.0.0.1:3100/task'
const out = []; const check = (n, ok, x='') => out.push(`${ok?'PASS':'FAIL'}  ${n} ${x}`)
async function login(browser, sid, viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addCookies([{ name: 'yorki_session', value: sid, domain: '127.0.0.1', path: '/' }])
  const page = await ctx.newPage()
  page.on('pageerror', e => out.push(`PAGEERROR ${sid}: ${e.message}`))
  await page.goto(`${BASE}/dashboard`)
  await page.waitForLoadState('networkidle').catch(()=>{})
  return page
}
const card = (p, t) => p.getByRole('button', { name: `Open task: ${t}`, exact: true })
const bell = p => p.locator('button[aria-label^="Notifications"]:visible')
const badge = async (p) => (await bell(p).getAttribute('aria-label')) || ''
async function until(fn, ms = 6000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 250)) } return false }
async function comment(p, text) {
  const ta = p.locator('textarea[placeholder^="Add a comment"]')
  await ta.click(); await ta.pressSequentially(text, { delay: 15 })
}

;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: process.env.CHROMIUM_PATH ? ['--no-sandbox'] : [] })
  const george = await login(browser, 'sess-george')
  const ana = await login(browser, 'sess-ana')
  const mia = await login(browser, 'sess-mia')

  // 1. Assign Mia to t-1 -> Mia notified live + card appears for her
  await card(george, 'Finalize Yorki board polish').click()
  await george.getByLabel('Mia Porter').click()
  check('assigned: Mia gets unread badge live', await until(async () => /1 unread/.test(await badge(mia))), `(${await badge(mia)})`)
  check('assigned: card appears on Mia\'s board live', await until(async () => (await card(mia, 'Finalize Yorki board polish').count()) > 0))
  check('assigned: toast shown to Mia', await until(async () => /assigned you to/.test((await mia.locator('[data-sonner-toast]').allInnerTexts()).join(' '))))

  // 2. George comments mentioning Ana via the picker
  await comment(george, 'Hey @An')
  const listShown = await until(async () => (await george.locator('[role=listbox]').count()) > 0, 3000)
  check('picker: suggestions appear after typing @An', listShown)
  await george.keyboard.press('Enter')
  await george.locator('textarea[placeholder^="Add a comment"]').pressSequentially('can you check the spacing?', { delay: 10 })
  const draft = await george.locator('textarea[placeholder^="Add a comment"]').inputValue()
  check('picker: inserts readable "@Ana Reyes"', draft.startsWith('Hey @Ana Reyes can you check'), `("${draft}")`)
  await george.getByRole('button', { name: 'Send' }).click()
  const chip = george.locator('span', { hasText: /^@Ana Reyes$/ })
  check('comment: mention rendered as chip', await until(async () => (await chip.count()) > 0))

  check('mention: Ana gets unread badge live', await until(async () => /unread/.test(await badge(ana))), `(${await badge(ana)})`)
  check('mention: Ana sees toast', await until(async () => /mentioned you on/.test((await ana.locator('[data-sonner-toast]').allInnerTexts()).join(' '))))
  // Mia is an assignee -> gets a "comment" notification (not mention)
  check('comment: assignee Mia notified of reply', await until(async () => /2 unread/.test(await badge(mia))), `(${await badge(mia)})`)

  // 3. Ana opens via bell -> panel opens, unread cleared, her own chip highlighted
  await bell(ana).click()
  await ana.getByRole('button', { name: /George mentioned you on/ }).click()
  check('bell: clicking opens the card', await until(async () => (await ana.locator('textarea[placeholder^="Add a comment"]').count()) > 0))
  check('bell: unread cleared after opening', await until(async () => !(/unread/.test(await badge(ana)))), `(${await badge(ana)})`)
  const ownChipClass = await ana.locator('span', { hasText: /^@Ana Reyes$/ }).first().getAttribute('class')
  check('comment: your own mention is highlighted', /bg-primary text-primary-foreground/.test(ownChipClass || ''))

  // 4. Forged mention label is corrected server-side (Mia types a raw token)
  await card(mia, 'Finalize Yorki board polish').click()
  await mia.locator('textarea[placeholder^="Add a comment"]').fill('ping @[The CEO](33333333-3333-3333-3333-333333333333) and @[Ghost](nope-not-a-user)')
  await mia.getByRole('button', { name: 'Send' }).click()
  await mia.waitForTimeout(1500)
  await mia.reload()
  const miaText = await until(async () => (await mia.locator('text=ping').count()) > 0) && await mia.locator('p', { hasText: 'ping' }).last().innerText()
  check('security: forged name replaced with real name; unknown id becomes text', /@Ana Reyes/.test(miaText) && !/CEO/.test(miaText) && /@Ghost/.test(miaText), `("${miaText}")`)

  // 5. Internal note mentioning staff Mia -> Mia must NOT be notified
  const before = await badge(mia)
  await george.getByRole('button', { name: 'Set as internal' }).click()
  await george.locator('textarea[placeholder^="Add a comment"]').fill('secret @[Mia Porter](22222222-2222-2222-2222-222222222222)')
  await george.getByRole('button', { name: 'Send' }).click()
  await george.waitForTimeout(2500)
  check('privacy: staff not notified by internal note', (await badge(mia)) === before, `(before="${before}" after="${await badge(mia)}")`)
  const miaSeesSecret = await mia.locator('text=secret').count()
  check('privacy: staff cannot see internal note', miaSeesSecret === 0)

  // 6. George completes -> Mia notified
  await george.getByRole('button', { name: 'Mark Complete' }).click()
  await mia.goto(BASE + '/dashboard')
  await bell(mia).click()
  check('completed: assignee notified', await until(async () => (await mia.getByRole('button', { name: /George completed/ }).count()) > 0))

  // 7. Mobile: bell present
  const phone = await login(browser, 'sess-ana', { width: 390, height: 844 })
  check('mobile: bell visible in top bar', await bell(phone).isVisible())
  await bell(phone).click()
  await phone.screenshot({ path: (process.env.SP || '/tmp') + '/mobile-bell.png' })
  await ana.screenshot({ path: (process.env.SP || '/tmp') + '/desktop-panel.png' })

  await browser.close(); console.log(out.join('\n'))
  if (out.some(result => /^(FAIL|PAGEERROR)/.test(result))) process.exitCode = 1
})().catch(e => { console.log(out.join('\n')); console.error(e); process.exit(1) })
