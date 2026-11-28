'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import {
  X, CheckCircle2, Archive, Trash2, Lock, MessageSquare,
  Loader2, Send, User, Calendar, Flag, Tag, Clock, RotateCcw, Paperclip, MapPin, CheckSquare, Plus,
  Eye, PencilLine, AlertTriangle, LockKeyhole, UnlockKeyhole,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, getAssignedUserIds, getPriorityConfig, formatDateTime, formatRelativeDate, getUserDisplayName, isTaskAssignedToUser, normalizeAppAssetUrl } from '@/lib/utils'
import {
  completeTask, archiveTask, deleteTask, reopenTask, updateTask, deleteTaskAttachment, setTaskLocked,
} from '@/lib/actions/tasks'
import { addComment, deleteComment, editComment, getTaskComments } from '@/lib/actions/activity'
import { getMentionableUsers, markTaskSeen } from '@/lib/actions/notifications'
import MentionTextarea, { CommentBody, encodeMentions, mentionsToPlainText } from './MentionTextarea'
import { getStaffUsers } from '@/lib/actions/settings'
import type { ActionResult, MentionableUser, TaskWithRelations, CommentWithAuthor, SessionUser, Priority, Attachment, UserProfile, Column, TaskExpectation, TaskPresence } from '@/lib/types'
import { reportActionFailure, useTaskPresence } from '@/lib/live/client'
import { Avatar } from '@/components/layout/AppNav'
import LinkifiedText from '@/components/system/LinkifiedText'
import AppSelect from '@/components/system/AppSelect'

const APP_BASE_PATH = process.env.NODE_ENV === 'production' ? '/task' : ''
const PREVIEW_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

interface Props {
  task:        TaskWithRelations
  currentUser: SessionUser
  columns:      Column[]
  onClose:     () => void
  onUpdate:    (task: TaskWithRelations) => void
  onRemove:    (taskId: string) => void
  onMove:      (taskId: string, columnId: string) => Promise<void>
  /** Other people who have this card open right now. */
  presence?:   TaskPresence[]
  /** Wraps a server write so live refreshes wait for it to finish. */
  runWrite?:   <T>(write: () => Promise<T>) => Promise<T>
  /** Pull the latest board state (used after a conflict). */
  onRefresh?:  () => Promise<void>
}

/** The editable fields as they were when the user pressed Edit. */
interface EditBase {
  version: number
  title: string
  description: string | null
  due_date: string | null
  address: unknown
  send_to_calendar: unknown
  checklist: unknown
}

function captureEditBase(task: TaskWithRelations): EditBase {
  return {
    version: task.version,
    title: task.title,
    description: task.description,
    due_date: task.due_date,
    address: task.custom_fields?.address ?? null,
    send_to_calendar: task.custom_fields?.send_to_calendar ?? null,
    checklist: task.custom_fields?.checklist ?? null,
  }
}

interface ChecklistItemDraft {
  label: string
  checked: boolean
}

function toDateTimeLocalValue(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60_000)
  return local.toISOString().slice(0, 16)
}

function fromDateTimeLocalValue(value: string) {
  if (!value) return null
  return new Date(value).toISOString()
}

function getAssignableUserLabel(user: UserProfile) {
  return user.full_name ?? user.display_name ?? 'Unnamed user'
}

