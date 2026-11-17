'use server'

/**
 * Quick add knowledge.
 *  - Nicknames are TEAM-WIDE: when anyone teaches "Jimmy = James", everyone's
 *    Quick add understands it. Each person has one vote per nickname; the
 *    meaning with the most votes wins (ties: the most recent). You can withdraw
 *    your vote; admins can remove a nickname for everyone.
 *  - Date habits ("next Friday", 5/12) stay personal.
 *  - Suggestions come from the cards the person may see.
 * See src/lib/quick-add/learn.ts.
 */

import { requireRole } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getActiveTasks, getAllUsers } from '@/lib/local-data'
import { getAssignedUserIds, isTaskAssignedToUser } from '@/lib/utils'
import {
  buildHistoryModel, normalizeAliasToken,
  type HistoryModel, type QuickAddLesson, type QuickAddMemory, type TeamAlias,
} from '@/lib/quick-add/learn'
import type { ActionResult, UserProfile } from '@/lib/types'

const MAX_VOTES_PER_USER = 200
const MAX_LESSONS_PER_CALL = 20
const HISTORY_CARDS = 500

const PREF_VALUES: Record<string, string[]> = {
  nextWeekday: ['following', 'upcoming'],
  numericOrder: ['mdy', 'dmy'],
}

const isAdmin = (role: string) => role === 'admin' || role === 'super_admin'
const displayName = (u: UserProfile | undefined) => u?.full_name ?? u?.display_name ?? u?.email ?? 'Someone'

/** People a card can be assigned to — same rule as the New task form and the board. */
const assignable = (users: UserProfile[]) => new Set(users.filter((u) => u.is_active && u.role !== 'super_admin').map((u) => u.id))

/**
 * Words that already mean a real person (full name, first name, display name, e-mail name).
 * A nickname may never redefine them — only pick between people who share them ("Ana").
 */
function realNameKeys(users: UserProfile[]) {
  const keys = new Map<string, Set<string>>()
  for (const u of users.filter((x) => x.is_active)) {
    const names = [u.full_name, u.display_name, u.email?.split('@')[0], u.full_name?.trim().split(/\s+/)[0]]
    for (const name of names) {
      const key = name ? normalizeAliasToken(name) : null
      if (!key) continue
      keys.set(key, (keys.get(key) ?? new Set()).add(u.id))
    }
  }
  return keys
}

function teamAliases(viewerId: string, users: UserProfile[]): TeamAlias[] {
  const canAssign = assignable(users)
  const byId = new Map(users.map((u) => [u.id, u]))
  const rows = getDb().prepare('SELECT key, person_id, user_id, updated_at FROM quick_add_alias_votes ORDER BY key')
    .all() as Array<{ key: string; person_id: string; user_id: string; updated_at: string }>

  const byKey = new Map<string, typeof rows>()
  for (const row of rows) byKey.set(row.key, [...(byKey.get(row.key) ?? []), row])

  const out: TeamAlias[] = []
  for (const [key, votes] of Array.from(byKey.entries())) {
    // Count only votes from people still active, for people who can still be assigned.
    const valid = votes.filter((v) => byId.get(v.user_id)?.is_active && canAssign.has(v.person_id))
    if (valid.length === 0) continue
    const tally = new Map<string, { count: number; latest: string; voters: string[] }>()
    for (const v of valid) {
      const t = tally.get(v.person_id) ?? { count: 0, latest: '', voters: [] }
      t.count += 1
      t.latest = v.updated_at > t.latest ? v.updated_at : t.latest
      t.voters.push(v.user_id)
      tally.set(v.person_id, t)
    }
    const [winnerId, winner] = Array.from(tally.entries())
      .sort((a, b) => b[1].count - a[1].count || b[1].latest.localeCompare(a[1].latest))[0]
    out.push({
      token: key,
      personId: winnerId,
      votes: winner.count,
      taughtBy: winner.voters.slice(0, 3).map((id) => displayName(byId.get(id))),
      mine: winner.voters.includes(viewerId),
      contested: tally.size > 1,
    })
  }
  return out
}

function personalPrefs(userId: string): QuickAddMemory['prefs'] {
  const rows = getDb().prepare("SELECT key, value FROM quick_add_memory WHERE user_id = ? AND kind = 'pref'")
    .all(userId) as Array<{ key: string; value: string }>
  const prefs: QuickAddMemory['prefs'] = {}
  for (const row of rows) {
    if (!PREF_VALUES[row.key]?.includes(row.value)) continue
    if (row.key === 'nextWeekday') prefs.nextWeekday = row.value as 'following' | 'upcoming'
    if (row.key === 'numericOrder') prefs.numericOrder = row.value as 'mdy' | 'dmy'
  }
  return prefs
}

