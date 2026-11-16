'use server'

import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import {
  DEFAULT_BOARD_ID,
  createTask as dbCreateTask,
  updateTask as dbUpdateTask,
  moveTask as dbMoveTask,
  softDeleteTask,
  getActiveTasks,
  getActiveColumns,
  getTaskById,
  getTaskByShareToken,
  getTaskAttachments,
  getAttachmentById,
  getTaskComments,
  findUser,
  createActivityLog,
  softDeleteAttachment,
  recordBoardEvent,
  getActiveTaskPresence,
  getLatestBoardEventSeq,
  TaskConflictError,
} from '@/lib/local-data'
import type {
  ActionResult, BoardSnapshot, ColumnWithTasks, CreateTaskInput,
  MoveTaskInput, SessionUser, Task, TaskExpectation, TaskStatus, TaskWithRelations, UpdateTaskInput,
} from '@/lib/types'
import { expectationGuard } from '@/lib/collab'
import { notifyAssigned, notifyCompleted } from '@/lib/notifications'

/** Notifications are best-effort: never fail the user's action because of them. */
function safeNotify(fn: () => void) {
  try { fn() } catch (err) { console.error('[Notifications] failed', err) }
}
import { sendTaskCompletedEmail, sendTaskSharedEmail, sendTaskSubmittedEmail } from './email'
import { deleteGoogleCalendarEvent, upsertGoogleCalendarEvent } from '@/lib/integrations/google-calendar'
import { getAssignedUserIds, isTaskAssignedToUser } from '@/lib/utils'

// custom_fields keys that only admins may change (assignment + sharing).
const PROTECTED_CUSTOM_FIELD_KEYS = [
  'share_token', 'recipient_email', 'recipient_emails',
  'assigned_user_id', 'assigned_user_ids', 'assigned_user_names', 'assigned_user_name',
]

function isAdminUser(user: Pick<SessionUser, 'role'>) {
  return user.role === 'admin' || user.role === 'super_admin'
}

/** Anyone allowed to move a card may also work on it (edit, complete, reopen). */
function canWorkOnTask(user: Pick<SessionUser, 'id' | 'role'>, task: Task) {
  return isAdminUser(user) || task.submitted_by === user.id || isTaskAssignedToUser(task, user.id)
}

function failure(err: unknown): { success: false; error: string; code: 'conflict' | 'error' } {
  if (err instanceof TaskConflictError) {
    return { success: false, error: err.message, code: 'conflict' }
  }
  return { success: false, error: err instanceof Error ? err.message : 'Unknown error', code: 'error' }
}

function statusForColumn(column: { name: string; is_default: boolean; is_archive: boolean } | undefined, fallback: TaskStatus): TaskStatus {
  if (!column) return fallback
  const colName = column.name.toLowerCase()
  if (column.is_default)            return 'new'
  if (colName === 'pending')        return 'pending'
  if (colName.includes('progress')) return 'in_progress'
  if (colName.includes('complet'))  return 'completed'
  if (column.is_archive)            return 'archived'
  return fallback
}

function notifyBoard(task: Pick<Task, 'id' | 'board_id'>, actorId: string, type: string) {
  try {
    recordBoardEvent({ boardId: task.board_id, taskId: task.id, actorId, type })
  } catch (err) {
    console.error('[Live] failed to record board event', err)
  }
}

function normalizePath(p: string) {
  return process.env.NODE_ENV === 'production' ? `/task${p}` : p
}

function fallbackProfile(id: string | null) {
  const timestamp = new Date().toISOString()
  return {
    id: id ?? 'unknown-user',
    full_name: 'Unknown user',
    display_name: 'Unknown user',
    email: null,
    department: null,
    role: 'staff' as const,
    avatar_url: null,
    is_active: false,
    created_at: timestamp,
    updated_at: timestamp,
  }
}

