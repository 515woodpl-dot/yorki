import { getSetting } from '@/lib/local-data'
import type { SessionUser, Task } from '@/lib/types'

// Null means unrestricted. An empty list deliberately grants no categories.
export async function allowedCategoryIds(userId: string): Promise<string[] | null> {
  const value = await getSetting<unknown>(`category_access:${userId}`, null)
  return Array.isArray(value) && value.every(id => typeof id === 'string') ? value : null
}

export async function canSeeCategory(user: Pick<SessionUser, 'id' | 'role'>, columnId: string): Promise<boolean> {
  if (user.role === 'super_admin') return true
  const allowed = await allowedCategoryIds(user.id)
  return allowed === null || allowed.includes(columnId)
}

export async function canSeeTask(user: Pick<SessionUser, 'id' | 'role'>, task: Pick<Task, 'column_id'>): Promise<boolean> {
  return canSeeCategory(user, task.column_id)
}
