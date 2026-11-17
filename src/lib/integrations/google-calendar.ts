import fs from 'node:fs'
import path from 'node:path'
import { google } from 'googleapis'
import type { calendar_v3 } from 'googleapis'
import type { Task, UserProfile } from '@/lib/types'
import { APP_TIME_ZONE, getAssignedUserIds } from '@/lib/utils'

type CalendarSyncResult =
  | { status: 'created'; eventId: string }
  | { status: 'updated'; eventId: string }
  | { status: 'deleted' }
  | { status: 'skipped'; reason: string }

type ServiceAccountCredentials = {
  client_email: string
  private_key: string
  project_id?: string
}

let calendarClientPromise: Promise<calendar_v3.Calendar> | null = null

function cleanEnvValue(value: string | undefined | null) {
  return value?.trim() || undefined
}

function getErrorStatus(err: unknown) {
  if (!err || typeof err !== 'object') return undefined
  const candidate = err as { status?: number; code?: number; response?: { status?: number } }
  return candidate.status ?? candidate.code ?? candidate.response?.status
}

function loadServiceAccountCredentials(): ServiceAccountCredentials | null {
  const jsonBase64 = cleanEnvValue(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64)
  if (jsonBase64) {
    const parsed = JSON.parse(Buffer.from(jsonBase64, 'base64').toString('utf8')) as ServiceAccountCredentials
    return { ...parsed, private_key: parsed.private_key.replace(/\\n/g, '\n') }
  }

  const jsonInline = cleanEnvValue(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
  if (jsonInline) {
    const parsed = JSON.parse(jsonInline) as ServiceAccountCredentials
    return { ...parsed, private_key: parsed.private_key.replace(/\\n/g, '\n') }
  }

  const jsonPath = cleanEnvValue(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH)
  if (jsonPath) {
    // This path is operator-provided at runtime; credentials must be supplied
    // separately and must never be bundled into the deployed application.
    const resolvedPath = path.isAbsolute(jsonPath) ? jsonPath : path.join(/*turbopackIgnore: true*/ process.cwd(), jsonPath)
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8')) as ServiceAccountCredentials
    return { ...parsed, private_key: parsed.private_key.replace(/\\n/g, '\n') }
  }

  const client_email = cleanEnvValue(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL)
  const private_key = cleanEnvValue(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)?.replace(/\\n/g, '\n')
  const project_id = cleanEnvValue(process.env.GOOGLE_SERVICE_ACCOUNT_PROJECT_ID)

  if (client_email && private_key) {
    return { client_email, private_key, project_id }
  }

  return null
}

async function getCalendarClient() {
  if (!calendarClientPromise) {
    const credentials = loadServiceAccountCredentials()
    const calendarId = cleanEnvValue(process.env.GOOGLE_CALENDAR_ID)

    if (!credentials || !calendarId) {
      throw new Error('Google Calendar integration is not configured')
    }

    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    })

    calendarClientPromise = Promise.resolve(google.calendar({ version: 'v3', auth }))
  }

  return calendarClientPromise
}

function getCalendarId() {
  return cleanEnvValue(process.env.GOOGLE_CALENDAR_ID)
}

function getCalendarTimeZone() {
  return cleanEnvValue(process.env.GOOGLE_CALENDAR_TIME_ZONE) ?? APP_TIME_ZONE
}

function resolveAttendeeEmail(task: Task, assignedUser: UserProfile | null) {
  const customRecipient = typeof task.custom_fields?.recipient_email === 'string'
    ? task.custom_fields.recipient_email.trim().toLowerCase()
    : null
  return customRecipient || assignedUser?.email?.trim().toLowerCase() || null
}

function getAssignedNames(task: Task) {
  if (Array.isArray(task.custom_fields?.assigned_user_names)) {
    const names = task.custom_fields.assigned_user_names
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    if (names.length > 0) return names
  }

  if (typeof task.custom_fields?.assigned_user_name === 'string' && task.custom_fields.assigned_user_name.trim()) {
    return [task.custom_fields.assigned_user_name.trim()]
  }

  return []
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isNaiveDateTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)
}