export async function getQuickAddKnowledge(): Promise<{ memory: QuickAddMemory; history: HistoryModel }> {
  const user = await requireRole('staff', 'admin', 'super_admin')
  const users = await getAllUsers()

  // Learn only from cards this person may see (staff: their own), newest first.
  const tasks = (await getActiveTasks())
    .filter((t) => isAdmin(user.role) || t.submitted_by === user.id || isTaskAssignedToUser(t, user.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, HISTORY_CARDS)
  const history = buildHistoryModel(tasks.map((t) => ({
    title: t.title,
    assigneeIds: getAssignedUserIds(t),
    priority: t.priority,
    labels: t.labels ?? [],
  })))

  return { memory: { aliases: teamAliases(user.id, users), prefs: personalPrefs(user.id) }, history }
}

export async function rememberQuickAdd(lessons: QuickAddLesson[]): Promise<ActionResult<{ learned: number }>> {
  try {
    const user = await requireRole('staff', 'admin', 'super_admin')
    if (!Array.isArray(lessons)) throw new Error('Invalid lessons.')
    const users = await getAllUsers()
    const canAssign = assignable(users)
    const realNames = realNameKeys(users)
    const db = getDb()
    const now = new Date().toISOString()
    const vote = db.prepare(`
      INSERT INTO quick_add_alias_votes (key, person_id, user_id, updated_at) VALUES (?,?,?,?)
      ON CONFLICT(key, user_id) DO UPDATE SET person_id = excluded.person_id, updated_at = excluded.updated_at
    `)
    const pref = db.prepare(`
      INSERT INTO quick_add_memory (user_id, kind, key, value, hits, updated_at) VALUES (?, 'pref', ?, ?, 1, ?)
      ON CONFLICT(user_id, kind, key) DO UPDATE SET
        hits = CASE WHEN value = excluded.value THEN hits + 1 ELSE 1 END,
        value = excluded.value, updated_at = excluded.updated_at
    `)
    let learned = 0
    db.transaction(() => {
      for (const lesson of lessons.slice(0, MAX_LESSONS_PER_CALL)) {
        if (!lesson || typeof lesson !== 'object') continue
        if (lesson.kind === 'alias') {
          const key = typeof lesson.key === 'string' ? normalizeAliasToken(lesson.key) : null
          if (!key || typeof lesson.value !== 'string' || !canAssign.has(lesson.value)) continue
          // "mia" can't be taught to mean George; "ana" may only pick between the real Anas.
          const owners = realNames.get(key)
          if (owners && !owners.has(lesson.value)) continue
          vote.run(key, lesson.value, user.id, now)
          learned += 1
        } else if (lesson.kind === 'pref') {
          if (!PREF_VALUES[lesson.key]?.includes(lesson.value)) continue
          pref.run(user.id, lesson.key, lesson.value, now)
          learned += 1
        }
      }
      // Each person keeps at most MAX_VOTES_PER_USER nicknames (oldest dropped).
      db.prepare(`
        DELETE FROM quick_add_alias_votes WHERE user_id = ? AND key NOT IN (
          SELECT key FROM quick_add_alias_votes WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?
        )
      `).run(user.id, user.id, MAX_VOTES_PER_USER)
    })()
    return { success: true, data: { learned } }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * kind 'alias', scope 'mine': withdraw your vote. scope 'team': remove the nickname for everyone (admins).
 * kind 'pref': forget your personal date habit.
 */
export async function forgetQuickAdd(kind: 'alias' | 'pref', key: string, scope: 'mine' | 'team' = 'mine'): Promise<ActionResult> {
  try {
    const user = await requireRole('staff', 'admin', 'super_admin')
    if ((kind !== 'alias' && kind !== 'pref') || typeof key !== 'string' || key.length > 60) throw new Error('Invalid request.')
    const db = getDb()
    if (kind === 'pref') {
      db.prepare("DELETE FROM quick_add_memory WHERE user_id = ? AND kind = 'pref' AND key = ?").run(user.id, key)
    } else if (scope === 'team') {
      if (!isAdmin(user.role)) throw new Error('Only admins can remove a nickname for everyone.')
      db.prepare('DELETE FROM quick_add_alias_votes WHERE key = ?').run(key)
    } else {
      db.prepare('DELETE FROM quick_add_alias_votes WHERE key = ? AND user_id = ?').run(key, user.id)
    }
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
