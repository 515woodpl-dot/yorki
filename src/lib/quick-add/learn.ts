/**
 * quick-add/learn.ts — how Quick add gets smarter with use. Pure functions; no AI.
 *
 * Two kinds of learning:
 *
 * 1. From corrections (nicknames are shared by the whole team; date habits are personal):
 *    - "Jimmy should call the supplier" → Quick add doesn't know Jimmy → you pick
 *      James Lee in the preview → next time "Jimmy" means James Lee.
 *    - "@Ana" matched two people and you picked one → "Ana" now means that one.
 *    - "@Mai" was guessed as Mia and you kept it → confirmed, no longer a guess.
 *    - You changed "next Friday" (or 5/12) to the other reading → that reading
 *      becomes your default.
 *
 * 2. From past cards (computed fresh from the board, nothing extra stored):
 *    which people, priorities and labels usually go with which words.
 *    "fix the leak in unit 4" → "Mia did 4 of 5 ‘leak’ cards" → offered as a
 *    one-click suggestion, never applied silently.
 */

import { CONCEPT_OF, STOP_WORDS } from './vocabulary'

export type LearnPriority = 'low' | 'normal' | 'high' | 'urgent'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// ─── Memory of corrections ───────────────────────────────────────────────────

export type QuickAddLesson =
  | { kind: 'alias'; key: string; value: string }
  | { kind: 'pref'; key: 'nextWeekday'; value: 'following' | 'upcoming' }
  | { kind: 'pref'; key: 'numericOrder'; value: 'mdy' | 'dmy' }

/** A nickname the team taught Quick add ("jimmy" → James). Shared by everyone. */
export interface TeamAlias {
  token: string
  personId: string
  /** How many people confirmed this meaning. */
  votes?: number
  /** Names of (up to 3) people who taught it. */
  taughtBy?: string[]
  /** The current person voted for this meaning. */
  mine?: boolean
  /** Someone else on the team thinks it means a different person. */
  contested?: boolean
}

export interface QuickAddMemory {
  /** Team-wide nicknames / disambiguations: token (folded) → person id. */
  aliases: TeamAlias[]
  /** Personal: how *this* person writes dates. */
  prefs: { nextWeekday?: 'following' | 'upcoming'; numericOrder?: 'mdy' | 'dmy' }
}

export const EMPTY_MEMORY: QuickAddMemory = { aliases: [], prefs: {} }

