/**
 * push/payload.ts — what a push message says. Pure functions.
 *
 * The text is built on the server and encrypted end-to-end to the device (the browser vendors'
 * push services only see ciphertext). People can switch off "show previews": then the lock
 * screen only says that something new is waiting — no names, no task titles.
 */

export const PUSH_TYPES = ['mention', 'comment', 'assigned', 'completed'] as const
export type PushType = (typeof PUSH_TYPES)[number]

export interface PushPrefs {
  mention: boolean
  comment: boolean
  assigned: boolean
  completed: boolean
  /** Show names and task titles on the lock screen. */
  show_preview: boolean
}

export const DEFAULT_PREFS: PushPrefs = { mention: true, comment: true, assigned: true, completed: true, show_preview: true }

export interface PushPayload {
  v: 1
  title: string
  body: string
  /** Where tapping it goes, relative to the app ("/dashboard?task=…"); the service worker adds the base path. */
  path: string
  /** Same tag = replaces the earlier alert for that task instead of stacking. */
  tag: string
  type: PushType | 'test'
  /** Unread count, for the icon badge. */
  unread: number
  ts: number
}

// Control characters and invisible text-direction / line-break characters have no place in an alert.
const UNSAFE_CHARS = new RegExp('[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069]', 'g')

const clean = (text: unknown, max: number) => {
  const t = String(text ?? '').replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

export interface PayloadInput {
  type: PushType | 'test'
  actorName?: string | null
  taskTitle?: string | null
  snippet?: string | null
  taskId?: string | null
  showPreview: boolean
  unread: number
  now?: number
}

export function buildPushPayload(input: PayloadInput): PushPayload {
  const actor = clean(input.actorName, 40) || 'Someone'
  const task = clean(input.taskTitle, 70)
  const snippet = clean(input.snippet, 120)
  const path = input.taskId ? `/dashboard?task=${encodeURIComponent(input.taskId)}` : '/dashboard'
  const base = { v: 1 as const, path, tag: `yorki-${input.type}-${input.taskId ?? 'general'}`, type: input.type, unread: Math.max(0, Math.floor(input.unread || 0)), ts: input.now ?? Date.now() }

  if (input.type === 'test') {
    return { ...base, title: 'Yorki notifications are on', body: 'This is a test. You’ll get alerts like this when someone mentions or assigns you.' }
  }
  if (!input.showPreview) {
    return { ...base, title: 'Yorki', body: 'You have a new notification.' }
  }
  switch (input.type) {
    case 'mention':
      return { ...base, title: `${actor} mentioned you`, body: snippet || (task ? `On “${task}”` : 'Open Yorki to see it.') }
    case 'comment':
      return { ...base, title: `${actor} commented`, body: task ? `“${task}”${snippet ? `: ${snippet}` : ''}` : snippet || 'Open Yorki to see it.' }
    case 'assigned':
      return { ...base, title: `${actor} assigned you a task`, body: task || 'Open Yorki to see it.' }
    case 'completed':
      return { ...base, title: 'Task completed', body: task ? `“${task}” was completed by ${actor}` : `${actor} completed a task` }
  }
}
