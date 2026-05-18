'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { MessageSquare, Paperclip, AlertCircle, Clock } from 'lucide-react'
import { cn, getPriorityConfig, formatDate, isOverdue, isDueSoon, getUserDisplayName, isTaskAssignedToUser } from '@/lib/utils'
import type { TaskWithRelations, SessionUser } from '@/lib/types'
import { Avatar } from '@/components/layout/AppNav'
import LinkifiedText from '@/components/system/LinkifiedText'

interface Props {
  task:        TaskWithRelations
  currentUser: SessionUser
  isDragging?: boolean
  onClick?:    () => void
}

const priorityBorderColor: Record<string, string> = {
  low:    '#B0BAD1',
  normal: '#6A97C4',
  high:   '#A6784A',
  urgent: '#E11D48',
}

export default function TaskCard({ task, currentUser, isDragging = false, onClick }: Props) {
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'super_admin'
  const canMoveTask = isAdmin || task.submitted_by === currentUser.id || isTaskAssignedToUser(task, currentUser.id)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging: isSortableDragging } = useSortable({
    id: task.id, disabled: !canMoveTask,
  })

  const style = {
    transform:  CSS.Transform.toString(transform),
    transition,
    borderRightColor: priorityBorderColor[task.priority] ?? '#B0BAD1',
  }

  const priority  = getPriorityConfig(task.priority)
  const overdue   = isOverdue(task.due_date, task.has_real_due_date)
  const dueSoon   = isDueSoon(task.due_date, task.has_real_due_date)
  const submitter = task.submitted_by_profile

  const assignees = task.assigned_to_profiles ?? (task.assigned_to_profile ? [task.assigned_to_profile] : [])
  const handleCardClick = () => {
    if (isSortableDragging || isDragging) return
    onClick?.()
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={handleCardClick}
      {...(canMoveTask ? attributes : {})}
      {...(canMoveTask ? listeners  : {})}
      className={cn(
        'group relative bg-card rounded-2xl px-3.5 pt-3 pb-3',
        'border border-border/70 border-r-[5px]',
        canMoveTask ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        'select-none transition-all duration-200',
        'hover:shadow-lg hover:shadow-black/8 hover:-translate-y-0.5 hover:border-border',
        'dark:hover:shadow-black/25',
        isSortableDragging && 'opacity-25 scale-95 shadow-none',
        isDragging && 'shadow-2xl shadow-black/20 ring-2 ring-primary/30 rotate-1 scale-[1.03] opacity-95',
      )}
    >
      <div className="space-y-2.5">

        {/* Priority + flags row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md tracking-wider uppercase', priority.bgClass)}>
            {priority.label}
          </span>
          {overdue && (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-red-500 dark:text-red-400">
              <AlertCircle size={9} strokeWidth={2.5} /> Overdue
            </span>
          )}
          {dueSoon && !overdue && (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              <Clock size={9} strokeWidth={2.5} /> Due soon
            </span>
          )}
        </div>

        {/* Title */}
        <p className="text-[13px] font-semibold text-foreground leading-snug line-clamp-2 tracking-tight">
          {task.title}
        </p>

        {/* Description */}
        {task.description && (
          <p className="text-[11px] text-muted-foreground/80 line-clamp-2 leading-relaxed">
            <LinkifiedText text={task.description} stopPropagation />
          </p>
        )}

        {/* Labels */}
        {task.labels && task.labels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {task.labels.slice(0, 3).map(label => (
              <span key={label} className="text-[10px] px-1.5 py-0.5 rounded-md bg-accent/80 text-muted-foreground font-medium tracking-wide">
                {label}
              </span>
            ))}
            {task.labels.length > 3 && (
              <span className="text-[10px] text-muted-foreground/60">+{task.labels.length - 3}</span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 pt-2 mt-0.5 border-t border-border/40">
          <div className="flex items-center gap-1.5 min-w-0">
            <Avatar user={submitter} size="sm" />
            <span className="text-[10px] text-muted-foreground/70 truncate font-medium">
              {getUserDisplayName(submitter)}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {task.due_date && task.has_real_due_date && (
              <span className={cn('text-[10px] tabular-nums font-medium',
                overdue ? 'text-red-500' : dueSoon ? 'text-amber-500' : 'text-muted-foreground/60')}>
                {formatDate(task.due_date)}
              </span>
            )}
            {task._comment_count > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
                <MessageSquare size={10} strokeWidth={1.8} />
                {task._comment_count}
              </span>
            )}
            {task._attachment_count > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
                <Paperclip size={10} strokeWidth={1.8} />
                {task._attachment_count}
              </span>
            )}
            {assignees.length > 0 && (
              <div className="flex -space-x-1">
                {assignees.slice(0, 3).map((assignee) => (
                  <Avatar key={assignee.id} user={assignee} size="sm" />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
