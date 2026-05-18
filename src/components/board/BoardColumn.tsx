'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { cn } from '@/lib/utils'
import type { ColumnWithTasks, TaskWithRelations, SessionUser } from '@/lib/types'
import TaskCard from './TaskCard'

interface Props {
  column:      ColumnWithTasks
  currentUser: SessionUser
  onTaskClick: (task: TaskWithRelations) => void
}

export default function BoardColumn({ column, currentUser, onTaskClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  const taskIds   = column.tasks.map(t => t.id)
  const taskCount = column.tasks.length

  return (
    <div className="w-full sm:w-[288px] shrink-0 flex flex-col max-h-full">

      {/* Column header */}
      <div className="flex items-center gap-2.5 mb-3 px-1">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: column.color ?? '#6b7280', boxShadow: `0 0 0 2px hsl(var(--background)), 0 0 0 3px ${column.color ?? '#6b7280'}40` }}
        />
        <h2 className="text-[11px] font-bold text-foreground uppercase tracking-[0.12em] flex-1">
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
          'flex-1 rounded-2xl p-2 overflow-y-auto transition-all duration-200 board-scroll',
          isOver
            ? 'bg-primary/5 ring-1 ring-inset ring-primary/20 dark:bg-primary/8'
            : 'bg-black/[0.02] dark:bg-white/[0.02]',
        )}
        style={{ minHeight: 120 }}
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {column.tasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                currentUser={currentUser}
                onClick={() => onTaskClick(task)}
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
              {isOver ? 'Drop here' : 'Empty'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
