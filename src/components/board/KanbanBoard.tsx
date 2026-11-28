'use client'

import Link from 'next/link'
import { useState, useCallback, useTransition, useRef, useDeferredValue, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  DndContext,
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCorners,
  pointerWithin,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { toast } from 'sonner'
import { Plus, Search, X, LayoutDashboard, List, CalendarDays, FolderOpen, Clock3, AlertTriangle, CheckCircle2, SlidersHorizontal } from 'lucide-react'
import { completeTask, deleteTask, getBoardSnapshot, moveTask, setTaskLocked } from '@/lib/actions/tasks'
import { cn, isTaskAssignedToUser, getCurrentDateInAppTimeZone, getAssignedUserIds, getUserDisplayName } from '@/lib/utils'
import { reportActionFailure, useBoardStream } from '@/lib/live/client'
import type { BoardSnapshot, ColumnWithTasks, TaskExpectation, TaskPresence, TaskWithRelations, SessionUser } from '@/lib/types'
import { taskDay, taskIsOverdue, taskDueLabel } from '@/lib/board-view'
import { Avatar } from '@/components/layout/AppNav'
import BoardColumn from './BoardColumn'
import TaskCard from './TaskCard'
import TaskDetailPanel from '../tasks/TaskDetailPanel'
import QuickAdd, { type QuickAddPerson } from './QuickAdd'
import AppSelect from '@/components/system/AppSelect'
import { mentionsToPlainText } from '../tasks/MentionTextarea'

interface Props {
  initialColumns: ColumnWithTasks[]
  currentUser:    SessionUser
  initialSeq?:    number
  /** People who can be assigned (same list as the New request form). */
  people?:        QuickAddPerson[]
}


function normalizeSearchValue(value: string) {
  const normalized = typeof value.normalize === 'function' ? value.normalize('NFKD') : value
  return normalized
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function stringifyCustomFields(customFields: Record<string, unknown>) {
  return Object.values(customFields)
    .flatMap((value) => {
      if (typeof value === 'string') return [value]
      if (typeof value === 'number') return [String(value)]
      if (Array.isArray(value)) {
        return value.flatMap((item) => {
          if (typeof item === 'string') return [item]
          if (typeof item === 'number') return [String(item)]
          if (item && typeof item === 'object') {
            return Object.values(item)
              .filter((nested): nested is string | number => typeof nested === 'string' || typeof nested === 'number')
              .map(String)
          }
          return []
        })
      }
      return []
    })
    .join(' ')
}

function getTaskSearchText(task: TaskWithRelations) {
  const assigneeNames = (task.assigned_to_profiles ?? [])
    .flatMap((profile) => [profile.full_name, profile.display_name, profile.email].filter(Boolean))
    .join(' ')
  return normalizeSearchValue([
    task.id,
    task.title,
    task.description,
    task.priority,
    task.status,
    task.submitted_by_profile?.full_name,
    task.submitted_by_profile?.display_name,
    task.submitted_by_profile?.email,
    assigneeNames,
    task.labels.join(' '),
    stringifyCustomFields(task.custom_fields),
    task.comments.map((comment) => mentionsToPlainText(comment.body)).join(' '),
    task.attachments.map((attachment) => attachment.file_name).join(' '),
  ].filter(Boolean).join(' '))
}

function getTaskSearchScore(task: TaskWithRelations, normalizedQuery: string, tokens: string[]) {
  const title = normalizeSearchValue(task.title)
  const description = normalizeSearchValue(task.description ?? '')
  const assignee = normalizeSearchValue((task.assigned_to_profiles ?? [])
    .map((profile) => profile.full_name ?? profile.display_name ?? profile.email ?? '')
    .join(' '))
  const submitter = normalizeSearchValue(task.submitted_by_profile?.full_name ?? task.submitted_by_profile?.email ?? '')
  const fullText = getTaskSearchText(task)

  if (!tokens.every((token) => fullText.includes(token))) {
    return -1
  }

  let score = 0
  if (title === normalizedQuery) score += 140
  if (title.includes(normalizedQuery)) score += 90
  if (description.includes(normalizedQuery)) score += 40
  if (assignee.includes(normalizedQuery)) score += 30
  if (submitter.includes(normalizedQuery)) score += 20

  for (const token of tokens) {
    if (title.includes(token)) score += 20
    if (description.includes(token)) score += 10
    if (assignee.includes(token)) score += 8
    if (submitter.includes(token)) score += 6
    if (fullText.includes(token)) score += 4
  }

  return score
}

export default function KanbanBoard({ initialColumns, currentUser, initialSeq = 0, people = [] }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [columns,      setColumns]      = useState<ColumnWithTasks[]>(initialColumns)
  const [activeTask,   setActiveTask]   = useState<TaskWithRelations | null>(null)
  const [selectedTask, setSelectedTask] = useState<TaskWithRelations | null>(null)
  const [searchQuery,  setSearchQuery]  = useState('')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [dueFilter, setDueFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [mobileColumnId, setMobileColumnId] = useState(initialColumns[0]?.id ?? '')
  const [isMobile, setIsMobile] = useState(false)
  const deferredSearchQuery             = useDeferredValue(searchQuery)
  const [isPending,    startTransition] = useTransition()
  const [swipeActionTaskId, setSwipeActionTaskId] = useState<string | null>(null)

  const [presence, setPresence] = useState<TaskPresence[]>([])

  // columnsRef keeps drag handlers reading current state without stale closures
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  // ─── Live updates ─────────────────────────────────────────────────────────
  // While the user is dragging or a save is in flight we hold incoming
  // snapshots, so the board never jumps under their cursor; we refresh as
  // soon as they're done.
  const dragOriginRef     = useRef<{ taskId: string; column_id: string; status: TaskWithRelations['status'] } | null>(null)
  const inFlightRef       = useRef(0)
  const refreshQueuedRef  = useRef(false)
  const refreshTimerRef   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastSeqRef        = useRef(initialSeq)
  const selectedIdRef     = useRef<string | null>(null)
  // Cards opened here, with the latest change they showed — the server may not have recorded the open yet.
  const openedLocallyRef  = useRef(new Map<string, string>())
  selectedIdRef.current   = selectedTask?.id ?? null

  const applySnapshot = useCallback((snapshot: BoardSnapshot) => {
    if (snapshot.seq < lastSeqRef.current) return // older than what we already show
    lastSeqRef.current = snapshot.seq
    // A card opened a moment ago may not be recorded on the server yet.
    const opened = openedLocallyRef.current
    setColumns(opened.size === 0 ? snapshot.columns : snapshot.columns.map(col => ({ ...col, tasks: col.tasks.map(task => task.fresh && opened.has(task.id) && (task.fresh_at ?? '') <= (opened.get(task.id) ?? '') ? { ...task, fresh: null } : task) })))
    setPresence(snapshot.presence)

    const openId = selectedIdRef.current
    if (!openId) return
    const fresh = snapshot.columns.flatMap((col) => col.tasks).find((task) => task.id === openId)
    if (fresh) {
      setSelectedTask(fresh)
    } else {
      setSelectedTask(null)
      router.replace('/dashboard', { scroll: false })
      toast.info('The card you had open was archived, deleted, or reassigned by someone else.', { duration: 7000 })
    }
  }, [router])

  const refreshBoard = useCallback(async () => {
    if (dragOriginRef.current || inFlightRef.current > 0) {
      refreshQueuedRef.current = true
      return
    }
    refreshQueuedRef.current = false
    try {
      const snapshot = await getBoardSnapshot()
      // A drag or save may have started while we were fetching.
      if (dragOriginRef.current || inFlightRef.current > 0) {
        refreshQueuedRef.current = true
        return
      }
      applySnapshot(snapshot)
    } catch {
      // Network blip: the stream will trigger another refresh.
    }
  }, [applySnapshot])

  const scheduleRefresh = useCallback((delay = 200) => {
    clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => { void refreshBoard() }, delay)
  }, [refreshBoard])

  /** Run a server write; holds live refreshes until it finishes, then resyncs. */
  const runWrite = useCallback(async <T,>(write: () => Promise<T>): Promise<T> => {
    inFlightRef.current += 1
    try {
      return await write()
    } finally {
      inFlightRef.current -= 1
      if (inFlightRef.current === 0) scheduleRefresh(0)
    }
  }, [scheduleRefresh])

  useBoardStream(() => scheduleRefresh())

  useEffect(() => () => clearTimeout(refreshTimerRef.current), [])

  // Other people only; one entry per person per card ("editing" wins over "viewing").
  const presenceByTask = new Map<string, TaskPresence[]>()
  const byTaskAndUser = new Map<string, TaskPresence>()
  for (const entry of presence) {
    if (entry.user_id === currentUser.id) continue
    const key = `${entry.task_id}:${entry.user_id}`
    if (byTaskAndUser.get(key)?.mode !== 'editing') byTaskAndUser.set(key, entry)
  }
  for (const entry of Array.from(byTaskAndUser.values())) {
    presenceByTask.set(entry.task_id, [...(presenceByTask.get(entry.task_id) ?? []), entry])
  }

  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'super_admin'

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 250, tolerance: 5 } })
  )

  const collisionDetectionStrategy: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args)
    return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args)
  }

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 639px)')
    const sync = () => setIsMobile(mediaQuery.matches)
    sync()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', sync)
      return () => mediaQuery.removeEventListener('change', sync)
    }

    mediaQuery.addListener(sync)
    return () => mediaQuery.removeListener(sync)
  }, [])

  // ─── Search filter ────────────────────────────────────────────────────────
  const normalizedQuery = normalizeSearchValue(deferredSearchQuery.trim())
  const searchTokens = normalizedQuery.split(/\s+/).filter(Boolean)

  const mine = searchParams.get('scope') === 'mine'
  const requestedView = searchParams.get('view')
  const view = requestedView === 'calendar' ? 'calendar' : requestedView === 'list' || (!requestedView && isMobile) ? 'list' : 'board'
  const today = getCurrentDateInAppTimeZone()
  const allTasks = columns.flatMap(column => column.tasks)
  const scopeTasks = allTasks.filter(task => !mine || task.submitted_by === currentUser.id || isTaskAssignedToUser(task, currentUser.id))
  const weekStart = new Date(`${today}T12:00:00Z`)
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7))
  const weekStartDay = weekStart.toISOString().slice(0, 10)
  const stats = {
    open: scopeTasks.filter(task => task.status !== 'completed').length,
    today: scopeTasks.filter(task => task.status !== 'completed' && task.has_real_due_date && taskDay(task.due_date) === today).length,
    overdue: scopeTasks.filter(task => taskIsOverdue(task, today)).length,
    completed: scopeTasks.filter(task => task.status === 'completed' && taskDay(task.completed_at) >= weekStartDay && taskDay(task.completed_at) <= today).length,
  }
  const assigneeOptions = Array.from(new Map(allTasks.flatMap(task => task.assigned_to_profiles ?? []).map(user => [user.id, user])).values())
  const filteredColumns = columns.map(col => ({
    ...col,
    tasks: col.tasks.filter(task => {
      if (mine && task.submitted_by !== currentUser.id && !isTaskAssignedToUser(task, currentUser.id)) return false
      if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false
      const assigned = getAssignedUserIds(task)
      if (assigneeFilter === 'unassigned' ? assigned.length > 0 : assigneeFilter !== 'all' && !assigned.includes(assigneeFilter)) return false
      if (statusFilter === 'open' && task.status === 'completed') return false
      if (statusFilter === 'completed' && (task.status !== 'completed' || taskDay(task.completed_at) < weekStartDay || taskDay(task.completed_at) > today)) return false
      if (dueFilter === 'overdue' && !taskIsOverdue(task, today)) return false
      if (dueFilter === 'today' && (!task.has_real_due_date || taskDay(task.due_date) !== today || task.status === 'completed')) return false
      if (dueFilter === 'upcoming' && (!task.has_real_due_date || taskDay(task.due_date) <= today || task.status === 'completed')) return false
      return !searchTokens.length || getTaskSearchScore(task, normalizedQuery, searchTokens) >= 0
    }).sort((a, b) => searchTokens.length ? getTaskSearchScore(b, normalizedQuery, searchTokens) - getTaskSearchScore(a, normalizedQuery, searchTokens) || a.position - b.position : a.position - b.position),
  }))
  const visibleTasks = filteredColumns.flatMap(column => column.tasks).sort((a, b) => {
    if (a.status === 'completed' && b.status !== 'completed') return 1
    if (b.status === 'completed' && a.status !== 'completed') return -1
    return (a.has_real_due_date ? taskDay(a.due_date) || '9999' : '9999').localeCompare(b.has_real_due_date ? taskDay(b.due_date) || '9999' : '9999')
  })
  const totalMatches = visibleTasks.length
  const hasFilters = Boolean(searchQuery || priorityFilter !== 'all' || assigneeFilter !== 'all' || dueFilter !== 'all' || statusFilter !== 'all')
  const visibleMobileColumnId = filteredColumns.find(column => column.id === mobileColumnId)?.id ?? filteredColumns[0]?.id ?? ''
  const calendarGroups = new Map<string, TaskWithRelations[]>()
  for (const task of [...visibleTasks].sort((a, b) => (taskDay(a.due_date) || '9999').localeCompare(taskDay(b.due_date) || '9999'))) {
    const day = task.has_real_due_date ? taskDay(task.due_date) : ''
    calendarGroups.set(day, [...(calendarGroups.get(day) ?? []), task])
  }
  function changeView(nextView: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', nextView)
    router.replace(`/dashboard?${params}`, { scroll: false })
  }
  const dashboardUrl = useCallback((taskId?: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (taskId) params.set('task', taskId)
    else params.delete('task')
    return `/dashboard${params.size ? `?${params}` : ''}`
  }, [searchParams])
  function resetFilters() {
    setSearchQuery(''); setPriorityFilter('all'); setAssigneeFilter('all'); setDueFilter('all'); setStatusFilter('all')
  }

  const deepLinkedTaskId = searchParams.get('task')

  // ─── Helpers (read from ref so drag handlers always see current state) ───
  function findTaskColumnId(taskId: string): string | null {
    for (const col of columnsRef.current) {
      if (col.tasks.some(t => t.id === taskId)) return col.id
    }
    return null
  }

  function findColumnId(id: string): string | null {
    return columnsRef.current.find(c => c.id === id)?.id ?? null
  }

  function findTask(taskId: string): TaskWithRelations | null {
    for (const col of columnsRef.current) {
      const t = col.tasks.find(t => t.id === taskId)
      if (t) return t
    }
    return null
  }

  function canMoveTask(task: TaskWithRelations | null) {
    if (!task) return false
    if (isAdmin) return true
    return task.submitted_by === currentUser.id || isTaskAssignedToUser(task, currentUser.id)
  }

  useEffect(() => {
    if (!deepLinkedTaskId) return
    const task = findTask(deepLinkedTaskId)
    if (!task) return
    setSelectedTask(task)
    setMobileColumnId(task.column_id)
  }, [deepLinkedTaskId, columns])

  // ─── Drag start ───────────────────────────────────────────────────────────
  function handleDragStart(event: DragStartEvent) {
    const task = findTask(event.active.id as string)
    if (!task || !canMoveTask(task)) return
    dragOriginRef.current = { taskId: task.id, column_id: task.column_id, status: task.status }
    setActiveTask(task)
  }

  function handleDragCancel() {
    dragOriginRef.current = null
    setActiveTask(null)
    if (refreshQueuedRef.current) scheduleRefresh(0)
  }

  // ─── Drag over (live column preview) ─────────────────────────────────────
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return

    const activeTaskId = active.id as string
    const overId       = over.id   as string
    const activeTask = findTask(activeTaskId)
    if (!canMoveTask(activeTask)) return

    const activeColId =
      (active.data.current?.sortable?.containerId as string | undefined) ??
      findTaskColumnId(activeTaskId)
    const overColId =
      (over.data.current?.sortable?.containerId as string | undefined) ??
      findColumnId(overId) ??
      findTaskColumnId(overId)

    // Avoid mutating cross-column state during hover; it causes intermittent
    // card identity drift on some clients. We commit cross-column moves on drop.
    if (!activeColId || !overColId || activeColId !== overColId) return

    setColumns(prev => {
      const activeCol = prev.find(c => c.id === activeColId)
      const overCol   = prev.find(c => c.id === overColId)
      if (!activeCol || !overCol) return prev

      const task = activeCol.tasks.find(t => t.id === activeTaskId)
      if (!task) return prev

      const overTaskIndex = overCol.tasks.findIndex(t => t.id === overId)
      const insertAt      = overTaskIndex >= 0 ? overTaskIndex : overCol.tasks.length

      return prev.map(col => {
        if (col.id === activeColId) {
          return { ...col, tasks: col.tasks.filter(t => t.id !== activeTaskId) }
        }
        if (col.id === overColId) {
          const newTasks = [...col.tasks]
          newTasks.splice(insertAt, 0, { ...task, column_id: overColId })
          return { ...col, tasks: newTasks }
        }
        return col
      })
    })
  }

  // ─── Drag end (persist) ───────────────────────────────────────────────────
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    const origin = dragOriginRef.current
    dragOriginRef.current = null
    // Apply any updates that arrived mid-drag. If a save starts below, the
    // refresh waits for it (runWrite) so the card doesn't flicker back.
    if (refreshQueuedRef.current) scheduleRefresh(300)
    if (!over) {
      setActiveTask(null)
      return
    }

    const activeTaskId = active.id as string
    const overId       = over.id   as string
    const activeTask = findTask(activeTaskId)
    if (!canMoveTask(activeTask)) return
    const movingTask = activeTask
    setActiveTask(null)

    const currentCols  = columnsRef.current
    const activeColId =
      (active.data.current?.sortable?.containerId as string | undefined) ??
      findTaskColumnId(activeTaskId)
    const overColId =
      (over.data.current?.sortable?.containerId as string | undefined) ??
      findColumnId(overId) ??
      findTaskColumnId(overId)

    if (!activeColId || !overColId) return

    let nextCols = currentCols

    if (activeColId === overColId) {
      nextCols = currentCols.map(col => {
        if (col.id !== activeColId) return col
        const oldIdx = col.tasks.findIndex(t => t.id === activeTaskId)
        const newIdx = col.tasks.findIndex(t => t.id === overId)
        if (oldIdx < 0) return col
        if (newIdx < 0) {
          // Dropped on empty area of same column: move card to end.
          const moving = col.tasks[oldIdx]
          const remaining = col.tasks.filter(t => t.id !== activeTaskId)
          return { ...col, tasks: [...remaining, moving] }
        }
        if (oldIdx === newIdx) return col
        return { ...col, tasks: arrayMove(col.tasks, oldIdx, newIdx) }
      })
      setColumns(nextCols)
    } else {
      // Ensure cross-column drops are committed from the final drop target.
      // Relying only on onDragOver state can be flaky when drag-over events are sparse.
      nextCols = currentCols.map(col => {
        if (col.id === activeColId) {
          return { ...col, tasks: col.tasks.filter(t => t.id !== activeTaskId) }
        }
        if (col.id === overColId) {
          if (!movingTask) return col

          const overTaskIndex = col.tasks.findIndex(t => t.id === overId)
          const insertAt = overTaskIndex >= 0 ? overTaskIndex : col.tasks.length
          const newTasks = [...col.tasks]
          newTasks.splice(insertAt, 0, { ...movingTask, column_id: overColId })
          return { ...col, tasks: newTasks }
        }
        return col
      })
      setColumns(nextCols)
    }

    // Calculate position from the final local state that matches the UI.
    const targetCol = nextCols.find(c => c.id === overColId)
    if (!targetCol) return

    const taskIdx     = targetCol.tasks.findIndex(t => t.id === activeTaskId)
    if (taskIdx < 0) return
    const prevTask    = targetCol.tasks[taskIdx - 1]
    const nextTask    = targetCol.tasks[taskIdx + 1]
    const newPosition =
      prevTask && nextTask ? (prevTask.position + nextTask.position) / 2
      : prevTask           ? prevTask.position + 1000
      : nextTask           ? nextTask.position - 1000
      : 1000

    // Only conflict if someone else moved / completed / archived this card
    // since the drag started — edits to its text don't block a move.
    const expected: TaskExpectation | undefined = origin && origin.taskId === activeTaskId
      ? { column_id: origin.column_id, status: origin.status }
      : undefined

    startTransition(async () => {
      const result = await runWrite(() => moveTask({
        task_id:       activeTaskId,
        new_column_id: overColId,
        new_position:  newPosition,
      }, expected))
      if (!result.success) {
        reportActionFailure(result, 'Failed to save card position.')
      }
    })
  }

  const handleTaskClick = useCallback((task: TaskWithRelations) => {
    if (task.fresh) {
      openedLocallyRef.current.set(task.id, task.fresh_at ?? '')
      setColumns(prev => prev.map(col => ({ ...col, tasks: col.tasks.map(item => item.id === task.id ? { ...item, fresh: null } : item) })))
    }
    setSelectedTask(task)
    router.replace(`/dashboard?task=${encodeURIComponent(task.id)}`, { scroll: false })
  }, [router])

  const handleTaskUpdate = useCallback((updatedTask: TaskWithRelations) => {
    setColumns(prev => {
      const withoutTask = prev.map(col => ({
        ...col,
        tasks: col.tasks.filter(t => t.id !== updatedTask.id),
      }))

      return withoutTask.map(col => {
        if (col.id !== updatedTask.column_id) return col

        const nextTasks = [...col.tasks, updatedTask]
          .sort((a, b) => a.position - b.position)

        return { ...col, tasks: nextTasks }
      })
    })
    setSelectedTask(updatedTask)
  }, [])

  const handleTaskRemove = useCallback((taskId: string) => {
    setColumns(prev => prev.map(col => ({
      ...col,
      tasks: col.tasks.filter(t => t.id !== taskId),
    })))
    setSelectedTask(null)
    router.replace('/dashboard', { scroll: false })
  }, [])

  async function handleSwipeComplete(task: TaskWithRelations) {
    if (swipeActionTaskId || task.status === 'completed' || !canMoveTask(task)) return
    setSwipeActionTaskId(task.id)
    try {
      const result = await runWrite(() => completeTask(task.id, { column_id: task.column_id, status: task.status }))
      if (!result.success) {
        reportActionFailure(result, 'Failed to complete task.')
        return
      }
      toast.success('Task marked as completed')
      await refreshBoard()
    } finally {
      setSwipeActionTaskId(null)
    }
  }

  async function handleSwipeDelete(task: TaskWithRelations) {
    if (swipeActionTaskId || !canMoveTask(task) || task.custom_fields?.locked === true) return
    if (!window.confirm(`Permanently delete “${task.title}”? This cannot be undone.`)) return
    setSwipeActionTaskId(task.id)
    try {
      const result = await runWrite(() => deleteTask(task.id, { version: task.version }))
      if (!result.success) {
        reportActionFailure(result, 'Failed to delete task.')
        return
      }
      setColumns(prev => prev.map(column => ({ ...column, tasks: column.tasks.filter(item => item.id !== task.id) })))
      toast.success('Task permanently deleted')
    } finally {
      setSwipeActionTaskId(null)
    }
  }

  const [lockingTaskId, setLockingTaskId] = useState<string | null>(null)
  async function handleToggleLock(task: TaskWithRelations) {
    if (!isAdmin || lockingTaskId) return
    const locking = task.custom_fields?.locked !== true
    setLockingTaskId(task.id)
    try {
      const result = await runWrite(() => setTaskLocked(task.id, locking, { version: task.version }))
      if (!result.success) {
        reportActionFailure(result, locking ? 'Failed to lock card.' : 'Failed to unlock card.')
        return
      }
      const saved = result.data
      setColumns(prev => prev.map(column => ({ ...column, tasks: column.tasks.map(item => item.id === task.id ? { ...item, custom_fields: saved.custom_fields, version: saved.version, updated_by: saved.updated_by, updated_at: saved.updated_at } : item) })))
      toast.success(locking ? 'Card locked' : 'Card unlocked')
    } finally {
      setLockingTaskId(null)
    }
  }

  function getLockAction(task: TaskWithRelations) {
    if (!isAdmin) return undefined
    return { onToggleLock: () => { void handleToggleLock(task) }, busy: lockingTaskId === task.id }
  }

  function getSwipeActions(task: TaskWithRelations) {
    const locked = task.custom_fields?.locked === true
    // Locked cards can still be marked complete; they just can't be edited or deleted.
    const onComplete = task.status !== 'completed' && canMoveTask(task)
      ? () => { void handleSwipeComplete(task) }
      : undefined
    const onDelete = !locked && canMoveTask(task)
      ? () => { void handleSwipeDelete(task) }
      : undefined
    return { onComplete, onDelete, busy: swipeActionTaskId === task.id }
  }

  const handleTaskMove = useCallback(async (taskId: string, columnId: string) => {
    const currentCols = columnsRef.current
    const sourceCol = currentCols.find((col) => col.tasks.some((task) => task.id === taskId))
    const destinationCol = currentCols.find((col) => col.id === columnId)
    const task = sourceCol?.tasks.find((item) => item.id === taskId)

    if (!sourceCol || !destinationCol || !task) {
      throw new Error('Task or column not found')
    }
    if (!canMoveTask(task)) {
      throw new Error('You do not have permission to move this task')
    }
    if (destinationCol.is_archive) {
      throw new Error('Use the archive action to archive tasks.')
    }

    const expected: TaskExpectation = { column_id: task.column_id, status: task.status }
    const lastTask = destinationCol.tasks[destinationCol.tasks.length - 1]
    const newPosition = lastTask ? lastTask.position + 1000 : 1000

    const destinationName = destinationCol.name.toLowerCase()
    let nextStatus = task.status
    if (destinationCol.is_default) nextStatus = 'new'
    else if (destinationName === 'pending') nextStatus = 'pending'
    else if (destinationName.includes('progress')) nextStatus = 'in_progress'
    else if (destinationName.includes('complet')) nextStatus = 'completed'
    else if (destinationCol.is_archive) nextStatus = 'archived'

    const completedAt =
      nextStatus === 'completed'
        ? task.completed_at ?? new Date().toISOString()
        : null

    setColumns((prev) => prev.map((col) => {
      if (col.id === sourceCol.id) {
        return { ...col, tasks: col.tasks.filter((item) => item.id !== taskId) }
      }

      if (col.id === destinationCol.id) {
        const movedTask = {
          ...task,
          column_id: destinationCol.id,
          column: destinationCol,
          position: newPosition,
          status: nextStatus,
          completed_at: completedAt,
        }

        return {
          ...col,
          tasks: [...col.tasks, movedTask].sort((a, b) => a.position - b.position),
        }
      }

      return col
    }))

    const movedTask: TaskWithRelations = {
      ...task,
      column_id: destinationCol.id,
      column: destinationCol,
      position: newPosition,
      status: nextStatus,
      completed_at: completedAt,
    }
    setSelectedTask(movedTask)

    const result = await runWrite(() => moveTask({
      task_id: taskId,
      new_column_id: columnId,
      new_position: newPosition,
    }, expected))

    if (!result.success) {
      reportActionFailure(result, 'Failed to move task.')
      // Thrown so the panel resets its column picker; the toast already explains.
      throw Object.assign(new Error(result.error), { reported: true })
    }
  }, [runWrite])

  return (
    <div className={cn('flex min-w-0 flex-1 flex-col px-4 pt-4 sm:px-7 lg:pt-5', view === 'board' && totalMatches > 0 && 'lg:h-dvh lg:flex-none lg:overflow-hidden')}>
      <div className="relative mb-4 overflow-hidden rounded-2xl bg-gradient-to-br from-[#203a70] via-[#284b85] to-[#3979a8] px-4 py-3 text-white shadow-md shadow-[#1f3154]/15 sm:px-6 sm:py-3.5">
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-24 h-48 w-48 rounded-full border-[32px] border-white/[0.05]" />
        <div className="relative flex items-center justify-between gap-4"><div className="min-w-0"><p className="hidden text-[10px] font-bold uppercase tracking-[0.2em] text-[#c7d9ee] sm:block">Golden Stone Works / Workspace</p><h1 className="flex items-baseline gap-3 text-xl font-semibold tracking-tight sm:text-2xl"><span className="truncate">{mine ? 'My tasks' : view === 'calendar' ? 'Calendar' : 'Team board'}</span><span className="hidden truncate text-sm font-normal text-white/70 md:inline">{mine ? 'Your work, all in one place.' : view === 'calendar' ? 'A clear look at what’s coming next.' : 'Good work starts with a clear plan.'}</span></h1></div>
        <Link href="/submit" className="flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-white px-3.5 text-sm font-semibold text-[#1f3154] shadow-sm transition-colors hover:bg-blue-50 sm:px-4"><Plus size={17} />New task</Link></div>
      </div>
      <div className="mb-4 grid grid-cols-4 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
        {[
          { label: 'Open', value: stats.open, icon: FolderOpen, color: 'text-primary', selected: statusFilter === 'open' && dueFilter === 'all', action: () => { setStatusFilter('open'); setDueFilter('all') } },
          { label: 'Due today', short: 'Today', value: stats.today, icon: Clock3, color: 'text-blue-600 dark:text-blue-400', selected: dueFilter === 'today', action: () => { setDueFilter('today'); setStatusFilter('all') } },
          { label: 'Overdue', value: stats.overdue, icon: AlertTriangle, color: 'text-amber-700 dark:text-amber-400', selected: dueFilter === 'overdue', action: () => { setDueFilter('overdue'); setStatusFilter('all') } },
          { label: 'Completed this week', short: 'Done', value: stats.completed, icon: CheckCircle2, color: 'text-emerald-700 dark:text-emerald-400', selected: statusFilter === 'completed', action: () => { setStatusFilter('completed'); setDueFilter('all') } },
        ].map(({ label, short, value, icon: Icon, color, selected, action }: { label: string; short?: string; value: number; icon: typeof FolderOpen; color: string; selected: boolean; action: () => void }, index) => <button key={label} type="button" onClick={action} aria-pressed={selected} aria-label={`${label}: ${value}`} className={cn('group flex items-center justify-between gap-2 rounded-xl border bg-gradient-to-br px-2.5 py-2 text-left sm:px-3.5 shadow-[0_4px_12px_-8px_rgba(35,67,115,0.25)] transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_22px_-9px_rgba(35,67,115,0.32)] dark:border-border dark:from-slate-800 dark:to-slate-900 sm:px-4 sm:py-3', index === 0 ? 'border-indigo-200 from-white via-indigo-50 to-indigo-100' : index === 1 ? 'border-blue-200 from-white via-blue-50 to-sky-100' : index === 2 ? 'border-amber-200 from-white via-amber-50 to-amber-100' : 'border-emerald-200 from-white via-emerald-50 to-teal-100', selected && 'ring-2 ring-primary/50')}><span className="min-w-0"><span className="block truncate text-[11px] font-medium text-muted-foreground sm:text-xs"><span className="sm:hidden">{short ?? label}</span><span className="hidden sm:inline">{label}</span></span><span className="block text-xl font-semibold leading-tight tracking-tight tabular-nums sm:text-2xl">{value}</span></span><span className={cn('hidden shrink-0 rounded-lg bg-white/80 p-2 shadow-sm dark:bg-white/10 sm:block', color)}><Icon size={17} strokeWidth={1.8} /></span></button>)}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1 sm:max-w-md"><Search size={17} className="absolute left-3 top-3 text-muted-foreground" /><input aria-label="Search tasks" type="search" placeholder="Search tasks, people, or notes" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-9 text-sm placeholder:text-muted-foreground focus:border-primary" />{searchQuery && <button aria-label="Clear search" onClick={() => setSearchQuery('')} className="absolute right-1 top-1 flex h-9 w-8 items-center justify-center text-muted-foreground"><X size={15} /></button>}</div>
        <QuickAdd people={people} currentUserId={currentUser.id} isAdmin={currentUser.role === 'admin' || currentUser.role === 'super_admin'} onCreated={() => { void refreshBoard() }} />
        <div aria-label="View" className="flex h-11 coarse:h-auto rounded-xl border border-border bg-card p-1 sm:order-last sm:ml-auto">{[{ key: 'board', label: 'Board', icon: LayoutDashboard }, { key: 'list', label: 'List', icon: List }, { key: 'calendar', label: 'Calendar', icon: CalendarDays }].map(({ key, label, icon: Icon }) => <button key={key} aria-label={`${label} view`} aria-pressed={view === key} onClick={() => changeView(key)} className={cn('flex items-center gap-1.5 rounded-lg px-2.5 coarse:h-10 coarse:min-w-11 coarse:justify-center text-xs font-medium', view === key ? 'bg-blue-100/70 text-primary dark:bg-primary/15' : 'text-muted-foreground hover:bg-accent/40')}><Icon size={15} /><span className="hidden xl:inline">{label}</span></button>)}</div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <AppSelect ariaLabel="Filter by assignee" value={assigneeFilter} onValueChange={setAssigneeFilter} options={[{ value: 'all', label: 'All assignees' }, { value: 'unassigned', label: 'Unassigned' }, ...assigneeOptions.map(user => ({ value: user.id, label: getUserDisplayName(user) }))]} className="h-11 min-w-0 flex-1 text-xs sm:max-w-[150px]" />
          <AppSelect ariaLabel="Filter by priority" value={priorityFilter} onValueChange={setPriorityFilter} options={[{ value: 'all', label: 'All priorities' }, ...['urgent', 'high', 'normal', 'low'].map(priority => ({ value: priority, label: priority[0].toUpperCase() + priority.slice(1) }))]} className="h-11 min-w-0 flex-1 text-xs sm:max-w-[130px]" />
          <AppSelect ariaLabel="Filter by due date" value={dueFilter} onValueChange={value => { setDueFilter(value); setStatusFilter('all') }} options={[{ value: 'all', label: 'Any due date' }, { value: 'today', label: 'Today' }, { value: 'overdue', label: 'Overdue' }, { value: 'upcoming', label: 'Upcoming' }]} className="hidden h-11 text-xs sm:inline-flex" />
        </div>
      </div>
      <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex gap-1 sm:hidden">{[{ key: 'all', label: 'All' }, { key: 'today', label: 'Today' }, { key: 'upcoming', label: 'Upcoming' }, { key: 'overdue', label: 'Overdue' }].map(({ key, label }) => <button key={key} onClick={() => { setDueFilter(key); setStatusFilter('all') }} aria-pressed={dueFilter === key} className={cn('min-h-10 min-w-11 rounded-lg px-3 font-medium', dueFilter === key ? 'bg-primary/10 text-primary' : 'hover:bg-accent/40')}>{label}</button>)}</div>
        <span aria-live="polite" className="hidden sm:inline">{totalMatches} task{totalMatches === 1 ? '' : 's'}{hasFilters ? ' matching your filters' : ' in this view'}</span>
        {hasFilters && <button onClick={resetFilters} className="flex min-h-9 items-center gap-1.5 rounded-lg px-2 hover:bg-accent/50"><X size={13} />Clear filters</button>}
        {isAdmin && <Link href="/admin/columns" className="ml-auto hidden min-h-9 coarse:min-h-11 items-center gap-1.5 rounded-lg px-2 hover:bg-accent/50 sm:flex"><SlidersHorizontal size={14} />Manage columns</Link>}
      </div>
      {totalMatches === 0 ? <div className="my-8 flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center"><CheckSquareIcon /><h2 className="mt-4 text-lg font-semibold">{hasFilters ? 'No tasks match these filters' : 'A little breathing room'}</h2><p className="mt-2 max-w-sm text-sm text-muted-foreground">{hasFilters ? 'Try another search or clear your filters to see more work.' : mine ? 'Tasks you create or are assigned to will appear here.' : 'Create a task to get your team’s next job moving.'}</p>{hasFilters ? <button onClick={resetFilters} className="mt-5 min-h-11 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground">Clear filters</button> : <Link href="/submit" className="mt-5 min-h-11 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground">Create a task</Link>}</div> : view === 'board' ? <>
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1 sm:hidden">{filteredColumns.map(column => <button key={column.id} onClick={() => setMobileColumnId(column.id)} className={cn('min-h-11 shrink-0 rounded-xl border px-4 text-xs font-semibold', visibleMobileColumnId === column.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card')}>{column.name} ({column.tasks.length})</button>)}</div>
        <div className="min-h-[350px] flex-1 overflow-x-auto pb-3 lg:min-h-0 board-scroll"><DndContext sensors={isMobile ? [] : sensors} collisionDetection={collisionDetectionStrategy} onDragStart={isMobile ? undefined : handleDragStart} onDragEnd={isMobile ? undefined : handleDragEnd} onDragCancel={handleDragCancel}>
          {isMobile ? <div className="flex h-full">{filteredColumns.filter(column => column.id === visibleMobileColumnId).map(column => <BoardColumn key={column.id} column={column} currentUser={currentUser} onTaskClick={handleTaskClick} presenceByTask={presenceByTask} getSwipeActions={getSwipeActions} getLockAction={getLockAction} />)}</div> :
          <div className="flex h-full min-w-max gap-4 xl:min-w-0">{filteredColumns.map(column => <BoardColumn key={column.id} column={column} currentUser={currentUser} onTaskClick={handleTaskClick} presenceByTask={presenceByTask} getLockAction={getLockAction} />)}</div>}
          <DragOverlay dropAnimation={{ duration: 150, easing: 'ease-out' }}>{!isMobile && activeTask && <TaskCard task={activeTask} currentUser={currentUser} isDragging />}</DragOverlay>
        </DndContext></div>
      </> : view === 'calendar' ? <div className="space-y-5 pb-6">{Array.from(calendarGroups, ([day, tasks]) => <section key={day || 'undated'} className="rounded-2xl border border-border bg-card p-4 sm:p-5"><h2 className="mb-4 flex items-center gap-2 text-sm font-semibold"><CalendarDays size={17} className="text-primary" />{day ? `${day === today ? 'Today · ' : ''}${new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))}` : 'No due date'}<span className="ml-auto text-xs font-normal text-muted-foreground">{tasks.length} task{tasks.length === 1 ? '' : 's'}</span></h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{tasks.map(task => <TaskCard key={task.id} task={task} currentUser={currentUser} draggable={false} onClick={() => handleTaskClick(task)} swipeActions={isMobile ? getSwipeActions(task) : undefined} onToggleLock={getLockAction(task)?.onToggleLock} lockBusy={lockingTaskId === task.id} />)}</div></section>)}</div> : <>
        <div className="space-y-3 pb-5 sm:hidden">{visibleTasks.map(task => <TaskCard key={task.id} task={task} currentUser={currentUser} draggable={false} onClick={() => handleTaskClick(task)} swipeActions={getSwipeActions(task)} onToggleLock={getLockAction(task)?.onToggleLock} lockBusy={lockingTaskId === task.id} />)}</div>
        <div className="mb-6 hidden overflow-hidden rounded-2xl border border-border bg-card sm:block"><div className="grid grid-cols-[minmax(0,1fr)_130px_150px_100px] gap-4 border-b border-border bg-muted/30 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><span>Task</span><span>Assignee</span><span>Due date</span><span>Priority</span></div>{visibleTasks.map(task => <button key={task.id} onClick={() => handleTaskClick(task)} className="grid min-h-[78px] w-full grid-cols-[minmax(0,1fr)_130px_150px_100px] items-center gap-4 border-b border-border/60 px-5 py-4 text-left last:border-0 hover:bg-accent/25"><span className="min-w-0"><span className="flex items-center gap-2 truncate text-sm font-semibold">{task.fresh && <span aria-label={task.fresh === 'new' ? 'New' : 'Updated'} className={cn('h-2 w-2 shrink-0 animate-pulse rounded-full', task.fresh === 'new' ? 'bg-primary' : 'bg-amber-500')} />}<span className="truncate">{task.title}</span></span><span className="mt-1 block text-xs text-muted-foreground">{task.column.name}</span></span><span className="flex min-w-0 items-center gap-2 text-xs">{task.assigned_to_profile ? <><Avatar user={task.assigned_to_profile} size="sm" /><span className="truncate">{getUserDisplayName(task.assigned_to_profile)}</span></> : 'Unassigned'}</span><span className={cn('text-xs', taskIsOverdue(task, today) ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>{task.status === 'completed' ? 'Completed' : `${taskIsOverdue(task, today) ? 'Overdue · ' : ''}${taskDueLabel(task, today)}`}</span><span className={`priority-${task.priority} w-fit rounded-md px-2 py-1 text-[10px] capitalize`}>{task.priority}</span></button>)}</div>
      </>}
      <footer className="mt-auto flex items-center gap-2 border-t border-border/60 py-4 text-[11px] lg:py-2.5 text-muted-foreground"><CheckCircle2 size={14} className="text-emerald-600" />{isPending ? 'Saving move…' : 'Open a task for details, files, and updates.'}</footer>
      {selectedTask && <TaskDetailPanel task={selectedTask} currentUser={currentUser} columns={columns.map(({ tasks: _tasks, ...column }) => column)} onClose={() => { setSelectedTask(null); router.replace(dashboardUrl(), { scroll: false }) }} onUpdate={handleTaskUpdate} onRemove={handleTaskRemove} onMove={handleTaskMove} presence={presenceByTask.get(selectedTask.id) ?? []} runWrite={runWrite} onRefresh={refreshBoard} />}
    </div>
  )
}

function CheckSquareIcon() { return <FolderOpen size={30} strokeWidth={1.4} className="text-primary/50" /> }