async function hydrateTask(task: Task, includeInternal = true): Promise<TaskWithRelations> {
  const [comments, attachments] = await Promise.all([
    getTaskComments(task.id, includeInternal),
    getTaskAttachments(task.id),
  ])
  const columns = await getActiveColumns(task.board_id, true)
  const submittedByProfile = findUser(task.submitted_by) ?? fallbackProfile(task.submitted_by)
  const assignedUserIds = getAssignedUserIds(task)
  const assignedToProfiles = assignedUserIds
    .map((userId) => findUser(userId))
    .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile))
  const assignedToProfile = assignedToProfiles[0] ?? null
  const taskColumn = columns.find(c => c.id === task.column_id) ?? {
    id: task.column_id,
    board_id: task.board_id,
    name: 'Unknown column',
    color: null,
    position: task.position,
    is_default: false,
    is_archive: false,
    created_at: task.created_at,
    updated_at: task.updated_at,
    deleted_at: null,
  }

  return {
    ...task,
    submitted_by_profile: submittedByProfile,
    updated_by_profile:   task.updated_by ? findUser(task.updated_by) : null,
    assigned_to_profile:  assignedToProfile,
    assigned_to_profiles: assignedToProfiles,
    column:               taskColumn,
    comments,
    attachments,
    _comment_count:    comments.length,
    _attachment_count: attachments.length,
  }
}

function revalidateBoard() {
  revalidatePath(normalizePath('/dashboard'))
}

function getRecipientEmailsFromTask(task: Task) {
  const recipientEmails = Array.isArray(task.custom_fields?.recipient_emails)
    ? task.custom_fields.recipient_emails
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim().toLowerCase())
    : []

  if (recipientEmails.length > 0) {
    return Array.from(new Set(recipientEmails))
  }

  if (typeof task.custom_fields?.recipient_email === 'string' && task.custom_fields.recipient_email.trim().length > 0) {
    return [task.custom_fields.recipient_email.trim().toLowerCase()]
  }

  return []
}

function getShareTokenFromTask(task: Task) {
  return typeof task.custom_fields?.share_token === 'string' && task.custom_fields.share_token.trim().length > 0
    ? task.custom_fields.share_token.trim()
    : ''
}

