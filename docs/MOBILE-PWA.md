# Yorki on phones — install, offline, and mobile design rules

## Install it like an app

| Device | How |
|---|---|
| **Android (Chrome / Edge / Samsung)** | Menu (your photo, top right) → **Install app** — or the browser's own "Install" prompt. |
| **iPhone / iPad (Safari)** | **Share** → **Add to Home Screen** → **Add**. (The menu's **Install app** shows these steps.) |
| **Windows / Mac (Chrome, Edge)** | **Install app** in the account menu, or the install icon in the address bar. |

Installed, Yorki opens full-screen with its own icon, and **long-press the icon** (Android) or
right-click it (desktop) for shortcuts: *New task*, *My tasks*, *Calendar*.

Needs **HTTPS** (already required for sign-in). Installing, the offline page and updates all depend on it.

## What works with no connection

Yorki is a live team board, so tasks, comments and uploads need internet. Offline, you get:

- a clear **"You're offline / Sin conexión"** page with *Try again* (it reloads by itself when the connection returns);
- while using the app, a **banner** when the connection drops, so a failed save isn't a mystery;
- the app opens instantly because its icons and code files are kept on the device.

**Not stored on the device:** pages, tasks, comments, attachments or anything from the API —
nothing that belongs to a signed-in person. (This is deliberate: a lost phone or a shared
computer never exposes cached work data.)

## Updates

A new version never replaces the old one while someone is mid-task. A bar appears —
**"A new version of Yorki is ready · Refresh"** — and the update applies when tapped.
Installed apps also look for updates hourly and whenever they're reopened.

## Mobile design rules (keep these when changing the UI)

| Rule | Why | How |
|---|---|---|
| Text fields are **16px on touch screens** | iPhone Safari zooms the page when a smaller field is focused, and doesn't zoom back | global rule in `globals.css` (`@media (pointer: coarse)`); desktop unchanged |
| Tap targets are **≥ 40px** (44–48 for main actions) | thumbs | use `coarse:` classes, e.g. `h-8 coarse:h-11` |
| `coarse:` / `fine:` instead of `sm:` for sizes | tablets and landscape phones are wider than `sm` but still touch | Tailwind variants in `tailwind.config.ts` |
| Icon-only buttons need an **`aria-label`** | no hover tooltip on a phone; screen readers | — |
| Use **`min-h-dvh`**, not `min-h-screen` | `100vh` includes the area behind Safari's address bar | — |
| Bars respect **notch and home bar** | `viewport-fit=cover` draws edge to edge, so fixed bars add `env(safe-area-inset-*)` padding | header / bottom nav in `AppNav.tsx`, `<main>` in the protected layout |
| Short (landscape) screens get slimmer bars | the bars would otherwise use half a 390px-tall screen | `[@media(max-height:500px)]:` variants |
| Overflowing strips (admin tabs) scroll to the current item and **fade** at the edge | otherwise people don't know there's more | `AdminNav.tsx` |
| Status-bar colour follows the **app's** light/dark theme | the app switches by time of day, not the phone's setting | `ThemeColorSync.tsx` |

## Files

| File | Purpose |
|---|---|
| `src/app/manifest.ts` | name, colours, icons, shortcuts |
| `public/sw.js` | service worker (offline page + public files only) |
| `public/offline.html` | self-contained offline page (English + Spanish) |
| `public/icons/*`, `src/app/icon.png`, `src/app/apple-icon.png` | app icons — **generated**: `node scripts/generate-pwa-icons.cjs` |
| `src/components/pwa/` | registration + update bar, install button, offline banner |
| `src/components/theme/ThemeColorSync.tsx` | status-bar colour |

## Testing

`tests/e2e/pwa-mobile.js` (part of `tests/e2e/run.sh`) checks, in a real browser:
installability (manifest, icons, iOS tags, service worker), the offline page, the install flow on
Android and iPhone, notch/home-bar spacing (emulated), and — at 320, 390, 768 and 844px —
every page for sideways scrolling, iPhone-zoom text fields and small tap targets.

**Not covered by automatic tests:** a physical iPhone or Android phone. Before relying on it,
install it once on each platform and try: install, open, airplane mode, reconnect.

## Not included (yet)

- **Push notifications** (alerts when the app is closed). Needs a push service and per-device
  subscriptions; today's notifications show in the app's bell and by email.
- **Offline editing / background sync.**
- Store-style install **screenshots** (would show real company data).
