/**
 * collab.ts — multi-user conflict protection (server only)
 *
 * Every write that a person starts from a possibly-stale screen carries a
 * TaskExpectation: what they believed about the card. The check runs inside
 * the same SQLite transaction as the write (see local-data.updateTask guard),
 * so two people can never both "win" — the second one gets a clear message
 * and a refreshed card instead of silently overwriting the first.
 *
 * Expectations are deliberately narrow so people can work freely:
 *  - Moving a card only conflicts if someone else moved / completed /
 *    archived it, not because they fixed a typo in its description.
 *  - Editing a field only conflicts if someone else changed *that* field.
 */

import { TaskConflictError, findUser } from '@/lib/local-data'
import { getAssignedUserIds } from '@/lib/utils'
import type { Task, TaskExpectation } from '@/lib/types'

const STATUS_LABEL: Record<string, string> = {
  new: 'new',
  pending: 'pending',
  in_progress: 'in progress',
  completed: 'completed',
  archived: 'archived',
}

function normalize(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'null'
  if (typeof value === 'string') return JSON.stringify(value.trim())
  return JSON.stringify(value)
}

function sameIds(a: string[], b: string[]) {
  return normalize([...a].sort()) === normalize([...b].sort())
}

function actorName(task: Task, selfId: string) {
  if (!task.updated_by) return 'Someone else'
  if (task.updated_by === selfId) return 'You (in another tab)'
  const user = findUser(task.updated_by)
  return user?.full_name ?? user?.display_name ?? user?.email ?? 'Someone else'
}

/** Returns the list of human-readable reasons the expectation no longer holds. */
export function findExpectationMismatches(current: Task, expected: TaskExpectation | undefined): string[] {
  if (!expected) return []
  const reasons: string[] = []

  if (expected.version !== undefined && expected.version !== current.version) {
    reasons.push('the card was changed')
  }
  const statusChanged = expected.status !== undefined && expected.status !== current.status
  if (statusChanged) {
    reasons.push(`it is now ${STATUS_LABEL[current.status] ?? current.status}`)
  }
  // A status change already explains a column change; don't report both.
  if (expected.column_id !== undefined && expected.column_id !== current.column_id && !statusChanged) {
    reasons.push('it was moved to another column')
  }

  const fields = expected.fields
  if (fields) {
    const simple = ['title', 'description', 'due_date', 'priority', 'assigned_to'] as const
    for (const key of simple) {
      if (key in fields && normalize(fields[key]) !== normalize(current[key])) {
        reasons.push(`the ${key.replace('_', ' ')} was changed`)
      }
    }
    if (fields.assigned_user_ids && !sameIds(fields.assigned_user_ids, getAssignedUserIds(current))) {
      reasons.push('the assignees were changed')
    }
    if (fields.custom_fields) {
      for (const [key, value] of Object.entries(fields.custom_fields)) {
        if (normalize(value) !== normalize(current.custom_fields?.[key])) {
          reasons.push(`the ${key.replace(/_/g, ' ')} was changed`)
        }
      }
    }
  }

  return Array.from(new Set(reasons))
}

/** Build a guard for local-data.updateTask / softDeleteTask. */
export function expectationGuard(expected: TaskExpectation | undefined, selfId: string, extra?: (current: Task) => string | null) {
  return (current: Task) => {
    const reasons = findExpectationMismatches(current, expected)
    const extraReason = extra?.(current)
    if (extraReason) reasons.push(extraReason)
    if (reasons.length === 0) return

    const who = actorName(current, selfId)
    throw new TaskConflictError(
      `${who} updated this card while you were working on it (${reasons.join(', ')}). ` +
      'Your change was not saved — the board has been refreshed so you can review and try again.',
      current,
    )
  }
}
