'use server'

import { randomBytes } from 'node:crypto'
import { getDb } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { requireRole } from '@/lib/auth'
import { sendInviteEmail } from '@/lib/actions/email'
import type { ActionResult } from '@/lib/types'

const INVITE_HOURS = 48

export interface InviteRecord {
  id:         string
  user_id:    string
  token:      string
  expires_at: string
  used_at:    string | null
  created_at: string
}

export interface InviteWithUser extends InviteRecord {
  full_name:    string | null
  display_name: string | null
  email:        string | null
  role:         string
}

// ─── Create invite ────────────────────────────────────────────────────────────

export async function createInvite(userId: string): Promise<{ token: string; url: string }> {
  const actor = await requireRole('admin', 'super_admin')
  const db      = getDb()
  const target = db.prepare('SELECT id, role FROM users WHERE id = ? AND is_active = 1').get(userId) as { id: string; role: string } | undefined
  if (!target) throw new Error('Active user not found.')
  if (target.role === 'super_admin' && actor.role !== 'super_admin') throw new Error('Only a super admin can reset this account.')
  const token   = randomBytes(32).toString('hex')
  const now     = new Date()
  const expires = new Date(now.getTime() + INVITE_HOURS * 60 * 60 * 1000)

  // Invalidate any previous unused invites for this user
  db.prepare(`DELETE FROM invites WHERE user_id = ? AND used_at IS NULL`).run(userId)

  db.prepare(`
    INSERT INTO invites (id, user_id, token, expires_at, used_at, created_at)
    VALUES (?, ?, ?, ?, NULL, ?)
  `).run(randomBytes(8).toString('hex'), userId, token, expires.toISOString(), now.toISOString())

  const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  const url    = `${appUrl}/invite/${token}`

  return { token, url }
}

// ─── Validate invite (public — no auth) ──────────────────────────────────────

export async function validateInvite(token: string): Promise<InviteWithUser | null> {
  const db  = getDb()
  const now = new Date().toISOString()

  const row = db.prepare(`
    SELECT i.*, u.full_name, u.display_name, u.email, u.role
    FROM invites i
    JOIN users u ON u.id = i.user_id
    WHERE i.token = ?
      AND i.expires_at > ?
      AND i.used_at IS NULL
      AND u.is_active = 1
  `).get(token, now) as InviteWithUser | undefined

  return row ?? null
}

// ─── Accept invite — set password ────────────────────────────────────────────

export async function acceptInvite(
  token: string,
  password: string
): Promise<ActionResult> {
  try {
    if (password.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters.' }
    }

    const invite = await validateInvite(token)
    if (!invite) {
      return { success: false, error: 'This invite link is invalid or has expired.' }
    }

    const db   = getDb()
    const hash = await hashPassword(password)

    // Recheck after hashing: another request may have consumed or revoked the invite.
    const accepted = db.transaction(() => {
      const now = new Date().toISOString()
      const claimed = db.prepare(`
        UPDATE invites SET used_at = ?
        WHERE token = ? AND used_at IS NULL AND expires_at > ?
          AND EXISTS (SELECT 1 FROM users WHERE id = invites.user_id AND is_active = 1)
      `).run(now, token, now)
      if (claimed.changes !== 1) return false
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(hash, now, invite.user_id)
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(invite.user_id)
      db.prepare('DELETE FROM invites WHERE user_id = ? AND used_at IS NULL').run(invite.user_id)
      return true
    })()
    if (!accepted) return { success: false, error: 'This invite link is invalid or has expired.' }

    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ─── Resend invite (admin) ────────────────────────────────────────────────────

export async function resendInvite(userId: string): Promise<ActionResult> {
  try {
    const actor = await requireRole('admin', 'super_admin')
    const target = getDb().prepare('SELECT email, full_name, role FROM users WHERE id = ?').get(userId) as {
      email: string | null; full_name: string | null; role: string
    } | undefined
    if (!target?.email) throw new Error('User email not found.')
    if (target.role === 'super_admin' && actor.role !== 'super_admin') {
      throw new Error('Only a super admin can reset this account.')
    }
    const { url } = await createInvite(userId)
    const delivery = await sendInviteEmail(target.email, target.full_name ?? target.email, target.role, url)
    if (!delivery.delivered) return { success: false, error: delivery.error ?? 'The invitation email could not be sent.' }
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
