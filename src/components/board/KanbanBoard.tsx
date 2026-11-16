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
import { Plus, Search, X } from 'lucide-react'
import { getBoardSnapshot, moveTask } from '@/lib/actions/tasks'
import { cn, isTaskAssignedToUser } from '@/lib/utils'
import { reportActionFailure, useBoardStream } from '@/lib/live/client'
import type { BoardSnapshot, ColumnWithTasks, TaskExpectation, TaskPresence, TaskWithRelations, SessionUser } from '@/lib/types'
import BoardColumn from './BoardColumn'
import TaskCard from './TaskCard'
import TaskDetailPanel from '../tasks/TaskDetailPanel'

interface Props {
  initialColumns: ColumnWithTasks[]
  currentUser:    SessionUser
  initialSeq?:    number
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
    task.comments.map((comment) => comment.body).join(' '),
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

export default function KanbanBoard({ initialColumns, currentUser, initialSeq = 0 }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [columns,      setColumns]      = useState<ColumnWithTasks[]>(initialColumns)
  const [activeTask,   setActiveTask]   = useState<TaskWithRelations | null>(null)
  const [selectedTask, setSelectedTask] = useState<TaskWithRelations | null>(null)
  const [searchQuery,  setSearchQuery]  = useState('')
  const [mobileColumnId, setMobileColumnId] = useState(initialColumns[0]?.id ?? '')
  const [isMobile, setIsMobile] = useState(false)
  const deferredSearchQuery             = useDeferredValue(searchQuery)
  const [isPending,    startTransition] = useTransition()

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
  selectedIdRef.current   = selectedTask?.id ?? null

  const applySnapshot = useCallback((snapshot: BoardSnapshot) => {
    if (snapshot.seq < lastSeqRef.current) return // older than what we already show
    lastSeqRef.current = snapshot.seq
    setColumns(snapshot.columns)
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

  const filteredColumns = columns.map((col) => {
    if (!searchTokens.length) {
      return { ...col, tasks: col.tasks }
    }

    return {
      ...col,
      tasks: col.tasks
        .map((task) => ({ task, score: getTaskSearchScore(task, normalizedQuery, searchTokens) }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => b.score - a.score || a.task.position - b.task.position)
        .map((entry) => entry.task),
    }
  })

  const totalMatches = filteredColumns.reduce((count, column) => count + column.tasks.length, 0)
  const visibleMobileColumnId =
    filteredColumns.find((column) => column.id === mobileColumnId)?.id ??
    filteredColumns[0]?.id ??
    ''
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
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Board toolbar */}
      <div className="flex items-center gap-2 px-3 sm:px-5 py-2 border-b border-border/60 bg-background/80 backdrop-blur-sm shrink-0">
        <div className="relative flex-1 max-w-[260px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
          <input
            type="text"
            inputMode="search"
            placeholder="Search tasks, people, notes…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className={cn(
              'w-full h-7 pl-7 pr-8 rounded-lg border border-input/60 bg-card/60',
              'text-xs placeholder:text-muted-foreground/40',
              'focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/30 transition-colors'
            )}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 transition-colors hover:text-foreground"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {searchTokens.length > 0 && (
          <div className="hidden sm:block text-[11px] text-muted-foreground">
            {totalMatches} result{totalMatches === 1 ? '' : 's'}
          </div>
        )}

      </div>

      <div className="sm:hidden border-b border-border/50 bg-background/90 px-3 py-2">
        <div className="flex gap-2 overflow-x-auto board-scroll">
          {filteredColumns.map((column) => (
            <button
              key={column.id}
              type="button"
              onClick={() => setMobileColumnId(column.id)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                visibleMobileColumnId === column.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground'
              )}
            >
              {column.name} ({column.tasks.length})
            </button>
          ))}
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-y-hidden sm:overflow-x-auto board-scroll" style={{ WebkitOverflowScrolling: "touch" }}>
        <DndContext
          sensors={isMobile ? [] : sensors}
          collisionDetection={collisionDetectionStrategy}
          onDragStart={isMobile ? undefined : handleDragStart}
          onDragOver={isMobile ? undefined : handleDragOver}
          onDragEnd={isMobile ? undefined : handleDragEnd}
          onDragCancel={isMobile ? undefined : handleDragCancel}
        >
          <div className="flex sm:hidden p-4 pb-20 h-full" style={{ minHeight: '100%' }}>
            {filteredColumns
              .filter((column) => column.id === visibleMobileColumnId)
              .map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                currentUser={currentUser}
                onTaskClick={handleTaskClick}
                presenceByTask={presenceByTask}
              />
            ))}
          </div>

          <div className="hidden sm:flex gap-4 p-4 pb-5 h-full min-w-max" style={{ minHeight: '100%' }}>
            {filteredColumns.map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                currentUser={currentUser}
                onTaskClick={handleTaskClick}
                presenceByTask={presenceByTask}
              />
            ))}
            {isAdmin && (
              <div className="w-72 shrink-0 flex items-start pt-9">
                <Link
                  href="/admin/columns"
                  className={cn(
                    'w-full h-10 rounded-xl border border-dashed border-border',
                    'flex items-center justify-center gap-2',
                    'text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-accent/20',
                    'transition-colors'
                  )}
                >
                  <Plus size={14} />
                  Manage columns
                </Link>
              </div>
            )}
          </div>

          <DragOverlay dropAnimation={{ duration: 150, easing: 'ease-out' }}>
            {!isMobile && activeTask && (
              <TaskCard
                task={activeTask}
                currentUser={currentUser}
                isDragging
              />
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          currentUser={currentUser}
          columns={columns.map(({ tasks: _tasks, ...column }) => column)}
          onClose={() => {
            setSelectedTask(null)
            router.replace('/dashboard', { scroll: false })
          }}
          onUpdate={handleTaskUpdate}
          onRemove={handleTaskRemove}
          onMove={handleTaskMove}
          presence={presenceByTask.get(selectedTask.id) ?? []}
          runWrite={runWrite}
          onRefresh={refreshBoard}
        />
      )}
    </div>
  )
}
