/**
 * push/server.ts — Web Push (server side).
 *
 * How it works: a phone or browser that agrees to alerts gives us a private "mailbox address"
 * at its vendor's push service (Google, Apple, Mozilla, Microsoft). When something happens,
 * we post an encrypted message to that address; the service wakes the device and Yorki's
 * service worker shows it. The vendor only ever sees ciphertext.
 *
 * We sign each request with a VAPID key pair so the push services know it's us. The pair is
 * created automatically the first time it's needed and kept in the database (so it survives
 * restores and nothing has to be configured). To manage it yourself, set VAPID_PUBLIC_KEY and
 * VAPID_PRIVATE_KEY (see scripts/generate-vapid-keys.cjs). Changing keys later makes every
 * existing device stop receiving until it turns notifications on again.
 */

import { createHash, randomUUID } from 'node:crypto'
import { generateVAPIDKeys, sendNotification } from 'web-push'
import { getDb } from '@/lib/db'
import { findUser, getSetting } from '@/lib/local-data'
import { DEFAULT_PREFS, buildPushPayload, type PushPayload, type PushPrefs, type PushType } from './payload'
import type { SubscriptionInput } from './validate'

export const MAX_DEVICES_PER_USER = 10
/** Consecutive failures (not "gone" errors) before a device is dropped. */
export const MAX_FAILURES = 10
const TTL_SECONDS = 24 * 60 * 60

// ─── Signing keys ────────────────────────────────────────────────────────────

export interface Vapid { subject: string; publicKey: string; privateKey: string }
let vapidCache: Vapid | null = null

/** Contact the push services can use: an https URL or mailto: (RFC 8292). */
async function vapidSubject(): Promise<string> {
  const explicit = process.env.VAPID_SUBJECT?.trim()
  if (explicit && /^(https:\/\/|mailto:)/.test(explicit)) return explicit
  try {
    const app = new URL(process.env.APP_URL ?? '')
    if (app.protocol === 'https:') return app.origin
  } catch { /* not set */ }
  const email = (await getSetting<{ notification_to?: string } | null>('email', null))?.notification_to?.trim()
  if (email && /^[^\s@]+@[^\s@]+$/.test(email)) return `mailto:${email}`
  return 'mailto:admin@yorki.local'
}

export async function getVapid(): Promise<Vapid> {
  if (vapidCache) return vapidCache
  const subject = await vapidSubject()
  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim()
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim()
  if (envPublic && envPrivate) return (vapidCache = { subject, publicKey: envPublic, privateKey: envPrivate })

  const db = getDb()
  const read = () => db.prepare("SELECT value FROM settings WHERE key = 'push_vapid'").get() as { value: string } | undefined
  let row = read()
  if (!row) {
    const keys = generateVAPIDKeys()
    // INSERT OR IGNORE: if two requests race on the very first use, one key pair wins.
    db.prepare('INSERT OR IGNORE INTO settings (id, key, value, updated_by, updated_at) VALUES (?,?,?,?,?)')
      .run(randomUUID(), 'push_vapid', JSON.stringify({ publicKey: keys.publicKey, privateKey: keys.privateKey }), null, new Date().toISOString())
    row = read()
  }
  const { publicKey, privateKey } = JSON.parse(row!.value) as { publicKey: string; privateKey: string }
  return (vapidCache = { subject, publicKey, privateKey })
}

/** For tests. */
export function resetPushCache() { vapidCache = null }

// ─── Preferences ─────────────────────────────────────────────────────────────

const PREF_KEYS = ['mention', 'comment', 'assigned', 'completed', 'show_preview'] as const

export function getPrefs(userId: string): PushPrefs {
  const row = getDb().prepare('SELECT mention, comment, assigned, completed, show_preview FROM push_prefs WHERE user_id = ?').get(userId) as Record<string, number> | undefined
  if (!row) return { ...DEFAULT_PREFS }
  return Object.fromEntries(PREF_KEYS.map((key) => [key, row[key] === 1])) as unknown as PushPrefs
}

/** Only known keys with real booleans are kept; everything else is ignored. */
export function savePrefs(userId: string, patch: unknown): PushPrefs {
  const next = getPrefs(userId)
  if (patch && typeof patch === 'object') {
    for (const key of PREF_KEYS) {
      const value = (patch as Record<string, unknown>)[key]
      if (typeof value === 'boolean') next[key] = value
    }
  }
  getDb().prepare(`
    INSERT INTO push_prefs (user_id, mention, comment, assigned, completed, show_preview, updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET mention=excluded.mention, comment=excluded.comment, assigned=excluded.assigned,
      completed=excluded.completed, show_preview=excluded.show_preview, updated_at=excluded.updated_at
  `).run(userId, +next.mention, +next.comment, +next.assigned, +next.completed, +next.show_preview, new Date().toISOString())
  return next
}

// ─── Devices ─────────────────────────────────────────────────────────────────

export const endpointId = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex').slice(0, 16)

export interface Device { id: string; label: string; created_at: string; last_success_at: string | null; failures: number }

export function listDevices(userId: string): Device[] {
  return getDb().prepare('SELECT id, COALESCE(label, \'Unknown device\') AS label, created_at, last_success_at, failures FROM push_subscriptions WHERE user_id = ? ORDER BY created_at')
    .all(userId) as Device[]
}

/**
 * Save (or take over) a device. If the same phone is later used by someone else, the
 * subscription moves to whoever turned notifications on last — never delivered to both.
 */
