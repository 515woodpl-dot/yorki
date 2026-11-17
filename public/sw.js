/*
 * Yorki service worker.
 *
 * What it does:
 *   • lets the app be installed and open instantly (icons + build files are cached);
 *   • shows a friendly offline page instead of the browser's error when the network is down;
 *   • updates safely: a new version waits until the person taps "Refresh".
 *
 * What it deliberately does NOT do: cache pages, API responses, uploads or anything else
 * that can contain a signed-in person's data. Only public, immutable files are cached.
 */
const VERSION = 'yorki-pwa-v3'
const STATIC_CACHE = `${VERSION}-static`
const MAX_STATIC_ENTRIES = 120

const scope = new URL(self.registration.scope).pathname.replace(/\/$/, '') // "/task" in production
const OFFLINE_URL = `${scope}/offline.html`
const PRECACHE = [OFFLINE_URL, `${scope}/icons/icon-192.png`, `${scope}/icons/icon-512.png`, `${scope}/Yorki.png`]

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