async function syncTaskToGoogleCalendar(task: Task) {
  const assignedUser = findUser(getAssignedUserIds(task)[0] ?? null)

  try {
    const result = await upsertGoogleCalendarEvent(task, assignedUser)
    if (result.status === 'created' || result.status === 'updated') {
      if (result.eventId !== task.google_calendar_event_id) {
        await dbUpdateTask(task.id, { google_calendar_event_id: result.eventId }, { bumpVersion: false })
      }
      console.log(`[Calendar] ${result.status} event for task ${task.id}: ${result.eventId}`)
      return
    }

    if (result.status === 'skipped' && task.google_calendar_event_id && task.due_date) {
      console.warn(`[Calendar] skipped task ${task.id}: ${result.reason}`)
      return
    }

    if (task.google_calendar_event_id) {
      await deleteGoogleCalendarEvent(task, assignedUser)
      await dbUpdateTask(task.id, { google_calendar_event_id: null }, { bumpVersion: false })
      console.warn(`[Calendar] task ${task.id} no longer syncable. Removed linked calendar event.`)
      return
    }

    if (result.status === 'skipped') {
      console.warn(`[Calendar] skipped task ${task.id}: ${result.reason}`)
    }
  } catch (err) {
    console.error('[Calendar] task sync failed', {
      taskId: task.id,
      action: task.google_calendar_event_id ? 'update' : 'create',
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }
}

async function loadVisibleColumns(user: SessionUser, boardId: string): Promise<ColumnWithTasks[]> {
  const columns = await getActiveColumns(boardId, false)
  const tasks   = (await getActiveTasks(boardId)).filter(t => t.status !== 'archived')

  // Staff see tasks they submitted or tasks assigned to them
  const visibleTasks = user.role === 'staff'
    ? tasks.filter((task) => task.submitted_by === user.id || isTaskAssignedToUser(task, user.id))
    : tasks
  // Internal notes are admin-only — never ship them to staff browsers.
  const includeInternal = isAdminUser(user)

  return Promise.all(
    columns.map(async col => ({
      ...col,
      tasks: await Promise.all(
        visibleTasks
          .filter(t => t.column_id === col.id)
          .sort((a, b) => a.position - b.position)
          .map((task) => hydrateTask(task, includeInternal))
      ),
    }))
  )
}

export async function getBoardData(boardId = DEFAULT_BOARD_ID) {
  const user    = await requireRole('staff', 'admin', 'super_admin')
  const columns = await loadVisibleColumns(user, boardId)
  return { columns, currentUser: user, seq: getLatestBoardEventSeq(boardId) }
}

/**
 * Fresh board state for live updates. Called by open boards whenever the
 * change feed says something happened. Respects the same visibility rules
 * as the initial page load.
 */
export async function getBoardSnapshot(boardId = DEFAULT_BOARD_ID): Promise<BoardSnapshot> {
  const user = await requireRole('staff', 'admin', 'super_admin')
  // Read seq first: if a change lands mid-load we'll simply refresh again.
  const seq = getLatestBoardEventSeq(boardId)
  const columns = await loadVisibleColumns(user, boardId)
  const visibleIds = new Set(columns.flatMap((col) => col.tasks.map((task) => task.id)))
  const presence = getActiveTaskPresence().filter((entry) => visibleIds.has(entry.task_id))
  return { columns, presence, seq }
}

export async function createTask(input: CreateTaskInput): Promise<ActionResult<Task>> {
  try {
    const user    = await requireRole('staff', 'admin', 'super_admin')
    const columns = await getActiveColumns(DEFAULT_BOARD_ID, false)
    const inbox   = columns.find(c => c.is_default)
    if (!inbox) throw new Error('Inbox column not found.')

    const shareToken = randomUUID()
    const assignedIds = Array.from(new Set(
      (Array.isArray(input.assigned_to)
        ? input.assigned_to
        : input.assigned_to ? [input.assigned_to] : []
      ).filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    ))
    const assignedUsers = assignedIds
      .map((userId) => findUser(userId))
      .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile))
    const recipientEmails = Array.from(new Set([
      ...(input.recipient_email?.trim() ? [input.recipient_email.trim().toLowerCase()] : []),
      ...assignedUsers.map((profile) => profile.email?.trim().toLowerCase()).filter((email): email is string => Boolean(email)),
    ]))
    const customFields = {
      ...(input.custom_fields ?? {}),
      assigned_user_name: assignedUsers.map((profile) => profile.full_name ?? profile.display_name).filter(Boolean).join(', ') || null,
      assigned_user_names: assignedUsers.map((profile) => profile.full_name ?? profile.display_name ?? 'Assigned user'),
      assigned_user_ids: assignedUsers.map((profile) => profile.id),
      ...(recipientEmails.length > 0 ? {
        recipient_email: recipientEmails[0],
        recipient_emails: recipientEmails,
        share_token: shareToken,
        assigned_user_id: assignedUsers[0]?.id ?? null,
      } : {}),
    }

    const task = await dbCreateTask({
      boardId:      DEFAULT_BOARD_ID,
      columnId:     inbox.id,
      title:        input.title,
      description:  input.description,
      priority:     input.priority ?? 'normal',
      submittedBy:  user.id,
      dueDate:      input.due_date,
      hasRealDueDate: !!input.due_date,
      labels:       input.labels ?? [],
      watchers:     Array.from(new Set([user.id, ...assignedIds])),
      customFields,
      assignedTo:   assignedIds[0] ?? null,
    })

    await createActivityLog({
      actor_id: user.id, task_id: task.id,
      entity_type: 'task', entity_id: task.id,
      action: 'task_created',
      metadata: { title: task.title, priority: task.priority },
    })
    notifyBoard(task, user.id, 'task_created')
    safeNotify(() => notifyAssigned(task, assignedIds, user.id))

    revalidateBoard()
    revalidatePath(normalizePath('/submit'))
    await syncTaskToGoogleCalendar(task)
    await sendTaskSubmittedEmail(task, user)
    for (const recipientEmail of recipientEmails) {
      await sendTaskSharedEmail({
        task: { ...task, custom_fields: customFields },
        recipientEmail,
        sender: user,
      })
    }
    return { success: true, data: task }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function getSharedTaskData(shareToken: string) {
  const task = await getTaskByShareToken(shareToken)
  if (!task || task.status === 'archived' || task.deleted_at) return null

  const [attachments, columns] = await Promise.all([
    getTaskAttachments(task.id),
    getActiveColumns(task.board_id, true),
  ])

  return {
    task: {
      ...task,
      attachments,
      column: columns.find((column) => column.id === task.column_id) ?? null,
    },
  }
}

export async function moveTask(input: MoveTaskInput, expected?: TaskExpectation): Promise<ActionResult<Task>> {
  try {
    const user = await requireRole('staff', 'admin', 'super_admin')
    const task = await getTaskById(input.task_id)
    if (!task) throw new Error('This card no longer exists — it may have been deleted.')
    if (!canWorkOnTask(user, task)) {
      throw new Error('You do not have permission to move this task.')
    }

    const columns = await getActiveColumns(task.board_id, true)
    const toCol   = columns.find(c => c.id === input.new_column_id)
    if (!toCol) throw new Error('That column no longer exists.')
    if (toCol.is_archive) {
      throw new Error('Use the archive action to archive tasks.')
    }

    let before: Task = task
    const moved = await dbUpdateTask(input.task_id, (current) => {
      before = current
      const newStatus = statusForColumn(toCol, current.status)
      return {
        column_id: input.new_column_id,
        position: input.new_position,
        status: newStatus,
        completed_at: newStatus === 'completed'
          ? (current.status === 'completed' ? current.completed_at : new Date().toISOString())
          : null,
      }
    }, {
      actorId: user.id,
      guard: expectationGuard(expected, user.id, (cur) => cur.status === 'archived' ? 'it was archived' : null),
    })
    if (!moved) throw new Error('This card no longer exists — it may have been deleted.')

    const fromCol = columns.find(c => c.id === before.column_id)
    await createActivityLog({
      actor_id: user.id, task_id: task.id,
      entity_type: 'task', entity_id: task.id,
      action: 'task_moved',
      metadata: {
        from_column:    fromCol?.name ?? 'Unknown',
        to_column:      toCol.name,
        status_changed: moved.status !== before.status ? `${before.status} → ${moved.status}` : null,
      },
    })

    notifyBoard(moved, user.id, 'task_moved')
    if (moved.status === 'completed' && before.status !== 'completed') {
      safeNotify(() => notifyCompleted(moved, user.id))
    }
    revalidateBoard()
    return { success: true, data: moved }
  } catch (err) {
    return failure(err)
  }
}

export async function updateTask(input: UpdateTaskInput, expected?: TaskExpectation): Promise<ActionResult<Task>> {
  try {
    const user = await requireRole('staff', 'admin', 'super_admin')
    const existingTask = await getTaskById(input.id)
    if (!existingTask) throw new Error('This card no longer exists — it may have been deleted.')
    const previousRecipientEmails = getRecipientEmailsFromTask(existingTask)

    const isAdmin = isAdminUser(user)
    const requestedFields = Object.keys(input).filter((key) => key !== 'id')
    if (!isAdmin) {
      const allowedFields = new Set(['title', 'description', 'due_date', 'custom_fields'])
      if (!canWorkOnTask(user, existingTask) || requestedFields.some((key) => !allowedFields.has(key))) {
        throw new Error('You do not have permission to edit this task.')
      }
    }

    // Validate inputs up front (outside the transaction).
    let normalizedTitle: string | undefined
    if ('title' in input) {
      normalizedTitle = input.title?.trim() ?? ''
      if (!normalizedTitle) throw new Error('Title is required.')
      if (normalizedTitle.length > 500) throw new Error('Title is too long.')
    }

    let assignedUsers: NonNullable<ReturnType<typeof findUser>>[] | null = null
    let assignedIds: string[] = []
    if ('assigned_to' in input) {
      assignedIds = Array.from(new Set(
        (Array.isArray(input.assigned_to)
          ? input.assigned_to
          : input.assigned_to ? [input.assigned_to] : []
        ).filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
      ))
      assignedUsers = assignedIds
        .map((userId) => findUser(userId))
        .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile))
    }

    let shareEmailRecipients: string[] = []

    // Everything that depends on the current row is computed inside the write
    // transaction, so concurrent edits to *other* custom fields are preserved.
    let previousAssigneeIds: string[] = []
    const task = await dbUpdateTask(input.id, (current) => {
      previousAssigneeIds = getAssignedUserIds(current)
      const updates: Record<string, unknown> = {}

      if ('priority' in input) updates.priority = input.priority
      if ('status' in input) updates.status = input.status
      if ('column_id' in input) updates.column_id = input.column_id
      if ('position' in input) updates.position = input.position
      if ('labels' in input) updates.labels = input.labels
      if (normalizedTitle !== undefined) updates.title = normalizedTitle
      if ('description' in input) {
        updates.description = input.description?.trim() ? input.description.trim() : null
      }
      if ('due_date' in input) {
        const normalizedDueDate = input.due_date?.trim() || null
        updates.due_date = normalizedDueDate
        updates.has_real_due_date = Boolean(normalizedDueDate)
      }

      // Merge custom_fields key-by-key onto the *current* value. A key sent as
      // null is removed. Non-admins can never change assignment/sharing keys.
      const nextCustomFields: Record<string, unknown> = { ...(current.custom_fields ?? {}) }
      let customFieldsTouched = false
      if ('custom_fields' in input && typeof input.custom_fields === 'object' && input.custom_fields) {
        for (const [key, value] of Object.entries(input.custom_fields as Record<string, unknown>)) {
          if (!isAdmin && PROTECTED_CUSTOM_FIELD_KEYS.includes(key)) continue
          if (value === null || value === undefined) delete nextCustomFields[key]
          else nextCustomFields[key] = value
        }
        customFieldsTouched = true
      }

      if (assignedUsers) {
        customFieldsTouched = true
        if (assignedUsers.length > 0) {
          const names = assignedUsers.map((profile) => profile.full_name ?? profile.display_name ?? 'Assigned user')
          nextCustomFields.assigned_user_name = names.join(', ')
          nextCustomFields.assigned_user_names = names
          nextCustomFields.assigned_user_ids = assignedUsers.map((profile) => profile.id)

          const recipientEmails = assignedUsers
            .map((profile) => profile.email?.trim().toLowerCase())
            .filter((email): email is string => Boolean(email))
          const removedRecipientEmails = previousRecipientEmails.filter((email) => !recipientEmails.includes(email))
          const addedRecipientEmails = recipientEmails.filter((email) => !previousRecipientEmails.includes(email))
          const existingShareToken = getShareTokenFromTask(current)
          const shareToken = removedRecipientEmails.length > 0 || !existingShareToken
            ? randomUUID()
            : existingShareToken

          if (recipientEmails.length > 0) {
            nextCustomFields.recipient_email = recipientEmails[0]
            nextCustomFields.recipient_emails = recipientEmails
            nextCustomFields.assigned_user_id = assignedUsers[0].id
            nextCustomFields.share_token = shareToken
            shareEmailRecipients = removedRecipientEmails.length > 0 ? recipientEmails : addedRecipientEmails
          } else {
            for (const key of ['recipient_email', 'recipient_emails', 'assigned_user_id', 'share_token']) delete nextCustomFields[key]
            shareEmailRecipients = []
          }
        } else {
          for (const key of PROTECTED_CUSTOM_FIELD_KEYS) delete nextCustomFields[key]
          shareEmailRecipients = []
        }
        updates.assigned_to = assignedIds[0] ?? null
      }

      if (customFieldsTouched) updates.custom_fields = nextCustomFields

      if (input.status === 'completed') {
        updates.completed_at = new Date().toISOString()
      } else if (input.status && input.status !== 'archived') {
        updates.completed_at = null
      }
      return updates
    }, {
      actorId: user.id,
      guard: expectationGuard(expected, user.id),
    })
    if (!task) throw new Error('This card no longer exists — it may have been deleted.')

    await createActivityLog({
      actor_id: user.id, task_id: task.id,
      entity_type: 'task', entity_id: task.id,
      action: 'task_updated',
      metadata: { fields_changed: requestedFields },
    })
    notifyBoard(task, user.id, 'task_updated')
    if (assignedUsers) {
      const added = assignedIds.filter((id) => !previousAssigneeIds.includes(id))
      safeNotify(() => notifyAssigned(task, added, user.id))
    }

    await syncTaskToGoogleCalendar(task)
    for (const recipientEmail of shareEmailRecipients) {
      await sendTaskSharedEmail({ task, recipientEmail, sender: user })
    }
    revalidateBoard()
    return { success: true, data: task }
  } catch (err) {
    return failure(err)
  }
}

