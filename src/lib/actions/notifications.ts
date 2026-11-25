'use server'

import { requireRole } from '@/lib/auth'
import { canSeeTask } from '@/lib/category-access'
import { getTaskById } from '@/lib/local-data'
import {
  getMentionCandidates,
  listNotifications,
  markNotificationsRead,
  markTaskNotificationsRead,
  userCanAccessTask,
} from '@/lib/notifications'
import type { AppNotification, MentionableUser } from '@/lib/types'

export async function getMyNotifications(): Promise<{ items: AppNotification[]; unread: number }> {
  const user = await requireRole('staff', 'admin', 'super_admin')
  const items = (await Promise.all(listNotifications(user.id, 100).map(async item => ({ item, visible: !item.task_id || await (async () => { const task = await getTaskById(item.task_id!); return !!task && await canSeeTask(user, task) })() })))).filter(entry => entry.visible).map(entry => entry.item).slice(0, 30)
  return { items, unread: items.filter(item => !item.read_at).length }
}

export async function markMyNotificationsRead(ids?: string[]): Promise<void> {
  const user = await requireRole('staff', 'admin', 'super_admin')
  markNotificationsRead(user.id, Array.isArray(ids) ? ids.filter((id) => typeof id === 'string').slice(0, 200) : undefined)
}

/** Called when a card is opened: its notifications count as seen. */
export async function markTaskSeen(taskId: string): Promise<void> {
  const user = await requireRole('staff', 'admin', 'super_admin')
  const task = await getTaskById(taskId)
  if (task && await canSeeTask(user, task)) markTaskNotificationsRead(user.id, taskId)
}

/** People who can be @mentioned on this card (those who can open it). */
export async function getMentionableUsers(taskId: string): Promise<MentionableUser[]> {
  const user = await requireRole('staff', 'admin', 'super_admin')
  const task = await getTaskById(taskId)
  if (!task || !(await canSeeTask(user, task)) || !userCanAccessTask({ id: user.id, role: user.role, is_active: true }, task)) return []
  return getMentionCandidates(task, { internalOnly: false })
    .filter((candidate) => candidate.id !== user.id)
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.full_name ?? candidate.display_name ?? candidate.email ?? 'User',
      role: candidate.role,
    }))
}
