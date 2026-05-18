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
} from '@/lib/local-data'
import type {
  ActionResult, ColumnWithTasks, CreateTaskInput,
  MoveTaskInput, Task, TaskWithRelations, UpdateTaskInput,
} from '@/lib/types'
import { sendTaskCompletedEmail, sendTaskSharedEmail, sendTaskSubmittedEmail } from './email'
import { deleteGoogleCalendarEvent, upsertGoogleCalendarEvent } from '@/lib/integrations/google-calendar'
import { getAssignedUserIds, isTaskAssignedToUser } from '@/lib/utils'

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

async function hydrateTask(task: Task): Promise<TaskWithRelations> {
  const [comments, attachments] = await Promise.all([
    getTaskComments(task.id),
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
        await dbUpdateTask(task.id, { google_calendar_event_id: result.eventId })
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
      await dbUpdateTask(task.id, { google_calendar_event_id: null })
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

export async function getBoardData(boardId = DEFAULT_BOARD_ID) {
  const user    = await requireRole('staff', 'admin', 'super_admin')
  const columns = await getActiveColumns(boardId, false)
  const tasks   = (await getActiveTasks(boardId)).filter(t => t.status !== 'archived')

  // Staff see tasks they submitted or tasks assigned to them
  const visibleTasks = user.role === 'staff'
    ? tasks.filter((task) => task.submitted_by === user.id || isTaskAssignedToUser(task, user.id))
    : tasks

  const columnsWithTasks: ColumnWithTasks[] = await Promise.all(
    columns.map(async col => ({
      ...col,
      tasks: await Promise.all(
        visibleTasks
          .filter(t => t.column_id === col.id)
          .sort((a, b) => a.position - b.position)
          .map(hydrateTask)
      ),
    }))
  )
  return { columns: columnsWithTasks, currentUser: user }
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

export async function moveTask(input: MoveTaskInput): Promise<ActionResult> {
  try {
    const user = await requireRole('staff', 'admin', 'super_admin')
    const task = await getTaskById(input.task_id)
    if (!task) throw new Error('Task not found')
    const isAdmin = user.role === 'admin' || user.role === 'super_admin'
    const canMoveTask =
      isAdmin ||
      task.submitted_by === user.id ||
      isTaskAssignedToUser(task, user.id)

    if (!canMoveTask) {
      throw new Error('You do not have permission to move this task.')
    }

    const columns = await getActiveColumns(task.board_id, true)
    const fromCol = columns.find(c => c.id === task.column_id)
    const toCol   = columns.find(c => c.id === input.new_column_id)
    if (toCol?.is_archive) {
      throw new Error('Use the archive action to archive tasks.')
    }

    // Derive new status from destination column name
    const colName = (toCol?.name ?? '').toLowerCase()
    let newStatus: string = task.status
    if (toCol?.is_default)                newStatus = 'new'
    else if (colName === 'pending')       newStatus = 'pending'
    else if (colName.includes('progress')) newStatus = 'in_progress'
    else if (colName.includes('complet')) newStatus = 'completed'
    else if (toCol?.is_archive)           newStatus = 'archived'

    const completedAt = newStatus === 'completed' && task.status !== 'completed'
      ? new Date().toISOString()
      : newStatus !== 'completed' ? null : task.completed_at

    await dbMoveTask(input.task_id, input.new_column_id, input.new_position)

    if (newStatus !== task.status) {
      await dbUpdateTask(input.task_id, { status: newStatus, completed_at: completedAt })
    }

    await createActivityLog({
      actor_id: user.id, task_id: task.id,
      entity_type: 'task', entity_id: task.id,
      action: 'task_moved',
      metadata: {
        from_column:    fromCol?.name ?? 'Unknown',
        to_column:      toCol?.name   ?? 'Unknown',
        status_changed: newStatus !== task.status ? `${task.status} → ${newStatus}` : null,
      },
    })

    revalidateBoard()
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function updateTask(input: UpdateTaskInput): Promise<ActionResult<Task>> {
  try {
    const user = await requireRole('staff', 'admin', 'super_admin')
    const existingTask = await getTaskById(input.id)
    if (!existingTask) throw new Error('Task not found')
    const previousRecipientEmails = getRecipientEmailsFromTask(existingTask)

    const isAdmin = user.role === 'admin' || user.role === 'super_admin'
    const canEditDetails =
      isAdmin ||
      existingTask.submitted_by === user.id ||
      isTaskAssignedToUser(existingTask, user.id)

    const requestedFields = Object.keys(input).filter((key) => key !== 'id')
    if (!isAdmin) {
      const allowedFields = new Set(['title', 'description', 'due_date', 'custom_fields'])
      if (!canEditDetails || requestedFields.some((key) => !allowedFields.has(key))) {
        throw new Error('You do not have permission to edit this task.')
      }
    }

    const updates: Record<string, unknown> = { ...input }
    delete updates.id
    let shareEmailRecipients: string[] = []

    if ('custom_fields' in input && typeof input.custom_fields === 'object' && input.custom_fields) {
      const nextCustomFields = {
        ...(existingTask.custom_fields ?? {}),
        ...(input.custom_fields as Record<string, unknown>),
      }

      if (!isAdmin) {
        delete nextCustomFields.share_token
        delete nextCustomFields.recipient_email
        delete nextCustomFields.recipient_emails
        delete nextCustomFields.assigned_user_id
        delete nextCustomFields.assigned_user_ids
        delete nextCustomFields.assigned_user_names
      }

      updates.custom_fields = nextCustomFields
    }

    if ('description' in input) {
      updates.description = input.description?.trim() ? input.description.trim() : null
    }

    if ('title' in input) {
      const normalizedTitle = input.title?.trim() ?? ''
      if (!normalizedTitle) {
        throw new Error('Title is required.')
      }
      if (normalizedTitle.length > 500) {
        throw new Error('Title is too long.')
      }
      updates.title = normalizedTitle
    }

    if ('due_date' in input) {
      const normalizedDueDate = input.due_date?.trim() || null
      updates.due_date = normalizedDueDate
      updates.has_real_due_date = Boolean(normalizedDueDate)
    }

    if ('assigned_to' in input) {
      const assignedIds = Array.from(new Set(
        (Array.isArray(input.assigned_to)
          ? input.assigned_to
          : input.assigned_to ? [input.assigned_to] : []
        ).filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
      ))
      const assignedUsers = assignedIds
        .map((userId) => findUser(userId))
        .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile))
      const currentCustomFields = {
        ...(existingTask.custom_fields ?? {}),
        ...(typeof updates.custom_fields === 'object' && updates.custom_fields ? updates.custom_fields as Record<string, unknown> : {}),
      }

      if (assignedUsers.length > 0) {
        currentCustomFields.assigned_user_name = assignedUsers
          .map((profile) => profile.full_name ?? profile.display_name ?? 'Assigned user')
          .join(', ')
        currentCustomFields.assigned_user_names = assignedUsers
          .map((profile) => profile.full_name ?? profile.display_name ?? 'Assigned user')
        currentCustomFields.assigned_user_ids = assignedUsers.map((profile) => profile.id)

        const recipientEmails = assignedUsers
          .map((profile) => profile.email?.trim().toLowerCase())
          .filter((email): email is string => Boolean(email))
        const removedRecipientEmails = previousRecipientEmails.filter((email) => !recipientEmails.includes(email))
        const addedRecipientEmails = recipientEmails.filter((email) => !previousRecipientEmails.includes(email))
        const existingShareToken = getShareTokenFromTask(existingTask)
        const shareToken = removedRecipientEmails.length > 0 || !existingShareToken
          ? randomUUID()
          : existingShareToken

        if (recipientEmails.length > 0) {
          currentCustomFields.recipient_email = recipientEmails[0]
          currentCustomFields.recipient_emails = recipientEmails
          currentCustomFields.assigned_user_id = assignedUsers[0].id
          currentCustomFields.share_token = shareToken
          shareEmailRecipients = removedRecipientEmails.length > 0 ? recipientEmails : addedRecipientEmails
        } else {
          delete currentCustomFields.recipient_email
          delete currentCustomFields.recipient_emails
          delete currentCustomFields.assigned_user_id
          delete currentCustomFields.share_token
          shareEmailRecipients = []
        }
      } else {
        delete currentCustomFields.assigned_user_name
        delete currentCustomFields.assigned_user_names
        delete currentCustomFields.recipient_email
        delete currentCustomFields.recipient_emails
        delete currentCustomFields.assigned_user_id
        delete currentCustomFields.assigned_user_ids
        delete currentCustomFields.share_token
        shareEmailRecipients = []
      }

      updates.custom_fields = currentCustomFields
      updates.assigned_to = assignedIds[0] ?? null
    }

    if (input.status === 'completed') {
      updates.completed_at = new Date().toISOString()
    } else if (input.status && input.status !== 'archived') {
      updates.completed_at = null
    }

    const task = await dbUpdateTask(input.id, updates)
    if (!task) throw new Error('Task not found')

    await createActivityLog({
      actor_id: user.id, task_id: task.id,
      entity_type: 'task', entity_id: task.id,
      action: 'task_updated',
      metadata: { fields_changed: Object.keys(input).filter(k => k !== 'id') },
    })

    await syncTaskToGoogleCalendar(task)
    if (shareEmailRecipients.length > 0) {
      for (const recipientEmail of shareEmailRecipients) {
        await sendTaskSharedEmail({ task, recipientEmail, sender: user })
      }
    }
    revalidateBoard()
    return { success: true, data: task }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function completeTask(taskId: string): Promise<ActionResult<Task>> {
  try {
    const user    = await requireRole('admin', 'super_admin')
    const task    = await getTaskById(taskId)
    if (!task) throw new Error('Task not found')

    const columns     = await getActiveColumns(task.board_id, false)
    const completedCol = columns.find(c => c.name.toLowerCase() === 'completed')
    const newColumnId  = completedCol?.id ?? task.column_id

    const updated = await dbUpdateTask(taskId, {
      status:       'completed',
      column_id:    newColumnId,
      completed_at: new Date().toISOString(),
    })
    if (!updated) throw new Error('Task not found')

    await createActivityLog({
      actor_id: user.id, task_id: taskId,
      entity_type: 'task', entity_id: taskId,
      action: 'task_completed',
      metadata: { completed_by: user.full_name ?? user.email },
    })

    await syncTaskToGoogleCalendar(updated)
    revalidateBoard()
    await sendTaskCompletedEmail(updated, user)
    return { success: true, data: updated }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function reopenTask(taskId: string): Promise<ActionResult<Task>> {
  try {
    const user   = await requireRole('admin', 'super_admin')
    const task   = await getTaskById(taskId)
    if (!task) throw new Error('Task not found')

    const columns = await getActiveColumns(task.board_id, false)
    const inbox   = columns.find(c => c.is_default)

    const updated = await dbUpdateTask(taskId, {
      status:       'pending',
      column_id:    inbox?.id ?? task.column_id,
      completed_at: null,
    })
    if (!updated) throw new Error('Task not found')

    await createActivityLog({
      actor_id: user.id, task_id: taskId,
      entity_type: 'task', entity_id: taskId,
      action: 'task_updated',
      metadata: { reopened_by: user.full_name ?? user.email },
    })

    await syncTaskToGoogleCalendar(updated)
    revalidateBoard()
    return { success: true, data: updated }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function archiveTask(taskId: string): Promise<ActionResult> {
  try {
    const user   = await requireRole('admin', 'super_admin')
    const task   = await getTaskById(taskId)
    if (!task) throw new Error('Task not found')

    const columns   = await getActiveColumns(task.board_id, true)
    const archiveCol = columns.find(c => c.is_archive)
    if (!archiveCol) throw new Error('Archive column not configured.')

    const updated = await dbUpdateTask(taskId, { status: 'archived', column_id: archiveCol.id })
    if (!updated) throw new Error('Task not found')
    await createActivityLog({
      actor_id: user.id, task_id: taskId,
      entity_type: 'task', entity_id: taskId,
      action: 'task_archived', metadata: {},
    })

    await syncTaskToGoogleCalendar(updated)
    revalidateBoard()
    revalidatePath(normalizePath('/archive'))
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function restoreTask(taskId: string, targetColumnId: string): Promise<ActionResult> {
  try {
    const user = await requireRole('admin', 'super_admin')
    const task = await getTaskById(taskId)
    if (!task) throw new Error('Task not found')

    const columns = await getActiveColumns(task.board_id, false)
    const targetColumn = columns.find((column) => column.id === targetColumnId)
    if (!targetColumn) {
      throw new Error('Restore column is invalid.')
    }

    const nextCustomFields = { ...(task.custom_fields ?? {}) }
    delete nextCustomFields.share_token
    delete nextCustomFields.recipient_email
    delete nextCustomFields.recipient_emails
    delete nextCustomFields.assigned_user_id
    delete nextCustomFields.assigned_user_ids
    delete nextCustomFields.assigned_user_names

    const updated = await dbUpdateTask(taskId, {
      status: 'new',
      column_id: targetColumnId,
      custom_fields: nextCustomFields,
    })
    if (!updated) throw new Error('Task not found')
    await createActivityLog({
      actor_id: user.id, task_id: taskId,
      entity_type: 'task', entity_id: taskId,
      action: 'task_restored',
      metadata: { restored_to_column: targetColumn.name },
    })

    await syncTaskToGoogleCalendar(updated)
    revalidateBoard()
    revalidatePath(normalizePath('/archive'))
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function deleteTask(taskId: string): Promise<ActionResult> {
  try {
    const user = await requireRole('admin', 'super_admin')
    const task = await getTaskById(taskId)
    if (!task) throw new Error('Task not found')

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

    await softDeleteTask(taskId)
    await createActivityLog({
      actor_id: user.id, task_id: taskId,
      entity_type: 'task', entity_id: taskId,
      action: 'task_deleted',
      metadata: { deleted_by: user.email },
    })

    revalidateBoard()
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
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