export function saveSubscription(userId: string, input: SubscriptionInput): { id: string } {
  const db = getDb()
  const id = endpointId(input.endpoint)
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare(`
      INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, label, created_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth,
        label=excluded.label, failures=0, last_error=NULL
    `).run(id, userId, input.endpoint, input.p256dh, input.auth, input.label, now)
    // Keep each person to a sensible number of devices: the oldest ones go first.
    db.prepare(`
      DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN (
        SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
      )
    `).run(userId, userId, MAX_DEVICES_PER_USER)
  })()
  return { id }
}

/** Remove one of this person's devices, by id or by endpoint. */
export function removeSubscription(userId: string, idOrEndpoint: string): boolean {
  const id = idOrEndpoint.startsWith('https://') ? endpointId(idOrEndpoint) : idOrEndpoint
  return getDb().prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND id = ?').run(userId, id).changes > 0
}

// ─── Sending ─────────────────────────────────────────────────────────────────

export interface PushTarget { endpoint: string; keys: { p256dh: string; auth: string } }
export type PushTransport = (
  target: PushTarget,
  body: string,
  options: { vapid: Vapid; ttl: number; urgency: 'normal' | 'high' },
) => Promise<{ statusCode: number }>

const webPushTransport: PushTransport = async (target, body, options) => {
  const response = await sendNotification(target, body, { TTL: options.ttl, urgency: options.urgency, timeout: 10_000, vapidDetails: options.vapid })
  return { statusCode: response.statusCode }
}
let transport: PushTransport = webPushTransport
/** For tests: replace (or, with null, restore) the thing that actually posts to the push service. */
export function setPushTransport(next: PushTransport | null) { transport = next ?? webPushTransport }

interface SubscriptionRow { id: string; endpoint: string; p256dh: string; auth: string; failures: number }
export interface DeliverySummary { sent: number; removed: number; failed: number }

async function deliver(row: SubscriptionRow, payload: PushPayload, vapid: Vapid): Promise<keyof DeliverySummary> {
  const db = getDb()
  try {
    await transport({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(payload), {
      vapid, ttl: TTL_SECONDS, urgency: payload.type === 'test' || payload.type === 'mention' || payload.type === 'assigned' ? 'high' : 'normal',
    })
    db.prepare('UPDATE push_subscriptions SET failures = 0, last_error = NULL, last_success_at = ? WHERE id = ?').run(new Date().toISOString(), row.id)
    return 'sent'
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    // 404 / 410: the device unsubscribed or the browser was uninstalled. Forget it.
    if (status === 404 || status === 410) {
      db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id)
      return 'removed'
    }
    const failures = row.failures + 1
    if (failures >= MAX_FAILURES) {
      db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id)
      return 'removed'
    }
    const why = status ? `HTTP ${status}` : ((error as { code?: string }).code ?? 'network error')
    db.prepare('UPDATE push_subscriptions SET failures = ?, last_error = ? WHERE id = ?').run(failures, why, row.id)
    return 'failed'
  }
}

async function deliverToUser(userId: string, payload: PushPayload): Promise<DeliverySummary> {
  const summary: DeliverySummary = { sent: 0, removed: 0, failed: 0 }
  const rows = getDb().prepare('SELECT id, endpoint, p256dh, auth, failures FROM push_subscriptions WHERE user_id = ?').all(userId) as SubscriptionRow[]
  if (rows.length === 0) return summary
  const vapid = await getVapid()
  const results = await Promise.all(rows.map((row) => deliver(row, payload, vapid)))
  for (const result of results) summary[result] += 1
  return summary
}

function unreadCount(userId: string): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as { n: number }).n
}

export interface PushItem { userId: string; actorId: string | null; taskId: string | null; type: PushType; snippet?: string | null }

/** One push per notification, to every device of that person who wants that kind. */
export async function sendPushForNotifications(items: PushItem[]): Promise<DeliverySummary> {
  const total: DeliverySummary = { sent: 0, removed: 0, failed: 0 }
  const db = getDb()
  for (const item of items) {
    const user = findUser(item.userId)
    if (!user || !user.is_active) continue
    const prefs = getPrefs(item.userId)
    if (!prefs[item.type]) continue
    const taskTitle = item.taskId
      ? (db.prepare('SELECT title FROM tasks WHERE id = ? AND deleted_at IS NULL').get(item.taskId) as { title: string } | undefined)?.title
      : null
    const actor = item.actorId ? findUser(item.actorId) : null
    const payload = buildPushPayload({
      type: item.type,
      actorName: actor?.full_name ?? actor?.display_name ?? null,
      taskTitle,
      snippet: item.snippet,
      taskId: item.taskId,
      showPreview: prefs.show_preview,
      unread: unreadCount(item.userId),
    })
    const summary = await deliverToUser(item.userId, payload)
    total.sent += summary.sent; total.removed += summary.removed; total.failed += summary.failed
  }
  return total
}

/** Fire and forget: never slows down or breaks the action that caused the notification. */
export function queuePush(items: PushItem[]) {
  if (items.length === 0) return
  setImmediate(() => {
    sendPushForNotifications(items).catch((error) => console.error('[Push] sending failed:', error instanceof Error ? error.message : error))
  })
}

/** "Send me a test" on the settings page. */
export async function sendTestPush(userId: string): Promise<DeliverySummary & { devices: number }> {
  const devices = listDevices(userId).length
  const payload = buildPushPayload({ type: 'test', showPreview: true, unread: unreadCount(userId) })
  return { ...(await deliverToUser(userId, payload)), devices }
}