function addOneHourToNaiveDateTime(value: string) {
  const [datePart, timePart] = value.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute, second = '00'] = timePart.split(':')
  const next = new Date(Date.UTC(year, month - 1, day, Number(hour), Number(minute), Number(second)))
  next.setUTCHours(next.getUTCHours() + 1)

  const y = next.getUTCFullYear()
  const m = String(next.getUTCMonth() + 1).padStart(2, '0')
  const d = String(next.getUTCDate()).padStart(2, '0')
  const h = String(next.getUTCHours()).padStart(2, '0')
  const min = String(next.getUTCMinutes()).padStart(2, '0')
  const sec = String(next.getUTCSeconds()).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}:${sec}`
}

function buildEventTiming(task: Task) {
  if (!task.due_date) {
    return null
  }

  if (isDateOnly(task.due_date)) {
    const startDate = new Date(`${task.due_date}T00:00:00`)
    if (Number.isNaN(startDate.getTime())) return null
    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + 1)
    return {
      start: { date: task.due_date },
      end: { date: endDate.toISOString().slice(0, 10) },
    }
  }

  if (isNaiveDateTime(task.due_date)) {
    const normalizedStart = task.due_date.length === 16
      ? `${task.due_date}:00`
      : task.due_date
    const timeZone = getCalendarTimeZone()
    return {
      start: { dateTime: normalizedStart, timeZone },
      end: { dateTime: addOneHourToNaiveDateTime(normalizedStart), timeZone },
    }
  }

  const startDate = new Date(task.due_date)
  if (Number.isNaN(startDate.getTime())) {
    return null
  }

  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000)
  const timeZone = getCalendarTimeZone()
  return {
    start: { dateTime: startDate.toISOString(), timeZone },
    end: { dateTime: endDate.toISOString(), timeZone },
  }
}

function buildTaskDescription(task: Task) {
  const parts: string[] = []
  if (task.description?.trim()) parts.push(task.description.trim())
  parts.push(`Status: ${task.status}`)
  const assignedNames = getAssignedNames(task)
  if (assignedNames.length > 0) parts.push(`Assigned to: ${assignedNames.join(', ')}`)
  const address = typeof task.custom_fields?.address === 'string' ? task.custom_fields.address.trim() : ''
  if (address) parts.push(`Address: ${address}`)
  const appUrl = cleanEnvValue(process.env.APP_URL)
  if (appUrl) parts.push(`Yorki task: ${appUrl}/dashboard?task=${encodeURIComponent(task.id)}`)
  return parts.join('\n\n') || undefined
}

function buildCalendarEvent(
  task: Task,
  assignedUser: UserProfile | null,
): { reason: string } | { event: calendar_v3.Schema$Event } {
  if (task.custom_fields?.send_to_calendar !== true) {
    return { reason: 'Task is not marked for calendar sync.' } as const
  }

  const timing = buildEventTiming(task)
  if (!timing) {
    return { reason: 'Task is missing a valid date/time.' } as const
  }

  const address = typeof task.custom_fields?.address === 'string' ? task.custom_fields.address.trim() : ''

  return {
    event: {
      summary: task.title,
      location: address || undefined,
      description: buildTaskDescription(task),
      extendedProperties: {
        private: {
          yorkiTaskId: task.id,
        },
      },
      ...timing,
    } satisfies calendar_v3.Schema$Event,
  } as const
}

export async function upsertGoogleCalendarEvent(task: Task, assignedUser: UserProfile | null): Promise<CalendarSyncResult> {
  const calendarId = getCalendarId()
  if (!calendarId) {
    return { status: 'skipped', reason: 'GOOGLE_CALENDAR_ID is not configured.' }
  }

  const built = buildCalendarEvent(task, assignedUser)
  if ('reason' in built) {
    return { status: 'skipped', reason: built.reason }
  }

  const calendar = await getCalendarClient()
  const sendUpdates = 'none'

  if (task.google_calendar_event_id) {
    try {
      await calendar.events.update({
        calendarId,
        eventId: task.google_calendar_event_id,
        requestBody: built.event,
        sendUpdates,
      })
      return { status: 'updated', eventId: task.google_calendar_event_id }
    } catch (err) {
      const status = getErrorStatus(err)
      if (status !== 404) {
        throw err
      }
    }
  }

  const response = await calendar.events.insert({
    calendarId,
    requestBody: built.event,
    sendUpdates,
  })

  if (!response.data.id) {
    throw new Error('Google Calendar event creation succeeded without returning an event ID')
  }

  return { status: 'created', eventId: response.data.id }
}

export async function deleteGoogleCalendarEvent(task: Task, assignedUser: UserProfile | null): Promise<CalendarSyncResult> {
  const calendarId = getCalendarId()
  if (!calendarId) {
    return { status: 'skipped', reason: 'GOOGLE_CALENDAR_ID is not configured.' }
  }
  if (!task.google_calendar_event_id) {
    return { status: 'skipped', reason: 'Task has no linked Google Calendar event.' }
  }

  const calendar = await getCalendarClient()
  try {
    await calendar.events.delete({
      calendarId,
      eventId: task.google_calendar_event_id,
      sendUpdates: 'none',
    })
  } catch (err) {
    const status = getErrorStatus(err)
    if (status !== 404) {
      throw err
    }
  }
  return { status: 'deleted' }
}
