import { APP_TIME_ZONE } from './utils'
import type { Task } from './types'

export function taskDay(value: string | null | undefined): string {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function taskIsOverdue(task: Task, today: string): boolean {
  if (task.status === 'completed' || task.status === 'archived' || !task.has_real_due_date) return false
  const day = taskDay(task.due_date)
  return Boolean(day && day < today)
}

export function taskDueLabel(task: Task, today: string): string {
  if (!task.due_date || !task.has_real_due_date) return 'No due date'
  const day = taskDay(task.due_date)
  if (!day) return 'No due date'
  const tomorrow = new Date(`${today}T12:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  if (day === today) {
    const time = task.due_date.includes('T') ? new Intl.DateTimeFormat('en-US', { timeZone: APP_TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(task.due_date)) : ''
    return time ? `Today · ${time}` : 'Today'
  }
  if (day === tomorrow.toISOString().slice(0, 10)) return 'Tomorrow'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))
}