export async function completeTask(taskId: string, expected?: TaskExpectation): Promise<ActionResult<Task>> {
  try {
    const user = await requireRole('staff', 'admin', 'super_admin')
    const task = await getTaskById(taskId)
    if (!task) throw new Error('This card no longer exists — it may have been deleted.')
    if (!canWorkOnTask(user, task)) throw new Error('You do not have permission to complete this task.')

    const columns      = await getActiveColumns(task.board_id, false)
    const completedCol = columns.find(c => c.name.toLowerCase() === 'completed')

    const updated = await dbUpdateTask(taskId, (current) => ({
      status:       'completed',
      column_id:    completedCol?.id ?? current.column_id,
      completed_at: new Date().toISOString(),
    }), {
      actorId: user.id,
      guard: expectationGuard(expected, user.id, (cur) =>
        cur.status === 'archived' ? 'it was archived'
          : cur.status === 'completed' ? 'it is already completed'
          : null),
    })
    if (!updated) throw new Error('This card no longer exists — it may have been deleted.')

    await createActivityLog({
      actor_id: user.id, task_id: taskId,
      entity_type: 'task', entity_id: taskId,
      action: 'task_completed',
      metadata: { completed_by: user.full_name ?? user.email },
    })
    notifyBoard(updated, user.id, 'task_completed')
    safeNotify(() => notifyCompleted(updated, user.id))

    await syncTaskToGoogleCalendar(updated)
    revalidateBoard()
    await sendTaskCompletedEmail(updated, user)
    return { success: true, data: updated }
  } catch (err) {
    return failure(err)
  }
}

