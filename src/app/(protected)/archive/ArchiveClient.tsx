'use client'

import { useState, useTransition } from 'react'
import { RotateCcw, Trash2, Archive, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { restoreTask, deleteTask } from '@/lib/actions/tasks'
import { cn, getPriorityConfig, formatRelativeDate } from '@/lib/utils'

interface Column { id: string; name: string }
interface Task {
  id: string; title: string; priority: string
  updated_at: string
  submitted_by_profile?: { full_name?: string | null; display_name?: string | null }
}

interface Props {
  initialTasks: Task[]
  columns:      Column[]
  isSuperAdmin: boolean
}

export default function ArchiveClient({ initialTasks, columns, isSuperAdmin }: Props) {
  const [tasks, setTasks]     = useState(initialTasks)
  const [isPending, start]    = useTransition()
  const [restoreTarget, setRestoreTarget] = useState<Record<string, string>>({})

  function handleRestore(taskId: string) {
    const columnId = restoreTarget[taskId] ?? columns[0]?.id
    if (!columnId) { toast.error('No column selected'); return }

    start(async () => {
      const result = await restoreTask(taskId, columnId)
      if (result.success) {
        setTasks(prev => prev.filter(t => t.id !== taskId))
        toast.success('Task restored to board')
      } else {
        toast.error(result.error)
      }
    })
  }

  function handleDelete(taskId: string) {
    start(async () => {
      const result = await deleteTask(taskId)
      if (result.success) {
        setTasks(prev => prev.filter(t => t.id !== taskId))
        toast.success('Task permanently deleted')
      } else {
        toast.error(result.error)
      }
    })
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
          <Archive size={24} className="text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Archive is empty</h2>
        <p className="text-sm text-muted-foreground">Archived tasks will appear here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {tasks.map(task => {
        const priority = getPriorityConfig(task.priority as import('@/lib/types').Priority)
        return (
          <div
            key={task.id}
            className="flex items-center gap-4 p-4 bg-card border border-border rounded-xl"
          >
            {/* Priority dot */}
            <div className={cn('w-2 h-2 rounded-full shrink-0', priority.dotColor)} />

            {/* Title + meta */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Archived {formatRelativeDate(task.updated_at)}
                {task.submitted_by_profile && (
                  <> · {task.submitted_by_profile.full_name ?? task.submitted_by_profile.display_name}</>
                )}
              </p>
            </div>

            {/* Restore controls */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Column selector */}
              <div className="relative">
                <select
                  value={restoreTarget[task.id] ?? columns[0]?.id ?? ''}
                  onChange={e => setRestoreTarget(prev => ({ ...prev, [task.id]: e.target.value }))}
                  className={cn(
                    'h-8 pl-2 pr-7 rounded-lg border border-input bg-background',
                    'text-xs text-foreground appearance-none cursor-pointer',
                    'focus:outline-none focus:ring-2 focus:ring-primary/50'
                  )}
                >
                  {columns.map(col => (
                    <option key={col.id} value={col.id}>{col.name}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>

              <button
                onClick={() => handleRestore(task.id)}
                disabled={isPending}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <RotateCcw size={12} />
                Restore
              </button>

              {isSuperAdmin && (
                <button
                  onClick={() => handleDelete(task.id)}
                  disabled={isPending}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title="Permanently delete"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
