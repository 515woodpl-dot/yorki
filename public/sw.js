const CACHE_NAME = 'yorki-pwa-v2'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      const scopePath = new URL(self.registration.scope).pathname.replace(/\/$/, '')
      await cache.addAll([
        `${scopePath}/offline`,
        `${scopePath}/manifest.webmanifest`,
        `${scopePath}/pwa-192x192`,
        `${scopePath}/pwa-512x512`,
      ])
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) {
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(event.request)
        } catch {
          const cache = await caches.open(CACHE_NAME)
          return (await cache.match(`${new URL(self.registration.scope).pathname.replace(/\/$/, '')}/offline`)) || Response.error()
        }
      })(),
    )
    return
  }

  // Only immutable build assets and public PWA resources may be cached.
  // RSC requests use GET too and can contain the signed-in user's private data.
  const scopePath = new URL(self.registration.scope).pathname.replace(/\/$/, '')
  const publicResources = ['/offline', '/manifest.webmanifest', '/pwa-192x192', '/pwa-512x512']
  const isPublicResource = publicResources.some((resource) => url.pathname === `${scopePath}${resource}`)
  const isBuildAsset = url.pathname.startsWith(`${scopePath}/_next/static/`)
  if (!isPublicResource && !isBuildAsset) {
    return
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request)
      if (cached) {
        return cached
      }

      try {
        const response = await fetch(event.request)
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME)
          cache.put(event.request, response.clone())
        }
        return response
      } catch {
        return Response.error()
      }
    })(),
  )
})
