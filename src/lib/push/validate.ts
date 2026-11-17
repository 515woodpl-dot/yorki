/**
 * push/validate.ts — checks on what a browser sends when it subscribes to push. Pure functions.
 *
 * Why this matters: after subscribing, the SERVER will send HTTPS requests to the address the
 * browser supplied (the "endpoint"). Without a check, any signed-in person could register
 * an internal address (http://localhost:…, a cloud metadata address, a router…) and make the
 * server call it. So only the real browser push services are accepted.
 */

/** Hosts of the real push services: Chrome/Edge/Opera/Brave/Samsung (Google), Firefox, Safari, Windows. */
const ALLOWED_HOSTS: Array<string | RegExp> = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9.-]+\.notify\.windows\.com$/,
]

const MAX_ENDPOINT_LENGTH = 1000

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

/** `extraHosts`: exact hostnames an admin added (env PUSH_EXTRA_HOSTS) for a service not listed above. */
export function validateEndpoint(raw: unknown, extraHosts: string[] = []): Checked<string> {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_ENDPOINT_LENGTH) return { ok: false, error: 'Invalid push address.' }
  let url: URL
  try { url = new URL(raw) } catch { return { ok: false, error: 'Invalid push address.' } }
  if (url.protocol !== 'https:') return { ok: false, error: 'Push address must use https.' }
  if (url.username || url.password) return { ok: false, error: 'Invalid push address.' }
  if (url.port && url.port !== '443') return { ok: false, error: 'Invalid push address.' }
  const host = url.hostname.toLowerCase()
  // Raw IP addresses are never push services.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[')) return { ok: false, error: 'Invalid push address.' }
  const allowed = ALLOWED_HOSTS.some((rule) => (typeof rule === 'string' ? rule === host : rule.test(host)))
    || extraHosts.map((h) => h.trim().toLowerCase()).filter(Boolean).includes(host)
  if (!allowed) return { ok: false, error: 'That push service is not supported.' }
  return { ok: true, value: url.href }
}

const BASE64URL = /^[A-Za-z0-9_-]+$/

function decodedLength(value: string): number | null {
  if (!BASE64URL.test(value) || value.length > 200) return null
  try { return Buffer.from(value, 'base64url').length } catch { return null }
}

/** p256dh is an uncompressed P-256 point (65 bytes, starts 0x04); auth is a 16-byte secret. */
export function validateKeys(p256dh: unknown, auth: unknown): Checked<{ p256dh: string; auth: string }> {
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return { ok: false, error: 'Invalid subscription keys.' }
  if (decodedLength(p256dh) !== 65 || Buffer.from(p256dh, 'base64url')[0] !== 0x04) return { ok: false, error: 'Invalid subscription keys.' }
  if (decodedLength(auth) !== 16) return { ok: false, error: 'Invalid subscription keys.' }
  return { ok: true, value: { p256dh, auth } }
}

/** "Chrome on Android", "Safari on iPhone"… — so people can recognise their devices in a list. */
export function labelFromUserAgent(ua: unknown): string {
  const s = typeof ua === 'string' ? ua.slice(0, 400) : ''
  const os = /iPhone/.test(s) ? 'iPhone'
    : /iPad/.test(s) ? 'iPad'
    : /Android/.test(s) ? 'Android'
    : /Windows/.test(s) ? 'Windows'
    : /Macintosh|Mac OS X/.test(s) ? 'Mac'
    : /CrOS/.test(s) ? 'Chromebook'
    : /Linux/.test(s) ? 'Linux'
    : ''
  const browser = /Edg(e|A|iOS)?\//.test(s) ? 'Edge'
    : /OPR\/|Opera/.test(s) ? 'Opera'
    : /SamsungBrowser/.test(s) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(s) ? 'Firefox'
    : /Chrome\/|CriOS/.test(s) ? 'Chrome'
    : /Safari\//.test(s) ? 'Safari'
    : ''
  if (browser && os) return `${browser} on ${os}`
  return browser || os || 'Unknown device'
}

export interface SubscriptionInput { endpoint: string; p256dh: string; auth: string; label: string }

/** Body of POST /api/push/subscribe — the JSON a browser's PushSubscription.toJSON() produces. */
export function validateSubscriptionInput(body: unknown, userAgent: unknown, extraHosts: string[] = []): Checked<SubscriptionInput> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid subscription.' }
  const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
  const endpoint = validateEndpoint(b.endpoint, extraHosts)
  if (!endpoint.ok) return endpoint
  const keys = validateKeys(b.keys?.p256dh, b.keys?.auth)
  if (!keys.ok) return keys
  return { ok: true, value: { endpoint: endpoint.value, ...keys.value, label: labelFromUserAgent(userAgent) } }
}