/** "@Jimmy " → "jimmy"; null when it can't be a nickname. */
export function normalizeAliasToken(token: string): string | null {
  const t = fold(token).replace(/^@+/, '').replace(/\s+/g, ' ').trim()
  return /^[a-z][a-z0-9 .'-]{0,39}$/.test(t) ? t : null
}

export interface RefNote {
  token: string
  status: 'matched' | 'learned' | 'guessed' | 'unknown' | 'ambiguous'
  personId?: string
  candidates?: string[]
}

export interface DateAlternative {
  pref: 'nextWeekday' | 'numericOrder'
  /** The preference value that would have produced `date`. */
  value: 'following' | 'upcoming' | 'mdy' | 'dmy'
  /** The other reading, "YYYY-MM-DD". */
  date: string
}

/** Compare what was parsed with what the person actually created → things to remember. */
export function lessonsFromEdit(
  parsed: { refs: RefNote[]; assigneeIds: string[]; dueDate: string | null; dateAlternative: DateAlternative | null },
  final: { assigneeIds: string[]; dueDate: string | null },
): QuickAddLesson[] {
  const lessons: QuickAddLesson[] = []
  const added = final.assigneeIds.filter((id) => !parsed.assigneeIds.includes(id))
  const open = parsed.refs.filter((r) => r.status === 'unknown' || r.status === 'ambiguous')
  if (open.length === 1 && added.length === 1) {
    const ref = open[0]
    const key = normalizeAliasToken(ref.token)
    if (key && (ref.status === 'unknown' || ref.candidates?.includes(added[0]))) {
      lessons.push({ kind: 'alias', key, value: added[0] })
    }
  }
  for (const ref of parsed.refs) {
    if (ref.status !== 'guessed' || !ref.personId || !final.assigneeIds.includes(ref.personId)) continue
    const key = normalizeAliasToken(ref.token)
    if (key) lessons.push({ kind: 'alias', key, value: ref.personId })
  }
  const alt = parsed.dateAlternative
  const finalDay = final.dueDate?.slice(0, 10)
  if (alt && finalDay && finalDay === alt.date && parsed.dueDate?.slice(0, 10) !== finalDay) {
    if (alt.pref === 'nextWeekday') lessons.push({ kind: 'pref', key: 'nextWeekday', value: alt.value as 'following' | 'upcoming' })
    else lessons.push({ kind: 'pref', key: 'numericOrder', value: alt.value as 'mdy' | 'dmy' })
  }
  return lessons
}

// ─── Learning from past cards ────────────────────────────────────────────────

export interface WordStats {
  /** Cards containing the word. */
  n: number
  /** Assignee id → cards. */
  a: Record<string, number>
  /** Priority → cards. */
  p: Partial<Record<LearnPriority, number>>
  /** Label → cards. */
  l: Record<string, number>
}

export interface HistoryModel { cards: number; words: Record<string, WordStats> }

export interface HistoryCard { title: string; assigneeIds: string[]; priority: string; labels: string[] }

/** Concept tokens start with "~" so they never collide with plain words. */
export const CONCEPT_PREFIX = '~'

/**
 * Meaningful parts of a title: words are folded and lightly stemmed ("slabs" → "slab",
 * "facturas" → "factura"), and words with a known meaning become that concept
 * ("gotera", "fuga", "leaks" → "~leak"), so evidence is shared across synonyms and languages.
 */
export function modelTokens(text: string): string[] {
  const words = fold(text).split(/[^a-z0-9]+/).filter(Boolean)
  const out: string[] = []
  for (const raw of words) {
    if (raw.length < 3 || /^\d+$/.test(raw) || STOP_WORDS.has(raw)) continue
    const stem = raw.length > 4 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw
    const concept = CONCEPT_OF.get(raw) ?? CONCEPT_OF.get(stem) ?? (raw.endsWith('es') ? CONCEPT_OF.get(raw.slice(0, -2)) : undefined)
    const token = concept ? `${CONCEPT_PREFIX}${concept}` : stem
    if (!out.includes(token)) out.push(token)
  }
  return out
}

export function buildHistoryModel(cards: HistoryCard[], maxWords = 400): HistoryModel {
  const words = new Map<string, WordStats>()
  for (const card of cards) {
    for (const token of modelTokens(card.title)) {
      const stats = words.get(token) ?? { n: 0, a: {}, p: {}, l: {} }
      stats.n += 1
      for (const id of new Set(card.assigneeIds)) stats.a[id] = (stats.a[id] ?? 0) + 1
      const priority = card.priority as LearnPriority
      if (['low', 'normal', 'high', 'urgent'].includes(priority)) stats.p[priority] = (stats.p[priority] ?? 0) + 1
      for (const label of new Set(card.labels)) stats.l[label] = (stats.l[label] ?? 0) + 1
      words.set(token, stats)
    }
  }
  const kept = Array.from(words.entries())
    .filter(([, s]) => s.n >= 2)
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, maxWords)
  return { cards: cards.length, words: Object.fromEntries(kept) }
}

export interface HistorySuggestion {
  kind: 'assignee' | 'priority' | 'label'
  value: string
  /** e.g. 4 of 5 cards with `word`. */
  support: number
  total: number
  word: string
}

/** Strongest single-word evidence: ≥ minSupport cards and ≥ minShare of them. */
function strongest(
  tokens: string[],
  model: HistoryModel,
  pick: (s: WordStats) => Record<string, number | undefined>,
  minSupport: number,
  minShare: number,
  allow: (value: string) => boolean,
): HistorySuggestion[] {
  const best = new Map<string, HistorySuggestion>()
  for (const word of tokens) {
    const stats = model.words[word]
    if (!stats) continue
    for (const [value, count] of Object.entries(pick(stats))) {
      if (!count || count < minSupport || count / stats.n < minShare || !allow(value)) continue
      const current = best.get(value)
      const better = !current || count / stats.n > current.support / current.total || (count / stats.n === current.support / current.total && count > current.support)
      if (better) best.set(value, { kind: 'assignee', value, support: count, total: stats.n, word })
    }
  }
  return Array.from(best.values()).sort((a, b) => b.support / b.total - a.support / a.total || b.support - a.support)
}

export function suggestFromHistory(
  title: string,
  model: HistoryModel | null | undefined,
  opts: { hasAssignee: boolean; hasPriority: boolean; labels: string[]; assignable?: Set<string>; ignoreWords?: Set<string> },
): HistorySuggestion[] {
  if (!model || model.cards < 3) return []
  const tokens = modelTokens(title).filter((t) => !opts.ignoreWords?.has(t))
  const out: HistorySuggestion[] = []
  if (!opts.hasAssignee) {
    const top = strongest(tokens, model, (s) => s.a, 3, 0.6, (id) => !opts.assignable || opts.assignable.has(id))[0]
    if (top) out.push({ ...top, kind: 'assignee' })
  }
  if (!opts.hasPriority) {
    const top = strongest(tokens, model, (s) => s.p, 3, 0.6, (p) => p !== 'normal')[0]
    if (top) out.push({ ...top, kind: 'priority' })
  }
  for (const s of strongest(tokens, model, (st) => st.l, 2, 0.6, (l) => !opts.labels.includes(l)).slice(0, 2)) {
    out.push({ ...s, kind: 'label' })
  }
  return out
}
