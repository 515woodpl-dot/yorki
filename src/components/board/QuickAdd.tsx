'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CalendarDays, CornerDownLeft, Flag, Loader2, Sparkles, Tag, X } from 'lucide-react'
import { createTask } from '@/lib/actions/tasks'
import { parseQuickAdd, type QuickPriority } from '@/lib/quick-add/parse'
import MentionTextarea from '@/components/tasks/MentionTextarea'
import { cn } from '@/lib/utils'
import type { MentionableUser, UserRole } from '@/lib/types'

export interface QuickAddPerson {
  id: string
  name: string
  role: UserRole
  aliases?: string[]
}

interface Props {
  people: QuickAddPerson[]
  currentUserId: string
  /** Called after cards were created so the board can refresh immediately. */
  onCreated?: () => void
}

type CardEdits = Partial<{ title: string; assigneeIds: string[]; date: string; time: string; priority: QuickPriority }>
interface EditState { key: string; edits: Record<number, CardEdits>; removed: number[] }

const PRIORITIES: Array<{ value: QuickPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const PRIORITY_STYLES: Record<QuickPriority, string> = {
  low: 'text-muted-foreground',
  normal: 'text-foreground',
  high: 'text-amber-700 dark:text-amber-400',
  urgent: 'text-red-600 dark:text-red-400',
}

function describeDate(dueDate: string | null) {
  if (!dueDate) return null
  const [y, m, d] = dueDate.slice(0, 10).split('-').map(Number)
  const day = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const time = dueDate.length > 10
    ? ` · ${new Date(2000, 0, 1, +dueDate.slice(11, 13), +dueDate.slice(14, 16)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : ''
  return `${day}${time}`
}

const fieldClass = 'h-9 rounded-lg border border-border bg-card px-2 text-xs text-foreground focus:border-primary'

export default function QuickAdd({ people, currentUserId, onCreated }: Props) {
  const [text, setText] = useState('')
  const [splitLists, setSplitLists] = useState(true)
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<EditState>({ key: '', edits: {}, removed: [] })

  const mentionCandidates: MentionableUser[] = useMemo(
    () => people.filter((p) => p.id !== currentUserId).map((p) => ({ id: p.id, name: p.name, role: p.role })),
    [people, currentUserId],
  )

  // Parsing is instant and local; re-run on every keystroke.
  const parsed = useMemo(
    () => parseQuickAdd(text, { people, currentUserId, splitLists }),
    [text, people, currentUserId, splitLists],
  )

  // Manual edits belong to one exact input: change the text and the preview starts fresh.
  const editKey = `${splitLists ? 1 : 0}|${text}`
  const active: EditState = state.key === editKey ? state : { key: editKey, edits: {}, removed: [] }

  const cards = parsed
    .map((card, index) => ({ card, index, edit: active.edits[index] ?? {} }))
    .filter(({ index }) => !active.removed.includes(index))
    .map(({ card, index, edit }) => {
      const dueDate = edit.date !== undefined
        ? (edit.date ? `${edit.date}${edit.time ? `T${edit.time}:00` : ''}` : null)
        : edit.time !== undefined && card.dueDate
          ? `${card.dueDate.slice(0, 10)}${edit.time ? `T${edit.time}:00` : ''}`
          : card.dueDate
      return {
        index,
        source: card.source,
        found: card.found,
        warnings: card.warnings,
        labels: card.labels,
        description: card.description,
        title: edit.title ?? card.title,
        assigneeIds: edit.assigneeIds ?? card.assigneeIds,
        priority: edit.priority ?? card.priority,
        dueDate,
      }
    })

  function patch(index: number, change: CardEdits) {
    setState({ key: editKey, edits: { ...active.edits, [index]: { ...active.edits[index], ...change } }, removed: active.removed })
  }
  function remove(index: number) {
    setState({ key: editKey, edits: active.edits, removed: [...active.removed, index] })
  }

  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? 'Unknown'
  const ready = cards.filter((c) => c.title.trim().length > 0)

  async function handleCreate() {
    if (busy || ready.length === 0) return
    setBusy(true)
    const failed: Array<{ source: string; title: string; error: string }> = []
    let created = 0
    try {
      for (const card of ready) {
        const result = await createTask({
          title: card.title.trim(),
          description: card.description,
          priority: card.priority,
          due_date: card.dueDate,
          labels: card.labels,
          assigned_to: card.assigneeIds,
        })
        if (result.success) created += 1
        else failed.push({ source: card.source, title: card.title, error: result.error })
      }
    } catch (error) {
      failed.push({ source: text, title: 'Request', error: error instanceof Error ? error.message : 'Network error' })
    } finally {
      setBusy(false)
    }

    if (created > 0) {
      toast.success(created === 1 ? 'Card created in Inbox' : `${created} cards created in Inbox`)
      onCreated?.()
    }
    if (failed.length === 0) {
      setText('')
    } else {
      toast.error(`${failed.length} not created — “${failed[0].title}”: ${failed[0].error}`, { duration: 9000 })
      // Keep only what failed, so pressing Enter again can't duplicate the ones that worked.
      setText(Array.from(new Set(failed.map((f) => f.source))).join('\n'))
    }
  }

  const first = people[0]?.name.split(' ')[0]
  const second = people[1]?.name.split(' ')[0]
  const examples = [
    `${first ?? 'Sam'} should call the supplier by Friday at 3pm, urgent`,
    'Pay the electric bill tomorrow',
    `Order tiles, book the truck and email ${second ?? 'Alex'} the quote next week`,
  ]

  return (
    <section aria-label="Quick add" className="mb-6 rounded-2xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          <Sparkles size={16} aria-hidden="true" />
        </span>
        <h2 className="text-sm font-semibold text-foreground">Quick add</h2>
        <p className="text-xs text-muted-foreground">Type it the way you would say it. Names, dates and urgency are picked out for you.</p>
      </div>

      <div>
        <MentionTextarea
          value={text}
          onChange={setText}
          candidates={mentionCandidates}
          onPick={() => {}}
          onSubmit={handleCreate}
          enterToSubmit
          rows={2}
          menuPosition="below"
          disabled={busy}
          ariaLabel="Describe what needs to be done"
          placeholder="e.g. I want @Mia to call the supplier by Friday. Also pay the electric bill tomorrow"
          className="w-full resize-y rounded-xl border border-input bg-background px-3.5 py-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
        />
      </div>

      {text.trim() === '' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Try</span>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setText(example)}
              className="max-w-full truncate rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {text.trim() !== '' && cards.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">Keep typing — a card appears as soon as there is something to do.</p>
      )}

      {cards.length > 0 && (
        <div className="mt-4 space-y-2.5" aria-live="polite">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {cards.length === 1 ? 'This will create 1 card' : `This will create ${cards.length} cards`} · check, then press Enter
          </p>
          {cards.map((card) => {
            const available = people.filter((p) => !card.assigneeIds.includes(p.id))
            return (
              <div key={card.index} className="rounded-xl border border-border/80 bg-background p-3">
                <div className="flex items-start gap-2">
                  <input
                    value={card.title}
                    onChange={(event) => patch(card.index, { title: event.target.value })}
                    aria-label="Card title"
                    maxLength={500}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-sm font-semibold text-foreground hover:border-border focus:border-primary focus:bg-card focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => remove(card.index)}
                    aria-label={`Remove “${card.title}”`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {card.assigneeIds.map((id) => (
                    <span key={id} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary/10 pl-2.5 pr-1 text-xs font-medium text-primary">
                      {nameOf(id)}
                      <button
                        type="button"
                        aria-label={`Unassign ${nameOf(id)}`}
                        onClick={() => patch(card.index, { assigneeIds: card.assigneeIds.filter((x) => x !== id) })}
                        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-primary/15"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  {available.length > 0 && (
                    <select
                      aria-label="Assign someone"
                      value=""
                      onChange={(event) => event.target.value && patch(card.index, { assigneeIds: [...card.assigneeIds, event.target.value] })}
                      className={cn(fieldClass, 'max-w-[9.5rem]')}
                    >
                      <option value="">{card.assigneeIds.length ? '+ Add person' : 'Assign to…'}</option>
                      {available.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}

                  <span className="relative inline-flex items-center">
                    <CalendarDays size={13} aria-hidden="true" className="pointer-events-none absolute left-2 text-muted-foreground" />
                    <input
                      type="date"
                      aria-label="Due date"
                      value={card.dueDate?.slice(0, 10) ?? ''}
                      onChange={(event) => patch(card.index, { date: event.target.value })}
                      className={cn(fieldClass, 'pl-7')}
                    />
                  </span>
                  <input
                    type="time"
                    aria-label="Due time"
                    value={card.dueDate && card.dueDate.length > 10 ? card.dueDate.slice(11, 16) : ''}
                    disabled={!card.dueDate}
                    onChange={(event) => patch(card.index, { time: event.target.value })}
                    className={cn(fieldClass, 'disabled:opacity-40')}
                  />
                  <span className="relative inline-flex items-center">
                    <Flag size={13} aria-hidden="true" className="pointer-events-none absolute left-2 text-muted-foreground" />
                    <select
                      aria-label="Priority"
                      value={card.priority}
                      onChange={(event) => patch(card.index, { priority: event.target.value as QuickPriority })}
                      className={cn(fieldClass, 'pl-7 font-medium', PRIORITY_STYLES[card.priority])}
                    >
                      {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </span>
                  {card.labels.map((label) => (
                    <span key={label} className="inline-flex h-9 items-center gap-1 rounded-lg bg-accent px-2.5 text-xs text-muted-foreground">
                      <Tag size={11} aria-hidden="true" />{label}
                    </span>
                  ))}
                </div>

                {(card.found.date || card.found.priority || card.found.assignees.length > 0) && (
                  <p className="mt-2 px-1 text-[11px] text-muted-foreground">
                    Understood
                    {card.found.assignees.length > 0 && <> · <b className="font-medium text-foreground">{card.found.assignees.join(', ')}</b></>}
                    {card.found.date && card.dueDate && <> · “{card.found.date}” → <b className="font-medium text-foreground">{describeDate(card.dueDate)}</b></>}
                    {card.found.priority && <> · “{card.found.priority}”</>}
                  </p>
                )}
                {card.warnings.map((warning) => (
                  <p key={warning} className="mt-1.5 flex items-start gap-1.5 px-1 text-[11px] text-amber-700 dark:text-amber-400">
                    <AlertTriangle size={12} className="mt-px shrink-0" aria-hidden="true" />{warning}
                  </p>
                ))}
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={splitLists}
            onChange={(event) => setSplitLists(event.target.checked)}
            className="h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
          />
          Split “pay the bill and call John” into separate cards
        </label>
        <div className="ml-auto flex items-center gap-2">
          {text !== '' && !busy && (
            <button type="button" onClick={() => setText('')} className="min-h-9 rounded-lg px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy || ready.length === 0}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <CornerDownLeft size={15} aria-hidden="true" />}
            {busy ? 'Creating…' : ready.length > 1 ? `Create ${ready.length} cards` : 'Create card'}
          </button>
        </div>
      </div>
    </section>
  )
}
