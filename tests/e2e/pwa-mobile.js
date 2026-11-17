// PWA + mobile checks against a running production server (:3100): installable, offline page,
// install prompts on Android/iPhone, notch safe areas — and, on phone/tablet sizes, no sideways
// scrolling, no text fields that make iPhones zoom, no tap targets under 40px.
// Run by tests/e2e/run.sh (or: SHOTS=/some/dir to keep screenshots).
const { chromium, devices: playwrightDevices } = require('playwright')
const fs = require('node:fs')
const BASE = 'http://127.0.0.1:3100/task'
const pageErrors = []  // any uncaught JavaScript error, on any page, fails the run
const SHOTS = process.env.SHOTS || '/tmp'

const VIEWPORTS = [
  { name: 'iPhone SE (320)', width: 320, height: 568 },
  { name: 'iPhone 14 (390)', width: 390, height: 844 },
  { name: 'iPad portrait (768)', width: 768, height: 1024 },
  { name: 'phone landscape (844)', width: 844, height: 390 },
]
const PAGES = [
  ['/dashboard', 'Board'], ['/dashboard?view=list', 'List'], ['/dashboard?view=calendar', 'Calendar'],
  ['/submit', 'New task'], ['/archive', 'Archive'], ['/admin/users', 'Users'], ['/admin/settings', 'Settings'],
  ['/admin/columns', 'Columns'], ['/notifications', 'Notification settings'], ['/admin/email', 'Email'], ['/admin/activity', 'Activity'],
]

async function ctxFor(browser, vp, sid) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: vp.width < 800, deviceScaleFactor: 2 })
  if (sid) await ctx.addCookies([{ name: 'yorki_session', value: sid, domain: '127.0.0.1', path: '/' }])
  return ctx
}

/** Runs in the page: what's wrong with layout on a touch device? */
function inspectPage() {
  const vw = document.documentElement.clientWidth
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'
  }
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.name || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40)
  const out = { overflowX: document.documentElement.scrollWidth - vw, wide: [], small: [], zoom: [], clipped: [] }
  // Elements poking out of the viewport (the cause of sideways scrolling).
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    // Inside a horizontally scrollable area on purpose (e.g. kanban columns, tab strips)?
    let scroller = false
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth) { scroller = true; break }
    }
    const decorative = el.closest('[aria-hidden="true"], .pointer-events-none')
    if (!scroller && !decorative && r.right > vw + 1 && out.wide.length < 6) out.wide.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${label(el)}" right=${Math.round(r.right)}`)
  }
  for (const el of Array.from(document.querySelectorAll('a[href], button, [role=button], select, summary, input:not([type=hidden]), textarea, [role=option], [role=tab]'))) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    const isCheckbox = el.tagName === 'INPUT' && /checkbox|radio/.test(el.type)
    // WCAG 2.5.8 minimum is 24px; Apple/Google recommend 44/48. Flag < 36 (checkbox/radio: look at their label).
    const target = isCheckbox ? (el.closest('label')?.getBoundingClientRect() ?? r) : r
    if ((target.width < 40 || target.height < 40) && out.small.length < 25) out.small.push(`${el.tagName.toLowerCase()} "${label(el)}" ${Math.round(target.width)}x${Math.round(target.height)}`)
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !isCheckbox && !/(checkbox|radio|range|color|file|submit|button)/.test(el.type || '')) {
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (fs < 16 && out.zoom.length < 15) out.zoom.push(`${el.tagName.toLowerCase()} "${label(el)}" ${fs}px`)
    }
  }
  return out
}

