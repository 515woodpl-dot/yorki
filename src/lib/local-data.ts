/**
 * local-data.ts — data access layer (SQLite via better-sqlite3)
 *
 * All queries are synchronous (better-sqlite3 is sync-only).
 * JSON columns are serialised/deserialised here — callers see typed objects.
 */

import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type {
  ActivityLog,
  ActivityLogEntry,
  Board,
  Column,
  Comment,
  CommentWithAuthor,
  SessionUser,
  Setting,
  Task,
  TaskStatus,
  UserProfile,
  UserRole,
} from '@/lib/types'

export const DEFAULT_BOARD_ID   = '00000000-0000-0000-0000-000000000001'
export const LOCAL_CURRENT_USER_ID = '11111111-1111-1111-1111-111111111111'

// ─── Row mappers (SQLite rows → typed objects) ────────────────────────────────

function mapTask(row: Record<string, unknown>): Task {
  return {
    ...(row as unknown as Task),
    has_real_due_date: row.has_real_due_date === 1,
    labels:        JSON.parse((row.labels       as string) || '[]'),
    watchers:      JSON.parse((row.watchers     as string) || '[]'),
    custom_fields: JSON.parse((row.custom_fields as string) || '{}'),
  }
}

function mapComment(row: Record<string, unknown>): Comment {
  return { ...(row as unknown as Comment), is_internal: row.is_internal === 1 }
}

function mapUser(row: Record<string, unknown>): UserProfile {
  const { password_hash: _passwordHash, ...profile } = row
  return { ...(profile as unknown as UserProfile), is_active: row.is_active === 1 }
}

function mapColumn(row: Record<string, unknown>): Column {
  return {
    ...(row as unknown as Column),
    is_default: row.is_default === 1,
    is_archive: row.is_archive === 1,
  }
}

function now() { return new Date().toISOString() }

function fallbackUser(userId: string): UserProfile {
  const timestamp = now()
  return {
    id: userId,
    full_name: 'Unknown user',
    display_name: 'Unknown user',
    email: null,
    department: null,
    role: 'staff',
    avatar_url: null,
    is_active: false,
    created_at: timestamp,
    updated_at: timestamp,
  }
}

// ─── Users ────────────────────────────────────────────────────────────────────

export function toSessionUser(user: UserProfile): SessionUser {
  return {
    id:           user.id,
    email:        user.email ?? '',
    role:         user.role,
    full_name:    user.full_name,
    display_name: user.display_name,
    avatar_url:   user.avatar_url,
  }
}

export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  const db  = getDb()
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(LOCAL_CURRENT_USER_ID) as Record<string, unknown> | undefined
  return row ? mapUser(row) : null
}

export async function getCurrentSessionUser(): Promise<SessionUser | null> {
  const user = await getCurrentUserProfile()
  return user ? toSessionUser(user) : null
}

export function findUser(userId: string | null | undefined): UserProfile | null {
  if (!userId) return null
  const db  = getDb()
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown> | undefined
  return row ? mapUser(row) : null
}

export async function getAllUsers(): Promise<UserProfile[]> {
  const db   = getDb()
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as Record<string, unknown>[]
  return rows.map(mapUser)
}

