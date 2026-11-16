const { chromium } = require('playwright')
const BASE = 'http://127.0.0.1:3100/task'
const results = []
const check = (name, ok, extra='') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`) }

async function login(browser, sid) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await ctx.addCookies([{ name: 'yorki_session', value: sid, domain: '127.0.0.1', path: '/' }])
  const page = await ctx.newPage()
  page.on('pageerror', e => results.push(`PAGEERROR ${sid}: ${e.message}`))
  await page.goto(`${BASE}/dashboard`)
  await page.getByRole('button', { name: 'Open task: Finalize Yorki board polish' }).waitFor()
  return page
}
const card = (page, title) => page.getByRole('button', { name: `Open task: ${title}`, exact: true })
const colOf = async (page, title) => page.evaluate((t) => {
  for (const col of document.querySelectorAll('[data-board-column]')) {
    if (col.querySelector(`[aria-label="Open task: ${t}"]`)) return col.getAttribute('data-board-column')
  }
  return null
}, title)
const toasts = (page) => page.locator('[data-sonner-toast]').allInnerTexts()

;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: process.env.CHROMIUM_PATH ? ['--no-sandbox'] : [] })
  const george = await login(browser, 'sess-george')
  const ana = await login(browser, 'sess-ana')

  // 1. Live update: George moves t-1 to Pending via panel; Ana sees it without reload.
  await card(george, 'Finalize Yorki board polish').click()
  await george.waitForSelector('text=Save details', { state: 'detached' }).catch(()=>{})
  await george.locator('select').last().selectOption({ label: 'Pending' })
  await ana.waitForFunction(() => true)
  let moved = false
  for (let i = 0; i < 20 && !moved; i++) { await ana.waitForTimeout(250); moved = (await colOf(ana, 'Finalize Yorki board polish')) === 'Pending' }
  check('live update: other admin sees move without refresh', moved, `(Ana sees column: ${await colOf(ana, 'Finalize Yorki board polish')})`)

  // 2. Presence: Ana sees "George viewing" chip on the card George has open.
  let chip = ''
  for (let i = 0; i < 20 && !/viewing|editing/.test(chip); i++) { await ana.waitForTimeout(250); chip = await card(ana, 'Finalize Yorki board polish').innerText() }
  check('presence: card shows who has it open', /George viewing/.test(chip))

  // 3. Complete vs Archive race. Both open t-1. George completes, then Ana archives from stale screen.
  await card(ana, 'Finalize Yorki board polish').click()
  await ana.waitForSelector('text=Mark Complete')
  const anaPanelPresence = await ana.locator('text=George is viewing').count()
  check('presence: panel shows "George is viewing"', anaPanelPresence > 0)
  // Freeze Ana's view: reload with the live stream blocked from the start, so
  // her screen is genuinely stale (like a dropped connection).
  await ana.route('**/api/board/stream', r => r.abort())
  await ana.goto(BASE + '/dashboard?task=t-1')
  await ana.waitForSelector('text=Mark Complete')
  await george.getByRole('button', { name: 'Mark Complete' }).click()
  await george.waitForTimeout(800)
  await ana.getByRole('button', { name: 'Archive' }).click()
  await ana.waitForTimeout(1200)
  const anaToasts = (await toasts(ana)).join(' | ')
  check('conflict: Archive after Complete is rejected', /George updated this card/.test(anaToasts) && /completed/.test(anaToasts), `toast="${anaToasts.slice(0,160)}"`)
  await ana.unroute('**/api/board/stream')

  // 4. Edit conflict. Both edit t-2 title. George saves first; Ana sees banner, then her save is stopped.
  await ana.goto(`${BASE}/dashboard`); await george.goto(`${BASE}/dashboard`)
  for (const p of [george, ana]) {
    await card(p, 'Clarify mobile nav behavior').click()
    await p.getByRole('button', { name: 'Edit', exact: true }).click()
  }
  await george.locator('input[placeholder="Task title"]').fill('Clarify mobile nav (George)')
  await ana.locator('input[placeholder="Task title"]').fill('Clarify mobile nav (Ana)')
  // Ana sees George is editing
  let anaSeesEditing = false
  for (let i = 0; i < 20 && !anaSeesEditing; i++) { await ana.waitForTimeout(250); anaSeesEditing = (await ana.locator('text=George is editing').count()) > 0 }
  check('presence: "George is editing" shown to Ana', anaSeesEditing)
  await george.getByRole('button', { name: 'Save details' }).click()
  let banner = false
  for (let i = 0; i < 20 && !banner; i++) { await ana.waitForTimeout(250); banner = (await ana.locator('text=just changed this card').count()) > 0 }
  check('editing: banner warns Ana that George changed the card', banner)
  const anaDraft = await ana.locator('input[placeholder="Task title"]').inputValue()
  check('editing: live update did not wipe Ana\'s draft', anaDraft === 'Clarify mobile nav (Ana)', `(draft="${anaDraft}")`)
  await ana.getByRole('button', { name: 'Save details' }).click()
  await ana.waitForTimeout(1200)
  const notice = await ana.locator('text=Your edits are still here').count()
  check('conflict: same-field save is stopped, drafts kept', notice > 0)
  const dbTitle1 = await george.locator('h2', { hasText: 'Clarify mobile nav' }).first().innerText().catch(()=>null)
  check('conflict: George\'s title not overwritten', /George/.test(dbTitle1 || ''), `(George sees "${dbTitle1}")`)
  // Ana deliberately saves again -> allowed
  await ana.getByRole('button', { name: 'Save details' }).click()
  await ana.waitForTimeout(1200)
  let georgeSeesAna = false
  for (let i = 0; i < 20 && !georgeSeesAna; i++) { await george.waitForTimeout(250); georgeSeesAna = (await george.locator('h2', { hasText: '(Ana)' }).count()) > 0 }
  check('editing: deliberate second save goes through & syncs live', georgeSeesAna)

  // 5. Different-field edits merge: George edits title, Ana edits description concurrently -> both kept.
  for (const p of [george, ana]) await p.getByRole('button', { name: 'Edit', exact: true }).click()
  await george.locator('input[placeholder="Task title"]').fill('Mobile nav — final')
  await ana.locator('textarea').first().fill('Ana added a description')
  await george.getByRole('button', { name: 'Save details' }).click()
  await george.waitForTimeout(600)
  await ana.getByRole('button', { name: 'Save details' }).click()
  await ana.waitForTimeout(1500)
  const anaNotice = await ana.locator('text=Your edits are still here').count()
  check('merge: edits to different fields both succeed', anaNotice === 0)

  await browser.close()
  console.log(results.join('\n'))
  if (results.some(result => /^(FAIL|PAGEERROR)/.test(result))) process.exitCode = 1
})().catch(e => { console.log(results.join('\n')); console.error(e); process.exit(1) })
