import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import type { SessionUser } from '@/lib/types'

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

const MAX_BODY_BYTES = 8 * 1024

/**
 * Common checks for /api/push/*: signed in; and for changes, a same-site request with a JSON body
 * (the session cookie alone isn't enough — another website must not be able to turn alerts on or off).
 */
export async function guard(request: Request, write: boolean): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const user = await getSessionUser()
  if (!user) return { response: json({ error: 'Not signed in.' }, 401) }
  if (write) {
    const origin = request.headers.get('origin')
    if (origin) {
      let originHost = ''
      try { originHost = new URL(origin).host } catch { /* invalid */ }
      const hosts = [request.headers.get('host'), request.headers.get('x-forwarded-host')].filter(Boolean)
      if (!originHost || !hosts.includes(originHost)) return { response: json({ error: 'Cross-site request refused.' }, 403) }
    }
    if (!/application\/json/i.test(request.headers.get('content-type') ?? '')) return { response: json({ error: 'Expected JSON.' }, 415) }
  }
  return { user }
}

export async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return { ok: false, response: json({ error: 'Request too large.' }, 413) }
  try { return { ok: true, body: text ? JSON.parse(text) : {} } } catch { return { ok: false, response: json({ error: 'Invalid JSON.' }, 400) } }
}
