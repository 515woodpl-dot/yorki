/**
 * notifications.ts — @mentions + in-app notifications (server only)
 *
 * Mentions are stored inside comment bodies as  @[Display Name](userId)
 * so they survive renames and two people with the same first name.
 *
 * Who gets notified:
 *  - mention   : people @mentioned in a comment
 *  - comment   : the card's submitter + assignees (not the author, not those already mentioned)
 *  - assigned  : people newly assigned to a card
 *  - completed : the card's submitter + assignees when it is completed
 *
 * Nobody is ever notified about a card they can't open, and internal
 * (admin-only) notes only ever notify admins.
 */

import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import { findUser } from './local-data'
import { getAssignedUserIds, isTaskAssignedToUser } from './utils'
import { queuePush } from './push/server'
import type { AppNotification, NotificationType, Task, UserProfile } from './types'

const MENTION_PATTERN = /@\[([^\]\n]{1,80})\]\(([A-Za-z0-9-]{1,64})\)/g

/** User ids mentioned in a comment body (deduplicated, in order). */
export function parseMentionIds(body: string): string[] {
  const ids: string[] = []
  for (const match of Array.from(body.matchAll(MENTION_PATTERN))) {
    if (!ids.includes(match[2])) ids.push(match[2])
  }
  return ids
}

/** Body with mention tokens turned into plain "@Name" (for snippets, emails, search). */
export function mentionsToPlainText(body: string): string {
  return body.replace(MENTION_PATTERN, (_m, name: string) => `@${name}`)
}

export function isAdminRole(role: string) {
  return role === 'admin' || role === 'super_admin'
}

/** Same visibility rule as the board: admins, the submitter, and assignees. */
export function userCanAccessTask(user: Pick<UserProfile, 'id' | 'role' | 'is_active'>, task: Task) {
  if (!user.is_active) return false
  return isAdminRole(user.role) || task.submitted_by === user.id || isTaskAssignedToUser(task, user.id)
}

/** Everyone who could be @mentioned on this card (optionally: admins only). */
export function getMentionCandidates(task: Task, { internalOnly = false } = {}): UserProfile[] {
  const rows = getDb().prepare('SELECT * FROM users WHERE is_active = 1 ORDER BY full_name').all() as Record<string, unknown>[]
  return rows
    .map((row) => ({ ...(row as unknown as UserProfile), is_active: row.is_active === 1 }))
    .filter((user) => userCanAccessTask(user, task))
    .filter((user) => !internalOnly || isAdminRole(user.role))
}

function snippetOf(text: string, max = 140) {
  const plain = mentionsToPlainText(text).replace(/\s+/g, ' ').trim()
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain
}

interface NewNotification {
  userId: string
  actorId: string
  taskId: string
  commentId?: string | null
  type: NotificationType
  snippet?: string | null
}

function insertNotifications(items: NewNotification[]) {
  if (items.length === 0) return
  const db = getDb()
  const insert = db.prepare(`
    INSERT INTO notifications (id, user_id, actor_id, task_id, comment_id, type, snippet, created_at, read_at)
    VALUES (?,?,?,?,?,?,?,?,NULL)
  `)
  const now = new Date().toISOString()
  db.transaction(() => {
    for (const item of items) {
      insert.run(randomUUID(), item.userId, item.actorId, item.taskId, item.commentId ?? null, item.type, item.snippet ?? null, now)
    }
  })()

  // Also push to people's phones / browsers (fire and forget; never affects this request).
  try {
    queuePush(items.map((item) => ({ userId: item.userId, actorId: item.actorId, taskId: item.taskId, type: item.type, snippet: item.snippet ?? null })))
  } catch (error) {
    console.error('[Push] could not queue:', error instanceof Error ? error.message : error)
  }

  // Housekeeping: keep notifications for 90 days.
  if (Math.random() < 0.02) {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    db.prepare('DELETE FROM notifications WHERE created_at < ?').run(cutoff)
  }
}

/** Resolve user ids → active users who may see this card (and the note, if internal). */
function eligibleRecipients(task: Task, userIds: string[], actorId: string, internal: boolean): UserProfile[] {
  const seen = new Set<string>()
  const result: UserProfile[] = []
  for (const id of userIds) {
    if (!id || id === actorId || seen.has(id)) continue
    seen.add(id)
    const user = findUser(id)
    if (!user || !userCanAccessTask(user, task)) continue
    if (internal && !isAdminRole(user.role)) continue
    result.push(user)
  }
  return result
}