export async function createUser(email: string, fullName: string, role: UserRole): Promise<void> {
  const db = getDb()
  const n  = now()
  db.prepare(`INSERT INTO users (id,full_name,display_name,email,department,role,avatar_url,is_active,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), fullName, fullName, email, null, role, null, 1, n, n)
}

export async function updateUserRole(userId: string, newRole: UserRole): Promise<void> {
  getDb().prepare('UPDATE users SET role=?, updated_at=? WHERE id=?').run(newRole, now(), userId)
}

export async function toggleUserActive(userId: string, isActive: boolean): Promise<void> {
  getDb().prepare('UPDATE users SET is_active=?, updated_at=? WHERE id=?').run(isActive ? 1 : 0, now(), userId)
}

export async function deleteUser(userId: string): Promise<void> {
  const db = getDb()
  const relatedTasks = db.prepare(`
    SELECT COUNT(*) as n FROM tasks
    WHERE deleted_at IS NULL AND (submitted_by=? OR assigned_to=?)
  `).get(userId, userId) as { n: number }
  if (relatedTasks.n > 0) {
    throw new Error('Cannot delete a user with assigned or submitted tasks.')
  }

  const relatedComments = db.prepare(`
    SELECT COUNT(*) as n FROM comments
    WHERE deleted_at IS NULL AND author_id=?
  `).get(userId) as { n: number }
  if (relatedComments.n > 0) {
    throw new Error('Cannot delete a user with comment history.')
  }

  db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId)
  db.prepare('DELETE FROM invites WHERE user_id=?').run(userId)
  db.prepare('DELETE FROM users WHERE id=?').run(userId)
}

// ─── Columns ──────────────────────────────────────────────────────────────────

export async function getActiveColumns(boardId = DEFAULT_BOARD_ID, includeArchive = false): Promise<Column[]> {
  const db   = getDb()
  const rows = db.prepare(`
    SELECT * FROM columns
    WHERE board_id=? AND deleted_at IS NULL ${includeArchive ? '' : 'AND is_archive=0'}
    ORDER BY position
  `).all(boardId) as Record<string, unknown>[]
  return rows.map(mapColumn)
}

export async function createColumn(boardId: string, name: string, color = '#6b7280'): Promise<void> {
  const db = getDb()
  const n = now()
  const completedColumn = db.prepare(`
    SELECT id, position FROM columns
    WHERE board_id=? AND deleted_at IS NULL AND LOWER(name)='completed'
    LIMIT 1
  `).get(boardId) as { id: string; position: number } | undefined

  let insertPosition =
    (db.prepare('SELECT MAX(position) as m FROM columns WHERE board_id=? AND deleted_at IS NULL AND is_archive=0').get(boardId) as { m: number | null }).m ?? 0

  if (completedColumn) {
    db.prepare(`
      UPDATE columns
      SET position = position + 1000, updated_at=?
      WHERE board_id=? AND deleted_at IS NULL AND position >= ?
    `).run(n, boardId, completedColumn.position)
    insertPosition = completedColumn.position
  } else {
    insertPosition += 1000
  }

  db.prepare(`INSERT INTO columns (id,board_id,name,color,position,is_default,is_archive,created_at,updated_at,deleted_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), boardId, name.trim(), color, insertPosition, 0, 0, n, n, null)
}

export async function updateColumn(columnId: string, updates: { name?: string; color?: string }): Promise<void> {
  const db = getDb()
  if (updates.name  !== undefined) db.prepare('UPDATE columns SET name=?,  updated_at=? WHERE id=?').run(updates.name,  now(), columnId)
  if (updates.color !== undefined) db.prepare('UPDATE columns SET color=?, updated_at=? WHERE id=?').run(updates.color, now(), columnId)
}

