'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useRef, useState } from 'react'
import { MessageSquare, Paperclip, CalendarDays, CheckSquare, CheckCircle2, ArrowUpRight, LockKeyhole, Trash2 } from 'lucide-react'
import { cn, getPriorityConfig, getUserDisplayName, isTaskAssignedToUser, getCurrentDateInAppTimeZone } from '@/lib/utils'
import { taskIsOverdue, taskDueLabel, taskDay } from '@/lib/board-view'
import type { TaskWithRelations, SessionUser, TaskPresence } from '@/lib/types'
import { Avatar } from '@/components/layout/AppNav'

interface Props {
  task: TaskWithRelations
  currentUser: SessionUser
  isDragging?: boolean
  draggable?: boolean
  onClick?: () => void
  presence?: TaskPresence[]
  swipeActions?: {
    onComplete?: () => void
    onDelete?: () => void
    busy?: boolean
  }
}

const SWIPE_LIMIT = 96
const SWIPE_TRIGGER = 68

export default function TaskCard({ task, currentUser, isDragging = false, draggable = true, onClick, presence = [], swipeActions }: Props) {
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'super_admin'
  const locked = task.custom_fields?.locked === true
  const canMove = !locked && draggable && (isAdmin || task.submitted_by === currentUser.id || isTaskAssignedToUser(task, currentUser.id))
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: sorting } = useSortable({ id: isDragging ? `overlay-${task.id}` : task.id, disabled: !canMove || isDragging })
  const priority = getPriorityConfig(task.priority)
  const today = getCurrentDateInAppTimeZone()
  const completed = task.status === 'completed'
  const overdue = taskIsOverdue(task, today)
  const assignees = task.assigned_to_profiles ?? (task.assigned_to_profile ? [task.assigned_to_profile] : [])
  const checklist = Array.isArray(task.custom_fields?.checklist) ? task.custom_fields.checklist.filter(item => item && typeof item === 'object' && typeof item.label === 'string' && item.label.trim()) as { label: string; checked?: boolean }[] : []
  const address = typeof task.custom_fields?.address === 'string' ? task.custom_fields.address : ''
  const job = typeof task.custom_fields?.job_number === 'string' ? task.custom_fields.job_number : task.labels[0]
  const editors = presence.filter(entry => entry.mode === 'editing')
  const viewers = presence.filter(entry => entry.mode === 'viewing')
  const person = editors[0] ?? viewers[0]
  const presenceLabel = person ? `${person.user_name.split(' ')[0]} ${editors.length ? 'editing' : 'viewing'}` : null
  const [swipeX, setSwipeX] = useState(0)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const swiping = useRef(false)
  const suppressClick = useRef(false)
  const canSwipeRight = Boolean(swipeActions?.onComplete)
  const canSwipeLeft = Boolean(swipeActions?.onDelete)

  function open() {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (!sorting && !isDragging && !swipeActions?.busy) onClick?.()
  }

  function handleTouchStart(event: React.TouchEvent) {
    if (!swipeActions || swipeActions.busy) return
    const touch = event.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY }
    swiping.current = false
  }

  function handleTouchMove(event: React.TouchEvent) {
    if (!touchStart.current || !swipeActions || swipeActions.busy) return
    const touch = event.touches[0]
    const dx = touch.clientX - touchStart.current.x
    const dy = touch.clientY - touchStart.current.y
    if (!swiping.current && Math.abs(dx) < 8) return
    if (!swiping.current && Math.abs(dy) > Math.abs(dx)) {
      touchStart.current = null
      return
    }
    swiping.current = true
    suppressClick.current = true
    const allowedDx = dx > 0 && !canSwipeRight ? 0 : dx < 0 && !canSwipeLeft ? 0 : dx
    setSwipeX(Math.max(-SWIPE_LIMIT, Math.min(SWIPE_LIMIT, allowedDx)))
  }

  function handleTouchEnd() {
    if (!touchStart.current) return
    const completedSwipe = swiping.current
    touchStart.current = null
    swiping.current = false
    if (swipeX >= SWIPE_TRIGGER && canSwipeRight) swipeActions?.onComplete?.()
    if (swipeX <= -SWIPE_TRIGGER && canSwipeLeft) swipeActions?.onDelete?.()
    setSwipeX(0)
    if (completedSwipe) window.setTimeout(() => { suppressClick.current = false }, 0)
  }

  const card = <div ref={setNodeRef} style={{
    transform: swipeActions ? `translateX(${swipeX}px)` : CSS.Transform.toString(transform),
    transition: swipeX !== 0 ? 'none' : transition ?? 'transform 180ms ease-out',
  }} {...(canMove ? attributes : {})} {...(canMove ? listeners : {})}
    role="button" tabIndex={0} aria-label={`Open task: ${task.title}`} onClick={open}
    onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open() } }}
    className={cn('group rounded-2xl border border-blue-200/70 bg-gradient-to-br from-white via-white to-blue-50/70 p-4 shadow-[0_4px_14px_-7px_rgba(35,67,115,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_10px_22px_-9px_rgba(35,67,115,0.32)] dark:border-border dark:from-slate-800 dark:via-slate-800 dark:to-slate-900', canMove ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer', sorting && 'opacity-30', isDragging && 'rotate-1 shadow-xl ring-2 ring-primary/30', swipeActions?.busy && 'pointer-events-none opacity-60', task.unopened && !isDragging && 'card-unopened')}>

    <div className="mb-1 flex items-start justify-between gap-2"><h3 className="line-clamp-2 text-[14px] font-semibold leading-snug tracking-tight text-foreground">{task.unopened && <span className="mr-1.5 inline-block -translate-y-px rounded-full bg-primary px-1.5 py-px align-middle text-[9px] font-bold uppercase tracking-wider text-primary-foreground">New</span>}{task.title}</h3>{locked ? <LockKeyhole size={16} aria-label="Locked" className="shrink-0 text-amber-600" /> : completed ? <CheckCircle2 size={18} className="shrink-0 text-emerald-600" /> : <ArrowUpRight size={16} className="shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />}</div>
    {presenceLabel && <span title={presence.map(entry => `${entry.user_name} is ${entry.mode}`).join('\n')} className="mb-2 inline-block rounded-md bg-blue-100 px-2 py-1 text-[10px] font-semibold text-blue-800">{presenceLabel}</span>}
    {(job || address) && <p className="mb-3 line-clamp-1 text-xs leading-5 text-muted-foreground">{[job, address].filter(Boolean).join(' · ')}</p>}
    {!job && !address && task.description && <p className="mb-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{task.description}</p>}
    <div className="my-3 flex flex-wrap gap-1.5"><span className={cn('rounded-md px-2 py-0.5 text-[10px] font-semibold', priority.bgClass)}>{priority.label}</span>{overdue && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">Overdue</span>}</div>
    <div className="mb-3 flex min-h-6 items-center gap-2">{assignees.length ? <><Avatar user={assignees[0]} size="sm" /><span className="truncate text-xs font-medium">{getUserDisplayName(assignees[0])}</span>{assignees.length > 1 && <span className="text-xs text-muted-foreground">+{assignees.length - 1}</span>}</> : <span className="text-xs text-muted-foreground">Unassigned</span>}</div>
    <div className={cn('mb-3 flex items-center gap-1.5 text-xs font-medium', completed ? 'text-emerald-700 dark:text-emerald-400' : overdue ? 'text-amber-700 dark:text-amber-400' : taskDay(task.due_date) === today && task.has_real_due_date ? 'text-blue-700 dark:text-blue-400' : 'text-muted-foreground')}>
      {completed ? <CheckCircle2 size={14} /> : <CalendarDays size={14} />}<span>{completed ? 'Completed' : `${overdue ? 'Overdue · ' : ''}${taskDueLabel(task, today)}`}</span>
    </div>
    <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground"><span className="flex items-center gap-1.5" title="Checklist completed">{checklist.length ? <><CheckSquare size={14} />{checklist.filter(item => item.checked).length}/{checklist.length}</> : <span className="text-[11px]">{task.column.name}</span>}</span><span className="flex items-center gap-3"><span className="flex items-center gap-1" title="Comments"><MessageSquare size={14} />{task._comment_count}</span><span className="flex items-center gap-1" title="Attachments"><Paperclip size={14} />{task._attachment_count}</span></span></div>
  </div>

  if (!swipeActions) return card

  return <div
    className="relative overflow-hidden rounded-2xl touch-pan-y"
    onTouchStart={handleTouchStart}
    onTouchMove={handleTouchMove}
    onTouchEnd={handleTouchEnd}
    onTouchCancel={() => { touchStart.current = null; swiping.current = false; setSwipeX(0) }}
  >
    <div aria-hidden="true" className={cn('absolute inset-0 flex items-center justify-between overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-red-600 text-white', swipeX === 0 && 'invisible')}>
      <span className={cn('flex h-full w-24 items-center justify-center gap-1.5 text-xs font-bold transition-opacity', swipeX > 12 ? 'opacity-100' : 'opacity-0')}><CheckCircle2 size={20} />Complete</span>
      <span className={cn('flex h-full w-24 items-center justify-center gap-1.5 text-xs font-bold transition-opacity', swipeX < -12 ? 'opacity-100' : 'opacity-0')}><Trash2 size={20} />Delete</span>
    </div>
    {card}
  </div>
}
