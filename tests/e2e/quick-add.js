// Quick add (chat box): typed sentences → preview → real cards. Uses 3 real sessions:
// Ana (admin, can be assigned), Mia (staff, can be assigned), George (super admin).
const { chromium } = require('playwright')
const BASE = 'http://127.0.0.1:3100/task'
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`) }

async function login(browser, sid, viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addCookies([{ name: 'yorki_session', value: sid, domain: '127.0.0.1', path: '/' }])
  const page = await ctx.newPage()
  page.on('pageerror', e => results.push(`PAGEERROR ${sid}: ${e.message}`))
  await page.goto(`${BASE}/dashboard`)
  await page.getByRole('region', { name: 'Quick add' }).waitFor()
  return page
}
// Everything in the preview is looked up inside the panel (the board has its own filters).
const qa = (page) => page.getByRole('region', { name: 'Quick add' })
const box = (page) => page.getByRole('textbox', { name: 'Describe what needs to be done' })
const card = (page, title) => page.getByRole('button', { name: `Open task: ${title}`, exact: true })
const colOf = (page, title) => page.evaluate((t) => {
  for (const col of document.querySelectorAll('[data-board-column]')) {
    if (col.querySelector(`[aria-label="Open task: ${t}"]`)) return col.getAttribute('data-board-column')
  }
  return null
}, title)
async function until(fn, ms = 8000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 200)) }
  return false
}
const previewTitles = (page) => qa(page).getByRole('textbox', { name: 'Card title' }).evaluateAll(els => els.map(e => e.value))
const toasts = (page) => page.locator('[data-sonner-toast]').allInnerTexts()
const badge = async (page) => (await page.locator('header button[aria-label^="Notifications"]').first().getAttribute('aria-label')) || ''

;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: process.env.CHROMIUM_PATH ? ['--no-sandbox'] : [] })
  const ana = await login(browser, 'sess-ana')
  const mia = await login(browser, 'sess-mia')

  // 1 · The sentence from the request (with a real date), including the "Shr" typo.
  await box(ana).click()
  await box(ana).pressSequentially('I want @Mia to work in this project. Shr has until Dec 5, 2030 to work o.n that', { delay: 8 })
  check('preview: one card appears while typing', await until(async () => (await previewTitles(ana)).length === 1))
  check('preview: title has the filler removed', (await previewTitles(ana))[0] === 'Work in this project', `(${JSON.stringify(await previewTitles(ana))})`)
  check('preview: Mia is assigned', (await qa(ana).getByText('Mia Porter').count()) > 0)
  check('preview: deadline from the 2nd sentence', (await qa(ana).getByLabel('Due date', { exact: true }).inputValue()) === '2030-12-05')
  check('preview: explains what it understood', (await qa(ana).getByText(/Understood/).count()) > 0)
  await ana.screenshot({ path: (process.env.SP || '/tmp') + '/quick-add-preview.png' })

  await box(ana).press('Enter')
  check('create: card lands in Inbox', await until(async () => (await colOf(ana, 'Work in this project')) !== null))
  check('create: box is cleared', (await box(ana).inputValue()) === '')
  check('live: Mia (assignee) sees it without refresh', await until(async () => (await card(mia, 'Work in this project').count()) > 0))
  check('live: Mia is notified of the assignment', await until(async () => /unread/.test(await badge(mia))), `(${await badge(mia)})`)

  // 2 · Two prompts at once.
  await box(ana).fill('lets work on this project. Or pay this bill')
  check('preview: two sentences → two cards', await until(async () => (await previewTitles(ana)).length === 2), `(${JSON.stringify(await previewTitles(ana))})`)
  check('preview: titles', JSON.stringify(await previewTitles(ana)) === JSON.stringify(['Work on this project', 'Pay this bill']))
  await qa(ana).getByRole('button', { name: 'Create 2 cards' }).click()
  check('create: both cards on the board', await until(async () => (await card(ana, 'Work on this project').count()) > 0 && (await card(ana, 'Pay this bill').count()) > 0))

  // 3 · Edit the preview before creating: change priority, remove the second card.
  await box(ana).fill('Call the supplier by Friday, order tiles')
  await until(async () => (await previewTitles(ana)).length === 2)
  await qa(ana).getByRole('button', { name: /^Remove “Order tiles”$/ }).click()
  check('edit: remove a card from the preview', (await previewTitles(ana)).length === 1)
  await qa(ana).getByLabel('Priority', { exact: true }).first().selectOption('urgent')
  await qa(ana).getByRole('textbox', { name: 'Card title' }).fill('Call the supplier today')
  await box(ana).focus()
  await qa(ana).getByRole('button', { name: 'Create card' }).click()
  check('edit: your changes are what gets created', await until(async () => (await card(ana, 'Call the supplier today').count()) > 0))
  check('edit: removed card was not created', (await card(ana, 'Order tiles').count()) === 0)
  await card(ana, 'Call the supplier today').click()
  check('edit: priority saved', await until(async () => (await ana.getByText('Urgent', { exact: true }).count()) > 0))
  await ana.keyboard.press('Escape')
  await ana.reload(); await ana.getByRole('region', { name: 'Quick add' }).waitFor()

  // 4 · Mentions: suggestions, Enter picks (does not send), unknown names are flagged.
  await box(ana).click()
  await box(ana).pressSequentially('@Mi', { delay: 15 })
  check('mention: suggestions appear', await until(async () => (await qa(ana).getByRole('option', { name: /Mia Porter/ }).count()) > 0))
  await box(ana).press('Enter')
  check('mention: Enter picks the name instead of sending', (await box(ana).inputValue()) === '@Mia Porter ' && (await toasts(ana)).every(t => !/created/.test(t)), `("${await box(ana).inputValue()}")`)
  await box(ana).fill('@bob to paint the fence')
  check('warning: unknown @name is flagged, not guessed', await until(async () => (await qa(ana).getByText(/@bob isn’t a user/).count()) > 0))

  // 5 · Staff can use it too, and "remind me" assigns yourself.
  await box(mia).fill('Remind me to pay the electric bill tomorrow, urgent')
  check('staff: preview works', await until(async () => (await previewTitles(mia)).length === 1))
  check('staff: "remind me" assigns Mia', (await qa(mia).getByText('Mia Porter').count()) > 0 && (await previewTitles(mia))[0] === 'Pay the electric bill')
  await box(mia).press('Enter')
  check('staff: card created', await until(async () => (await card(mia, 'Pay the electric bill').count()) > 0))
  check('live: admin sees the staff card', await until(async () => (await card(ana, 'Pay the electric bill').count()) > 0))

  // 6 · Spanish, with the follow-up deadline.
  await box(ana).fill('Quiero que @Mia trabaje en este proyecto. Ella tiene hasta el 5 de diciembre de 2030')
  await until(async () => (await previewTitles(ana)).length === 1)
  check('es: title in the infinitive', (await previewTitles(ana))[0] === 'Trabajar en este proyecto', `(${JSON.stringify(await previewTitles(ana))})`)
  check('es: Mia assigned', (await qa(ana).getByText('Mia Porter').count()) > 0)
  check('es: deadline from "Ella tiene hasta…"', (await qa(ana).getByLabel('Due date', { exact: true }).inputValue()) === '2030-12-05')

  // 7 · Typos are understood and shown.
  await box(ana).fill('pay the rent tomorow, urjent')
  await until(async () => (await previewTitles(ana)).length === 1)
  check('typo: date understood', (await qa(ana).getByLabel('Due date', { exact: true }).inputValue()) !== '')
  check('typo: priority understood', (await qa(ana).getByLabel('Priority', { exact: true }).inputValue()) === 'urgent')
  check('typo: the guess is shown', (await qa(ana).getByText(/“tomorow” → tomorrow/).count()) > 0)

  // 8 · Team-wide learning: Ana teaches "Jimmy" → Mia's Quick add knows it too → admin can remove it for everyone.
  await box(ana).fill('Jimmy should sweep the shop')
  check('learn: unknown name is asked about', await until(async () => (await qa(ana).getByText(/Who is “Jimmy”/).count()) > 0))
  await qa(ana).getByLabel('Assign someone').selectOption({ label: 'Mia Porter' })
  await qa(ana).getByRole('button', { name: 'Create card' }).click()
  check('learn: tells you the team learned it', await until(async () => (await toasts(ana)).some(t => /Learned for the whole team: “jimmy” means Mia Porter/.test(t))))
  await box(ana).fill('Jimmy should mop the floor')
  check('learn: next time Jimmy = Mia', await until(async () => (await qa(ana).getByText('Mia Porter').count()) > 0 && (await qa(ana).getByText(/Who is/).count()) === 0))
  check('learn: shown as remembered', (await qa(ana).getByText(/remembered: Jimmy = Mia Porter/).count()) > 0)

  await mia.reload(); await qa(mia).waitFor()
  await box(mia).fill('Jimmy should restock the sealer')
  check('team: another person (staff) already knows Jimmy', await until(async () => (await qa(mia).getByText(/remembered: Jimmy = Mia Porter/).count()) > 0))
  await qa(mia).getByText(/What Quick add has learned/).click()
  check('team: shows who taught it', (await qa(mia).getByText(/taught by Ana Reyes/).count()) > 0)
  check('team: staff cannot remove it for everyone', (await qa(mia).getByRole('button', { name: /for everyone/ }).count()) === 0)
  await box(mia).fill('')

  await qa(ana).getByText(/What Quick add has learned \(1\)/).click()
  check('learn: listed under "What Quick add has learned"', (await qa(ana).getByText(/“jimmy” →/).count()) > 0)
  await qa(ana).getByRole('button', { name: 'Remove jimmy for everyone' }).click()
  check('admin: can remove it for everyone', await until(async () => (await qa(ana).getByText(/Who is “Jimmy”/).count()) > 0))
  await mia.reload(); await qa(mia).waitFor()
  await box(mia).fill('Jimmy should restock the sealer')
  check('team: removal applies to everyone', await until(async () => (await qa(mia).getByText(/Who is “Jimmy”/).count()) > 0))
  await box(mia).fill('')
  await box(ana).fill('')

  // 9 · Suggestions from past cards: after a few "leak" cards for Mia, it suggests Mia.
  await box(ana).fill('Mia should fix the leak in unit 1, urgent\nMia should fix the leak in unit 2, urgent\nMia should check the leak in unit 3, urgent')
  await until(async () => (await previewTitles(ana)).length === 3)
  await qa(ana).getByRole('button', { name: 'Create 3 cards' }).click()
  await until(async () => (await card(ana, 'Fix the leak in unit 2').count()) > 0)
  await ana.waitForTimeout(800) // knowledge reloads after creating
  await box(ana).fill('fix the leak in the kitchen')
  check('suggest: offers Mia from past cards', await until(async () => (await qa(ana).getByRole('button', { name: /^Accept suggestion: Mia Porter/ }).count()) > 0))
  check('suggest: not applied on its own', (await qa(ana).getByRole('button', { name: 'Unassign Mia Porter' }).count()) === 0)
  await qa(ana).getByRole('button', { name: /^Accept suggestion: Mia Porter/ }).click()
  check('suggest: one click applies it', (await qa(ana).getByRole('button', { name: 'Unassign Mia Porter' }).count()) === 1)
  check('suggest: urgency suggested too', (await qa(ana).getByRole('button', { name: /^Accept suggestion: Urgent/ }).count()) > 0)
  await ana.screenshot({ path: (process.env.SP || '/tmp') + '/quick-add-suggest.png' })
  await box(ana).fill('')

  // 10 · Phone layout.
  const phone = await login(browser, 'sess-ana', { width: 390, height: 844 })
  await box(phone).fill('Ana should call the supplier by Friday, urgent')
  await until(async () => (await previewTitles(phone)).length === 1)
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  check('mobile: no horizontal scrolling with a preview open', !overflow)
  await phone.screenshot({ path: (process.env.SP || '/tmp') + '/quick-add-mobile.png' })

  await browser.close()
  console.log(results.join('\n'))
})().catch(e => { console.log(results.join('\n')); console.error(e); process.exit(1) })
