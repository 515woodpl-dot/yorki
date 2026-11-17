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
    version:       typeof row.version === 'number' ? row.version : 1,
    updated_by:    (row.updated_by as string | null | undefined) ?? null,
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

export function updateUserRole(userId: string, newRole: UserRole): void {
  getDb().prepare('UPDATE users SET role=?, updated_at=? WHERE id=?').run(newRole, now(), userId)
}

export function toggleUserActive(userId: string, isActive: boolean): void {
  getDb().prepare('UPDATE users SET is_active=?, updated_at=? WHERE id=?').run(isActive ? 1 : 0, now(), userId)
}

export function deleteUser(userId: string): { deletedTaskCount: number } {
  const db = getDb()
  const relatedTaskIds = new Set(
    (db.prepare(`
      SELECT id FROM tasks
      WHERE deleted_at IS NULL AND (submitted_by=? OR assigned_to=?)
    `).all(userId, userId) as Array<{ id: string }>).map(({ id }) => id)
  )

  const customAssignments = db.prepare('SELECT id, custom_fields FROM tasks WHERE deleted_at IS NULL').all() as Array<{ id: string; custom_fields: string }>
  for (const { id, custom_fields } of customAssignments) {
    try {
      const value = JSON.parse(custom_fields || '{}') as Record<string, unknown>
      if (Array.isArray(value.assigned_user_ids) && value.assigned_user_ids.includes(userId)) {
        relatedTaskIds.add(id)
      }
    } catch {
      // Invalid legacy JSON cannot create an assignment relationship.
    }
  }

  const deletedAt = now()
  const softDeleteTask = db.prepare('UPDATE tasks SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL')
  for (const taskId of relatedTaskIds) softDeleteTask.run(deletedAt, deletedAt, taskId)

  // A deleted account must not leave visible comments tied to a missing author.
  db.prepare('UPDATE comments SET deleted_at=?, updated_at=? WHERE author_id=? AND deleted_at IS NULL')
    .run(deletedAt, deletedAt, userId)

  db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId)
  db.prepare('DELETE FROM invites WHERE user_id=?').run(userId)
  db.prepare('DELETE FROM users WHERE id=?').run(userId)
  return { deletedTaskCount: relatedTaskIds.size }
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
  const existing = db.prepare('SELECT id FROM columns WHERE id=? AND deleted_at IS NULL').get(columnId)
  if (!existing) throw new Error('Column not found')
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

/**
 * Raised when a change is rejected because someone else changed the card first.
 * `task` is the current server state so the client can show / reload it.
 */
export class TaskConflictError extends Error {
  readonly code = 'conflict' as const
  constructor(message: string, readonly task: Task | null) {
    super(message)
    this.name = 'TaskConflictError'
  }
}

export interface TaskWriteOptions {
  /** Who is making the change (stored in tasks.updated_by). */
  actorId?: string | null
  /**
   * Runs inside the write transaction against the *current* row, before the
   * update is applied. Throw (usually TaskConflictError) to reject the change.
   * Because read + check + write happen in one IMMEDIATE transaction, two
   * people acting on the same card can never both pass the check.
   */
  guard?: (current: Task) => void
  /**
   * Internal bookkeeping writes (e.g. storing a Google Calendar event id)
   * should not bump the version, or they would cause false conflicts.
   */
  bumpVersion?: boolean
}

const TASK_COLUMN_MAP: Record<string, string> = {
  title: 'title', description: 'description', priority: 'priority',
  column_id: 'column_id', assigned_to: 'assigned_to', position: 'position',
  status: 'status', completed_at: 'completed_at', due_date: 'due_date',
  has_real_due_date: 'has_real_due_date', google_calendar_event_id: 'google_calendar_event_id', custom_fields: 'custom_fields',
}

export async function updateTask(
  taskId: string,
  /** Field changes, or a function computing them from the current row (runs inside the transaction). */
  updatesOrFn: Record<string, unknown> | ((current: Task) => Record<string, unknown>),
  options: TaskWriteOptions = {},
): Promise<Task | null> {
  const db = getDb()
  const bumpVersion = options.bumpVersion ?? true

  const run = db.transaction((): Task | null => {
    const row = db.prepare('SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL').get(taskId) as Record<string, unknown> | undefined
    if (!row) return null
    const current = mapTask(row)
    options.guard?.(current)
    const updates = typeof updatesOrFn === 'function' ? updatesOrFn(current) : updatesOrFn

    const sets: string[] = []
    const vals: unknown[] = []
    if (bumpVersion) {
      sets.push('updated_at=?', 'version=version+1', 'updated_by=?')
      vals.push(now(), options.actorId ?? current.updated_by ?? null)
    }

    for (const [k, v] of Object.entries(updates)) {
      if (k in TASK_COLUMN_MAP) {
        sets.push(`${TASK_COLUMN_MAP[k]}=?`)
        vals.push(
          typeof v === 'boolean'
            ? (v ? 1 : 0)
            : k === 'custom_fields'
              ? JSON.stringify(v ?? {})
              : v,
        )
      }
    }
    if (sets.length === 0) return current

    vals.push(taskId)
    db.prepare(`UPDATE tasks SET ${sets.join(',')} WHERE id=? AND deleted_at IS NULL`).run(...vals)
    const updated = db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId) as Record<string, unknown>
    return mapTask(updated)
  })

  // IMMEDIATE takes the write lock up front, so the guard sees the latest row
  // even if several server processes share the database file.
  return run.immediate()
}

