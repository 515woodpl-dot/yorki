'use server'

/**
 * Quick add knowledge: what each person taught it, plus word statistics from
 * the cards they can see (for suggestions). See src/lib/quick-add/learn.ts.
 */

import { requireRole } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getActiveTasks, getAllUsers } from '@/lib/local-data'
import { getAssignedUserIds, isTaskAssignedToUser } from '@/lib/utils'
import {
  buildHistoryModel, normalizeAliasToken,
  type HistoryModel, type QuickAddLesson, type QuickAddMemory,
} from '@/lib/quick-add/learn'
import type { ActionResult } from '@/lib/types'

const MAX_ALIASES_PER_USER = 200
const MAX_LESSONS_PER_CALL = 20
const HISTORY_CARDS = 500

const PREF_VALUES: Record<string, string[]> = {
  nextWeekday: ['following', 'upcoming'],
  numericOrder: ['mdy', 'dmy'],
}

/** People a card can be assigned to — same rule as the New task form and the board. */
async function assignableIds() {
  return new Set((await getAllUsers()).filter((u) => u.is_active && u.role !== 'super_admin').map((u) => u.id))
}

function readMemory(userId: string, assignable: Set<string>): QuickAddMemory {
  const rows = getDb().prepare('SELECT kind, key, value FROM quick_add_memory WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId) as Array<{ kind: string; key: string; value: string }>
  const memory: QuickAddMemory = { aliases: [], prefs: {} }
  for (const row of rows) {
    if (row.kind === 'alias' && assignable.has(row.value)) memory.aliases.push({ token: row.key, personId: row.value })
    if (row.kind === 'pref' && PREF_VALUES[row.key]?.includes(row.value)) {
      if (row.key === 'nextWeekday') memory.prefs.nextWeekday = row.value as 'following' | 'upcoming'
      if (row.key === 'numericOrder') memory.prefs.numericOrder = row.value as 'mdy' | 'dmy'
    }
  }
  return memory
}

export async function getQuickAddKnowledge(): Promise<{ memory: QuickAddMemory; history: HistoryModel }> {
  const user = await requireRole('staff', 'admin', 'super_admin')
  const assignable = await assignableIds()
  const isAdmin = user.role === 'admin' || user.role === 'super_admin'

  // Learn only from cards this person may see (staff: their own), newest first.
  const tasks = (await getActiveTasks())
    .filter((t) => isAdmin || t.submitted_by === user.id || isTaskAssignedToUser(t, user.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, HISTORY_CARDS)
  const history = buildHistoryModel(tasks.map((t) => ({
    title: t.title,
    assigneeIds: getAssignedUserIds(t),
    priority: t.priority,
    labels: t.labels ?? [],
  })))

  return { memory: readMemory(user.id, assignable), history }
}

export async function rememberQuickAdd(lessons: QuickAddLesson[]): Promise<ActionResult<{ learned: number }>> {
  try {
    const user = await requireRole('staff', 'admin', 'super_admin')
    if (!Array.isArray(lessons)) throw new Error('Invalid lessons.')
    const assignable = await assignableIds()
    const db = getDb()
    const now = new Date().toISOString()
    const upsert = db.prepare(`
      INSERT INTO quick_add_memory (user_id, kind, key, value, hits, updated_at) VALUES (?,?,?,?,1,?)
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
          if (!key || typeof lesson.value !== 'string' || !assignable.has(lesson.value)) continue
          upsert.run(user.id, 'alias', key, lesson.value, now)
          learned += 1
        } else if (lesson.kind === 'pref') {
          if (!PREF_VALUES[lesson.key]?.includes(lesson.value)) continue
          upsert.run(user.id, 'pref', lesson.key, lesson.value, now)
          learned += 1
        }
      }
      // Keep memory small: drop the least recently used nicknames beyond the cap.
      db.prepare(`
        DELETE FROM quick_add_memory WHERE user_id = ? AND kind = 'alias' AND key NOT IN (
          SELECT key FROM quick_add_memory WHERE user_id = ? AND kind = 'alias' ORDER BY updated_at DESC LIMIT ?
        )
      `).run(user.id, user.id, MAX_ALIASES_PER_USER)
    })()
    return { success: true, data: { learned } }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function forgetQuickAdd(kind: 'alias' | 'pref', key: string): Promise<ActionResult> {
  try {
    const user = await requireRole('staff', 'admin', 'super_admin')
    if ((kind !== 'alias' && kind !== 'pref') || typeof key !== 'string' || key.length > 60) throw new Error('Invalid request.')
    getDb().prepare('DELETE FROM quick_add_memory WHERE user_id = ? AND kind = ? AND key = ?').run(user.id, kind, key)
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
