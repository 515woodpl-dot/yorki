'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import LinkifiedText from '@/components/system/LinkifiedText'
import type { MentionableUser } from '@/lib/types'

/**
 * @mentions
 *
 * While typing, the textarea shows plain "@Ana Reyes". The people picked from
 * the suggestion list are remembered, and on send encodeMentions() turns each
 * "@Ana Reyes" into the stored token "@[Ana Reyes](userId)". The server then
 * re-validates every token (see actions/activity.ts).
 */

const TOKEN_PATTERN = /@\[([^\]\n]{1,80})\]\(([A-Za-z0-9-]{1,64})\)/g

export function encodeMentions(text: string, picks: MentionableUser[]) {
  // Longest names first so "@Ana Reyes" wins over "@Ana".
  const unique = Array.from(new Map(picks.map((pick) => [pick.id, pick])).values())
    .sort((a, b) => b.name.length - a.name.length)
  let result = text
  for (const pick of unique) {
    const escaped = pick.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // "@Name" not already inside a token, followed by a non-word char or end.
    result = result.replace(new RegExp(`(^|[^\\[\\w])@${escaped}(?![\\w])`, 'g'), `$1@[${pick.name}](${pick.id})`)
  }
  return result
}

/** Mention tokens → "@Name" (for search, previews). */
export function mentionsToPlainText(text: string) {
  return text.replace(TOKEN_PATTERN, (_m, name: string) => `@${name}`)
}

/** Renders a comment body with mention chips (your own mentions highlighted). */
export function CommentBody({ body, currentUserId }: { body: string; currentUserId: string }) {
  const parts: Array<{ text: string } | { name: string; id: string }> = []
  let last = 0
  for (const match of Array.from(body.matchAll(TOKEN_PATTERN))) {
    const index = match.index ?? 0
    if (index > last) parts.push({ text: body.slice(last, index) })
    parts.push({ name: match[1], id: match[2] })
    last = index + match[0].length
  }
  if (last < body.length) parts.push({ text: body.slice(last) })

  return (
    <p className="whitespace-pre-wrap break-words">
      {parts.map((part, index) => 'text' in part
        ? <LinkifiedText key={index} text={part.text} />
        : (
          <span
            key={index}
            className={cn(
              'rounded px-1 py-px font-medium',
              part.id === currentUserId
                ? 'bg-primary text-primary-foreground'
                : 'bg-primary/12 text-primary',
            )}
          >
            @{part.name}
          </span>
        ))}
    </p>
  )
}

interface Props {
  value: string
  onChange: (value: string) => void
  candidates: MentionableUser[]
  onPick: (user: MentionableUser) => void
  onSubmit: () => void
  placeholder?: string
  className?: string
  /** Chat style: Enter sends, Shift+Enter adds a line. (Ctrl/Cmd+Enter always sends.) */
  enterToSubmit?: boolean
  rows?: number
  /** Where the suggestion list opens. */
  menuPosition?: 'above' | 'below'
  disabled?: boolean
  ariaLabel?: string
}

export default function MentionTextarea({
  value, onChange, candidates, onPick, onSubmit, placeholder, className,
  enterToSubmit = false, rows = 3, menuPosition = 'above', disabled = false, ariaLabel,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [query, setQuery] = useState<{ text: string; start: number } | null>(null)
  const [highlight, setHighlight] = useState(0)
  // Caret position to restore right after React applies an inserted mention.
  // Done in a layout effect (before the next keystroke), not a later frame,
  // so fast typing after picking a name never lands in the wrong place.
  const pendingCaretRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    const caret = pendingCaretRef.current
    if (caret === null || !ref.current) return
    pendingCaretRef.current = null
    ref.current.focus()
    ref.current.setSelectionRange(caret, caret)
  }, [value])

  const matches = query
    ? candidates
        .filter((user) => user.name.toLowerCase().split(/\s+/).some((part) => part.startsWith(query.text.toLowerCase()))
          || user.name.toLowerCase().startsWith(query.text.toLowerCase()))
        .slice(0, 6)
    : []

  function detectQuery(text: string, caret: number) {
    const before = text.slice(0, caret)
    const match = before.match(/(^|\s)@([^\s@]{0,30})$/)
    if (match) {
      setQuery({ text: match[2], start: caret - match[2].length - 1 })
      setHighlight(0)
    } else {
      setQuery(null)
    }
  }

  function pick(user: MentionableUser) {
    if (!query) return
    const caret = ref.current?.selectionStart ?? value.length
    const next = `${value.slice(0, query.start)}@${user.name} ${value.slice(caret)}`
    pendingCaretRef.current = query.start + user.name.length + 2
    onChange(next)
    onPick(user)
    setQuery(null)
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => {
          onChange(event.target.value)
          detectQuery(event.target.value, event.target.selectionStart ?? event.target.value.length)
        }}
        onClick={(event) => detectQuery(value, event.currentTarget.selectionStart ?? value.length)}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        onKeyDown={(event) => {
          if (matches.length > 0) {
            if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight((h) => (h + 1) % matches.length); return }
            if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight((h) => (h - 1 + matches.length) % matches.length); return }
            if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); pick(matches[highlight]); return }
            if (event.key === 'Escape') { event.preventDefault(); setQuery(null); return }
          }
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          if (event.metaKey || event.ctrlKey || (enterToSubmit && !event.shiftKey)) {
            event.preventDefault()
            onSubmit()
          }
        }}
        className={className}
        aria-autocomplete="list"
      />
      {matches.length > 0 && (
        <div
          role="listbox"
          className={cn(
            'absolute left-2 z-30 w-64 rounded-xl border border-border bg-card shadow-xl py-1 animate-scale-in',
            menuPosition === 'above' ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          <p className="px-3 pt-1 pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Mention someone</p>
          {matches.map((user, index) => (
            <button
              key={user.id}
              type="button"
              role="option"
              aria-selected={index === highlight}
              onMouseDown={(event) => { event.preventDefault(); pick(user) }}
              onMouseEnter={() => setHighlight(index)}
              className={cn(
                'w-full text-left flex items-center justify-between gap-2 px-3 py-1.5 text-sm',
                index === highlight ? 'bg-accent' : 'hover:bg-accent/60',
              )}
            >
              <span className="truncate">{user.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {user.role === 'staff' ? 'staff' : 'admin'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
