import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDistanceToNow, format, isAfter, isBefore } from 'date-fns'
import type { Priority, TaskStatus } from '@/lib/types'

export const APP_TIME_ZONE = 'America/Los_Angeles'

export type AppThemeMode = 'light' | 'dark' | 'auto'

function formatInAppTimeZone(
  dateStr: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    ...options,
  }).format(date)
}

export function getCurrentDateInAppTimeZone(): string {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  return `${year}-${month}-${day}`
}

function getAppTimePart(type: Intl.DateTimeFormatPartTypes, date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  }).formatToParts(date).find((part) => part.type === type)?.value ?? ''
}

export function getAppThemeForNow(date = new Date()): 'light' | 'dark' {
  const hour = Number(getAppTimePart('hour', date))
  if (Number.isNaN(hour)) return 'light'
  return hour >= 7 && hour < 19 ? 'light' : 'dark'
}

// ─── Tailwind class merging ───────────────────────────────────────────────────
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Priority helpers ─────────────────────────────────────────────────────────
export const PRIORITY_CONFIG: Record<
  Priority,
  { label: string; color: string; bgClass: string; dotColor: string }
> = {
  low:    { label: 'Low',    color: '#6b7280', bgClass: 'priority-low',    dotColor: 'bg-gray-400' },
  normal: { label: 'Normal', color: '#3b82f6', bgClass: 'priority-normal', dotColor: 'bg-blue-500' },
  high:   { label: 'High',   color: '#f97316', bgClass: 'priority-high',   dotColor: 'bg-orange-500' },
  urgent: { label: 'Urgent', color: '#ef4444', bgClass: 'priority-urgent', dotColor: 'bg-red-500' },
}

export function getPriorityConfig(priority: Priority) {
  return PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.normal
}

// ─── Status helpers ───────────────────────────────────────────────────────────
export const STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; color: string }
> = {
  new:         { label: 'New',         color: '#6366f1' },
  pending:     { label: 'Pending',     color: '#f59e0b' },
  in_progress: { label: 'In Progress', color: '#3b82f6' },
  completed:   { label: 'Completed',   color: '#10b981' },
  archived:    { label: 'Archived',    color: '#6b7280' },
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
export function formatRelativeDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return formatDistanceToNow(new Date(dateStr), { addSuffix: true })
}

export function formatDate(dateStr: string | null | undefined): string {
  return formatInAppTimeZone(dateStr, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateTime(dateStr: string | null | undefined): string {
  return formatInAppTimeZone(dateStr, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  })
}

export function normalizeAppAssetUrl(url: string | null | undefined): string {
  if (!url) return '#'
  if (/^https?:\/\//i.test(url)) return url

  const basePath = process.env.NODE_ENV === 'production' ? '/task' : ''
  const normalizedInput = url.replace(/\\/g, '/').trim()
  const publicIndex = normalizedInput.indexOf('/public/')
  const uploadIndex = normalizedInput.indexOf('/uploads/')

  let stripped =
    publicIndex >= 0
      ? normalizedInput.slice(publicIndex + '/public'.length)
      : uploadIndex >= 0
        ? normalizedInput.slice(uploadIndex)
        : normalizedInput

  if (stripped.startsWith('/task/task/')) stripped = stripped.slice('/task'.length)
  else if (stripped.startsWith('/task/')) stripped = stripped.slice('/task'.length)

  if (!stripped.startsWith('/')) {
    return `${basePath}/${stripped}`
  }

  return `${basePath}${stripped}`
}

export function isDueSoon(dueDate: string | null, hasRealDueDate: boolean): boolean {
  if (!dueDate || !hasRealDueDate) return false
  const due = new Date(dueDate)
  const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  return isBefore(due, threeDaysFromNow) && isAfter(due, new Date())
}

export function isOverdue(dueDate: string | null, hasRealDueDate: boolean): boolean {
  if (!dueDate || !hasRealDueDate) return false
  return isBefore(new Date(dueDate), new Date())
}

// ─── User display helpers ─────────────────────────────────────────────────────
export function getUserInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function getUserDisplayName(
  profile: { display_name?: string | null; full_name?: string | null; email?: string | null }
): string {
  return profile.display_name ?? profile.full_name ?? profile.email ?? 'Unknown'
}

export function getAssignedUserIds(task: { assigned_to?: string | null; custom_fields?: Record<string, unknown> }) {
  const fromCustomFields = Array.isArray(task.custom_fields?.assigned_user_ids)
    ? task.custom_fields.assigned_user_ids.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []

  return Array.from(new Set([
    ...fromCustomFields,
    ...(task.assigned_to ? [task.assigned_to] : []),
  ]))
}

export function isTaskAssignedToUser(
  task: { assigned_to?: string | null; custom_fields?: Record<string, unknown> },
  userId: string,
) {
  return getAssignedUserIds(task).includes(userId)
}

// ─── File size helpers ────────────────────────────────────────────────────────
export function formatFileSize(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const MAX_FILE_SIZE = 10 * 1024 * 1024  // 10MB
