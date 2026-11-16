'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import {
  getTaskComments as dbGetComments,
  createComment as dbCreateComment,
  getRecentActivityLogs as dbGetRecentActivityLogs,
  softDeleteComment,
  createActivityLog,
  getTaskById,
} from '@/lib/local-data'
import type { ActionResult, ActivityLogEntry, Comment, CommentWithAuthor } from '@/lib/types'
import { isTaskAssignedToUser } from '@/lib/utils'

function canAccessTask(user: { id: string; role: string }, task: { submitted_by: string; assigned_to: string | null }) {
  return user.role === 'admin'
    || user.role === 'super_admin'
    || task.submitted_by === user.id
    || isTaskAssignedToUser(task, user.id)
}

export async function getTaskComments(taskId: string): Promise<CommentWithAuthor[]> {
  const user = await requireRole('staff', 'admin', 'super_admin')
  const task = await getTaskById(taskId)
  if (!task || !canAccessTask(user, task)) {
    throw new Error('You do not have permission to view comments for this task.')
  }
  const includeInternal = user.role !== 'staff'
  return dbGetComments(taskId, includeInternal)
}

export async function getRecentActivityLogs(limit = 100): Promise<ActivityLogEntry[]> {
  await requireRole('admin', 'super_admin')
  return dbGetRecentActivityLogs(limit)
}

export async function addComment(
  taskId: string,
  body: string,
  isInternal = false
): Promise<ActionResult<Comment>> {
  try {
    const user = await requireRole('staff', 'admin', 'super_admin')
    if (typeof body !== 'string' || !body.trim()) return { success: false, error: 'Comment cannot be empty.' }
    if (body.length > 20_000) return { success: false, error: 'Comment is too long.' }
    const task = await getTaskById(taskId)
    if (!task || !canAccessTask(user, task)) {
      return { success: false, error: 'You do not have permission to comment on this task.' }
    }
    if (isInternal && user.role === 'staff') {
      return { success: false, error: 'Only admins can post internal notes.' }
    }

    const comment = await dbCreateComment(taskId, user.id, body, isInternal)

    await createActivityLog({
      actor_id: user.id, task_id: taskId,
      entity_type: 'comment', entity_id: comment.id,
      action: 'comment_added',
      metadata: { is_internal: isInternal },
    })

    revalidatePath('/dashboard')
    return { success: true, data: comment }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function deleteComment(commentId: string): Promise<ActionResult> {
  try {
    const user = await requireRole('admin', 'super_admin')
    await softDeleteComment(commentId)
    await createActivityLog({
      actor_id: user.id, task_id: null,
      entity_type: 'comment', entity_id: commentId,
      action: 'comment_deleted', metadata: {},
    })

    revalidatePath('/dashboard')
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
