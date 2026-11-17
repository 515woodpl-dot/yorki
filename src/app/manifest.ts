import type { MetadataRoute } from 'next'

// Colours match the app: light = the page background, used on the install splash screen.
const LIGHT_BACKGROUND = '#EFF4FA'
const BRAND_NAVY = '#2F3650'

export default function manifest(): MetadataRoute.Manifest {
  const base = process.env.NODE_ENV === 'production' ? '/task' : ''

  return {
    id: `${base}/`,
    name: 'Yorki — Tasks',
    short_name: 'Yorki',
    description: 'Team tasks, requests and calendar for Golden Stone Works',
    lang: 'en',
    dir: 'ltr',
    categories: ['business', 'productivity'],
    start_url: `${base}/dashboard?source=pwa`,
    scope: `${base}/`,
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: LIGHT_BACKGROUND,
    theme_color: BRAND_NAVY,
    prefer_related_applications: false,
    icons: [
      { src: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}/icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${base}/icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Long-press the app icon (Android) or right-click it (desktop) for these.
    shortcuts: [
      { name: 'New task', short_name: 'New task', url: `${base}/submit?source=shortcut`, icons: [{ src: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' }] },
      { name: 'My tasks', short_name: 'My tasks', url: `${base}/dashboard?scope=mine&view=list&source=shortcut`, icons: [{ src: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' }] },
      { name: 'Calendar', short_name: 'Calendar', url: `${base}/dashboard?view=calendar&source=shortcut`, icons: [{ src: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' }] },
    ],
  }
}