export async function reopenTask(taskId: string, expected?: TaskExpectation): Promise<ActionResult<Task>> {
  try {
    const user = await requireRole('staff', 'admin', 'super_admin')
    const task = await getTaskById(taskId)
    if (!task) throw new Error('This card no longer exists — it may have been deleted.')
    if (!canWorkOnTask(user, task)) throw new Error('You do not have permission to reopen this task.')

    const columns = await getActiveColumns(task.board_id, false)
    const inbox   = columns.find(c => c.is_default)

    const updated = await dbUpdateTask(taskId, (current) => ({
      status:       'pending',
      column_id:    inbox?.id ?? current.column_id,
      completed_at: null,
    }), {
      actorId: user.id,
      guard: expectationGuard(expected, user.id, (cur) =>
        cur.status === 'archived' ? 'it was archived'
          : cur.status !== 'completed' ? 'it was already reopened'
          : null),
    })
    if (!updated) throw new Error('This card no longer exists — it may have been deleted.')

    await createActivityLog({
      actor_id: user.id, task_id: taskId,
      entity_type: 'task', entity_id: taskId,
      action: 'task_updated',
      metadata: { reopened_by: user.full_name ?? user.email },
    })
    notifyBoard(updated, user.id, 'task_reopened')

    await syncTaskToGoogleCalendar(updated)
    revalidateBoard()
    return { success: true, data: updated }
  } catch (err) {
    return failure(err)
  }
}

