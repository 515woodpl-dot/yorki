/*
 * Yorki service worker.
 *
 * What it does:
 *   • lets the app be installed and open instantly (icons + build files are cached);
 *   • shows a friendly offline page instead of the browser's error when the network is down;
 *   • updates safely: a new version waits until the person taps "Refresh";
 *   • shows push notifications (mentions, assignments…) when the app is closed, and opens the
 *     right card when one is tapped.
 *
 * What it deliberately does NOT do: cache pages, API responses, uploads or anything else
 * that can contain a signed-in person's data. Only public, immutable files are cached.
 */
const VERSION = 'yorki-pwa-v4'
const STATIC_CACHE = `${VERSION}-static`
const MAX_STATIC_ENTRIES = 120

const scope = new URL(self.registration.scope).pathname.replace(/\/$/, '') // "/task" in production
const OFFLINE_URL = `${scope}/offline.html`
const PRECACHE = [OFFLINE_URL, `${scope}/icons/icon-192.png`, `${scope}/icons/icon-512.png`, `${scope}/icons/badge-96.png`, `${scope}/Yorki.png`]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)))
  // No skipWaiting() here: an update waits until the person chooses to refresh (see 'message').
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key.startsWith('yorki-pwa-') && key !== STATIC_CACHE).map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

/** Keep the runtime cache small: drop the oldest entries first. */
async function trim(cache) {
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - MAX_STATIC_ENTRIES; i++) await cache.delete(keys[i])
}

const isCacheable = (pathname) =>
  pathname.startsWith(`${scope}/_next/static/`) ||
  pathname.startsWith(`${scope}/icons/`) ||
  pathname === `${scope}/Yorki.png`

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Page loads: always ask the network (so people never see stale or someone else's data).
  // If the network is down, or the server is unreachable (502/503/504), show the offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          if ([502, 503, 504].includes(response.status)) throw new Error(`upstream ${response.status}`)
          return response
        } catch {
          const cache = await caches.open(STATIC_CACHE)
          return (await cache.match(OFFLINE_URL)) || Response.error()
        }
      })(),
    )
    return
  }

  // Public, content-hashed files: cache first.
  if (!isCacheable(url.pathname)) return // everything else (API, RSC, uploads, live stream) goes straight to the network
  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE)
      const cached = await cache.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) {
        await cache.put(request, response.clone())
        trim(cache)
      }
      return response
    })(),
  )
})

// ─── Push notifications ──────────────────────────────────────────────────────

/** iPhone / iPad (WebKit): every push MUST show a notification, or the subscription is revoked. */
const mustAlwaysShow = () => {
  const nav = self.navigator
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1)
}

/** The message comes from our own server (encrypted for this device), but still only accept in-app paths. */
const safePath = (path) => (typeof path === 'string' && /^\/(?!\/)/.test(path) && path.length < 500 ? path : '/dashboard')

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let data = {}
      try {
        data = event.data ? event.data.json() : {}
      } catch {
        data = { body: event.data ? event.data.text() : '' }
      }
      const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 120) : 'Yorki'
      const body = typeof data.body === 'string' ? data.body.slice(0, 300) : ''
      const path = safePath(data.path)

      // Icon badge: the unread count (supported by Android/desktop Chrome, installed iPhone apps).
      if (typeof data.unread === 'number' && self.navigator && 'setAppBadge' in self.navigator) {
        try { await (data.unread > 0 ? self.navigator.setAppBadge(data.unread) : self.navigator.clearAppBadge()) } catch { /* optional */ }
      }

      // If the person is looking at Yorki right now, the in-app bell already tells them — don't also pop a
      // system banner (except a test, which they just asked for, and on iPhone, which requires one).
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const looking = windows.find((client) => client.focused && client.visibilityState === 'visible')
      if (looking && data.type !== 'test' && !mustAlwaysShow()) {
        looking.postMessage({ type: 'push', payload: { type: data.type, path, unread: data.unread } })
        return
      }

      await self.registration.showNotification(title, {
        body,
        icon: `${scope}/icons/icon-192.png`,
        badge: `${scope}/icons/badge-96.png`, // small monochrome icon in the Android status bar
        tag: typeof data.tag === 'string' && data.tag ? data.tag.slice(0, 80) : 'yorki', // same card → replaces, not stacks
        renotify: true,
        timestamp: typeof data.ts === 'number' ? data.ts : Date.now(),
        data: { path },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = safePath(event.notification.data && event.notification.data.path)
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows.find((client) => new URL(client.url).pathname.startsWith(`${scope}/`))
      if (open) {
        // Already open: move to the card without a full reload, and bring the window forward.
        // Going to the card must not depend on focusing working (browsers sometimes refuse focus()).
        open.postMessage({ type: 'navigate', path })
        try { await open.focus() } catch { /* the navigation above still happens */ }
        return
      }
      await self.clients.openWindow(`${scope}${path}`)
    })(),
  )
})

/** The browser rotated or expired this device's subscription: quietly get a new one. */
const keyToBytes = (key) => {
  const padded = (key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const state = await fetch(`${scope}/api/push/state`, { credentials: 'same-origin' })
        if (!state.ok) return // signed out: nothing to renew
        const { publicKey } = await state.json()
        const subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) })
        await fetch(`${scope}/api/push/subscribe`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription.toJSON()),
        })
      } catch { /* the person can turn notifications on again from the settings page */ }
    })(),
  )
})
