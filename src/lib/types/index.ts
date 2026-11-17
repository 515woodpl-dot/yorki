// ─────────────────────────────────────────────────────────────────────────────
// CORE DOMAIN TYPES
// These match the database schema 1:1.
// Every component, server action, and API route uses these.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Enums ───────────────────────────────────────────────────────────────────

export type UserRole = 'super_admin' | 'admin' | 'staff'

export type TaskStatus =
  | 'new'
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'archived'

export type Priority = 'low' | 'normal' | 'high' | 'urgent'

export type FieldType =
  | 'text'
  | 'textarea'
  | 'date'
  | 'select'
  | 'checkbox'
  | 'file'
  | 'email'
  | 'number'
  | 'priority'
  | 'labels'
  | 'url'

export type ActivityAction =
  | 'task_created'
  | 'task_updated'
  | 'task_moved'
  | 'task_completed'
  | 'task_archived'
  | 'task_restored'
  | 'task_deleted'
  | 'comment_added'
  | 'comment_deleted'
  | 'attachment_added'
  | 'attachment_deleted'
  | 'settings_changed'
  | 'user_created'
  | 'user_updated'
  | 'column_created'
  | 'column_updated'
  | 'column_deleted'

// ─── Database Row Types ───────────────────────────────────────────────────────

export interface Board {
  id: string
  name: string
  slug: string
  description: string | null
  is_default: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Column {
  id: string
  board_id: string
  name: string
  color: string | null
  position: number
  is_default: boolean   // the "Inbox" column
  is_archive: boolean   // the hidden archive column
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface UserProfile {
  id: string
  full_name: string | null
  display_name: string | null
  email: string | null
  department: string | null
  role: UserRole
  avatar_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Task {
  id: string
  board_id: string
  column_id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: Priority
  position: number
  submitted_by: string
  assigned_to: string | null
  due_date: string | null
  has_real_due_date: boolean
  completed_at: string | null
  labels: string[]
  watchers: string[]
  google_calendar_event_id: string | null
  custom_fields: Record<string, unknown>
  /** Incremented on every user-visible change. Used for conflict detection. */
  version: number
  /** User who made the most recent change. */
  updated_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Comment {
  id: string
  task_id: string
  author_id: string
  body: string
  is_internal: boolean  // admin-only notes, invisible to staff
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Attachment {
  id: string
  task_id: string
  uploaded_by: string
  file_name: string
  file_size: number | null
  file_type: string | null
  storage_path: string
  public_url: string | null
  created_at: string
  deleted_at: string | null
}

export interface FieldDefinition {
  id: string
  board_id: string | null
  label: string
  field_key: string
  field_type: FieldType
  options: string[] | null   // for 'select' type
  is_required: boolean
  is_visible: boolean
  position: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface ActivityLog {
  id: string
  actor_id: string | null
  task_id: string | null
  entity_type: string
  entity_id: string | null
  action: ActivityAction
  metadata: Record<string, unknown>
  created_at: string
}

export interface ActivityLogEntry extends ActivityLog {
  actor_name: string | null
  actor_email: string | null
  task_title: string | null
}

export interface Notification {
  id: string
  user_id: string
  task_id: string | null
  type: string
  message: string
  is_read: boolean
  created_at: string
}

export interface Setting {
  id: string
  key: string
  value: unknown
  description: string | null
  updated_by: string | null
  updated_at: string
}

// ─── Composed / Joined Types ──────────────────────────────────────────────────
// Used in UI — tasks with their related data already fetched

export interface TaskWithRelations extends Task {
  /** Who made the most recent change (for "changed by …" messages). */
  updated_by_profile?: UserProfile | null
  submitted_by_profile: UserProfile
  assigned_to_profile: UserProfile | null
  assigned_to_profiles: UserProfile[]
  column: Column
  comments: CommentWithAuthor[]
  attachments: Attachment[]
  _comment_count: number
  _attachment_count: number
}

export interface CommentWithAuthor extends Comment {
  author: UserProfile
}

export interface ColumnWithTasks extends Column {
  tasks: TaskWithRelations[]
}

// ─── Settings Shapes ─────────────────────────────────────────────────────────
// The settings table uses JSONB values. These type the value field.

export interface BrandingSettings {
  app_name: string
  logo_url: string | null
  primary_color: string   // HSL string e.g. "224 70% 40%"
  accent_color: string
}

export interface EmailSettings {
  notification_to: string        // where completion emails go
  reply_to: string | null
  subject_prefix: string         // e.g. "[Yorki]"
  notify_on_submit: boolean
  notify_on_complete: boolean
  notify_on_comment: boolean
  /** Email people when they are @mentioned (in-app notifications are always on). */
  notify_on_mention?: boolean
}

export interface ThemeSettings {
  default_mode: 'light' | 'dark' | 'auto'
}

// ─── Form / Action Types ──────────────────────────────────────────────────────

export interface CreateTaskInput {
  title: string
  description?: string | null
  priority: Priority
  due_date?: string | null
  labels?: string[]
  custom_fields?: Record<string, unknown>
  recipient_email?: string | null
  assigned_to?: string | string[] | null
}

export interface UpdateTaskInput extends Partial<CreateTaskInput> {
  id: string
  column_id?: string
  status?: TaskStatus
  assigned_to?: string | string[] | null
  position?: number
}

export interface MoveTaskInput {
  task_id: string
  new_column_id: string
  new_position: number
}

export interface CreateCommentInput {
  task_id: string
  body: string
  is_internal?: boolean
}

// ─── Server Action Response Wrapper ──────────────────────────────────────────

export type ActionResult<T = void> =
  | { success: true;  data: T;      error?: never; code?: never }
  | { success: false; error: string; data?: never; code?: 'conflict' | 'forbidden' | 'not_found' | 'error' }

// ─── Multi-user collaboration ────────────────────────────────────────────────

/**
 * What the client believed about the card when the user started the action.
 * The server rejects the action (code: 'conflict') if reality differs, instead
 * of silently overwriting another person's work.
 *
 * - column_id / status: for moves and Complete / Archive / Reopen / Restore
 * - fields: the values of the fields being edited, as the user saw them.
 *   Edits to *other* fields by other people do not cause a conflict.
 * - version: exact-match check (used for destructive actions such as delete)
 */
export interface TaskExpectation {
  version?: number
  column_id?: string
  status?: TaskStatus
  fields?: Partial<Pick<Task, 'title' | 'description' | 'due_date' | 'priority' | 'assigned_to'>> & {
    assigned_user_ids?: string[]
    custom_fields?: Record<string, unknown>
  }
}

export type PresenceMode = 'viewing' | 'editing'

export interface TaskPresence {
  task_id: string
  user_id: string
  user_name: string
  mode: PresenceMode
}

export type NotificationType = 'mention' | 'comment' | 'assigned' | 'completed'

export interface AppNotification {
  id: string
  type: NotificationType
  task_id: string | null
  task_title: string | null
  actor_id: string | null
  actor_name: string | null
  snippet: string | null
  created_at: string
  read_at: string | null
}

export interface MentionableUser {
  id: string
  name: string
  role: UserRole
}

export interface BoardSnapshot {
  columns: ColumnWithTasks[]
  presence: TaskPresence[]
  seq: number
}

// ─── Auth / Session ───────────────────────────────────────────────────────────

export interface SessionUser {
  id: string
  email: string
  role: UserRole
  full_name: string | null
  display_name: string | null
  avatar_url: string | null
}
