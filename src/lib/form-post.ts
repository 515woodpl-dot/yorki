/**
 * Helpers for plain HTML form posts (sign in, sign out, user management).
 * These work without any JavaScript running in the browser, which is the point:
 * the buttons must never depend on the page having loaded perfectly.
 */
export const BASE_PATH = process.env.NODE_ENV === 'production' ? '/task' : ''

/** Reject posts coming from another website (cookies are SameSite=Lax too; this is a second lock). */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin || origin === 'null') return !origin // no Origin header: same-site form post from older browsers
  try {
    const host = new URL(origin).host
    const allowed = [request.headers.get('host'), request.headers.get('x-forwarded-host')]
      .filter(Boolean).flatMap((value) => String(value).split(',').map((part) => part.trim()))
    return allowed.includes(host)
  } catch {
    return false
  }
}

/** 303 "go look at this page now" with a relative address, so it is right behind any proxy. */
export function seeOther(path: string, params: Record<string, string | undefined> = {}): Response {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value.slice(0, 300))
  const qs = query.toString()
  return new Response(null, {
    status: 303,
    headers: { Location: `${BASE_PATH}${path}${qs ? `?${qs}` : ''}`, 'Cache-Control': 'no-store' },
  })
}