;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: process.env.CHROMIUM_PATH ? ['--no-sandbox'] : [] })
  // Every browser context this test opens reports uncaught JavaScript errors.
  const openContext = browser.newContext.bind(browser)
  browser.newContext = async (options) => {
    const context = await openContext(options)
    context.on('page', (page) => page.on('pageerror', (e) => pageErrors.push(e.message)))
    return context
  }
  const report = { pwa: [], pages: [] }
  const fs = require('node:fs')  // (only used when REPORT is set)
  const ok = (name, pass, detail = '') => report.pwa.push({ name, pass, detail })

  // ─── PWA ───────────────────────────────────────────────────────────────────
  {
    const ctx = await ctxFor(browser, VIEWPORTS[2], 'sess-ana')
    const page = await ctx.newPage()
    await page.goto(`${BASE}/dashboard`)
    await page.waitForLoadState('networkidle').catch(() => {})
    const head = await page.evaluate(() => ({
      manifest: document.querySelector('link[rel=manifest]')?.getAttribute('href') ?? null,
      themeColors: Array.from(document.querySelectorAll('meta[name=theme-color]')).map((m) => `${m.content}|${m.media}`),
      appleIcon: document.querySelector('link[rel=apple-touch-icon]')?.getAttribute('href') ?? null,
      appleCapable: document.querySelector('meta[name=apple-mobile-web-app-capable], meta[name=mobile-web-app-capable]')?.content ?? null,
      appleTitle: document.querySelector('meta[name=apple-mobile-web-app-title]')?.content ?? null,
      statusBar: document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]')?.content ?? null,
      viewport: document.querySelector('meta[name=viewport]')?.content ?? null,
      lang: document.documentElement.lang,
      favicon: document.querySelector('link[rel~=icon]')?.getAttribute('href') ?? null,
    }))
    ok('manifest linked in <head>', !!head.manifest, head.manifest ?? 'missing')
    // The server sends light + dark tags (first paint); once running, ThemeColorSync keeps ONE tag matching the app's own theme.
    const raw = await page.request.get(`${BASE}/login`).then((r) => r.text())
    const served = (raw.match(/<meta name="theme-color"[^>]*>/g) ?? [])
    ok('theme-color: light + dark served for first paint', served.length >= 2 && /prefers-color-scheme: ?light/.test(served.join('')) && /prefers-color-scheme: ?dark/.test(served.join('')), served.join(' ') || 'missing')
    ok('theme-color: first tag follows the in-app theme', /^#[0-9a-f]{6}\|$/i.test(head.themeColors[0] ?? ''), head.themeColors.join(' ; '))
    ok('apple-touch-icon (iOS home screen icon)', !!head.appleIcon, head.appleIcon ?? 'missing')
    ok('iOS standalone meta (apple-mobile-web-app-capable)', !!head.appleCapable, head.appleCapable ?? 'missing')
    ok('iOS status bar style', !!head.statusBar, head.statusBar ?? 'missing')
    ok('viewport-fit=cover (notch / home bar)', /viewport-fit=cover/.test(head.viewport ?? ''), head.viewport ?? 'missing')
    ok('viewport allows pinch zoom', !/user-scalable=no|maximum-scale=1(\.0)?(,|$)/.test(head.viewport ?? ''), head.viewport ?? 'missing')
    ok('favicon', !!head.favicon, head.favicon ?? 'missing')

    const mres = await page.request.get(`${BASE}/manifest.webmanifest`)
    const manifest = mres.ok() ? await mres.json() : {}
    ok('manifest served', mres.ok(), `HTTP ${mres.status()}`)
    for (const k of ['name', 'short_name', 'start_url', 'scope', 'id', 'display', 'theme_color', 'background_color', 'description']) ok(`manifest.${k}`, !!manifest[k], String(manifest[k] ?? 'missing'))
    ok('manifest: display standalone', manifest.display === 'standalone')
    ok('manifest: orientation not locked', !manifest.orientation || manifest.orientation === 'any', String(manifest.orientation ?? 'free'))
    const icons = manifest.icons ?? []
    for (const [size, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]) {
      const icon = icons.find((i) => i.sizes === size && (i.purpose ?? 'any').split(' ').includes(purpose))
      ok(`icon ${size} ${purpose}`, !!icon, icon?.src ?? 'missing')
      if (icon) {
        const r = await page.request.get(new URL(icon.src, `${BASE}/`).href)
        ok(`icon ${size} ${purpose} loads as PNG`, r.ok() && /image\/png/.test(r.headers()['content-type'] ?? ''), `${r.status()} ${r.headers()['content-type']}`)
      }
    }
    ok('manifest shortcuts (long-press app icon)', Array.isArray(manifest.shortcuts) && manifest.shortcuts.length > 0, `${manifest.shortcuts?.length ?? 0}`)
    // Optional: store-style screenshots would show real company data, so none are shipped on purpose.
    ok('manifest screenshots (optional, skipped on purpose)', true, `${manifest.screenshots?.length ?? 0}`)

    // Service worker
    const sw = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false }
      const regs = await navigator.serviceWorker.getRegistrations()
      return { supported: true, registrations: regs.map((r) => r.scope), controlled: !!navigator.serviceWorker.controller }
    })
    ok('service worker registered', (sw.registrations ?? []).length > 0, JSON.stringify(sw))
    const swFile = await page.request.get(`${BASE}/sw.js`)
    ok('sw.js served, not cached by the browser/CDN', swFile.ok() && /no-cache|max-age=0|no-store/.test(swFile.headers()['cache-control'] ?? ''), `${swFile.status()} cache-control: ${swFile.headers()['cache-control'] ?? 'none'}`)

    // Offline: with an installed worker, a page load must show the offline screen rather than a browser error.
    if ((sw.registrations ?? []).length > 0) {
      await page.evaluate(() => navigator.serviceWorker.ready)
      await page.reload(); await page.waitForLoadState('networkidle').catch(() => {})
      await ctx.setOffline(true)
      const res = await page.goto(`${BASE}/dashboard`).catch((e) => ({ error: e.message }))
      const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 80)
      ok('offline: shows the Yorki offline page', /offline/i.test(text), text.replace(/\s+/g, ' '))
      await ctx.setOffline(false)
    } else {
      ok('offline: shows the Yorki offline page', false, 'needs a service worker')
    }
    await ctx.close()
  }

  // ─── Install flow ──────────────────────────────────────────────────────────
  {
    // Android / desktop Chrome: a captured beforeinstallprompt becomes an "Install app" button.
    const ctx = await ctxFor(browser, VIEWPORTS[2], 'sess-ana')
    const page = await ctx.newPage()
    await page.addInitScript(() => {
      window.__installCalls = 0
      window.addEventListener('DOMContentLoaded', () => {
        const e = new Event('beforeinstallprompt', { cancelable: true })
        e.prompt = async () => { window.__installCalls += 1 }
        e.userChoice = Promise.resolve({ outcome: 'accepted' })
        setTimeout(() => window.dispatchEvent(e), 300)
      })
    })
    await page.goto(`${BASE}/dashboard`); await page.waitForTimeout(1200)
    await page.locator('summary[aria-label="Account menu"]:visible').first().click()
    const item = page.locator('button:visible', { hasText: 'Install app' }).first()
    ok('install (Android/Chrome): "Install app" appears in the account menu', await item.isVisible().catch(() => false))
    if (await item.isVisible().catch(() => false)) {
      await item.click(); await page.waitForTimeout(200)
      ok('install (Android/Chrome): tapping it opens the browser install prompt', (await page.evaluate(() => window.__installCalls)) === 1)
    }
    await ctx.close()

    // iPhone Safari: no install event exists, so it shows the three steps.
    const iphone = playwrightDevices['iPhone 14']
    const ictx = await browser.newContext({ ...iphone })
    await ictx.addCookies([{ name: 'yorki_session', value: 'sess-ana', domain: '127.0.0.1', path: '/' }])
    const ip = await ictx.newPage()
    await ip.goto(`${BASE}/dashboard`); await ip.waitForTimeout(800)
    await ip.locator('summary[aria-label="Account menu"]:visible').first().click()
    const iosItem = ip.locator('button:visible', { hasText: 'Install app' }).first()
    ok('install (iPhone): "Install app" appears in the account menu', await iosItem.isVisible().catch(() => false))
    if (await iosItem.isVisible().catch(() => false)) {
      await iosItem.click()
      ok('install (iPhone): shows Share → Add to Home Screen steps', await ip.getByText('Add to Home Screen').first().isVisible().catch(() => false))
    }
    await ictx.close()
    // Already installed (iOS standalone): nothing to offer.
    const sctx = await browser.newContext({ ...iphone })
    await sctx.addCookies([{ name: 'yorki_session', value: 'sess-ana', domain: '127.0.0.1', path: '/' }])
    await sctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }))
    const sp = await sctx.newPage()
    await sp.goto(`${BASE}/dashboard`); await sp.waitForTimeout(800)
    await sp.locator('summary[aria-label="Account menu"]:visible').first().click()
    ok('install: hidden once the app is installed', (await sp.locator('button:visible', { hasText: 'Install app' }).count()) === 0)
    await sctx.close()
  }

  // ─── Notch / home bar (emulated safe-area insets) ──────────────────────────
  {
    const ctx = await ctxFor(browser, { name: 'landscape', width: 844, height: 390 }, 'sess-ana')
    const page = await ctx.newPage()
    const cdp = await ctx.newCDPSession(page)
    const INSET = { top: 0, bottom: 21, left: 47, right: 47 } // iPhone in landscape
    const applied = await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: INSET }).then(() => true).catch(() => false)
    await page.goto(`${BASE}/dashboard`); await page.waitForLoadState('networkidle').catch(() => {})
    if (!applied) {
      ok('safe areas: emulation available in this browser', false, 'Emulation.setSafeAreaInsetsOverride unsupported')
    } else {
      const m = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth
        const links = Array.from(document.querySelectorAll('nav[aria-label="Mobile navigation"] a')).map((a) => a.getBoundingClientRect())
        const header = document.querySelector('header')
        const hb = header ? Array.from(header.querySelectorAll('a, button, summary')).map((a) => a.getBoundingClientRect()) : []
        const nav = document.querySelector('nav[aria-label="Mobile navigation"]')?.getBoundingClientRect()
        const heroLeft = document.querySelector('main')?.firstElementChild?.getBoundingClientRect().left ?? 0
        return {
          vw,
          navLeft: Math.min(...links.map((r) => r.left)), navRight: Math.max(...links.map((r) => r.right)),
          headerLeft: Math.min(...hb.map((r) => r.left)), headerRight: Math.max(...hb.map((r) => r.right)),
          navBottomPad: nav ? parseFloat(getComputedStyle(document.querySelector('nav[aria-label="Mobile navigation"]')).paddingBottom) : 0,
          contentLeft: heroLeft,
        }
      })
      ok('safe areas: bottom bar clear of the notch (left/right)', m.navLeft >= INSET.left - 1 && m.navRight <= m.vw - INSET.right + 1, `links ${Math.round(m.navLeft)}–${Math.round(m.navRight)} of ${m.vw}`)
      ok('safe areas: header buttons clear of the notch', m.headerLeft >= INSET.left - 1 && m.headerRight <= m.vw - INSET.right + 1, `${Math.round(m.headerLeft)}–${Math.round(m.headerRight)} of ${m.vw}`)
      ok('safe areas: bottom bar sits above the home indicator', m.navBottomPad >= INSET.bottom - 1, `padding-bottom ${m.navBottomPad}px`)
      ok('safe areas: page content clear of the notch', m.contentLeft >= INSET.left - 1, `content starts at ${Math.round(m.contentLeft)}px`)
      if (process.env.SHOTS) await page.screenshot({ path: `${SHOTS}/landscape-safearea.png` })
    }
    await ctx.close()
  }

  // ─── Every page, every size ────────────────────────────────────────────────
  for (const vp of VIEWPORTS) {
    const ctx = await ctxFor(browser, vp, 'sess-ana')
    const page = await ctx.newPage()
    const targets = [...PAGES]
    for (const [path, name] of targets) {
      await page.goto(`${BASE}${path}`).catch(() => {})
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.waitForTimeout(300)
      const r = await page.evaluate(inspectPage)
      report.pages.push({ vp: vp.name, page: name, ...r })
      if (process.env.SHOTS && vp.name.startsWith('iPhone 14')) await page.screenshot({ path: `${SHOTS}/${vp.name.replace(/\W+/g, '')}-${name.replace(/\W+/g, '')}.png`, fullPage: false })
    }
    // Board with the Quick add preview open, and with a task sheet open
    await page.goto(`${BASE}/dashboard`); await page.waitForLoadState('networkidle').catch(() => {})
    const box = page.getByRole('textbox', { name: 'Describe what needs to be done' })
    await box.fill('Ana should call the supplier by Friday at 3pm, urgent #vendors. Mia to order tiles')
    await page.waitForTimeout(400)
    report.pages.push({ vp: vp.name, page: 'Quick add', ...(await page.evaluate(inspectPage)) })
    if (process.env.SHOTS && vp.name.startsWith('iPhone 14')) await page.screenshot({ path: `${SHOTS}/${vp.name.replace(/\W+/g, '')}-QuickAdd.png` })
    await box.fill('')
    const firstCard = page.getByRole('button', { name: /^Open task:/ }).first()
    if (await firstCard.count()) {
      await firstCard.click(); await page.waitForTimeout(500)
      report.pages.push({ vp: vp.name, page: 'Task sheet', ...(await page.evaluate(inspectPage)) })
      if (process.env.SHOTS && vp.name.startsWith('iPhone 14')) await page.screenshot({ path: `${SHOTS}/${vp.name.replace(/\W+/g, '')}-TaskSheet.png` })
    }
    // Login (logged out)
    const out = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: vp.width < 800 })
    const lp = await out.newPage()
    await lp.goto(`${BASE}/login`); await lp.waitForLoadState('networkidle').catch(() => {})
    report.pages.push({ vp: vp.name, page: 'Login', ...(await lp.evaluate(inspectPage)) })
    if (process.env.SHOTS && vp.name.startsWith('iPhone 14')) await lp.screenshot({ path: `${SHOTS}/${vp.name.replace(/\W+/g, '')}-Login.png` })
    await out.close(); await ctx.close()
  }

  await browser.close()
  let failed = 0
  if (pageErrors.length) { failed += 1; console.log(`FAIL  no JavaScript errors in the browser — ${pageErrors.length}: ${Array.from(new Set(pageErrors)).slice(0, 3).join(' | ')}`) }
  else console.log('PASS  no JavaScript errors in the browser on any page')
  for (const c of report.pwa) {
    if (!c.pass) failed += 1
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`)
  }
  // One line per screen size: every page measured there, problems spelled out.
  for (const vp of VIEWPORTS) {
    const here = report.pages.filter((p) => p.vp === vp.name)
    const bad = here.filter((p) => p.overflowX > 1 || p.wide.length || p.zoom.length || p.small.length)
    if (bad.length === 0) console.log(`PASS  ${vp.name}: ${here.length} screens, no sideways scroll, no iOS zoom fields, no small tap targets`)
    else {
      failed += 1
      console.log(`FAIL  ${vp.name}: ${bad.length} of ${here.length} screens have problems`)
      for (const p of bad) {
        const why = []
        if (p.overflowX > 1) why.push(`sideways scroll +${p.overflowX}px`)
        if (p.wide.length) why.push(`sticks out: ${p.wide.slice(0, 2).join(' | ')}`)
        if (p.zoom.length) why.push(`iOS zoom <16px: ${p.zoom.slice(0, 2).join(' | ')}`)
        if (p.small.length) why.push(`tap targets <40px: ${p.small.slice(0, 3).join(' | ')}`)
        console.log(`        ${p.page}: ${why.join('; ')}`)
      }
    }
  }
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
