const isProd = process.env.NODE_ENV === 'production'

const nextConfig = {
  // ─── Subfolder deployment (/task) ───────────────────────────────────
  // This makes the entire app live at yoursite.com/task/
  // ALL internal links, API routes, and static assets automatically
  // resolve relative to this path — no manual prefixing needed.
  ...(isProd ? { basePath: '/task' } : {}),

  // ─── Images ─────────────────────────────────────────────────────────
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },

  // ─── Security Headers ────────────────────────────────────────────────
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },

  async redirects() {
    if (isProd) {
      return []
    }

    return [
      {
        source: '/task',
        destination: '/',
        permanent: false,
      },
      {
        source: '/task/:path*',
        destination: '/:path*',
        permanent: false,
      },
    ]
  },
}

export default nextConfig
