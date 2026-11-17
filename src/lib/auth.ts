/**
 * auth.ts — session-based authentication
 *
 * Login:   bcrypt verify password → create session row → set HttpOnly cookie
 * Check:   read cookie → look up session → return user
 * Logout:  delete session row → clear cookie
 *
 * Security:
 *   - Deactivated users blocked at login + session lookup
 *   - Brute-force: 5 attempts per email per 15 min (persistent SQLite counter)
 *   - Expired sessions pruned from DB on every login
 *   - Sessions expire after 10 minutes of inactivity
 */

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import { reserveLoginAttempt, clearLoginAttempts } from './login-rate-limit'
import type { SessionUser, UserProfile, UserRole } from './types'

const COOKIE_NAME = 'yorki_session'
export const SESSION_IDLE_MS = 10 * 60 * 1000

// ─── User mapping ─────────────────────────────────────────────────────────────

function mapUser(row: Record<string, unknown>): UserProfile {
  return {
    ...(row as unknown as UserProfile),
    is_active: row.is_active === 1,
  }
}

// ─── Password ─────────────────────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  if (Buffer.byteLength(plain, 'utf8') > 72) throw new Error('Password must be at most 72 UTF-8 bytes.')
  return bcrypt.hash(plain, 12)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/**
 * Mark the cookie Secure only when the visitor is really on HTTPS. Browsers silently drop a Secure
 * cookie received over plain http (e.g. http://192.168.x.x:3000 or an http Tailscale/LAN address),
 * which made sign-in appear to do nothing. COOKIE_SECURE=true/false overrides the detection.
 */
async function useSecureCookie(): Promise<boolean> {
  const forced = process.env.COOKIE_SECURE
  if (forced === 'true') return true
  if (forced === 'false') return false
  if (process.env.NODE_ENV !== 'production') return false
  try {
    const proto = (await headers()).get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
    return proto === 'https'
  } catch {
    return false
  }
}

// ─── Session ──────────────────────────────────────────────────────────────────

export async function createSession(userId: string): Promise<string> {
  const db        = getDb()
  const sessionId = randomUUID()
  const now       = new Date()
  const expires   = new Date(now.getTime() + SESSION_IDLE_MS)

  // Prune expired sessions for this user to keep the table clean
  db.prepare(`DELETE FROM sessions WHERE user_id = ? AND expires_at < ?`)
    .run(userId, now.toISOString())

  db.prepare(`
    INSERT INTO sessions (id, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, userId, now.toISOString(), expires.toISOString())

  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    path:     '/',
    expires,
    secure:   await useSecureCookie(),
  })

  return sessionId
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies()
    const sessionId   = cookieStore.get(COOKIE_NAME)?.value
    if (!sessionId) return null

    const db  = getDb()
    const now = new Date().toISOString()

    const session = db.prepare(`
      SELECT * FROM sessions WHERE id = ? AND expires_at > ?
    `).get(sessionId, now) as { user_id: string } | undefined

    if (!session) return null

    // is_active = 1 ensures deactivated users are immediately blocked
    const userRow = db.prepare(`
      SELECT * FROM users WHERE id = ? AND is_active = 1
    `).get(session.user_id) as Record<string, unknown> | undefined

    if (!userRow) return null

    const user = mapUser(userRow)
    return {
      id:           user.id,
      email:        user.email ?? '',
      role:         user.role,
      full_name:    user.full_name,
      display_name: user.display_name,
      avatar_url:   user.avatar_url,
    }
  } catch {
    return null
  }
}

export async function destroySession(): Promise<void> {
  try {
    const cookieStore = await cookies()
    const sessionId   = cookieStore.get(COOKIE_NAME)?.value
    if (sessionId) {
      getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
      cookieStore.delete(COOKIE_NAME)
    }
  } catch {}
}

/** Extend an active session after a user interaction. */
export async function refreshSession(): Promise<boolean> {
  try {
    const cookieStore = await cookies()
    const sessionId = cookieStore.get(COOKIE_NAME)?.value
    if (!sessionId) return false

    const db = getDb()
    const now = new Date()
    const session = db.prepare(`
      SELECT s.id
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ? AND u.is_active = 1
    `).get(sessionId, now.toISOString()) as { id: string } | undefined
    if (!session) return false

    const expires = new Date(now.getTime() + SESSION_IDLE_MS)
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(expires.toISOString(), sessionId)
    cookieStore.set(COOKIE_NAME, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires,
      secure: await useSecureCookie(),
    })
    return true
  } catch {
    return false
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function loginWithPassword(
  email: string,
  password: string
): Promise<{ success: true; user: SessionUser } | { success: false; error: string }> {
  try {
    if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 1024) {
      return { success: false, error: 'Incorrect email or password.' }
    }
    const normalised = email.trim().toLowerCase()
    const db = getDb()

    // Rate limit check
    const limit = reserveLoginAttempt(db, normalised)
    if (!limit.allowed) {
      const mins = Math.ceil((limit.remainingMs ?? 900000) / 60000)
      return { success: false, error: `Too many attempts. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.` }
    }

    const row = db.prepare(`
      SELECT * FROM users WHERE LOWER(email) = ? AND is_active = 1
    `).get(normalised) as Record<string, unknown> | undefined

    if (!row) {
      return { success: false, error: 'Incorrect email or password.' }
    }

    const hash = row.password_hash as string | null
    if (!hash) {
      return { success: false, error: 'Account not activated yet. Check your invite email.' }
    }

    const ok = await verifyPassword(password, hash)
    if (!ok) {
      return { success: false, error: 'Incorrect email or password.' }
    }

    // Success — clear rate limit and create session
    clearLoginAttempts(db, normalised)
    const user = mapUser(row)
    await createSession(user.id)

    return {
      success: true,
      user: {
        id:           user.id,
        email:        user.email ?? '',
        role:         user.role,
        full_name:    user.full_name,
        display_name: user.display_name,
        avatar_url:   user.avatar_url,
      },
    }
  } catch (err) {
    console.error('[auth] login error', err)
    return { success: false, error: 'Sign in failed. Please try again.' }
  }
}

// ─── requireRole ─────────────────────────────────────────────────────────────

export async function requireRole(...roles: UserRole[]) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (!roles.includes(user.role)) throw new Error('Access denied.')
  return user
}
