import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  const appBasePath = process.env.NODE_ENV === 'production' ? '/task' : ''

  return {
    name: 'Yorki',
    short_name: 'Yorki',
    description: 'Internal task and request management',
    id: `${appBasePath}/`,
    start_url: `${appBasePath}/`,
    scope: `${appBasePath}/`,
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    background_color: '#F6F3EE',
    theme_color: '#F6F3EE',
    icons: [
      {
        src: `${appBasePath}/pwa-192x192`,
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: `${appBasePath}/pwa-512x512`,
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: `${appBasePath}/pwa-512x512`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
