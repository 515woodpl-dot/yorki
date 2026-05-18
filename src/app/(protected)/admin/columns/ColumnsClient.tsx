'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Check, X, Loader2, Lock } from 'lucide-react'
import { createColumn, updateColumn, deleteColumn } from '@/lib/actions/settings'
import { cn } from '@/lib/utils'
import type { Column } from '@/lib/types'

const COLOR_OPTIONS = [
  '#6366f1', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#ec4899', '#6b7280',
]

interface Props {
  initialColumns: Column[]
  boardId:        string
}

export default function ColumnsClient({ initialColumns, boardId }: Props) {
  const [columns,   setColumns]   = useState(initialColumns)
  const [editId,    setEditId]    = useState<string | null>(null)
  const [editName,  setEditName]  = useState('')
  const [editColor, setEditColor] = useState('')
  const [adding,    setAdding]    = useState(false)
  const [newName,   setNewName]   = useState('')
  const [newColor,  setNewColor]  = useState(COLOR_OPTIONS[0])
  const [isPending, start]        = useTransition()

  function startEdit(col: Column) {
    setEditId(col.id)
    setEditName(col.name)
    setEditColor(col.color ?? '#6b7280')
  }

  function cancelEdit() {
    setEditId(null)
    setEditName('')
    setEditColor('')
  }

  async function handleUpdate(colId: string) {
    if (!editName.trim()) return
    start(async () => {
      const result = await updateColumn(colId, { name: editName.trim(), color: editColor })
      if (result.success) {
        setColumns(prev => prev.map(c =>
          c.id === colId ? { ...c, name: editName.trim(), color: editColor } : c
        ))
        cancelEdit()
        toast.success('Column updated')
      } else {
        toast.error(result.error)
      }
    })
  }

  async function handleAdd() {
    if (!newName.trim()) return
    start(async () => {
      const result = await createColumn(boardId, newName.trim(), newColor)
      if (result.success) {
        // Reload page to get new column with ID from server
        window.location.reload()
      } else {
        toast.error(result.error)
      }
    })
  }

  async function handleDelete(colId: string) {
    start(async () => {
      const result = await deleteColumn(colId)
      if (result.success) {
        setColumns(prev => prev.filter(c => c.id !== colId))
        toast.success('Column deleted')
      } else {
        toast.error(result.error)
      }
    })
  }

  const isProtected = (col: Column) => col.is_default || col.is_archive

  return (
    <div className="space-y-3 max-w-xl">
      {/* Column list */}
      {columns.map(col => (
        <div
          key={col.id}
          className="flex items-center gap-3 p-4 bg-card border border-border rounded-xl"
        >
          {editId === col.id ? (
            /* Edit mode */
            <div className="flex-1 flex items-center gap-3">
              {/* Color picker */}
              <div className="flex gap-1.5 flex-wrap">
                {COLOR_OPTIONS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setEditColor(c)}
                    className={cn(
                      'w-6 h-6 rounded-full border-2 transition-all',
                      editColor === c ? 'border-foreground scale-110' : 'border-transparent'
                    )}
                    style={{ background: c }}
                  />
                ))}
              </div>
              <input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleUpdate(col.id)
                  if (e.key === 'Escape') cancelEdit()
                }}
                autoFocus
                className="flex-1 h-8 px-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button onClick={() => handleUpdate(col.id)} disabled={isPending}
                className="w-7 h-7 rounded-lg bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 flex items-center justify-center hover:opacity-80">
                {isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              </button>
              <button onClick={cancelEdit}
                className="w-7 h-7 rounded-lg bg-muted text-muted-foreground flex items-center justify-center hover:opacity-80">
                <X size={13} />
              </button>
            </div>
          ) : (
            /* Display mode */
            <>
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: col.color ?? '#6b7280' }}
              />
              <span className="flex-1 text-sm font-medium text-foreground">{col.name}</span>

              {isProtected(col) ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground px-2">
                  <Lock size={11} />
                  {col.is_default ? 'Default' : 'Archive'}
                </span>
              ) : (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startEdit(col)}
                    className="w-7 h-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent flex items-center justify-center transition-colors"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => handleDelete(col.id)}
                    disabled={isPending}
                    className="w-7 h-7 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {/* Add column */}
      {adding ? (
        <div className="p-4 bg-card border border-primary/30 rounded-xl space-y-3">
          <p className="text-sm font-medium">New column</p>
          {/* Color picker */}
          <div className="flex gap-1.5 flex-wrap">
            {COLOR_OPTIONS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setNewColor(c)}
                className={cn(
                  'w-6 h-6 rounded-full border-2 transition-all',
                  newColor === c ? 'border-foreground scale-110' : 'border-transparent'
                )}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Column name…"
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              autoFocus
              className="flex-1 h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button onClick={handleAdd} disabled={!newName.trim() || isPending}
              className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors">
              {isPending ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
            </button>
            <button onClick={() => { setAdding(false); setNewName('') }}
              className="h-9 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 w-full h-11 px-4 rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
        >
          <Plus size={15} />
          Add column
        </button>
      )}
    </div>
  )
}