export async function deleteColumn(columnId: string): Promise<void> {
  const db  = getDb()
  const col = db.prepare('SELECT * FROM columns WHERE id=? AND deleted_at IS NULL').get(columnId) as Record<string, unknown> | undefined
  if (!col) throw new Error('Column not found')
  if (col.is_default) throw new Error('Cannot delete the default Inbox column.')
  if (col.is_archive) throw new Error('Cannot delete the Archive column.')
  const active = (db.prepare('SELECT COUNT(*) as n FROM tasks WHERE column_id=? AND deleted_at IS NULL').get(columnId) as { n: number }).n
  if (active > 0) throw new Error(`Move or archive the ${active} task(s) in this column first.`)
  db.prepare('UPDATE columns SET deleted_at=?, updated_at=? WHERE id=?').run(now(), now(), columnId)
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function getActiveTasks(boardId = DEFAULT_BOARD_ID): Promise<Task[]> {
  const rows = getDb().prepare(`
    SELECT * FROM tasks WHERE board_id=? AND deleted_at IS NULL ORDER BY position
  `).all(boardId) as Record<string, unknown>[]
  return rows.map(mapTask)
}

export async function getTaskById(taskId: string): Promise<Task | null> {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL').get(taskId) as Record<string, unknown> | undefined
  return row ? mapTask(row) : null
}

export async function createTask(input: {
  boardId: string; columnId: string; title: string; description?: string | null
  priority: string; submittedBy: string; dueDate?: string | null; hasRealDueDate?: boolean
  labels?: string[]; watchers?: string[]; customFields?: Record<string, unknown>; assignedTo?: string | null; googleCalendarEventId?: string | null
}): Promise<Task> {
  const db = getDb()
  const maxPos = (db.prepare('SELECT MAX(position) as m FROM tasks WHERE column_id=? AND deleted_at IS NULL').get(input.columnId) as { m: number | null }).m ?? 0
  const n   = now()
  const id  = randomUUID()
  db.prepare(`
    INSERT INTO tasks (id,board_id,column_id,title,description,status,priority,position,
      submitted_by,assigned_to,due_date,has_real_due_date,completed_at,
      labels,watchers,google_calendar_event_id,custom_fields,created_at,updated_at,deleted_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, input.boardId, input.columnId,
    input.title.trim(), input.description ?? null,
    'new', input.priority, maxPos + 1000,
    input.submittedBy, input.assignedTo ?? null,
    input.dueDate ?? null, input.hasRealDueDate ? 1 : 0, null,
    JSON.stringify(input.labels ?? []),
    JSON.stringify(input.watchers ?? [input.submittedBy]),
    input.googleCalendarEventId ?? null,
    JSON.stringify(input.customFields ?? {}), n, n, null
  )
  return (await getTaskById(id))!
}

export async function getTaskByShareToken(shareToken: string): Promise<Task | null> {
  const tasks = await getActiveTasks()
  return tasks.find((task) => task.custom_fields?.share_token === shareToken) ?? null
}

export async function updateTask(taskId: string, updates: Record<string, unknown>): Promise<Task | null> {
  const db   = getDb()
  const n    = now()
  const sets: string[] = ['updated_at=?']
  const vals: unknown[] = [n]

  const colMap: Record<string, string> = {
    title: 'title', description: 'description', priority: 'priority',
    column_id: 'column_id', assigned_to: 'assigned_to', position: 'position',
    status: 'status', completed_at: 'completed_at', due_date: 'due_date',
    has_real_due_date: 'has_real_due_date', google_calendar_event_id: 'google_calendar_event_id', custom_fields: 'custom_fields',
  }

  for (const [k, v] of Object.entries(updates)) {
    if (k in colMap) {
      sets.push(`${colMap[k]}=?`)
      vals.push(
        typeof v === 'boolean'
          ? (v ? 1 : 0)
          : k === 'custom_fields'
            ? JSON.stringify(v ?? {})
            : v,
      )
    }
  }

  vals.push(taskId)
  db.prepare(`UPDATE tasks SET ${sets.join(',')} WHERE id=? AND deleted_at IS NULL`).run(...vals)
  return getTaskById(taskId)
}

export async function moveTask(taskId: string, newColumnId: string, newPosition: number): Promise<void> {
  getDb().prepare('UPDATE tasks SET column_id=?, position=?, updated_at=? WHERE id=? AND deleted_at IS NULL')
    .run(newColumnId, newPosition, now(), taskId)
}

export async function softDeleteTask(taskId: string): Promise<void> {
  getDb().prepare('UPDATE tasks SET deleted_at=?, updated_at=? WHERE id=?').run(now(), now(), taskId)
}

// ─── Comments ────────────────────────────────────────────────────────────────

export async function getTaskComments(taskId: string, includeInternal = true) {
  const db   = getDb()
  const rows = db.prepare(`
    SELECT * FROM comments WHERE task_id=? AND deleted_at IS NULL
    ${includeInternal ? '' : 'AND is_internal=0'}
    ORDER BY created_at
  `).all(taskId) as Record<string, unknown>[]

  return rows.map(row => {
    const comment = mapComment(row)
    const author  = findUser(comment.author_id) ?? fallbackUser(comment.author_id)
    const result: CommentWithAuthor = { ...comment, author }
    return result
  })
}

export async function createComment(taskId: string, authorId: string, body: string, isInternal: boolean): Promise<Comment> {
  const n  = now()
  const id = randomUUID()
  getDb().prepare(`
    INSERT INTO comments (id,task_id,author_id,body,is_internal,created_at,updated_at,deleted_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(id, taskId, authorId, body.trim(), isInternal ? 1 : 0, n, n, null)
  const row = getDb().prepare('SELECT * FROM comments WHERE id=?').get(id) as Record<string, unknown>
  return mapComment(row)
}

export async function softDeleteComment(commentId: string): Promise<void> {
  getDb().prepare('UPDATE comments SET deleted_at=?, updated_at=? WHERE id=?').run(now(), now(), commentId)
}

// ─── Attachments ──────────────────────────────────────────────────────────────

export async function getTaskAttachments(taskId: string) {
  return getDb().prepare(`
    SELECT * FROM attachments WHERE task_id=? AND deleted_at IS NULL ORDER BY created_at
  `).all(taskId) as import('@/lib/types').Attachment[]
}

export async function getAttachmentById(attachmentId: string) {
  return getDb().prepare(`
    SELECT * FROM attachments WHERE id=? AND deleted_at IS NULL
  `).get(attachmentId) as import('@/lib/types').Attachment | undefined
}

export async function createAttachment(input: {
  id?: string
  taskId: string; uploadedBy: string; fileName: string
  fileSize: number; fileType: string; storagePath: string; publicUrl: string
}): Promise<import('@/lib/types').Attachment> {
  const n  = now()
  const id = input.id ?? randomUUID()
  getDb().prepare(`
    INSERT INTO attachments (id,task_id,uploaded_by,file_name,file_size,file_type,storage_path,public_url,created_at,deleted_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(id, input.taskId, input.uploadedBy, input.fileName, input.fileSize, input.fileType, input.storagePath, input.publicUrl, n, null)
  return getDb().prepare('SELECT * FROM attachments WHERE id=?').get(id) as import('@/lib/types').Attachment
}

export async function softDeleteAttachment(attachmentId: string): Promise<void> {
  getDb().prepare('UPDATE attachments SET deleted_at=? WHERE id=? AND deleted_at IS NULL').run(now(), attachmentId)
}

// ─── Activity logs ────────────────────────────────────────────────────────────

export async function createActivityLog(input: Omit<ActivityLog, 'id' | 'created_at'>): Promise<void> {
  getDb().prepare(`
    INSERT INTO activity_logs (id,actor_id,task_id,entity_type,entity_id,action,metadata,created_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(randomUUID(), input.actor_id, input.task_id, input.entity_type, input.entity_id, input.action, JSON.stringify(input.metadata), now())
}

export async function getRecentActivityLogs(limit = 100): Promise<ActivityLogEntry[]> {
  const rows = getDb().prepare(`
    SELECT
      al.*,
      u.full_name AS actor_full_name,
      u.display_name AS actor_display_name,
      u.email AS actor_email,
      t.title AS task_title
    FROM activity_logs al
    LEFT JOIN users u ON u.id = al.actor_id
    LEFT JOIN tasks t ON t.id = al.task_id
    ORDER BY al.created_at DESC
    LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>

  return rows.map((row) => ({
    id: row.id as string,
    actor_id: row.actor_id as string | null,
    task_id: row.task_id as string | null,
    entity_type: row.entity_type as string,
    entity_id: row.entity_id as string | null,
    action: row.action as ActivityLog['action'],
    metadata: JSON.parse((row.metadata as string) || '{}'),
    created_at: row.created_at as string,
    actor_name: (row.actor_full_name as string | null) ?? (row.actor_display_name as string | null) ?? null,
    actor_email: row.actor_email as string | null,
    task_title: row.task_title as string | null,
  }))
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = getDb().prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined
  if (!row) return fallback
  try { return JSON.parse(row.value) as T } catch { return fallback }
}

export async function upsertSetting(key: string, value: unknown, actorId = LOCAL_CURRENT_USER_ID): Promise<void> {
  const n = now()
  getDb().prepare(`
    INSERT INTO settings (id,key,value,updated_by,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at
  `).run(randomUUID(), key, JSON.stringify(value), actorId, n)
}

// ─── Helpers kept for compatibility ──────────────────────────────────────────

export function nextPosition(items: { position: number }[]): number {
  if (!items.length) return 1000
  return Math.max(...items.map(i => i.position)) + 1000
}

// Legacy — kept so old callers still compile until fully migrated
export async function readStore() {
  throw new Error('readStore() removed — use individual db functions from local-data.ts')
}
export async function writeStore() {
  throw new Error('writeStore() removed — use individual db functions from local-data.ts')
}
export async function updateStore<T>(mutate: (store: never) => Promise<T> | T): Promise<T> {
  throw new Error('updateStore() removed — use individual db functions from local-data.ts')
}
export function settingValue<T>(_store: unknown, _key: string, fallback: T): T { return fallback }
export function activeColumns() { return [] }
export function activeTasks()   { return [] }
export function findUser_legacy() { return null }
