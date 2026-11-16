'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { cn } from '@/lib/utils'
import type { ColumnWithTasks, TaskWithRelations, SessionUser, TaskPresence } from '@/lib/types'
import TaskCard from './TaskCard'

interface Props {
  column:      ColumnWithTasks
  currentUser: SessionUser
  onTaskClick: (task: TaskWithRelations) => void
  /** Other people's presence, keyed by task id. */
  presenceByTask?: Map<string, TaskPresence[]>
}

export default function BoardColumn({ column, currentUser, onTaskClick, presenceByTask }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  const taskIds   = column.tasks.map(t => t.id)
  const taskCount = column.tasks.length

  return (
    <div data-board-column={column.name} className="w-full sm:w-[290px] xl:flex-1 xl:min-w-[260px] xl:max-w-[360px] shrink-0 flex flex-col max-h-full">

      {/* Column header */}
      <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-border/60 bg-card/70 px-3 py-3 shadow-sm">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: column.color ?? '#6b7280' }}
        />
        <h2 className="text-sm font-semibold text-foreground flex-1">
          {column.name}
        </h2>
        <span className={cn(
          'text-[10px] font-bold min-w-[20px] h-5 rounded-full flex items-center justify-center px-1.5 tabular-nums',
          taskCount > 0
            ? 'bg-primary/10 text-primary dark:bg-primary/15'
            : 'bg-muted/60 text-muted-foreground'
        )}>
          {taskCount}
        </span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 rounded-2xl p-1 overflow-y-auto transition-all duration-200 board-scroll',
          isOver
            ? 'bg-primary/5 ring-1 ring-inset ring-primary/20 dark:bg-primary/8'
            : 'bg-transparent',
        )}
        style={{ minHeight: 120 }}
      >
        <SortableContext id={column.id} items={taskIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {column.tasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                currentUser={currentUser}
                onClick={() => onTaskClick(task)}
                presence={presenceByTask?.get(task.id)}
              />
            ))}
          </div>
        </SortableContext>

        {taskCount === 0 && (
          <div className="h-20 flex items-center justify-center">
            <p className={cn(
              'text-[10px] uppercase tracking-[0.15em] select-none transition-colors',
              isOver ? 'text-primary/60' : 'text-muted-foreground/25'
            )}>
              {isOver ? 'Drop here' : 'No tasks here yet'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