export async function moveTask(taskId: string, newColumnId: string, newPosition: number, options: TaskWriteOptions = {}): Promise<Task | null> {
  return updateTask(taskId, { column_id: newColumnId, position: newPosition }, options)
}

export async function softDeleteTask(taskId: string, options: Pick<TaskWriteOptions, 'actorId' | 'guard'> = {}): Promise<boolean> {
  const db = getDb()
  const run = db.transaction((): boolean => {
    const row = db.prepare('SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL').get(taskId) as Record<string, unknown> | undefined
    if (!row) return false
    options.guard?.(mapTask(row))
    const n = now()
    db.prepare('UPDATE tasks SET deleted_at=?, updated_at=?, version=version+1, updated_by=? WHERE id=?')
      .run(n, n, options.actorId ?? null, taskId)
    return true
  })
  return run.immediate()
}

// ─── Live board: change feed ─────────────────────────────────────────────────

export function recordBoardEvent(input: { boardId?: string; taskId?: string | null; actorId?: string | null; type: string }) {
  const db = getDb()
  const info = db.prepare(`
    INSERT INTO board_events (board_id, task_id, actor_id, type, created_at) VALUES (?,?,?,?,?)
  `).run(input.boardId ?? DEFAULT_BOARD_ID, input.taskId ?? null, input.actorId ?? null, input.type, now())

  // Keep the feed small: it is only a "something changed" signal.
  if (Number(info.lastInsertRowid) % 500 === 0) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    db.prepare('DELETE FROM board_events WHERE created_at < ?').run(cutoff)
  }
}

export function getLatestBoardEventSeq(boardId = DEFAULT_BOARD_ID): number {
  const row = getDb().prepare('SELECT MAX(seq) AS seq FROM board_events WHERE board_id=?').get(boardId) as { seq: number | null }
  return row.seq ?? 0
}

// ─── Live board: presence ("who has this card open") ────────────────────────

export const PRESENCE_TTL_MS = 45_000

export function upsertTaskPresence(input: { clientId: string; userId: string; taskId: string; mode: string }) {
  getDb().prepare(`
    INSERT INTO task_presence (client_id, user_id, task_id, mode, updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(client_id) DO UPDATE SET
      user_id=excluded.user_id, task_id=excluded.task_id, mode=excluded.mode, updated_at=excluded.updated_at
  `).run(input.clientId, input.userId, input.taskId, input.mode, now())
}

export function clearTaskPresence(clientId: string, userId: string) {
  getDb().prepare('DELETE FROM task_presence WHERE client_id=? AND user_id=?').run(clientId, userId)
}

export function getActiveTaskPresence() {
  const db = getDb()
  const cutoff = new Date(Date.now() - PRESENCE_TTL_MS).toISOString()
  db.prepare('DELETE FROM task_presence WHERE updated_at < ?').run(cutoff)
  return db.prepare(`
    SELECT p.task_id, p.user_id, p.mode, COALESCE(u.full_name, u.display_name, u.email, 'Someone') AS user_name
    FROM task_presence p
    JOIN users u ON u.id = p.user_id
    ORDER BY p.task_id, p.user_id
  `).all() as Array<{ task_id: string; user_id: string; mode: 'viewing' | 'editing'; user_name: string }>
}

/** Cheap fingerprint of presence, so the live stream can tell when it changed. */
export function getTaskPresenceSignature(): string {
  const cutoff = new Date(Date.now() - PRESENCE_TTL_MS).toISOString()
  const row = getDb().prepare(`
    SELECT group_concat(entry, '|') AS sig FROM (
      SELECT task_id || ':' || user_id || ':' || mode AS entry
      FROM task_presence WHERE updated_at >= ?
      GROUP BY task_id, user_id, mode
      ORDER BY entry
    )
  `).get(cutoff) as { sig: string | null }
  return row.sig ?? ''
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
  const result = getDb().prepare('UPDATE comments SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL').run(now(), now(), commentId)
  if (result.changes !== 1) throw new Error('Comment not found')
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
