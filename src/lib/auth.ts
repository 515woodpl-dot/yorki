/**
 * auth.ts — session-based authentication
 *
 * Login:   bcrypt verify password → create session row → set HttpOnly cookie
 * Check:   read cookie → look up session → return user
 * Logout:  delete session row → clear cookie
 *
 * Security:
 *   - Deactivated users blocked at login + session lookup
 *   - Brute-force: 5 attempts per email per 15 min (in-memory, resets on server restart)
 *   - Expired sessions pruned from DB on every login
 *   - Sessions expire after 30 days
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type { SessionUser, UserProfile, UserRole } from './types'

const COOKIE_NAME  = 'yorki_session'
const SESSION_DAYS = 30
const SESSION_MS   = SESSION_DAYS * 24 * 60 * 60 * 1000

// ─── Rate limiting (in-memory) ────────────────────────────────────────────────
// Keyed by lowercase email. Resets on server restart.
// For production with multiple workers, replace with Redis or DB-backed counter.

const MAX_ATTEMPTS   = 5
const LOCKOUT_MS     = 15 * 60 * 1000  // 15 minutes

interface AttemptRecord { count: number; firstAt: number }
const loginAttempts = new Map<string, AttemptRecord>()

function checkRateLimit(email: string): { allowed: boolean; remainingMs?: number } {
  const key    = email.toLowerCase()
  const now    = Date.now()
  const record = loginAttempts.get(key)

  if (!record) return { allowed: true }

  // Reset window if lockout period has passed
  if (now - record.firstAt > LOCKOUT_MS) {
    loginAttempts.delete(key)
    return { allowed: true }
  }

  if (record.count >= MAX_ATTEMPTS) {
    const remainingMs = LOCKOUT_MS - (now - record.firstAt)
    return { allowed: false, remainingMs }
  }

  return { allowed: true }
}

function recordFailedAttempt(email: string) {
  const key    = email.toLowerCase()
  const now    = Date.now()
  const record = loginAttempts.get(key)

  if (!record || now - record.firstAt > LOCKOUT_MS) {
    loginAttempts.set(key, { count: 1, firstAt: now })
  } else {
    loginAttempts.set(key, { count: record.count + 1, firstAt: record.firstAt })
  }
}

function clearAttempts(email: string) {
  loginAttempts.delete(email.toLowerCase())
}

// ─── User mapping ─────────────────────────────────────────────────────────────

function mapUser(row: Record<string, unknown>): UserProfile {
  return {
    ...(row as unknown as UserProfile),
    is_active: row.is_active === 1,
  }
}

// ─── Password ─────────────────────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

// ─── Session ──────────────────────────────────────────────────────────────────

export async function createSession(userId: string): Promise<string> {
  const db        = getDb()
  const sessionId = randomUUID()
  const now       = new Date()
  const expires   = new Date(now.getTime() + SESSION_MS)

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
    secure:   process.env.NODE_ENV === 'production',
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

// ─── Login ────────────────────────────────────────────────────────────────────

export async function loginWithPassword(
  email: string,
  password: string
): Promise<{ success: true; user: SessionUser } | { success: false; error: string }> {
  try {
    const normalised = email.trim().toLowerCase()

    // Rate limit check
    const limit = checkRateLimit(normalised)
    if (!limit.allowed) {
      const mins = Math.ceil((limit.remainingMs ?? LOCKOUT_MS) / 60000)
      return { success: false, error: `Too many attempts. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.` }
    }

    const db  = getDb()
    const row = db.prepare(`
      SELECT * FROM users WHERE LOWER(email) = ? AND is_active = 1
    `).get(normalised) as Record<string, unknown> | undefined

    if (!row) {
      recordFailedAttempt(normalised)
      return { success: false, error: 'Incorrect email or password.' }
    }

    const hash = row.password_hash as string | null
    if (!hash) {
      return { success: false, error: 'Account not activated yet. Check your invite email.' }
    }

    const ok = await verifyPassword(password, hash)
    if (!ok) {
      recordFailedAttempt(normalised)
      return { success: false, error: 'Incorrect email or password.' }
    }

    // Success — clear rate limit and create session
    clearAttempts(normalised)
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