export async function archiveTask(taskId: string, expected?: TaskExpectation): Promise<ActionResult> {
  try {
    const user = await requireRole('admin', 'super_admin')
    const task = await getTaskById(taskId)
    if (!task) throw new Error('This card no longer exists — it may have been deleted.')

    const columns    = await getActiveColumns(task.board_id, true)
    const archiveCol = columns.find(c => c.is_archive)
    if (!archiveCol) throw new Error('Archive column not configured.')

    const updated = await dbUpdateTask(taskId, { status: 'archived', column_id: archiveCol.id }, {
      actorId: user.id,
      guard: expectationGuard(expected, user.id, (cur) => cur.status === 'archived' ? 'it is already archived' : null),
    })
    if (!updated) throw new Error('This card no longer exists — it may have been deleted.')
    await createActivityLog({
      actor_id: user.id, task_id: taskId,
      entity_type: 'task', entity_id: taskId,
      action: 'task_archived', metadata: {},
    })
    notifyBoard(updated, user.id, 'task_archived')

    await syncTaskToGoogleCalendar(updated)
    revalidateBoard()
    revalidatePath(normalizePath('/archive'))
    return { success: true, data: undefined }
  } catch (err) {
    return failure(err)
  }
}

export async function restoreTask(taskId: string, targetColumnId: string): Promise<ActionResult> {
  try {
    const user = await requireRole('admin', 'super_admin')
    const task = await getTaskById(taskId)
    if (!task) throw new Error('This card no longer exists — it may have been deleted.')

    const columns = await getActiveColumns(task.board_id, false)
    const targetColumn = columns.find((column) => column.id === targetColumnId)
    if (!targetColumn) {
      throw new Error('Restore column is invalid.')
    }

    const updated = await dbUpdateTask(taskId, (current) => {
      const nextCustomFields = { ...(current.custom_fields ?? {}) }
      for (const key of ['share_token', 'recipient_email', 'recipient_emails', 'assigned_user_id', 'assigned_user_ids', 'assigned_user_names']) {
        delete nextCustomFields[key]
      }
      return { status: 'new', column_id: targetColumnId, custom_fields: nextCustomFields }
    }, {
      actorId: user.id,
      guard: expectationGuard(undefined, user.id, (cur) => cur.status !== 'archived' ? 'it was already restored' : null),
    })
    if (!updated) throw new Error('This card no longer exists — it may have been deleted.')
    await createActivityLog({
      actor_id: user.id, task_id: taskId,
      entity_type: 'task', entity_id: taskId,
      action: 'task_restored',
      metadata: { restored_to_column: targetColumn.name },
    })
    notifyBoard(updated, user.id, 'task_restored')

    await syncTaskToGoogleCalendar(updated)
    revalidateBoard()
    revalidatePath(normalizePath('/archive'))
    return { success: true, data: undefined }
  } catch (err) {
    return failure(err)
  }
}