function participantIds(task: Task) {
  return [task.submitted_by, ...getAssignedUserIds(task)]
}

/**
 * Called after a comment is saved. Return each recipient group so the caller
 * can send one email per person without duplicating mention emails.
 */
export function notifyForComment(input: {
  task: Task
  commentId: string
  body: string
  actorId: string
  isInternal: boolean
}): { mentioned: UserProfile[]; others: UserProfile[] } {
  const mentioned = eligibleRecipients(input.task, parseMentionIds(input.body), input.actorId, input.isInternal)
  const mentionedIds = new Set(mentioned.map((user) => user.id))
  const others = eligibleRecipients(input.task, participantIds(input.task), input.actorId, input.isInternal)
    .filter((user) => !mentionedIds.has(user.id))

  const snippet = snippetOf(input.body)
  insertNotifications([
    ...mentioned.map((user) => ({ userId: user.id, actorId: input.actorId, taskId: input.task.id, commentId: input.commentId, type: 'mention' as const, snippet })),
    ...others.map((user) => ({ userId: user.id, actorId: input.actorId, taskId: input.task.id, commentId: input.commentId, type: 'comment' as const, snippet })),
  ])
  return { mentioned, others }
}

export function notifyAssigned(task: Task, newAssigneeIds: string[], actorId: string) {
  const recipients = eligibleRecipients(task, newAssigneeIds, actorId, false)
  insertNotifications(recipients.map((user) => ({
    userId: user.id, actorId, taskId: task.id, type: 'assigned' as const, snippet: task.title,
  })))
}

export function notifyCompleted(task: Task, actorId: string) {
  const recipients = eligibleRecipients(task, participantIds(task), actorId, false)
  insertNotifications(recipients.map((user) => ({
    userId: user.id, actorId, taskId: task.id, type: 'completed' as const, snippet: task.title,
  })))
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export function listNotifications(userId: string, limit = 30): AppNotification[] {
  return getDb().prepare(`
    SELECT n.id, n.type, n.task_id, n.actor_id, n.snippet, n.created_at, n.read_at,
           t.title AS task_title,
           COALESCE(u.full_name, u.display_name, u.email) AS actor_name
    FROM notifications n
    LEFT JOIN tasks t ON t.id = n.task_id AND t.deleted_at IS NULL
    LEFT JOIN users u ON u.id = n.actor_id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC
    LIMIT ?
  `).all(userId, limit) as AppNotification[]
}

export function countUnreadNotifications(userId: string): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as { n: number }
  return row.n
}

/** Cheap fingerprint so the live stream can tell when this user's bell changed. */
export function getNotificationSignature(userId: string): string {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS total, MAX(created_at) AS latest,
           SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread
    FROM notifications WHERE user_id = ?
  `).get(userId) as { total: number; latest: string | null; unread: number | null }
  return `${row.total}:${row.latest ?? ''}:${row.unread ?? 0}`
}

export function markNotificationsRead(userId: string, ids?: string[]) {
  const db = getDb()
  const now = new Date().toISOString()
  if (!ids) {
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, userId)
    return
  }
  const update = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL')
  db.transaction(() => { for (const id of ids) update.run(now, id, userId) })()
}

/** Opening a card clears its notifications for you. */
export function markTaskNotificationsRead(userId: string, taskId: string) {
  getDb().prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND task_id = ? AND read_at IS NULL')
    .run(new Date().toISOString(), userId, taskId)
}

/** Remember that this person has opened the card (it stops being highlighted). */
export function markTaskViewed(userId: string, taskId: string) {
  getDb().prepare('INSERT OR IGNORE INTO task_views (user_id, task_id, viewed_at) VALUES (?, ?, ?)')
    .run(userId, taskId, new Date().toISOString())
}

/** IDs of the cards this person has opened. */
export function getViewedTaskIds(userId: string): Set<string> {
  const rows = getDb().prepare('SELECT task_id FROM task_views WHERE user_id = ?').all(userId) as Array<{ task_id: string }>
  return new Set(rows.map((row) => row.task_id))
}