export default function TaskDetailPanel({
  task, currentUser, columns, onClose, onUpdate, onRemove, onMove,
  presence = [], runWrite = (write) => write(), onRefresh,
}: Props) {
  const isAdmin      = currentUser.role === 'admin' || currentUser.role === 'super_admin'
  const isSuperAdmin = currentUser.role === 'admin' || currentUser.role === 'super_admin'
  const isLocked = task.custom_fields?.locked === true
  const canEditDetails = !isLocked && (isAdmin || task.submitted_by === currentUser.id || isTaskAssignedToUser(task, currentUser.id))
  // Locking blocks edits, not completion.
  const canCompleteTask = isAdmin || task.submitted_by === currentUser.id || isTaskAssignedToUser(task, currentUser.id)

  const [comments,    setComments]    = useState<CommentWithAuthor[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [lightbox,    setLightbox]    = useState<string | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const [staffUsers,  setStaffUsers]  = useState<UserProfile[]>([])
  const [loadingComments, setLoadingComments] = useState(true)
  const [commentBody, setCommentBody] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentBody, setEditingCommentBody] = useState('')
  const [commentActionId, setCommentActionId] = useState<string | null>(null)
  const [commentFiles, setCommentFiles] = useState<File[]>([])
  const commentFileInputRef = useRef<HTMLInputElement>(null)
  const [isInternal,  setIsInternal]  = useState(false)
  const [mentionCandidates, setMentionCandidates] = useState<MentionableUser[]>([])
  const [mentionPicks, setMentionPicks] = useState<MentionableUser[]>([])
  const [isPending,   startTransition] = useTransition()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [selectedColumnId, setSelectedColumnId] = useState(task.column_id)
  const [isEditingDetails, setIsEditingDetails] = useState(false)
  const [isSavingChecklist, setIsSavingChecklist] = useState(false)
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false)
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const [descriptionDraft, setDescriptionDraft] = useState(task.description ?? '')
  const [addressDraft, setAddressDraft] = useState(typeof task.custom_fields?.address === 'string' ? task.custom_fields.address : '')
  const [dueDateDraft, setDueDateDraft] = useState(toDateTimeLocalValue(task.due_date))
  const [sendToCalendarDraft, setSendToCalendarDraft] = useState(task.custom_fields?.send_to_calendar === true)
  const [checklistDraft, setChecklistDraft] = useState<ChecklistItemDraft[]>(
    Array.isArray(task.custom_fields?.checklist)
      ? (task.custom_fields.checklist as ChecklistItemDraft[]).map((item) => ({
          label: item.label ?? '',
          checked: Boolean(item.checked),
        }))
      : [],
  )

  useEffect(() => {
    setSelectedColumnId(task.column_id)
  }, [task.column_id])

  // Snapshot of the editable fields when Edit was pressed. Saving sends these
  // as the expectation, so only changes to the *same* fields by someone else
  // block the save. null = use the card as currently shown.
  const editBaseRef = useRef<EditBase | null>(null)
  const [conflictNotice, setConflictNotice] = useState<string | null>(null)

  // Opening a different card always leaves edit mode.
  useEffect(() => {
    setIsEditingDetails(false)
    setEditingCommentId(null)
    setEditingCommentBody('')
    setConflictNotice(null)
    editBaseRef.current = null
  }, [task.id])

  // Keep drafts in sync with live updates — but never overwrite what the
  // user is typing. While editing, a banner tells them the card changed.
  useEffect(() => {
    if (isEditingDetails) return
    resetDetailDrafts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.title, task.description, task.due_date, task.custom_fields, task.id, isEditingDetails])

  useTaskPresence(task.id, isEditingDetails ? 'editing' : 'viewing')

  // Load comments when the panel opens, and again when someone else comments.
  const loadedCommentsForRef = useRef<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const firstLoad = loadedCommentsForRef.current !== task.id
    if (firstLoad) setLoadingComments(true)
    getTaskComments(task.id).then(data => {
      if (!cancelled) {
        setComments(data)
        setLoadingComments(false)
        loadedCommentsForRef.current = task.id
      }
    }).catch(() => setLoadingComments(false))
    // You're looking at the card, so its notifications (incl. new replies) are seen.
    markTaskSeen(task.id).catch(() => {})
    return () => { cancelled = true }
  }, [task.id, task._comment_count])

  // Who can be @mentioned here: people who can open this card.
  const assigneeKey = getAssignedUserIds(task).join(',')
  useEffect(() => { setMentionPicks([]) }, [task.id])
  useEffect(() => {
    let cancelled = false
    getMentionableUsers(task.id)
      .then((users) => { if (!cancelled) setMentionCandidates(users) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [task.id, assigneeKey])

  // Internal notes are admin-only, so only admins can be mentioned in them.
  const visibleMentionCandidates = isInternal
    ? mentionCandidates.filter((user) => user.role !== 'staff')
    : mentionCandidates

  /** Common handling for a rejected action. */
  async function handleFailure(result: Extract<ActionResult<unknown>, { success: false }>, fallback: string) {
    reportActionFailure(result, fallback)
    if (result.code === 'conflict') await onRefresh?.()
  }

  const stateExpectation: TaskExpectation = { column_id: task.column_id, status: task.status }

  // Load staff for assignment dropdown (admin only)
  useEffect(() => {
    if (!isAdmin) return
    getStaffUsers().then(setStaffUsers).catch(() => {})
  }, [isAdmin])

  // Sync attachments from task prop whenever it updates
  useEffect(() => {
    setAttachments((task.attachments ?? []) as Attachment[])
  }, [task.attachments, task._attachment_count])



  // ─── Actions ──────────────────────────────────────────────────────────────

  async function handleComplete() {
    startTransition(async () => {
      const result = await runWrite(() => completeTask(task.id, stateExpectation))
      if (result.success && result.data) {
        toast.success('Task marked as completed — notification sent')
        onUpdate({ ...task, ...result.data })
      } else if (!result.success) {
        await handleFailure(result, 'Failed to complete task')
      }
    })
  }

  async function handleArchive() {
    startTransition(async () => {
      const result = await runWrite(() => archiveTask(task.id, stateExpectation))
      if (result.success) {
        toast.success('Task archived')
        onRemove(task.id)
        onClose()
      } else {
        await handleFailure(result, 'Failed to archive task')
      }
    })
  }

  async function handleReopen() {
    startTransition(async () => {
      const result = await runWrite(() => reopenTask(task.id, stateExpectation))
      if (result.success && result.data) {
        toast.success('Task reopened and moved back to Inbox')
        onUpdate({ ...task, ...result.data })
      } else if (!result.success) {
        await handleFailure(result, 'Failed to reopen task')
      }
    })
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 4000)
      return
    }
    startTransition(async () => {
      // Deleting is irreversible: refuse if *anything* changed since you looked.
      const result = await runWrite(() => deleteTask(task.id, { version: task.version }))
      if (result.success) {
        toast.success('Task permanently deleted')
        onRemove(task.id)
        onClose()
      } else {
        await handleFailure(result, 'Failed to delete task')
      }
    })
  }

  async function handleAssign(selectedIds: string[]) {
    startTransition(async () => {
      const result = await runWrite(() => updateTask(
        { id: task.id, assigned_to: selectedIds },
        { fields: { assigned_user_ids: selectedAssigneeIds } },
      ))
      if (result.success && result.data) {
        const assignedToProfiles = selectedIds
          .map((userId) => staffUsers.find((staffUser) => staffUser.id === userId) ?? null)
          .filter((profile): profile is UserProfile => Boolean(profile))
        onUpdate({
          ...task,
          ...result.data,
          assigned_to_profile: assignedToProfiles[0] ?? null,
          assigned_to_profiles: assignedToProfiles,
        })
      } else if (!result.success) {
        await handleFailure(result, 'Failed to update assignees')
      }
    })
  }

  async function handleToggleChecklistItem(index: number) {
    if (!canEditDetails || isEditingDetails || isSavingChecklist) return

    const sourceChecklist = Array.isArray(task.custom_fields?.checklist)
      ? (task.custom_fields.checklist as ChecklistItemDraft[]).map((item) => ({
          label: item.label ?? '',
          checked: Boolean(item.checked),
        }))
      : []

    if (!sourceChecklist[index]) return

    const nextChecklist = sourceChecklist.map((item, itemIndex) => (
      itemIndex === index ? { ...item, checked: !item.checked } : item
    ))

    setIsSavingChecklist(true)

    try {
      // Send only the checklist; expect it unchanged since we rendered it.
      const result = await runWrite(() => updateTask(
        { id: task.id, custom_fields: { checklist: nextChecklist } },
        { fields: { custom_fields: { checklist: task.custom_fields?.checklist ?? null } } },
      ))

      if (result.success && result.data) {
        onUpdate({ ...task, ...result.data })
        return
      }

      if (!result.success) await handleFailure(result, 'Failed to update checklist')
    } catch {
      toast.error('Failed to update checklist')
    } finally {
      setIsSavingChecklist(false)
    }
  }

  async function handlePriorityChange(priority: Priority) {
    startTransition(async () => {
      const result = await runWrite(() => updateTask(
        { id: task.id, priority },
        { fields: { priority: task.priority } },
      ))
      if (result.success) {
        onUpdate({ ...task, ...result.data, priority })
      } else {
        await handleFailure(result, 'Failed to change priority')
      }
    })
  }

  async function handleLockToggle() {
    const result = await runWrite(() => setTaskLocked(task.id, !isLocked, { version: task.version }))
    if (result.success) {
      setIsEditingDetails(false)
      onUpdate({ ...task, ...result.data })
      toast.success(isLocked ? 'Card unlocked' : 'Card locked')
    } else await handleFailure(result, 'Could not change card lock')
  }

  async function handleMoveColumn(columnId: string) {
    if (!columnId || columnId === task.column_id) return

    startTransition(async () => {
      try {
        await onMove(task.id, columnId)
        setSelectedColumnId(columnId)
        toast.success('Task moved')
      } catch (error) {
        const alreadyReported = Boolean((error as { reported?: boolean } | null)?.reported)
        if (!alreadyReported) toast.error(error instanceof Error ? error.message : 'Failed to move task')
        setSelectedColumnId(task.column_id)
      }
    })
  }

  async function handleAttachmentUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return

    setIsUploadingAttachment(true)
    try {
      const uploadedAttachments: Attachment[] = []

      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('task_id', task.id)

        const response = await fetch(`${APP_BASE_PATH}/api/upload`, {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const payload = await response.json().catch(() => ({ error: 'Upload failed' }))
          throw new Error(payload.error || `Failed to upload ${file.name}`)
        }

        const payload = await response.json()
        if (payload?.attachment) {
          uploadedAttachments.push(payload.attachment as Attachment)
        }
      }

      if (uploadedAttachments.length > 0) {
        const nextAttachments = [...attachments, ...uploadedAttachments]
        setAttachments(nextAttachments)
        onUpdate({
          ...task,
          attachments: nextAttachments,
          _attachment_count: nextAttachments.length,
        })
        toast.success(uploadedAttachments.length === 1 ? 'Attachment uploaded' : 'Attachments uploaded')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload attachment')
    } finally {
      setIsUploadingAttachment(false)
    }
  }

  async function handleDeleteAttachment(attachmentId: string) {
    if (deletingAttachmentId) return

    setDeletingAttachmentId(attachmentId)
    try {
      const result = await deleteTaskAttachment(attachmentId)
      if (!result.success) {
        toast.error(result.error)
        return
      }

      const nextAttachments = attachments.filter((attachment) => attachment.id !== attachmentId)
      setAttachments(nextAttachments)
      onUpdate({
        ...task,
        attachments: nextAttachments,
        _attachment_count: nextAttachments.length,
      })
      toast.success('Attachment deleted')
    } finally {
      setDeletingAttachmentId(null)
    }
  }

  async function handleAddComment() {
    if (!commentBody.trim() && commentFiles.length === 0) return
    startTransition(async () => {
      const body = encodeMentions(commentBody.trim() || 'Attached files', mentionPicks)
      const result = await runWrite(() => addComment(task.id, body, isInternal))
      if (result.success) {
        const uploaded: Attachment[] = []
        const failed: File[] = []
        for (const file of commentFiles) {
          try {
            const data = new FormData()
            data.append('task_id', task.id)
            data.append('comment_id', result.data.id)
            data.append('file', file)
            const response = await fetch(`${APP_BASE_PATH}/api/upload`, { method: 'POST', body: data })
            const payload = await response.json()
            if (!response.ok) throw new Error(payload.error || 'Upload failed')
            uploaded.push(payload.attachment as Attachment)
          } catch { failed.push(file) }
        }
        // Optimistically add to list
        const newComment: CommentWithAuthor = {
          ...result.data,
          attachments: uploaded,
          author: {
            id:           currentUser.id,
            full_name:    currentUser.full_name,
            display_name: currentUser.display_name,
            email:        currentUser.email,
            avatar_url:   currentUser.avatar_url,
            role:         currentUser.role,
            department:   null,
            is_active:    true,
            created_at:   new Date().toISOString(),
            updated_at:   new Date().toISOString(),
          },
        }
        setComments(prev => [...prev, newComment])
        setCommentBody('')
        setCommentFiles(failed)
        if (failed.length) toast.error(`${failed.length} file${failed.length === 1 ? '' : 's'} could not be attached. The comment was saved.`)
        setMentionPicks([])
        onUpdate({ ...task, _comment_count: task._comment_count + 1 })
      } else {
        toast.error(result.error)
      }
    })
  }

  async function handleEditComment(comment: CommentWithAuthor) {
    const body = encodeMentions(editingCommentBody.trim(), mentionCandidates)
    if (!body) return
    setCommentActionId(comment.id)
    try {
      const result = await runWrite(() => editComment(comment.id, body))
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setComments(prev => prev.map(item => item.id === comment.id ? { ...item, ...result.data } : item))
      setEditingCommentId(null)
      setEditingCommentBody('')
      toast.success('Comment updated')
    } finally {
      setCommentActionId(null)
    }
  }

  async function handleDeleteComment(comment: CommentWithAuthor) {
    if (!window.confirm('Delete this comment? This cannot be undone.')) return
    setCommentActionId(comment.id)
    try {
      const result = await runWrite(() => deleteComment(comment.id))
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setComments(prev => prev.filter(item => item.id !== comment.id))
      if (editingCommentId === comment.id) {
        setEditingCommentId(null)
        setEditingCommentBody('')
      }
      onUpdate({ ...task, _comment_count: Math.max(0, task._comment_count - 1) })
      toast.success('Comment deleted')
    } finally {
      setCommentActionId(null)
    }
  }

  async function handleSaveDetails() {
    const trimmedChecklist = checklistDraft
      .map((item) => ({ label: item.label.trim(), checked: item.checked }))
      .filter((item) => item.label)

    // Send only what the user actually changed, and expect only those fields
    // to be as they saw them. Someone else editing a *different* field (or
    // assigning the card) never blocks this save. null removes a custom field.
    const base = editBaseRef.current ?? captureEditBase(task)
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

    const next = {
      title: titleDraft.trim(),
      description: descriptionDraft.trim() || null,
      due_date: fromDateTimeLocalValue(dueDateDraft),
      address: addressDraft.trim() || null,
      send_to_calendar: sendToCalendarDraft ? true : null,
      checklist: trimmedChecklist.length > 0 ? trimmedChecklist : null,
    }

    const input: Parameters<typeof updateTask>[0] = { id: task.id }
    const expectedFields: NonNullable<TaskExpectation['fields']> = {}
    const custom_fields: Record<string, unknown> = {}
    const expectedCustom: Record<string, unknown> = {}

    if (!same(next.title, base.title)) { input.title = next.title; expectedFields.title = base.title }
    if (!same(next.description, base.description)) { input.description = next.description ?? ''; expectedFields.description = base.description }
    if (!same(next.due_date, base.due_date)) { input.due_date = next.due_date; expectedFields.due_date = base.due_date }
    for (const key of ['address', 'send_to_calendar', 'checklist'] as const) {
      if (!same(next[key], base[key])) { custom_fields[key] = next[key]; expectedCustom[key] = base[key] }
    }
    if (Object.keys(custom_fields).length > 0) {
      input.custom_fields = custom_fields
      expectedFields.custom_fields = expectedCustom
    }

    if (Object.keys(input).length === 1) {
      // Nothing changed.
      editBaseRef.current = null
      setConflictNotice(null)
      setIsEditingDetails(false)
      return
    }

    startTransition(async () => {
      const result = await runWrite(() => updateTask(input, { fields: expectedFields }))

      if (result.success && result.data) {
        onUpdate({ ...task, ...result.data })
        editBaseRef.current = null
        setConflictNotice(null)
        setIsEditingDetails(false)
        toast.success('Task details updated')
      } else if (!result.success) {
        if (result.code === 'conflict') {
          // Keep the user's drafts. The card refreshes underneath; saving again
          // is a deliberate choice to replace the other person's version.
          editBaseRef.current = null
          setConflictNotice(result.error.replace(
            /Your change was not saved.*$/,
            'Your edits are still here. Review the card, then press Save again to replace their version — or Cancel edit to keep theirs.',
          ))
          await onRefresh?.()
        } else {
          toast.error(result.error)
        }
      }
    })
  }

  function resetDetailDrafts() {
    setTitleDraft(task.title)
    setDescriptionDraft(task.description ?? '')
    setAddressDraft(typeof task.custom_fields?.address === 'string' ? task.custom_fields.address : '')
    setDueDateDraft(toDateTimeLocalValue(task.due_date))
    setSendToCalendarDraft(task.custom_fields?.send_to_calendar === true)
    setChecklistDraft(
      Array.isArray(task.custom_fields?.checklist)
        ? (task.custom_fields.checklist as ChecklistItemDraft[]).map((item) => ({
            label: item.label ?? '',
            checked: Boolean(item.checked),
          }))
        : [],
    )
  }

  function updateChecklistItem(index: number, updates: Partial<ChecklistItemDraft>) {
    setChecklistDraft((prev) => prev.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...updates } : item
    )))
  }

  function toggleEditMode() {
    if (isEditingDetails) {
      resetDetailDrafts()
      editBaseRef.current = null
      setConflictNotice(null)
      setIsEditingDetails(false)
      return
    }
    editBaseRef.current = captureEditBase(task)
    setIsEditingDetails(true)
  }

  // Someone else saved this card while you're in edit mode.
  const changedWhileEditing =
    isEditingDetails &&
    !conflictNotice &&
    editBaseRef.current !== null &&
    task.version !== editBaseRef.current.version &&
    task.updated_by !== currentUser.id
  const lastEditorName = task.updated_by_profile
    ? getUserDisplayName(task.updated_by_profile)
    : 'Someone else'
  const otherEditors = presence.filter((entry) => entry.mode === 'editing')
  const otherViewers = presence.filter((entry) => entry.mode === 'viewing')

  const priority = getPriorityConfig(task.priority)

  const selectedAssigneeIds = getAssignedUserIds(task)
  const assignees = task.assigned_to_profiles ?? (task.assigned_to_profile ? [task.assigned_to_profile] : [])

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className={cn(
        'fixed z-50 bg-card shadow-2xl flex flex-col overflow-hidden',
        // Mobile: bottom sheet
        'inset-x-0 bottom-0 top-[15%] rounded-t-2xl border-t border-border',
        'animate-slide-up',
        // Desktop: right panel
        'sm:inset-x-auto sm:right-0 sm:top-0 sm:bottom-0 sm:rounded-none sm:border-t-0 sm:border-l sm:border-border',
        'sm:w-[480px] lg:w-[540px]',
        'sm:animate-slide-in-right',
        task.priority === 'low'    && 'priority-top-low',
        task.priority === 'normal' && 'priority-top-normal',
        task.priority === 'high'   && 'priority-top-high',
        task.priority === 'urgent' && 'priority-top-urgent',
      )}>
        <div className="flex items-start gap-3 p-5 border-b border-border shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', priority.bgClass)}>
                {priority.label}
              </span>
              <StatusBadge status={task.status} />
              {isLocked && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200"><LockKeyhole size={11} />Locked</span>}
              {task.status === 'completed' && (
                <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                  ✓ Completed {formatRelativeDate(task.completed_at)}
                </span>
              )}
            </div>
            {canEditDetails && isEditingDetails ? (
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-base font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Task title"
              />
            ) : (
              <h2 className="text-lg font-semibold text-foreground leading-snug">
                {task.title}
              </h2>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isAdmin && <button type="button" onClick={() => void handleLockToggle()} disabled={isPending} aria-label={isLocked ? 'Unlock card' : 'Lock card'} className="flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium text-primary hover:bg-accent disabled:opacity-50 coarse:h-11">{isLocked ? <UnlockKeyhole size={14} /> : <LockKeyhole size={14} />}{isLocked ? 'Unlock' : 'Lock'}</button>}
            {canEditDetails && (
              <button
                type="button"
                onClick={toggleEditMode}
                className="h-8 coarse:h-11 rounded-lg border border-border px-2.5 coarse:px-4 text-xs font-medium text-primary hover:bg-accent"
              >
                {isEditingDetails ? 'Cancel edit' : 'Edit'}
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close panel"
              className="w-8 h-8 coarse:h-11 coarse:w-11 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        {(presence.length > 0 || changedWhileEditing || conflictNotice) && (
          <div className="px-5 py-2.5 border-b border-border space-y-2 shrink-0 text-xs">
            {presence.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap text-muted-foreground">
                {otherEditors.length > 0 && (
                  <span className="flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                    <PencilLine size={11} />
                    {otherEditors.map((entry) => entry.user_name).join(', ')} {otherEditors.length === 1 ? 'is' : 'are'} editing
                  </span>
                )}
                {otherViewers.length > 0 && (
                  <span className="flex items-center gap-1 rounded-md bg-sky-100 px-2 py-1 font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
                    <Eye size={11} />
                    {otherViewers.map((entry) => entry.user_name).join(', ')} {otherViewers.length === 1 ? 'is' : 'are'} viewing
                  </span>
                )}
              </div>
            )}
            {changedWhileEditing && (
              <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                <AlertTriangle size={13} className="mt-px shrink-0" />
                {lastEditorName} just changed this card. If they edited the same fields as you, your save will be stopped so you can review first.
              </p>
            )}
            {conflictNotice && (
              <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                <AlertTriangle size={13} className="mt-px shrink-0" />
                {conflictNotice}
              </p>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          <div className="p-5 border-b border-border space-y-3">
            <MetaRow icon={User} label="Submitted by">
              <div className="flex items-center gap-2">
                <Avatar user={task.submitted_by_profile} size="sm" />
                <span className="text-sm">{getUserDisplayName(task.submitted_by_profile)}</span>
              </div>
            </MetaRow>

            <MetaRow icon={User} label="Assigned to">
              {isAdmin ? (
                <div className="space-y-2">
                  {staffUsers.map((u) => {
                    const checked = selectedAssigneeIds.includes(u.id)
                    return (
                      <label key={u.id} className="flex items-center gap-2 text-sm coarse:min-h-11 coarse:gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const nextIds = e.target.checked
                              ? [...selectedAssigneeIds, u.id]
                              : selectedAssigneeIds.filter((id) => id !== u.id)
                            void handleAssign(Array.from(new Set(nextIds)))
                          }}
                          className="h-5 w-5 shrink-0 cursor-pointer rounded border-input text-primary accent-[hsl(var(--primary))] focus:ring-primary touch-manipulation"
                        />
                        <span>{getAssignableUserLabel(u)}</span>
                      </label>
                    )
                  })}
                </div>
              ) : assignees.length > 0 ? (
                <div className="space-y-2">
                  {assignees.map((assignee) => (
                    <div key={assignee.id} className="flex items-center gap-2">
                      <Avatar user={assignee} size="sm" />
                      <span className="text-sm">{getUserDisplayName(assignee)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Unassigned</span>
              )}
            </MetaRow>

            <MetaRow icon={Calendar} label="Due date">
              {canEditDetails && isEditingDetails ? (
                <input
                  type="datetime-local"
                  value={dueDateDraft}
                  onChange={(e) => setDueDateDraft(e.target.value)}
                  className="h-8 px-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              ) : (
                <span className="text-sm">
                  {task.has_real_due_date && task.due_date
                    ? formatDateTime(task.due_date)
                    : <span className="text-muted-foreground">Auto-assigned</span>
                  }
                </span>
              )}
            </MetaRow>

            <MetaRow icon={Calendar} label="Calendar sync">
              {canEditDetails && isEditingDetails ? (
                <label className="flex items-center gap-2 text-sm coarse:min-h-11 coarse:gap-3">
                  <input
                    type="checkbox"
                    checked={sendToCalendarDraft}
                    onChange={(e) => setSendToCalendarDraft(e.target.checked)}
                    className="h-5 w-5 shrink-0 cursor-pointer rounded border-input text-primary accent-[hsl(var(--primary))] focus:ring-primary touch-manipulation"
                  />
                  <span>Send to Google Calendar</span>
                </label>
              ) : (
                <span className="text-sm">
                  {task.custom_fields?.send_to_calendar === true ? 'Enabled' : 'Off'}
                </span>
              )}
            </MetaRow>

            <MetaRow icon={Clock} label="Created">
              <span className="text-sm text-muted-foreground">
                {formatDateTime(task.created_at)}
              </span>
            </MetaRow>
            {canEditDetails && (
              <MetaRow icon={CheckSquare} label="Move to">
                <AppSelect
                  ariaLabel="Move to column"
                  value={selectedColumnId}
                  onValueChange={(nextColumnId) => {
                    setSelectedColumnId(nextColumnId)
                    void handleMoveColumn(nextColumnId)
                  }}
                  className="h-8 rounded-lg bg-background text-sm coarse:h-11"
                  options={columns
                    .filter((column) => !column.deleted_at)
                    .map((column) => ({ value: column.id, label: `${column.name}${column.id === task.column_id ? ' (Current)' : ''}` }))}
                />
              </MetaRow>
            )}

            {isAdmin && !isLocked && (
              <MetaRow icon={Flag} label="Priority">
                <div className="flex flex-wrap gap-1.5">
                  {(['low', 'normal', 'high', 'urgent'] as Priority[]).map(p => {
                    const cfg = getPriorityConfig(p)
                    return (
                      <button
                        key={p}
                        onClick={() => handlePriorityChange(p)}
                        className={cn(
                          'text-xs px-2 py-1 coarse:min-h-11 coarse:px-3.5 rounded-md border transition-all font-medium',
                          cfg.bgClass,
                          task.priority === p
                            ? 'ring-2 ring-offset-1 ring-offset-card'
                            : 'opacity-50 hover:opacity-100'
                        )}
                      >
                        {cfg.label}
                      </button>
                    )
                  })}
                </div>
              </MetaRow>
            )}
            {task.labels && task.labels.length > 0 && (
              <MetaRow icon={Tag} label="Labels">
                <div className="flex flex-wrap gap-1.5">
                  {task.labels.map((label, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-md bg-accent text-accent-foreground">
                      {String(label)}
                    </span>
                  ))}
                </div>
              </MetaRow>
            )}
          </div>

          <AttachmentGrid
            items={attachments as Attachment[]}
            onOpen={setLightbox}
            canUpload={canEditDetails}
            isUploading={isUploadingAttachment}
            onUploadClick={() => attachmentInputRef.current?.click()}
            canDelete={canEditDetails}
            deletingAttachmentId={deletingAttachmentId}
            onDelete={handleDeleteAttachment}
          />
          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            onChange={handleAttachmentUpload}
            className="hidden"
          />
          <div className="p-5 border-b border-border space-y-5">
            <div>
              <div className="mb-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Description
                </h3>
              </div>
              {canEditDetails && isEditingDetails ? (
                <textarea
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              ) : (
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {task.description ? <LinkifiedText text={task.description} /> : 'No description'}
                </p>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                <MapPin size={12} />
                Address
              </h3>
              {canEditDetails && isEditingDetails ? (
                <textarea
                  value={addressDraft}
                  onChange={(e) => setAddressDraft(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              ) : (
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {typeof task.custom_fields?.address === 'string' && task.custom_fields.address
                    ? String(task.custom_fields.address)
                    : 'No address'}
                </p>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                <CheckSquare size={12} />
                Checklist
              </h3>
              {canEditDetails && isEditingDetails ? (
                <div className="space-y-2">
                  {checklistDraft.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateChecklistItem(idx, { checked: !item.checked })}
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded border-2',
                          item.checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background',
                        )}
                      >
                        {item.checked ? '✓' : ''}
                      </button>
                      <input
                        type="text"
                        value={item.label}
                        onChange={(e) => updateChecklistItem(idx, { label: e.target.value })}
                        className="flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      <button
                        type="button"
                        onClick={() => setChecklistDraft((prev) => prev.filter((_, itemIndex) => itemIndex !== idx))}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setChecklistDraft((prev) => [...prev, { label: '', checked: false }])}
                    className="flex items-center gap-1.5 text-sm font-medium text-primary"
                  >
                    <Plus size={14} />
                    Add item
                  </button>
                </div>
              ) : Array.isArray(task.custom_fields?.checklist) && (task.custom_fields.checklist as ChecklistItemDraft[]).some((item) => item.label) ? (
                <div className="space-y-2">
                  {(task.custom_fields.checklist as ChecklistItemDraft[]).filter((item) => item.label).map((item, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => void handleToggleChecklistItem(idx)}
                      disabled={!canEditDetails || isSavingChecklist}
                      className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 coarse:min-h-11 text-left disabled:cursor-default"
                    >
                      <div className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded border-2', item.checked ? 'border-primary bg-primary' : 'border-border bg-background')}>
                        {item.checked && <span className="text-[9px] font-bold text-primary-foreground">✓</span>}
                      </div>
                      <span className={cn('text-sm', item.checked ? 'line-through text-muted-foreground' : 'text-foreground')}>
                        {item.label}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No checklist</p>
              )}
            </div>

            {canEditDetails && isEditingDetails && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    resetDetailDrafts()
                    setIsEditingDetails(false)
                  }}
                  disabled={isPending}
                  className="flex h-9 flex-1 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveDetails}
                  disabled={isPending}
                  className="flex h-9 flex-1 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isPending ? <Loader2 size={14} className="animate-spin" /> : 'Save details'}
                </button>
              </div>
            )}
          </div>
          <div className="p-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4 flex items-center gap-2">
              <MessageSquare size={12} />
              Comments {comments.length > 0 && `(${comments.length})`}
            </h3>

            {loadingComments ? (
              <div className="flex justify-center py-4">
                <Loader2 size={16} className="animate-spin text-muted-foreground" />
              </div>
            ) : comments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No comments yet
              </p>
            ) : (
              <div className="space-y-4 mb-4">
                {comments.map(comment => (
                  <CommentItem
                    key={comment.id}
                    comment={comment}
                    currentUserId={currentUser.id}
                    canEdit={comment.author_id === currentUser.id}
                    canDelete={isAdmin || comment.author_id === currentUser.id}
                    editing={editingCommentId === comment.id}
                    editBody={editingCommentBody}
                    busy={commentActionId === comment.id}
                    mentionCandidates={comment.is_internal ? mentionCandidates.filter(candidate => candidate.role !== 'staff') : mentionCandidates}
                    onEditBodyChange={setEditingCommentBody}
                    onStartEdit={() => { setEditingCommentId(comment.id); setEditingCommentBody(mentionsToPlainText(comment.body)) }}
                    onCancelEdit={() => { setEditingCommentId(null); setEditingCommentBody('') }}
                    onSaveEdit={() => { void handleEditComment(comment) }}
                    onDelete={() => { void handleDeleteComment(comment) }}
                  />
                ))}
              </div>
            )}
            <div className="space-y-2">
              <input ref={commentFileInputRef} type="file" multiple className="hidden" aria-label="Comment files" onChange={event => { setCommentFiles(prev => [...prev, ...Array.from(event.target.files ?? [])]); event.target.value = '' }} />
              <div className="relative">
                <MentionTextarea
                  value={commentBody}
                  onChange={setCommentBody}
                  candidates={visibleMentionCandidates}
                  onPick={(user) => setMentionPicks((prev) => [...prev, user])}
                  onSubmit={handleAddComment}
                  placeholder="Add a comment… type @ to mention someone"
                  className={cn(
                    'w-full px-3 py-2.5 pr-10 rounded-xl border border-input',
                    'bg-background text-foreground text-sm resize-none',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary',
                    'transition-colors'
                  )}
                />
              </div>

              {commentFiles.length > 0 && <div className="flex flex-wrap gap-1.5">{commentFiles.map((file, index) => <span key={`${file.name}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-accent px-2 py-1 text-xs"><span className="truncate">{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setCommentFiles(prev => prev.filter((_, i) => i !== index))}><X size={13} /></button></span>)}</div>}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" onClick={() => commentFileInputRef.current?.click()} className="flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"><Paperclip size={14} />Attach files</button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setIsInternal(v => !v)}
                    className={cn(
                      'flex items-center gap-1.5 text-xs px-2.5 py-1.5 coarse:min-h-11 coarse:px-3.5 rounded-lg border transition-colors',
                      isInternal
                        ? 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-400'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Lock size={11} />
                    {isInternal ? 'Internal note' : 'Set as internal'}
                  </button>
                )}
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-xs text-muted-foreground hidden sm:block">
                    ⌘↵ to send
                  </span>
                  <button
                    onClick={handleAddComment}
                    disabled={(!commentBody.trim() && commentFiles.length === 0) || isPending}
                    className={cn(
                      'flex items-center gap-1.5 h-8 coarse:h-11 px-3 coarse:px-4 rounded-lg text-sm font-medium',
                      'bg-primary text-primary-foreground',
                      'hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed',
                      'transition-all'
                    )}
                  >
                    {isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        {(canCompleteTask || isAdmin) && (
          <div className="p-4 pb-6 sm:pb-4 border-t border-border shrink-0 flex flex-wrap gap-2">
            {canCompleteTask && task.status !== 'completed' && (
              <button
                onClick={handleComplete}
                disabled={isPending}
                className={cn(
                  'flex items-center gap-1.5 h-9 coarse:h-12 px-4 rounded-lg text-sm font-medium',
                  'bg-green-600 text-white hover:bg-green-700 disabled:opacity-50',
                  'transition-colors flex-1 justify-center'
                )}
              >
                {isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Mark Complete
              </button>
            )}

            {canEditDetails && task.status === 'completed' && (
              <button
                onClick={handleReopen}
                disabled={isPending}
                className={cn(
                  'flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-medium',
                  'bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50',
                  'transition-colors flex-1 justify-center'
                )}
              >
                {isPending ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                Reopen Task
              </button>
            )}

            {isAdmin && !isLocked && (
              <button
                onClick={handleArchive}
                disabled={isPending}
                className="flex items-center gap-1.5 h-9 coarse:h-12 px-3 coarse:px-4 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
              >
                <Archive size={14} />
                Archive
              </button>
            )}

            {isSuperAdmin && !isLocked && (
              <button
                onClick={handleDelete}
                disabled={isPending}
                className={cn(
                  'flex items-center gap-1.5 h-9 coarse:h-12 px-3 coarse:px-4 rounded-lg text-sm font-medium transition-colors',
                  confirmDelete
                    ? 'bg-destructive text-destructive-foreground'
                    : 'border border-border text-muted-foreground hover:text-destructive hover:border-destructive'
                )}
              >
                <Trash2 size={14} />
                {confirmDelete ? 'Confirm delete?' : 'Delete'}
              </button>
            )}
          </div>
        )}
      </div>
      {lightbox && (
        <div
          className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-6"
          onClick={() => setLightbox(null)}
        >
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setLightbox(null)}
              className="absolute -top-3 -right-3 z-10 w-8 h-8 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={14} />
            </button>
            <img
              src={lightbox}
              alt="Attachment"
              className="max-w-[90vw] max-h-[90vh] rounded-xl object-contain shadow-2xl"
            />
          </div>
        </div>
      )}
    </>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AttachmentGrid({
  items,
  onOpen,
  canUpload,
  isUploading,
  onUploadClick,
  canDelete,
  deletingAttachmentId,
  onDelete,
}: {
  items: Attachment[]
  onOpen: (url: string) => void
  canUpload: boolean
  isUploading: boolean
  onUploadClick: () => void
  canDelete: boolean
  deletingAttachmentId: string | null
  onDelete: (attachmentId: string) => void
}) {
  if (!items.length && !canUpload) return null

  return (
    <div className="p-5 border-b border-border">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <Paperclip size={12} />
          Attachments ({items.length})
        </h3>
        {canUpload && (
          <button
            type="button"
            onClick={onUploadClick}
            disabled={isUploading}
            className="flex h-8 coarse:h-11 items-center gap-1.5 rounded-lg border border-border px-2.5 coarse:px-4 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            {isUploading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            {isUploading ? 'Uploading…' : 'Add files'}
          </button>
        )}
      </div>
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No attachments yet.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {items.map(att => {
          const isImage = PREVIEW_IMAGE_TYPES.has(att.file_type ?? '')
          const attachmentUrl = normalizeAppAssetUrl(att.public_url)
          return (
            <div key={att.id} className="relative">
              {isImage && att.public_url ? (
                <button
                  type="button"
                  onClick={() => onOpen(attachmentUrl)}
                  className="group block rounded-lg border border-border overflow-hidden hover:border-primary/40 transition-colors text-left w-full"
                >
                  <img src={attachmentUrl} alt={att.file_name} className="w-full h-28 object-cover bg-muted" />
                  <div className="px-2 py-1.5 bg-card">
                    <p className="text-xs text-foreground truncate font-medium">{att.file_name}</p>
                    <p className="text-xs text-muted-foreground">{att.file_size ? `${(att.file_size / 1024).toFixed(0)} KB` : ''}</p>
                  </div>
                </button>
              ) : (
                <a
                  href={attachmentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block rounded-lg border border-border overflow-hidden hover:border-primary/40 transition-colors"
                >
                  <div className="w-full h-28 bg-muted flex items-center justify-center">
                    <Paperclip size={20} className="text-muted-foreground" />
                  </div>
                  <div className="px-2 py-1.5 bg-card">
                    <p className="text-xs text-foreground truncate font-medium">{att.file_name}</p>
                    <p className="text-xs text-muted-foreground">{att.file_size ? `${(att.file_size / 1024).toFixed(0)} KB` : ''}</p>
                  </div>
                </a>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(att.id)}
                  disabled={deletingAttachmentId === att.id}
                  className="absolute right-1.5 top-1.5 rounded-md border border-border bg-card/95 p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
                  aria-label={`Delete ${att.file_name}`}
                >
                  {deletingAttachmentId === att.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MetaRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex items-center gap-2 w-28 shrink-0 mt-0.5">
        <Icon size={13} className="text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

interface CommentItemProps {
  comment: CommentWithAuthor
  currentUserId: string
  canEdit: boolean
  canDelete: boolean
  editing: boolean
  editBody: string
  busy: boolean
  mentionCandidates: MentionableUser[]
  onEditBodyChange: (body: string) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onDelete: () => void
}

function CommentItem({
  comment, currentUserId, canEdit, canDelete, editing, editBody, busy,
  mentionCandidates, onEditBodyChange, onStartEdit, onCancelEdit, onSaveEdit, onDelete,
}: CommentItemProps) {
  return (
    <div className={cn(
      'flex gap-3',
      comment.is_internal && 'opacity-90'
    )}>
      <Avatar user={comment.author} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-xs font-semibold text-foreground">
            {getUserDisplayName(comment.author)}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatRelativeDate(comment.created_at)}
          </span>
          {comment.updated_at !== comment.created_at && <span className="text-[10px] text-muted-foreground">Edited</span>}
          {comment.is_internal && (
            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
              <Lock size={10} />
              Internal
            </span>
          )}
          {(canEdit || canDelete) && !editing && <span className="ml-auto flex items-center gap-1">
            {canEdit && <button type="button" onClick={onStartEdit} disabled={busy} aria-label="Edit comment" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"><PencilLine size={13} /></button>}
            {canDelete && <button type="button" onClick={onDelete} disabled={busy} aria-label="Delete comment" className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30"><Trash2 size={13} /></button>}
          </span>}
        </div>
        <div className={cn(
          'text-sm leading-relaxed rounded-xl px-3 py-2',
          comment.is_internal
            ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800'
            : 'bg-accent text-foreground'
        )}>
          {editing ? <div className="space-y-2">
            <MentionTextarea
              value={editBody}
              onChange={onEditBodyChange}
              candidates={mentionCandidates}
              onPick={() => {}}
              onSubmit={onSaveEdit}
              rows={3}
              disabled={busy}
              ariaLabel="Edit comment"
              className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onCancelEdit} disabled={busy} className="min-h-9 rounded-lg px-3 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50">Cancel</button>
              <button type="button" onClick={onSaveEdit} disabled={busy || !editBody.trim()} className="flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">{busy && <Loader2 size={13} className="animate-spin" />}Save</button>
            </div>
          </div> : <CommentBody body={comment.body} currentUserId={currentUserId} />}
          {(comment.attachments?.length ?? 0) > 0 && <div className="mt-2 flex flex-wrap gap-2">{comment.attachments?.map(attachment => <a key={attachment.id} href={normalizeAppAssetUrl(attachment.public_url ?? `/api/attachments/${attachment.id}`)} target="_blank" rel="noopener noreferrer" className="flex max-w-full items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground hover:border-primary/50">{PREVIEW_IMAGE_TYPES.has(attachment.file_type ?? '') ? <img src={normalizeAppAssetUrl(attachment.public_url ?? `/api/attachments/${attachment.id}`)} alt="" className="h-10 w-10 rounded object-cover" /> : <Paperclip size={14} className="shrink-0" />}<span className="max-w-[180px] truncate">{attachment.file_name}</span></a>)}</div>}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    new:         'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300',
    pending:     'bg-amber-100  text-amber-700  dark:bg-amber-950/50  dark:text-amber-300',
    in_progress: 'bg-blue-100   text-blue-700   dark:bg-blue-950/50   dark:text-blue-300',
    completed:   'bg-green-100  text-green-700  dark:bg-green-950/50  dark:text-green-300',
    archived:    'bg-gray-100   text-gray-600   dark:bg-gray-800      dark:text-gray-400',
  }
  const labels: Record<string, string> = {
    new: 'New', pending: 'Pending', in_progress: 'In Progress',
    completed: 'Completed', archived: 'Archived',
  }
  return (
    <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', colors[status] ?? colors.new)}>
      {labels[status] ?? status}
    </span>
  )
}