export async function deleteTask(taskId: string, expected?: TaskExpectation): Promise<ActionResult> {
  try {
    const user = await requireRole('admin', 'super_admin')
    const task = await getTaskById(taskId)
    if (!task) throw new Error('This card no longer exists — it may have been deleted.')

    // Delete first (guarded), then clean up the calendar — so a rejected
    // delete never removes the calendar event.
    const deleted = await softDeleteTask(taskId, {
      actorId: user.id,
      guard: expectationGuard(expected, user.id),
    })
    if (!deleted) throw new Error('This card no longer exists — it may have been deleted.')

    try {
      const assignedUser = findUser(task.assigned_to)
      const result = await deleteGoogleCalendarEvent(task, assignedUser)
      if (result.status === 'deleted') {
        console.log(`[Calendar] deleted event for task ${task.id}: ${task.google_calendar_event_id}`)
      } else if (result.status === 'skipped') {
        console.warn(`[Calendar] skipped delete for task ${task.id}: ${result.reason}`)
      }
    } catch (err) {
      console.error('[Calendar] task delete sync failed', {
        taskId,
        action: 'delete',
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }

    await createActivityLog({
      actor_id: user.id, task_id: taskId,
      entity_type: 'task', entity_id: taskId,
      action: 'task_deleted',
      metadata: { deleted_by: user.email },
    })
    notifyBoard(task, user.id, 'task_deleted')

    revalidateBoard()
    return { success: true, data: undefined }
  } catch (err) {
    return failure(err)
  }
}

export async function getArchive(page = 0, limit = 25) {
  await requireRole('admin', 'super_admin')
  const all = (await getActiveTasks()).filter(t => t.status === 'archived')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))

  return {
    tasks: all.slice(page * limit, page * limit + limit).map(t => ({
      ...t,
      submitted_by_profile: findUser(t.submitted_by) ?? undefined,
    })),
    total: all.length,
  }
}

export async function fetchTaskAttachments(taskId: string): Promise<import('@/lib/types').Attachment[]> {
  const user = await requireRole('staff', 'admin', 'super_admin')
  const task = await getTaskById(taskId)
  if (!task) throw new Error('Task not found')

  const isAdmin = user.role === 'admin' || user.role === 'super_admin'
  const canAccessTask =
    isAdmin ||
    task.submitted_by === user.id ||
    isTaskAssignedToUser(task, user.id)

  if (!canAccessTask) {
    throw new Error('You do not have permission to view attachments for this task.')
  }

  return getTaskAttachments(taskId)
}

export async function deleteTaskAttachment(attachmentId: string): Promise<ActionResult> {
  try {
    const user = await requireRole('staff', 'admin', 'super_admin')
    const attachment = await getAttachmentById(attachmentId)
    if (!attachment) throw new Error('Attachment not found')

    const task = await getTaskById(attachment.task_id)
    if (!task) throw new Error('Task not found')

    const isAdmin = user.role === 'admin' || user.role === 'super_admin'
    const canDelete =
      isAdmin ||
      task.submitted_by === user.id ||
      isTaskAssignedToUser(task, user.id)

    if (!canDelete) {
      throw new Error('You do not have permission to delete this attachment.')
    }

    await softDeleteAttachment(attachmentId)
    notifyBoard(task, user.id, 'attachment_deleted')
    try {
      await unlink(attachment.storage_path)
    } catch {
      // If file is already missing, keep DB deletion as source of truth.
    }

    await createActivityLog({
      actor_id: user.id,
      task_id: task.id,
      entity_type: 'attachment',
      entity_id: attachment.id,
      action: 'attachment_deleted',
      metadata: { file_name: attachment.file_name },
    })

    revalidateBoard()
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
