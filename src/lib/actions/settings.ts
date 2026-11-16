'use server'

import { readFile } from 'node:fs/promises'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { createInvite } from '@/lib/actions/invite'
import { sendInviteEmail } from '@/lib/actions/email'
import {
  getSetting, upsertSetting,
  getAllUsers, createUser as dbCreateUser,
  updateUserRole as dbUpdateUserRole,
  toggleUserActive as dbToggleUserActive,
  deleteUser as dbDeleteUser,
  createColumn as dbCreateColumn,
  updateColumn as dbUpdateColumn,
  deleteColumn as dbDeleteColumn,
  getActiveColumns,
  createActivityLog,
  DEFAULT_BOARD_ID,
} from '@/lib/local-data'
import type {
  ActionResult, BrandingSettings, EmailSettings,
  ThemeSettings, UserProfile,
} from '@/lib/types'

function normalizePath(path: string) {
  return process.env.NODE_ENV === 'production' ? `/task${path}` : path
}

function getActiveAdminCount() {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS count
    FROM users
    WHERE is_active = 1 AND role IN ('admin', 'super_admin')
  `).get() as { count: number }
  return row.count
}

function assertMayManageUser(actor: { role: string }, userId: string) {
  const target = getDb().prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined
  if (!target) throw new Error('User not found.')
  if (target.role === 'super_admin' && actor.role !== 'super_admin') {
    throw new Error('Only a super admin can manage this account.')
  }
}

const BACKUP_HEARTBEAT_PATH = '/var/lib/yorki/.last_backup_ok'
const BACKUP_LOG_PATH = '/var/log/yorki-rclone.log'
const BACKUP_STALE_MINUTES = 10 * 60

export interface BackupHistory {
  lastBackupOkUtc: string | null
  minutesSinceLast: number | null
  status: 'ok' | 'stale' | 'unknown'
  recentLogLines: string[]
}

export async function getBackupHistory(): Promise<BackupHistory> {
  await requireRole('admin', 'super_admin')

  let lastBackupOkUtc: string | null = null
  let recentLogLines: string[] = []

  try {
    const heartbeat = (await readFile(BACKUP_HEARTBEAT_PATH, 'utf8')).trim()
    if (heartbeat) lastBackupOkUtc = heartbeat
  } catch {
    // Missing heartbeat means unknown status.
  }

  try {
    const logContent = await readFile(BACKUP_LOG_PATH, 'utf8')
    const allLines = logContent
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    recentLogLines = allLines.slice(-40)
  } catch {
    recentLogLines = ['Backup log file not found yet.']
  }

  if (!lastBackupOkUtc) {
    return {
      lastBackupOkUtc: null,
      minutesSinceLast: null,
      status: 'unknown',
      recentLogLines,
    }
  }

  const last = new Date(lastBackupOkUtc).getTime()
  const now = Date.now()
  const minutesSinceLast = Number.isNaN(last)
    ? null
    : Math.max(0, Math.floor((now - last) / (1000 * 60)))

  return {
    lastBackupOkUtc,
    minutesSinceLast,
    status: minutesSinceLast !== null && minutesSinceLast <= BACKUP_STALE_MINUTES ? 'ok' : 'stale',
    recentLogLines,
  }
}

export async function getSettings() {
  await requireRole('admin', 'super_admin')
  return {
    branding: await getSetting<BrandingSettings | null>('branding', null),
    email:    await getSetting<EmailSettings | null>('email', null),
    theme:    await getSetting<ThemeSettings | null>('theme', null),
  }
}

export async function updateEmailSettings(input: Partial<EmailSettings>): Promise<ActionResult<EmailSettings>> {
  try {
    const user    = await requireRole('admin', 'super_admin')
    const current = await getSetting<EmailSettings>('email', {
      notification_to: 'team@yorki.local', reply_to: null,
      subject_prefix: '[Yorki]', notify_on_submit: true,
      notify_on_complete: true, notify_on_comment: false,
    })
    const next = { ...current, ...input }
    await upsertSetting('email', next, user.id)
    await createActivityLog({
      actor_id: user.id, task_id: null,
      entity_type: 'settings', entity_id: null,
      action: 'settings_changed',
      metadata: { setting: 'email', fields: Object.keys(input) },
    })
    revalidatePath(normalizePath('/admin/email'))
    return { success: true, data: next }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function updateTheme(mode: 'light' | 'dark' | 'auto'): Promise<ActionResult> {
  try {
    const user = await requireRole('admin', 'super_admin')
    await upsertSetting('theme', { default_mode: mode }, user.id)
    revalidatePath(normalizePath('/'), 'layout')
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function getColumns(boardId: string) {
  await requireRole('admin', 'super_admin')
  return getActiveColumns(boardId, true)
}

export async function createColumn(boardId: string, name: string, color = '#6b7280'): Promise<ActionResult> {
  try {
    const user = await requireRole('admin', 'super_admin')
    await dbCreateColumn(boardId, name, color)
    await createActivityLog({
      actor_id: user.id, task_id: null,
      entity_type: 'column', entity_id: null,
      action: 'column_created', metadata: { name, board_id: boardId },
    })
    revalidatePath(normalizePath('/dashboard'))
    revalidatePath(normalizePath('/admin/columns'))
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function updateColumn(columnId: string, updates: { name?: string; color?: string }): Promise<ActionResult> {
  try {
    const user = await requireRole('admin', 'super_admin')
    await dbUpdateColumn(columnId, updates)
    await createActivityLog({
      actor_id: user.id, task_id: null,
      entity_type: 'column', entity_id: columnId,
      action: 'column_updated', metadata: { fields: Object.keys(updates) },
    })
    revalidatePath(normalizePath('/dashboard'))
    revalidatePath(normalizePath('/admin/columns'))
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function deleteColumn(columnId: string): Promise<ActionResult> {
  try {
    const user = await requireRole('admin', 'super_admin')
    await dbDeleteColumn(columnId)
    await createActivityLog({
      actor_id: user.id, task_id: null,
      entity_type: 'column', entity_id: columnId,
      action: 'column_deleted', metadata: {},
    })
    revalidatePath(normalizePath('/dashboard'))
    revalidatePath(normalizePath('/admin/columns'))
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function getAllUsersAction(): Promise<UserProfile[]> {
  await requireRole('admin', 'super_admin')
  return getAllUsers()
}

export async function createUser(email: string, fullName: string, role: 'staff' | 'admin'): Promise<ActionResult> {
  try {
    const actor = await requireRole('admin', 'super_admin')
    if (role !== 'staff' && role !== 'admin') throw new Error('Invalid role.')
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('Enter a valid email address.')
    if (!fullName.trim()) throw new Error('Enter a full name.')
    const existingUsers = await getAllUsers()
    if (existingUsers.some((user) => user.email?.trim().toLowerCase() === normalizedEmail)) {
      return { success: false, error: 'A user with that email already exists.' }
    }

    await dbCreateUser(normalizedEmail, fullName, role)
    await createActivityLog({
      actor_id: actor.id, task_id: null,
      entity_type: 'user', entity_id: null,
      action: 'user_created', metadata: { email: normalizedEmail, role },
    })
    // Generate invite link and send email
    const users = await getAllUsers()
    const created = users.find(u => u.email?.toLowerCase() === normalizedEmail)
    if (created) {
      const { url } = await createInvite(created.id)
      void sendInviteEmail(normalizedEmail, fullName, role, url)
    }

    revalidatePath(normalizePath('/admin/users'))
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function updateUserRole(userId: string, newRole: 'staff' | 'admin'): Promise<ActionResult> {
  try {
    const actor = await requireRole('admin', 'super_admin')
    assertMayManageUser(actor, userId)
    if (newRole !== 'staff' && newRole !== 'admin') throw new Error('Invalid role.')
    if (actor.id === userId) {
      return { success: false, error: 'You cannot change your own role.' }
    }
    if (newRole === 'staff') {
      const target = (await getAllUsers()).find((user) => user.id === userId)
      const activeAdminCount = getActiveAdminCount()
      if (target?.is_active && (target.role === 'admin' || target.role === 'super_admin') && activeAdminCount <= 1) {
        return { success: false, error: 'You cannot remove the last active admin account.' }
      }
    }
    await dbUpdateUserRole(userId, newRole)
    await createActivityLog({
      actor_id: actor.id, task_id: null,
      entity_type: 'user', entity_id: userId,
      action: 'user_updated', metadata: { new_role: newRole },
    })
    revalidatePath(normalizePath('/admin/users'))
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function toggleUserActive(userId: string, isActive: boolean): Promise<ActionResult> {
  try {
    const actor = await requireRole('admin', 'super_admin')
    assertMayManageUser(actor, userId)
    if (actor.id === userId && !isActive) {
      return { success: false, error: 'You cannot deactivate your own account.' }
    }
    if (!isActive) {
      const target = (await getAllUsers()).find((user) => user.id === userId)
      const activeAdminCount = getActiveAdminCount()
      if (target?.is_active && (target.role === 'admin' || target.role === 'super_admin') && activeAdminCount <= 1) {
        return { success: false, error: 'You cannot deactivate the last active admin account.' }
      }
    }
    await dbToggleUserActive(userId, isActive)
    await createActivityLog({
      actor_id: actor.id, task_id: null,
      entity_type: 'user', entity_id: userId,
      action: 'user_updated', metadata: { is_active: isActive },
    })
    revalidatePath(normalizePath('/admin/users'))
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function setUserPassword(userId: string, password: string): Promise<ActionResult> {
  try {
    const actor = await requireRole('admin', 'super_admin')
    assertMayManageUser(actor, userId)
    if (password.length < 8) return { success: false, error: 'Password must be at least 8 characters.' }
    const hash = await hashPassword(password)
    const db = getDb()
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE id=?')
        .run(hash, new Date().toISOString(), userId)
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
      db.prepare('DELETE FROM invites WHERE user_id = ?').run(userId)
    })()
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function deleteUser(userId: string): Promise<ActionResult> {
  try {
    const actor = await requireRole('admin', 'super_admin')
    assertMayManageUser(actor, userId)
    if (actor.id === userId) {
      return { success: false, error: 'You cannot delete your own account.' }
    }
    const target = (await getAllUsers()).find((user) => user.id === userId)
    const activeAdminCount = getActiveAdminCount()
    if (target?.is_active && (target.role === 'admin' || target.role === 'super_admin') && activeAdminCount <= 1) {
      return { success: false, error: 'You cannot delete the last active admin account.' }
    }
    await dbDeleteUser(userId)
    await createActivityLog({
      actor_id: actor.id, task_id: null,
      entity_type: 'user', entity_id: userId,
      action: 'user_updated', metadata: { deleted: true },
    })
    revalidatePath(normalizePath('/admin/users'))
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function getStaffUsers(): Promise<UserProfile[]> {
  await requireRole('admin', 'super_admin')
  const all = await getAllUsers()
  return all.filter(u => u.is_active && u.role !== 'super_admin')
}
