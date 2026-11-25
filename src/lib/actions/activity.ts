'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { canSeeTask } from '@/lib/category-access'
import {
  getTaskComments as dbGetComments,
  createComment as dbCreateComment,
  getRecentActivityLogs as dbGetRecentActivityLogs,
  softDeleteComment,
  updateCommentBody,
  createActivityLog,
  getTaskById,
  getCommentById,
  recordBoardEvent,
} from '@/lib/local-data'
import type { ActionResult, ActivityLogEntry, Comment, CommentWithAuthor } from '@/lib/types'
import { isTaskAssignedToUser } from '@/lib/utils'
import { getMentionCandidates, mentionsToPlainText, notifyForComment } from '@/lib/notifications'
import { sendCommentEmail, sendMentionEmail } from './email'

/**
 * Re-write mention tokens with the real user's name, and drop (to plain text)
 * any mention of someone who can't open this card / this internal note.
 */
function sanitizeMentions(body: string, allowedNames: Map<string, string>) {
  return body.replace(/@\[([^\]\n]{1,80})\]\(([A-Za-z0-9-]{1,64})\)/g, (_m, name: string, id: string) => {
    const realName = allowedNames.get(id)
    return realName ? `@[${realName.replace(/[\[\]\n]/g, '')}](${id})` : `@${name}`
  })
}

function canAccessTask(user: { id: string; role: string }, task: { submitted_by: string; assigned_to: string | null }) {
  return user.role === 'admin'
    || user.role === 'super_admin'
    || task.submitted_by === user.id
    || isTaskAssignedToUser(task, user.id)
}

export async function getTaskComments(taskId: string): Promise<CommentWithAuthor[]> {
  const user = await requireRole('staff', 'admin', 'super_admin')
  const task = await getTaskById(taskId)
  if (!task || !(await canSeeTask(user, task)) || !canAccessTask(user, task)) {
    throw new Error('You do not have permission to view comments for this task.')
  }
  const includeInternal = user.role !== 'staff'
  return dbGetComments(taskId, includeInternal)
}

export async function getRecentActivityLogs(limit = 100): Promise<ActivityLogEntry[]> {
  const user = await requireRole('admin', 'super_admin')
  const entries = await dbGetRecentActivityLogs(limit)
  return (await Promise.all(entries.map(async entry => ({ entry, visible: !entry.task_id || await (async () => { const task = await getTaskById(entry.task_id!); return !!task && await canSeeTask(user, task) })() })))).filter(item => item.visible).map(item => item.entry)
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
    if (!task || !(await canSeeTask(user, task)) || !canAccessTask(user, task)) {
      return { success: false, error: 'You do not have permission to comment on this task.' }
    }
    if (isInternal && user.role === 'staff') {
      return { success: false, error: 'Only admins can post internal notes.' }
    }

    if (!body.trim()) {
      return { success: false, error: 'Comment is empty.' }
    }
    if (body.length > 10_000) {
      return { success: false, error: 'Comment is too long.' }
    }

    const candidates = getMentionCandidates(task, { internalOnly: isInternal })
    const allowedNames = new Map(candidates.map((candidate) => [
      candidate.id,
      candidate.full_name ?? candidate.display_name ?? candidate.email ?? 'User',
    ]))
    const cleanBody = sanitizeMentions(body, allowedNames)

    const comment = await dbCreateComment(taskId, user.id, cleanBody, isInternal)

    await createActivityLog({
      actor_id: user.id, task_id: taskId,
      entity_type: 'comment', entity_id: comment.id,
      action: 'comment_added',
      metadata: { is_internal: isInternal },
    })
    recordBoardEvent({ boardId: task.board_id, taskId, actorId: user.id, type: 'comment_added' })

    try {
      const { mentioned, others } = notifyForComment({ task, commentId: comment.id, body: cleanBody, actorId: user.id, isInternal })
      const snippet = mentionsToPlainText(cleanBody)
      for (const recipient of mentioned) {
        if (await canSeeTask(recipient, task)) await sendMentionEmail({ task, recipient, author: user, snippet })
      }
      for (const recipient of others) {
        if (await canSeeTask(recipient, task)) await sendCommentEmail({ task, recipient, author: user, snippet })
      }
    } catch (err) {
      // Notifications must never block saving a comment.
      console.error('[Notifications] comment notify failed', err)
    }

    revalidatePath('/dashboard')
    return { success: true, data: comment }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function editComment(commentId: string, body: string): Promise<ActionResult<Comment>> {
  try {
    const user = await requireRole('staff', 'admin', 'super_admin')
    if (typeof body !== 'string' || !body.trim()) return { success: false, error: 'Comment cannot be empty.' }
    if (body.length > 10_000) return { success: false, error: 'Comment is too long.' }
    const comment = await getCommentById(commentId)
    if (!comment) return { success: false, error: 'Comment not found.' }
    if (comment.author_id !== user.id) return { success: false, error: 'You can only edit your own comments.' }
    const task = await getTaskById(comment.task_id)
    if (!task || !(await canSeeTask(user, task)) || !canAccessTask(user, task)) {
      return { success: false, error: 'You do not have permission to edit this comment.' }
    }

    const candidates = getMentionCandidates(task, { internalOnly: comment.is_internal })
    const allowedNames = new Map(candidates.map((candidate) => [
      candidate.id,
      candidate.full_name ?? candidate.display_name ?? candidate.email ?? 'User',
    ]))
    const updated = await updateCommentBody(commentId, sanitizeMentions(body, allowedNames))
    await createActivityLog({
      actor_id: user.id, task_id: task.id,
      entity_type: 'comment', entity_id: commentId,
      action: 'comment_updated', metadata: {},
    })
    recordBoardEvent({ boardId: task.board_id, taskId: task.id, actorId: user.id, type: 'comment_updated' })
    revalidatePath('/dashboard')
    return { success: true, data: updated }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function deleteComment(commentId: string): Promise<ActionResult> {
  try {
    const user = await requireRole('staff', 'admin', 'super_admin')
    const comment = await getCommentById(commentId)
    if (!comment) return { success: false, error: 'Comment not found.' }
    const task = await getTaskById(comment.task_id)
    if (!task || !(await canSeeTask(user, task)) || !canAccessTask(user, task)) {
      return { success: false, error: 'You do not have permission to delete this comment.' }
    }
    const isAdmin = user.role === 'admin' || user.role === 'super_admin'
    if (!isAdmin && comment.author_id !== user.id) {
      return { success: false, error: 'You can only delete your own comments.' }
    }
    await softDeleteComment(commentId)
    await createActivityLog({
      actor_id: user.id, task_id: task.id,
      entity_type: 'comment', entity_id: commentId,
      action: 'comment_deleted', metadata: {},
    })
    recordBoardEvent({ boardId: task.board_id, taskId: task.id, actorId: user.id, type: 'comment_deleted' })

    revalidatePath('/dashboard')
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
