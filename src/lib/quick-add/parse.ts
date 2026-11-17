/**
 * quick-add/parse.ts — turn typed sentences into task cards. No AI, no network.
 *
 * Plain rules (regular expressions + a small calendar), in English and Spanish,
 * so it is instant, predictable and testable. It runs in the browser: the
 * preview updates as you type and nothing leaves the page until you press Create.
 *
 *   people     "@Ana", "Ana should…", "have Ana…", "ask Ana to…", "assign … to Ana", "Ana: …"
 *              "quiero que Ana…", "Ana tiene que…", "pídele a Ana que…", "asigna esto a Ana"
 *              "remind me to…", "I'll…", "recuérdame…", "tengo que…"  (→ you)
 *   dates      today, tomorrow, Friday, next Friday, in 3 days, next week, end of month, Dec 5, 12/5
 *              hoy, mañana, pasado mañana, el viernes, el próximo lunes, en 3 días, la semana que
 *              viene, fin de mes, 5 de diciembre, el 15, 5/12 (día/mes in Spanish)
 *   times      3pm, 15:00, noon, at 3 · a las 3, a las 4 de la tarde, al mediodía, por la mañana
 *   priority   urgent / ASAP · urgente / lo antes posible / cuanto antes → Urgent
 *              high priority · prioridad alta / muy importante → High
 *              no rush / whenever · sin prisa / cuando puedas → Low
 *   labels     #plumbing
 *   cards      one per line, bullet or sentence; verb lists ("pay the rent, call John and email
 *              Ana" · "llamar al proveedor y pagar la factura"). A follow-up ("She has until Friday",
 *              "Ella tiene hasta el viernes", "It's urgent") adds to the previous card.
 *
 * Smarter with use (see learn.ts and fuzzy.ts):
 *   - guesses misspelled words ("tomorow", "wensday", "viernez") and @names ("@Mai" → Mia);
 *   - remembers what you correct (nicknames, which "Ana", what "next Friday" means to you);
 *   - suggests people / priority / labels that past cards with the same words had.
 *
 * Everything it is unsure about is reported (warnings, guesses) and nothing is
 * created until you confirm the preview. The word lists live in vocabulary.ts.
 */

import {
  EN_VERBS, ES_CLITICS, ES_FORM_TO_INFINITIVE, ES_FORMS_NOT_FOR_SPLITTING, ES_OBJECT_STARTERS, FOLLOW_UP_STARTERS,
  INTRO_WORDS, LEAD_FILLERS, MONTHS, NOT_NAMES, NUMBER_WORDS, PARTS_OF_DAY, PRIORITY_PHRASES, STOP_WORDS,
  TRAILING_WORDS, WEAK_FOLLOW_UP_STARTERS, WEEKDAYS,
} from './vocabulary'
import { closestWord, correctTypos } from './fuzzy'
import {
  suggestFromHistory, type DateAlternative, type HistoryModel, type QuickAddMemory, type RefNote,
} from './learn'

export type { DateAlternative, HistoryModel, QuickAddMemory, RefNote }

export type QuickPriority = 'low' | 'normal' | 'high' | 'urgent'
export type QuickLanguage = 'en' | 'es'

export interface QuickPerson {
  id: string
  name: string
  /** Other ways people refer to them: display name, first part of their e-mail… */
  aliases?: string[]
}

export interface QuickAddOptions {
  people: QuickPerson[]
  /** The person typing (for "remind me to…", "I'll…", "recuérdame…"). */
  currentUserId?: string | null
  /** Override "now" (tests). */
  now?: Date
  /** Split "pay the bill and call John" into two cards. Default true. */
  splitLists?: boolean
  /** What this person taught Quick add (nicknames, date preferences). */
  memory?: QuickAddMemory | null
  /** Word statistics from past cards, for suggestions. */
  history?: HistoryModel | null
}

export interface QuickSuggestion {
  kind: 'assignee' | 'priority' | 'label'
  value: string
  /** Human explanation: "Mia did 4 of 5 “leak” cards". */
  reason: string
}

export interface ParsedCard {
  title: string
  /** The original wording, when details were pulled out of it. */
  description: string | null
  assigneeIds: string[]
  /** "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:00" (local time), or null. */
  dueDate: string | null
  priority: QuickPriority
  labels: string[]
  /** The text this card was built from (after typo fixes). */
  source: string
  language: QuickLanguage
  /** What was recognised, for the preview. `guesses` are typo fixes, guessed and remembered names. */
  found: { assignees: string[]; date: string | null; priority: string | null; guesses: string[] }
  warnings: string[]
  /** Every person reference and how it was resolved (used to learn from your corrections). */
  refs: RefNote[]
  /** The other reasonable reading of an ambiguous date ("next Friday", "5/12"). */
  dateAlternative: DateAlternative | null
  /** One-click suggestions learned from past cards. Never applied automatically. */
  suggestions: QuickSuggestion[]
}

const MAX_CARDS = 20
const MAX_TITLE = 100

// ─── Small helpers ───────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')
const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const stripDiacritics = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const lowerFold = (s: string) => stripDiacritics(s).toLowerCase()
const comparable = (s: string) => lowerFold(s).replace(/[^a-z0-9]+/g, '')
const wordCount = (s: string) => (s.match(/\S+/g) ?? []).length
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Same-length accent-free copy, so matches can be mapped back onto the original text. */
function foldSame(text: string) {
  const folded = stripDiacritics(text)
  return folded.length === text.length ? folded : text
}

/** Regex alternation from words (longest first, spaces = any whitespace). */
const alternation = (words: Iterable<string>) => Array.from(new Set(Array.from(words, (w) => lowerFold(w))))
  .sort((a, b) => b.length - a.length)
  .map((w) => escapeRe(w).replace(/ /g, '\\s+'))
  .join('|')

function addMonths(d: Date, n: number) {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last))
}

function makeDate(y: number, m: number, d: number): Date | null {
  const date = new Date(y, m, d)
  return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d ? date : null
}

interface Hit { index: number; end: number; text: string; groups: Array<string | undefined>; starts: Array<number | undefined> }

/** Every match of `re` on the accent-free text, reported with the original wording. */
function findAll(text: string, re: RegExp): Hit[] {
  const folded = foldSame(text)
  const flags = Array.from(new Set(`${re.flags}gd`.split(''))).join('')
  const hits: Hit[] = []
  for (const m of Array.from(folded.matchAll(new RegExp(re.source, flags)))) {
    if (!m[0]) continue
    const index = m.index ?? 0
    const indices = (m as RegExpMatchArray & { indices?: Array<[number, number] | undefined> }).indices ?? []
    hits.push({
      index,
      end: index + m[0].length,
      text: text.slice(index, index + m[0].length),
      groups: indices.map((r) => (r ? text.slice(r[0], r[1]) : undefined)),
      starts: indices.map((r) => r?.[0]),
    })
  }
  return hits
}

/** Replace matches of `re` (matched accent-free) in the original text. Return null to keep a match. */
function rewrite(text: string, re: RegExp, fn: (hit: Hit) => string | null): string {
  let out = ''
  let last = 0
  for (const hit of findAll(text, re)) {
    if (hit.index < last) continue
    const replacement = fn(hit)
    if (replacement === null) continue
    out += text.slice(last, hit.index) + replacement
    last = hit.end
  }
  return out + text.slice(last)
}

// ─── Vocabulary as patterns ──────────────────────────────────────────────────

const MONTH_INDEX = new Map(MONTHS.map(([name, i]) => [name, i]))
const WEEKDAY_INDEX = new Map(WEEKDAYS.map(([name, i]) => [name, i]))
const MONTH = `(?:${alternation(MONTH_INDEX.keys())})`
const WEEKDAY = `(?:${alternation(WEEKDAY_INDEX.keys())})`
const NUM = `(${alternation(Object.keys(NUMBER_WORDS))}|\\d{1,3})`
const toNumber = (word: string) => NUMBER_WORDS[lowerFold(word)] ?? parseInt(word, 10)

const ES_FORMS = Array.from(ES_FORM_TO_INFINITIVE.keys())
/** Any verb (EN or ES form), for "Ana review…" and list splitting. */
const VERB = `(?:${alternation([...EN_VERBS, ...ES_FORMS])})`
const SPLIT_VERB = `(?:${alternation([...EN_VERBS, ...ES_FORMS.filter((f) => f.length > 2 && !ES_FORMS_NOT_FOR_SPLITTING.has(f))])})`

const KNOWN_WORDS = new Set<string>([
  ...EN_VERBS.map(lowerFold), ...ES_FORMS, ...STOP_WORDS, ...MONTH_INDEX.keys(), ...WEEKDAY_INDEX.keys(),
  ...Object.keys(NUMBER_WORDS),
])

// ─── Language ────────────────────────────────────────────────────────────────

const ES_MARKERS = new Set(['el', 'la', 'los', 'las', 'del', 'al', 'que', 'y', 'en', 'para', 'por', 'con', 'una', 'un', 'es',
  'hoy', 'manana', 'semana', 'tiene', 'hay', 'quiero', 'necesito', 'favor', 'lunes', 'martes', 'miercoles', 'jueves',
  'viernes', 'sabado', 'domingo', 'proximo', 'proxima', 'urgente', 'antes', 'hasta', 'dias', 'mes', 'de', 'su', 'debe'])
const EN_MARKERS = new Set(['the', 'to', 'and', 'for', 'on', 'by', 'is', 'of', 'with', 'an', 'should', 'will', 'please',
  'today', 'tomorrow', 'week', 'need', 'want', 'until', 'next', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'this', 'that', 'it', 'at', 'in', 'my', 'our', 'call', 'pay', 'send', 'fix', 'urgent', 'asap', 'she', 'he', 'they'])

export function detectLanguage(text: string): QuickLanguage {
  let es = 0
  let en = 0
  for (const word of lowerFold(text).split(/[^a-z]+/)) {
    if (ES_MARKERS.has(word) || ES_FORM_TO_INFINITIVE.has(word)) es += 1
    if (EN_MARKERS.has(word)) en += 1
  }
  return es > en ? 'es' : 'en'
}

// ─── Dates ───────────────────────────────────────────────────────────────────

interface DatePrefs { nextWeekday: 'following' | 'upcoming'; numericOrder: 'mdy' | 'dmy' }

interface DateHit {
  start: number
  end: number
  date: Date
  alternative?: { pref: 'nextWeekday' | 'numericOrder'; value: DatePrefs[keyof DatePrefs]; date: Date }
}

function upcomingWeekday(today: Date, weekday: number, includeToday: boolean) {
  const diff = (weekday - today.getDay() + 7) % 7
  return addDays(today, diff === 0 && !includeToday ? 7 : diff)
}

/** The given weekday in the *next calendar week* (Mon–Sun). */
function weekdayNextWeek(today: Date, weekday: number) {
  const mondayThisWeek = addDays(today, -((today.getDay() + 6) % 7))
  return addDays(mondayThisWeek, 7 + ((weekday + 6) % 7))
}

function relative(today: Date, n: number, unit: string) {
  if (!Number.isFinite(n)) return null
  const u = lowerFold(unit)
  if (u.startsWith('d')) return addDays(today, n)
  if (u.startsWith('w') || u.startsWith('sem')) return addDays(today, n * 7)
  return addMonths(today, n)
}

const RE = {
  iso: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/gi,
  monthDay: new RegExp(`\\b(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(?:de\\s+|del\\s+)?(20\\d{2})\\b)?`, 'gi'),
  dayMonth: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|ro|do|er|o)?\\s+(?:of\\s+|de\\s+)?(${MONTH})\\b\\.?(?:,?\\s*(?:de\\s+|del\\s+)?(20\\d{2})\\b)?`, 'gi'),
  slash: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/gi,
  dash: /\b(\d{1,2})-(\d{1,2})-(\d{2,4})\b/gi,
  relativeWord: /\b(today|tonight|tomorrow|tmrw|tmr|(?:the\s+)?day\s+after\s+tomorrow|hoy|esta\s+noche|pasado\s+manana)\b(?!'s)/gi,
  // "mañana" is tomorrow — except "por la mañana", "de mañana" (morning).
  manana: /(?<!\b(?:la|de|esta|por|en)\s{1,3})\bmanana\b/gi,
  inUnits: new RegExp(`\\b(?:in|within|en|dentro\\s+de|de\\s+aqui\\s+a)\\s+${NUM}\\s+(?:of\\s+)?(days?|weeks?|months?|dias?|semanas?|mes|meses)\\b`, 'gi'),
  fromNow: new RegExp(`\\b${NUM}\\s+(days?|weeks?|months?)\\s+from\\s+(?:now|today)\\b`, 'gi'),
  weekday: new RegExp(`\\b(?:(this|next|coming|upcoming|este\\s+proximo|este|esta|proximo|proxima)\\s+)?(${WEEKDAY})\\b(?!'s)(?:\\s+(que\\s+viene|proximo|de\\s+la\\s+(?:proxima\\s+semana|semana\\s+que\\s+viene)|(?:of\\s+)?next\\s+week))?`, 'gi'),
  period: /\b(next\s+week|this\s+week|next\s+month|end\s+of\s+(?:the\s+)?(?:week|month|year|day)|eow|eom|eoy|eod|cob|close\s+of\s+business|(?:this\s+)?weekend|(?:la\s+)?proxima\s+semana|(?:la\s+)?semana\s+que\s+viene|esta\s+semana|(?:este\s+)?fin\s+de\s+semana|(?:a\s+|al\s+)?fin(?:al)?\s+de(?:l)?\s+mes|(?:el\s+)?(?:proximo\s+mes|mes\s+que\s+viene)|(?:a\s+|al\s+)?fin(?:al)?\s+de(?:l)?\s+ano|(?:al\s+)?fin(?:al)?\s+del\s+dia)\b(?!'s)/gi,
  dayOfMonthEn: /\b(?:by|on|until|till|before|due)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/gi,
  dayOfMonthEs: /\b(?:para\s+el|antes\s+del|hasta\s+el|el|del)\s+(\d{1,2})\b(?!\s*(?:de\b|del\b|\/|:|%|[ap]\.?\s?m\b|h\b|hrs?\b|horas?\b|min|dias?\b|semanas?\b|mes(?:es)?\b|anos?\b|piezas?\b|unidades\b|veces\b))/gi,
}

function findDateHits(text: string, today: Date, prefs: DatePrefs): DateHit[] {
  const hits: DateHit[] = []
  const add = (hit: Hit, date: Date | null, from?: number, alternative?: DateHit['alternative']) => {
    if (date) hits.push({ start: from ?? hit.index, end: hit.end, date, alternative })
  }
  const monthDay = (month: number, day: number, year?: number) => {
    if (year !== undefined) return makeDate(year, month, day)
    const thisYear = makeDate(today.getFullYear(), month, day)
    if (thisYear && thisYear >= today) return thisYear
    return makeDate(today.getFullYear() + 1, month, day)
  }
  const fullYear = (y: string) => (y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10))
  const month = (name: string) => MONTH_INDEX.get(lowerFold(name)) ?? -1

  for (const h of findAll(text, RE.iso)) add(h, makeDate(+h.groups[1]!, +h.groups[2]! - 1, +h.groups[3]!))
  for (const h of findAll(text, RE.monthDay)) add(h, monthDay(month(h.groups[1]!), +h.groups[2]!, h.groups[3] ? +h.groups[3] : undefined))
  for (const h of findAll(text, RE.dayMonth)) add(h, monthDay(month(h.groups[2]!), +h.groups[1]!, h.groups[3] ? +h.groups[3] : undefined))

  // 12/5 → Dec 5 in English, 12 May in Spanish (or as this person taught us).
  const numeric = (h: Hit, a: number, b: number, year?: number) => {
    const read = (order: 'mdy' | 'dmy') => {
      let [m, d] = order === 'mdy' ? [a, b] : [b, a]
      if (m > 12 && d <= 12) [m, d] = [d, m]
      return year !== undefined ? makeDate(year, m - 1, d) : monthDay(m - 1, d)
    }
    const main = read(prefs.numericOrder)
    const otherOrder = prefs.numericOrder === 'mdy' ? 'dmy' : 'mdy'
    const other = a <= 12 && b <= 12 && a !== b ? read(otherOrder) : null
    add(h, main, undefined, other && main && fmtDate(other) !== fmtDate(main) ? { pref: 'numericOrder', value: otherOrder, date: other } : undefined)
  }
  for (const h of findAll(text, RE.slash)) numeric(h, +h.groups[1]!, +h.groups[2]!, h.groups[3] ? fullYear(h.groups[3]) : undefined)
  for (const h of findAll(text, RE.dash)) numeric(h, +h.groups[1]!, +h.groups[2]!, fullYear(h.groups[3]!))

  for (const h of findAll(text, RE.relativeWord)) {
    const w = lowerFold(h.groups[1]!).replace(/\s+/g, ' ')
    add(h, /after|pasado/.test(w) ? addDays(today, 2) : /^(tomorrow|tmrw|tmr)$/.test(w) ? addDays(today, 1) : today)
  }
  for (const h of findAll(text, RE.manana)) add(h, addDays(today, 1))
  for (const h of findAll(text, RE.inUnits)) add(h, relative(today, toNumber(h.groups[1]!), h.groups[2]!))
  for (const h of findAll(text, RE.fromNow)) add(h, relative(today, toNumber(h.groups[1]!), h.groups[2]!))

  for (const h of findAll(text, RE.weekday)) {
    const before = lowerFold(h.groups[1] ?? '').replace(/\s+/g, ' ')
    const after = lowerFold(h.groups[3] ?? '').replace(/\s+/g, ' ')
    const weekday = WEEKDAY_INDEX.get(lowerFold(h.groups[2]!)) ?? 0
    if (/semana|week/.test(after)) { add(h, weekdayNextWeek(today, weekday)); continue }
    if (before === 'this' || before === 'este' || before === 'esta') { add(h, upcomingWeekday(today, weekday, true)); continue }
    if (/next|proxim/.test(before) || /viene|proximo/.test(after)) {
      // "next Friday" is ambiguous: the coming one, or the one in next week?
      const following = weekdayNextWeek(today, weekday)
      const upcoming = upcomingWeekday(today, weekday, false)
      const main = prefs.nextWeekday === 'following' ? following : upcoming
      const other = prefs.nextWeekday === 'following' ? upcoming : following
      const otherValue = prefs.nextWeekday === 'following' ? 'upcoming' : 'following'
      add(h, main, undefined, fmtDate(main) !== fmtDate(other) ? { pref: 'nextWeekday', value: otherValue, date: other } : undefined)
      continue
    }
    add(h, upcomingWeekday(today, weekday, false))
  }

  for (const h of findAll(text, RE.period)) {
    const key = lowerFold(h.groups[1]!).replace(/\s+/g, ' ')
    let date: Date
    if (/next week|proxima semana|semana que viene/.test(key)) date = addDays(today, 7)
    else if (/this week|esta semana|end of (the )?week|eow/.test(key)) date = upcomingWeekday(today, 5, true)
    else if (/next month|proximo mes|mes que viene/.test(key)) date = addMonths(today, 1)
    else if (/month|eom|mes/.test(key)) date = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    else if (/year|eoy|ano/.test(key)) date = new Date(today.getFullYear(), 11, 31)
    else if (/weekend|fin de semana/.test(key)) date = upcomingWeekday(today, 6, true)
    else date = today // end of day / eod / cob / fin del día
    add(h, date)
  }

  const dayOfMonth = (h: Hit) => {
    const day = +h.groups[1]!
    if (day < 1 || day > 31) return
    const thisMonth = makeDate(today.getFullYear(), today.getMonth(), day)
    const nextMonth = makeDate(today.getFullYear(), today.getMonth() + 1, day)
    add(h, thisMonth && thisMonth >= today ? thisMonth : nextMonth, h.starts[1])
  }
  for (const h of findAll(text, RE.dayOfMonthEn)) dayOfMonth(h)
  for (const h of findAll(text, RE.dayOfMonthEs)) dayOfMonth(h)

  // Resolve overlaps: earliest first, longer wins on a tie.
  hits.sort((a, b) => a.start - b.start || b.end - a.end)
  const kept: DateHit[] = []
  for (const hit of hits) {
    const last = kept[kept.length - 1]
    if (!last || hit.start >= last.end) kept.push(hit)
  }
  return kept
}

// Words just before a date that belong to it: "she has until", "due on", "para el", "antes del", "plazo:".
const LEAD_RE = new RegExp([
  '(?:(?:\\b(?:she|he|they|it|we|you|i|ella|el|ellos|ellas|usted|tu)\\s+)?\\b(?:has|have|had|needs?|gets?|got|tiene|tienen|tenemos|tengo)\\s+)?',
  '(?:\\b(?:the\\s+)?(?:deadline|due\\s+date)\\s*(?:is|=|:)?\\s*|\\b(?:la\\s+)?fecha\\s+(?:limite|de\\s+entrega)\\s*(?:es|:)?\\s*|\\bplazo\\s*(?:es|:)?\\s*',
  '|\\b(?:due|done|finished|completed|ready|submitted|paid|delivered|needed|vence|listo|lista|entregado|entregada|pagado|pagada)\\s+)?',
  '(?:\\b(?:by|until|till|before|due|on|for|at|no\\s+later\\s+than|through|thru|ending|para|antes\\s+de(?:l)?|hasta|a\\s+mas\\s+tardar|como\\s+muy\\s+tarde|como\\s+maximo|from|desde|del|al)\\s+)?',
  '(?:\\b(?:el|la|los|las|the)\\s+)?$',
].join(''), 'i')

const DEADLINE_LEAD = /(?:\b(?:by|until|till|before|due|deadline|through|thru|no\s+later\s+than|para|antes\s+de(?:l)?|hasta|a\s+mas\s+tardar|vence|plazo|fecha\s+limite)\s*(?:is|:|on|date|el|la|es)?\s*)$/i
const RANGE_GAP = /^\s*(?:to|until|till|through|thru|-|–|—|al|a|hasta(?:\s+el)?)\s*$/i

function leadStart(text: string, start: number) {
  const m = LEAD_RE.exec(foldSame(text).slice(0, start))
  return m ? start - m[0].length : start
}

/** Pick the deadline among several dates. "from Monday to Friday" → Friday (and the whole range is removed). */
function chooseDate(text: string, hits: DateHit[]): { hit: DateHit; from: number } | null {
  if (hits.length === 0) return null
  const folded = foldSame(text)
  for (let i = 1; i < hits.length; i++) {
    if (RANGE_GAP.test(folded.slice(hits[i - 1].end, hits[i].start))) return { hit: hits[i], from: leadStart(text, hits[i - 1].start) }
  }
  if (hits.length > 1) {
    const withDeadline = hits.filter((h) => DEADLINE_LEAD.test(folded.slice(0, h.start)))
    if (withDeadline.length > 0) {
      const hit = withDeadline[withDeadline.length - 1]
      return { hit, from: leadStart(text, hit.start) }
    }
  }
  return { hit: hits[0], from: leadStart(text, hits[0].start) }
}

interface TimeHit { start: number; end: number; hour: number; minute: number }

const HOUR_WORDS: Record<string, number> = { una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 }
/** "at 3" / "a las 3" with no am/pm: working hours (1–6 → afternoon, 7–11 → morning). */
const workingHour = (h: number) => (h >= 1 && h <= 6 ? h + 12 : h)

const TIME_RE = {
  ampm: /(?:(?:\bat|\bby|\ba\s+las?|\bpara\s+las?|\bantes\s+de\s+las?)\s*|@\s*)?\b(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?!\w)/gi,
  h24: /(?:(?:\bat|\bby|\ba\s+las?|\bpara\s+las?)\s+)?\b([01]?\d|2[0-3]):([0-5]\d)\b(?:\s*(?:hrs?|h|horas)\b)?(?!\s*[ap]\.?\s?m)/gi,
  esBare: /\b(?:a|para|antes\s+de)\s+las?\s+(\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?:\s+y\s+(media|cuarto))?(?:\s*(?:hrs?|h|horas)\b)?(?:\s+(?:de\s+la\s+(manana|tarde|noche)|en\s+punto))?\b/gi,
  enBare: /\bat\s+(\d{1,2})(?:\s*o'?\s?clock)?(?=\s*$|\s*[,.;!?)])/gi,
  oclock: /\b(\d{1,2})\s*o'?\s?clock\b/gi,
  noon: /(?:(?:\bat|\bby|\bal?|\bpara\s+el)\s+)?\b(noon|midday|mediodia)\b/gi,
  partOfDay: new RegExp(`\\b(${alternation(PARTS_OF_DAY.map(([p]) => p))})\\b`, 'gi'),
}
const PART_HOURS = new Map(PARTS_OF_DAY.map(([p, h]) => [lowerFold(p), h]))

function findTimes(text: string): { time: TimeHit | null; extraCuts: Array<{ from: number; to: number }> } {
  const candidates: TimeHit[] = []
  for (const h of findAll(text, TIME_RE.ampm)) {
    let hour = +h.groups[1]!
    const minute = h.groups[2] ? +h.groups[2] : 0
    if (hour < 1 || hour > 12 || minute > 59) continue
    hour = (hour % 12) + (lowerFold(h.groups[3]!).startsWith('p') ? 12 : 0)
    candidates.push({ start: h.index, end: h.end, hour, minute })
  }
  for (const h of findAll(text, TIME_RE.h24)) candidates.push({ start: h.index, end: h.end, hour: +h.groups[1]!, minute: +h.groups[2]! })
  for (const h of findAll(text, TIME_RE.esBare)) {
    const raw = lowerFold(h.groups[1]!)
    let hour = HOUR_WORDS[raw] ?? parseInt(raw, 10)
    if (!(hour >= 0 && hour <= 23)) continue
    const minute = h.groups[2] ? (lowerFold(h.groups[2]) === 'media' ? 30 : 15) : 0
    const part = h.groups[3] ? lowerFold(h.groups[3]) : ''
    if (part === 'tarde' || part === 'noche') hour = hour < 12 ? hour + 12 : hour
    else if (part !== 'manana' && hour <= 12) hour = workingHour(hour)
    candidates.push({ start: h.index, end: h.end, hour, minute })
  }
  for (const h of findAll(text, TIME_RE.enBare)) {
    const hour = +h.groups[1]!
    if (hour >= 1 && hour <= 12) candidates.push({ start: h.index, end: h.end, hour: workingHour(hour), minute: 0 })
  }
  for (const h of findAll(text, TIME_RE.oclock)) {
    const hour = +h.groups[1]!
    if (hour >= 1 && hour <= 12) candidates.push({ start: h.index, end: h.end, hour: workingHour(hour), minute: 0 })
  }
  for (const h of findAll(text, TIME_RE.noon)) candidates.push({ start: h.index, end: h.end, hour: 12, minute: 0 })

  // "por la tarde" / "in the morning": a default time, and always removed from the title.
  const parts = findAll(text, TIME_RE.partOfDay)
  candidates.sort((a, b) => a.start - b.start || b.end - a.end)
  const explicit = candidates.find((c) => !parts.some((p) => c.start >= p.index && c.end <= p.end)) ?? null
  const extraCuts = parts
    .filter((p) => !explicit || p.end <= explicit.start || p.index >= explicit.end)
    .map((p) => ({ from: p.index, to: p.end }))
  if (explicit) return { time: explicit, extraCuts }
  const part = parts[0]
  return {
    time: part ? { start: part.index, end: part.end, hour: PART_HOURS.get(lowerFold(part.groups[1]!).replace(/\s+/g, ' ')) ?? 9, minute: 0 } : null,
    extraCuts: extraCuts.slice(part ? 1 : 0),
  }
}

// ─── Priority, verbs, segmenting ─────────────────────────────────────────────

// A leading "it's / this is / es / esto es" belongs to the phrase ("es muy importante", "it's urgent").
const COPULA = "(?:(?:this|it|that)(?:\\s+is|'s)\\s+|(?:esto|eso)\\s+es\\s+|es\\s+)?"
const PRIORITY_RULES = PRIORITY_PHRASES.map(([level, phrases]) => [level, new RegExp(`\\b${COPULA}(?:${phrases.join('|')})(?!\\w)`, 'gi')] as const)

const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'st', 'vs', 'etc', 'inc', 'ltd', 'co', 'approx', 'est', 'dept', 'jr', 'sr', 'prof', 'fig',
  'a.m', 'p.m', 'e.g', 'i.e', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'sra', 'srta', 'dra', 'ing', 'lic', 'av', 'num', 'tel', 'ud', 'uds', 'pag', 'arq', 'ene', 'abr', 'ago', 'dic',
])
const BULLET_RE = /^\s*(?:[-*•–—]|\d+[.)])\s+/

interface Sentence { text: string; bullet: boolean }

function splitSentences(line: string): string[] {
  const parts: string[] = []
  let last = 0
  for (const m of Array.from(line.matchAll(/([.!?]+|;)(\s+|$)/g))) {
    const index = m.index ?? 0
    if (m[1] === '.') {
      const token = lowerFold(line.slice(0, index).match(/(\S+)$/)?.[1] ?? '')
      if (ABBREVIATIONS.has(token)) continue
    }
    const end = index + (m[1] === ';' ? 0 : m[1].length)
    parts.push(line.slice(last, end))
    last = index + m[0].length
  }
  if (last < line.length) parts.push(line.slice(last))
  return parts.map((p) => p.trim().replace(/^[¿¡]+/, '')).filter((p) => /[\p{L}\p{N}]/u.test(p))
}

function toSentences(text: string): Sentence[] {
  const out: Sentence[] = []
  for (const rawLine of text.split('\n')) {
    let line = rawLine.trim()
    if (!line) continue
    const bullet = BULLET_RE.exec(line)
    if (bullet) line = line.slice(bullet[0].length)
    splitSentences(line).forEach((sentence, i) => out.push({ text: sentence, bullet: Boolean(bullet) && i === 0 }))
  }
  return out
}

const INTRO_CLAUSE = new RegExp(`^(?:${alternation(INTRO_WORDS)})\\b`, 'i')
const CONNECTOR = new RegExp(
  `(?:,\\s*(?:and\\s+|then\\s+|also\\s+|plus\\s+|y\\s+|e\\s+|luego\\s+|despues\\s+|tambien\\s+|ademas\\s+)?|\\s+(?:and|y|e)\\s+(?:also\\s+|tambien\\s+|luego\\s+)?|\\s+then\\s+|\\s+also\\s+|\\s+plus\\s+|\\s+luego\\s+|\\s+despues\\s+|\\s+tambien\\s+|\\s*\\+\\s*)(?=${SPLIT_VERB}\\b)`,
  'gi',
)

/** "pay the bill, call John and email Ana" → three parts (only at a verb). */
function splitList(sentence: string): string[] {
  const cuts = findAll(sentence, CONNECTOR).map((h) => ({ at: h.index, len: h.end - h.index }))
  // "Due to the rain, call the roofer": the first comma ends an introduction.
  if (INTRO_CLAUSE.test(foldSame(sentence))) cuts.shift()
  if (cuts.length === 0) return [sentence]
  const parts: string[] = []
  let from = 0
  for (const cut of cuts) {
    const left = sentence.slice(from, cut.at)
    if (wordCount(left) >= 2 && wordCount(sentence.slice(cut.at + cut.len)) >= 2) {
      parts.push(left)
      from = cut.at + cut.len
    }
  }
  parts.push(sentence.slice(from))
  return parts.map((p) => p.trim()).filter(Boolean)
}

const STRONG_CONTINUATION = new RegExp(`^(?:and\\s+|but\\s+|y\\s+|pero\\s+)?(?:${alternation(FOLLOW_UP_STARTERS)})\\b(?!\\s+to\\b)`, 'i')
const WEAK_CONTINUATION = new RegExp(`^(?:${alternation(WEAK_FOLLOW_UP_STARTERS)})\\b`, 'i')
// "<anyone> has until…", "until this date", "deadline": a deadline remark, whatever the subject word (even "Shr").
const DEADLINE_REMARK = /^\S{1,12}\s+(?:has|have|had|got|gets|needs?\s+it|tiene|tienen)\s+(?:until|till|by|before|hasta|para)\b|\b(?:until|by|before|hasta|para|antes\s+de)\s+(?:this|that|the|esta|esa|la)\s+(?:date|fecha)\b|\bdeadline\b|\bfecha\s+limite\b|\bplazo\b/i

// ─── People ──────────────────────────────────────────────────────────────────

interface Ref {
  display: string
  mention: boolean
  people: QuickPerson[] | null
  status: RefNote['status']
}

interface PeopleIndex { regex: RegExp; byKey: Map<string, QuickPerson[]>; learned: Set<string>; keys: string[] }

function buildPeopleIndex(people: QuickPerson[], memory: QuickAddMemory | null | undefined): PeopleIndex {
  const norm = (s: string) => lowerFold(s).replace(/\s+/g, ' ').trim()
  const byKey = new Map<string, QuickPerson[]>()
  const add = (key: string, person: QuickPerson) => {
    const k = norm(key)
    if (k.length < 2) return
    const list = byKey.get(k) ?? []
    if (!list.includes(person)) list.push(person)
    byKey.set(k, list)
  }
  for (const person of people) {
    for (const name of [person.name, ...(person.aliases ?? [])]) {
      if (!name?.trim()) continue
      add(name, person)
      const parts = name.trim().split(/\s+/)
      if (parts.length > 1) add(parts[0], person)
    }
  }
  // What this person taught us wins: "Ana" → the Ana they picked, "Jimmy" → James.
  const learned = new Set<string>()
  for (const alias of memory?.aliases ?? []) {
    const person = people.find((p) => p.id === alias.personId)
    const key = norm(alias.token)
    if (!person || key.length < 2) continue
    byKey.set(key, [person])
    learned.add(key)
  }
  const keys = Array.from(byKey.keys())
  const known = keys.length ? alternation(keys) : ''
  const source = known ? `(@?)\\b(${known})\\b|@([A-Za-z][A-Za-z0-9_'-]{0,30})` : `()()@([A-Za-z][A-Za-z0-9_'-]{0,30})`
  return { regex: new RegExp(source, 'gi'), byKey, learned, keys }
}

const PH = '\\u0001\\d+\\u0002'
// One or more people: "@Ana @Mia", "Ana, Mia and Joe", "Ana y Mia".
// Each separator form is distinct (no two optional \s* in a row) so failing matches can't backtrack exponentially.
const PS = `${PH}(?:(?:\\s*[,&]\\s*(?:and\\s+|y\\s+)?|\\s+(?:and|y)\\s+|\\s+)${PH})*`
const placeholder = (i: number) => `\u0001${i}\u0002`
const placeholderIds = (s: string) => Array.from(s.matchAll(/\u0001(\d+)\u0002/g)).map((m) => +m[1])

const WANT_EN = "(?:(?:i|we)(?:'d|\\s+would)?\\s+)?(?:really\\s+)?(?:want|need|like|wish|expect|require|prefer)s?"
const WANT_ES = '(?:quiero|necesito|quisiera|queremos|necesitamos|me\\s+gustaria|nos\\s+gustaria|prefiero|hace\\s+falta)'
const ASK_ES = '(?:pidele|pidale|pide(?:le)?|pedirle|dile|digale|decirle|recuerdale|recordarle|avisale|avisa)'
const MODAL_EN = "(?:should|will|must|can|could|shall|may|needs?\\s+to|has\\s+to|have\\s+to|is\\s+to|are\\s+to|is\\s+going\\s+to|are\\s+going\\s+to|'ll)"
const MODAL_ES = '(?:debe(?:ria|ra|n|rian)?|tiene\\s+que|tienen\\s+que|va\\s+a|van\\s+a|necesita|necesitan|puede|pueden|podria|podrian|se\\s+encarga(?:ra|n)?\\s+de|hara|haran|ha\\s+de|tendra\\s+que)'

interface Clause { re: RegExp; keep?: (hit: Hit) => string; onlyAfter?: string; spanishSubject?: boolean }

/** Assignment phrasings. Order matters (most specific first). */
const CLAUSES: Clause[] = [
  { re: new RegExp(`(?:${WANT_EN}|\\b(?:please\\s+)?(?:ask|get|tell|remind))\\s+${PS}\\s+to\\s+(?=\\S)`, 'gi') },
  { re: new RegExp(`\\b${WANT_ES}\\s+que\\s+${PS}\\s+(?=\\S)`, 'gi'), spanishSubject: true },
  { re: new RegExp(`^que\\s+${PS}\\s+(?=\\S)`, 'i'), spanishSubject: true },
  { re: new RegExp(`\\b${ASK_ES}\\s+a\\s+${PS}\\s+que\\s+(?=${VERB}\\b)`, 'gi'), spanishSubject: true },
  { re: new RegExp(`\\b(?:have|let)\\s+${PS}\\s+(?=${VERB}\\b)`, 'gi') },
  { re: new RegExp(`\\b(?:re)?assign(?:ed)?\\s+(?:this\\s+|it\\s+|the\\s+task\\s+)?to\\s+${PS}[\\s:,-]*`, 'gi') },
  { re: new RegExp(`\\b(?:re)?asigna(?:r(?:le|selo)?|do|da|dos|das|le)?\\s+(?:esto\\s+|esta\\s+tarea\\s+|la\\s+tarea\\s+|el\\s+trabajo\\s+)?a\\s+${PS}[\\s:,-]*`, 'gi') },
  { re: new RegExp(`\\b(?:re)?assign\\s+(.+?)\\s+to\\s+${PS}[\\s:,-]*`, 'gi'), keep: (h) => `${h.groups[1]} `, onlyAfter: ' to ' },
  { re: new RegExp(`\\b(?:re)?asigna(?:r)?\\s+(.+?)\\s+a\\s+${PS}[\\s:,-]*`, 'gi'), keep: (h) => `${h.groups[1]} `, onlyAfter: ' a ' },
  { re: new RegExp(`${PS}\\s+${MODAL_EN}\\s+`, 'gi') },
  { re: new RegExp(`${PS}\\s+${MODAL_ES}\\s+`, 'gi'), spanishSubject: true },
  { re: new RegExp(`^(?:for\\s+|para\\s+)?${PS}\\s*[:,\\-–—]\\s*`, 'i') },
  { re: new RegExp(`^${PS}\\s+to\\s+`, 'i') },
  { re: new RegExp(`^${PS}\\s+(?=(?:please\\s+|por\\s+favor\\s+)?${VERB}\\b)`, 'i'), spanishSubject: true },
  { re: new RegExp(`\\b(?:done|handled|completed|finished|owned|taken\\s+care\\s+of)\\s+by\\s+${PS}`, 'gi') },
  { re: new RegExp(`\\b(?:assignee|owner|responsible|dri|responsable|encargad[oa])\\s*[:=]?\\s*${PS}`, 'gi') },
  { re: new RegExp(`\\ba\\s+cargo\\s+de\\s+${PS}`, 'gi') },
]

// Someone Quick add doesn't know yet, in a clear "who does it" slot → ask, and learn the answer.
const UNK = "([A-Za-z][A-Za-z'-]{1,20})"
const UNKNOWN_SLOTS: RegExp[] = [
  new RegExp(`^${UNK}\\s+(?:should|will|must|needs?\\s+to|has\\s+to|is\\s+going\\s+to)\\s+(?=\\S)`, 'i'),
  new RegExp(`^${UNK}\\s+to\\s+(?=${VERB}\\b)`, 'i'),
  new RegExp(`(?:${WANT_EN}|\\b(?:ask|get|tell|remind))\\s+${UNK}\\s+to\\s+(?=\\S)`, 'gi'),
  new RegExp(`\\b(?:have|let)\\s+${UNK}\\s+(?=${VERB}\\b)`, 'gi'),
  new RegExp(`\\bassign(?:ed)?\\s+(?:this\\s+|it\\s+)?to\\s+${UNK}\\b[\\s:,-]*`, 'gi'),
  new RegExp(`^${UNK}\\s+${MODAL_ES}\\s+(?=\\S)`, 'i'),
  new RegExp(`\\b${WANT_ES}\\s+que\\s+${UNK}\\s+(?=${VERB}\\b)`, 'gi'),
  new RegExp(`^que\\s+${UNK}\\s+(?=${VERB}\\b)`, 'i'),
  new RegExp(`\\b${ASK_ES}\\s+a\\s+${UNK}\\s+que\\s+(?=${VERB}\\b)`, 'gi'),
  new RegExp(`\\basigna(?:r|do|da)?\\s+(?:esto\\s+|esta\\s+tarea\\s+)?a\\s+${UNK}\\b[\\s:,-]*`, 'gi'),
]

const ME_PATTERNS: RegExp[] = [
  /\bremind\s+me\s+to\s+/i,
  /\bassign(?:ed)?\s+(?:this\s+|it\s+)?to\s+me\b[\s:,-]*/i,
  /^(?:i'll|i\s+will|i\s+need\s+to|i\s+have\s+to|i\s+must|i\s+gotta|i\s+want\s+to|i\s+should|i\s+am\s+going\s+to|i'm\s+going\s+to|i\s+plan\s+to)\s+/i,
  /\brecuerdame\s+(?:que\s+|de\s+)?/i,
  /\basigna(?:melo|mela|me)\b[\s:,-]*/i,
  /\basigna(?:r)?(?:lo|la)?\s+a\s+mi\b[\s:,-]*/i,
  /^(?:tengo\s+que|debo|voy\s+a|necesito(?!\s+que)|me\s+toca|quiero(?!\s+que))\s+/i,
]

// ─── Titles ──────────────────────────────────────────────────────────────────

const TRAILING = new RegExp(`\\b(?:${alternation(TRAILING_WORDS)})$`, 'i')

function cleanTitle(raw: string): string {
  let t = raw
  for (let i = 0; i < 12; i++) {
    const before = t
    t = t.trim().replace(/^[\s,;:\-–—.!?¡¿'"()[\]]+/, '')
    for (const filler of LEAD_FILLERS) t = rewrite(t, new RegExp(filler.source, filler.flags.replace('g', '')), () => '')
    if (t === before) break
  }
  for (let i = 0; i < 12; i++) {
    const before = t
    t = t.replace(/[\s,;:\-–—.!?¡¿'"([]+$/, '')
    t = rewrite(t, TRAILING, () => '').trim()
    if (t === before) break
  }
  t = t.replace(/\(\s*\)/g, '').replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim()
  return capitalize(t)
}

function spanishVerb(word: string): { infinitive: string; clitic: string } | null {
  const w = lowerFold(word)
  const direct = ES_FORM_TO_INFINITIVE.get(w)
  if (direct) return { infinitive: direct, clitic: '' }
  for (const clitic of ES_CLITICS) {
    if (!w.endsWith(clitic)) continue
    const base = w.slice(0, -clitic.length)
    const inf = base.length >= 3 ? ES_FORM_TO_INFINITIVE.get(base) : undefined
    if (inf) return { infinitive: inf, clitic }
  }
  return null
}

/** Spanish task titles use the infinitive: "Llame al proveedor" → "Llamar al proveedor", "Envíale…" → "Enviarle…". */
const PREVERBAL_CLITICS = new Set(['le', 'les', 'lo', 'la', 'los', 'las', 'me', 'nos', 'se'])

function spanishTitle(title: string, subjectRemoved: boolean): string {
  // "le envíe el presupuesto" → "Enviarle el presupuesto"
  const pre = /^(\S+)\s+(\S+)/.exec(title)
  if (pre && PREVERBAL_CLITICS.has(lowerFold(pre[1]))) {
    const verb = spanishVerb(pre[2])
    if (verb && !verb.clitic && lowerFold(verb.infinitive) !== lowerFold(pre[2])) {
      return capitalize(verb.infinitive + lowerFold(pre[1])) + title.slice(pre[0].length)
    }
  }
  const m = /^(\S+)(?:\s+(\S+))?/.exec(title)
  if (!m) return title
  const verb = spanishVerb(m[1])
  if (!verb) return title
  const isInfinitive = !verb.clitic && lowerFold(verb.infinitive) === lowerFold(m[1])
  if (isInfinitive) return title
  const next = m[2] ? lowerFold(m[2]) : ''
  if (!subjectRemoved && !verb.clitic && !ES_OBJECT_STARTERS.includes(next)) return title
  return capitalize(verb.infinitive + verb.clitic) + title.slice(m[1].length)
}

// ─── One card's worth of text ────────────────────────────────────────────────

interface Analysis {
  title: string
  assigneeIds: string[]
  date: string | null
  dateAlternative: DateAlternative | null
  priority: QuickPriority | null
  labels: string[]
  found: ParsedCard['found']
  warnings: string[]
  refs: RefNote[]
}

interface Ctx {
  now: Date
  today: Date
  index: PeopleIndex
  people: QuickPerson[]
  meId: string | null
  splitLists: boolean
  memory: QuickAddMemory | null
}

function analyze(raw: string, ctx: Ctx, language: QuickLanguage): Analysis {
  const warnings: string[] = []
  const labels: string[] = []
  const found: Analysis['found'] = { assignees: [], date: null, priority: null, guesses: [] }
  const refNotes: RefNote[] = []
  let text = raw.trim()

  // 1 · #labels
  text = rewrite(text, /(^|\s)#([a-z0-9][\w-]{1,30})/gi, (h) => {
    labels.push(lowerFold(h.groups[2]!))
    return h.groups[1] ?? ''
  })

  // 2 · priority
  let priority: QuickPriority | null = null
  for (const [level, re] of PRIORITY_RULES) {
    const hits = findAll(text, re)
    if (hits.length === 0) continue
    priority = level
    found.priority = hits[0].text
    text = rewrite(text, re, () => ' ')
    break
  }

  // 3 · date + time
  const prefs: DatePrefs = {
    nextWeekday: ctx.memory?.prefs.nextWeekday ?? (language === 'es' ? 'upcoming' : 'following'),
    numericOrder: ctx.memory?.prefs.numericOrder ?? (language === 'es' ? 'dmy' : 'mdy'),
  }
  const chosen = chooseDate(text, findDateHits(text, ctx.today, prefs))
  const { time, extraCuts } = findTimes(text)
  let date: Date | null = chosen?.hit.date ?? null
  const cuts: Array<{ from: number; to: number }> = []
  if (chosen) {
    cuts.push({ from: chosen.from, to: chosen.hit.end })
    found.date = text.slice(chosen.from, chosen.hit.end).trim()
  }
  const overlaps = (a: { from: number; to: number }) => cuts.some((c) => a.from < c.to && a.to > c.from)
  if (time && !overlaps({ from: time.start, to: time.end })) {
    cuts.push({ from: time.start, to: time.end })
    const t = text.slice(time.start, time.end).trim()
    found.date = found.date ? `${found.date} ${t}` : t
  }
  for (const cut of extraCuts) if (!overlaps(cut)) cuts.push(cut)
  cuts.sort((a, b) => b.from - a.from)
  for (const cut of cuts) text = `${text.slice(0, cut.from)} ${text.slice(cut.to)}`
  if (time && !date) {
    date = ctx.today
    if (new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.hour, time.minute) <= ctx.now) date = addDays(ctx.today, 1)
  }
  let dueDate: string | null = null
  if (date) {
    dueDate = fmtDate(date) + (time ? `T${pad(time.hour)}:${pad(time.minute)}:00` : '')
    if (date < ctx.today) warnings.push('That date has already passed.')
  }
  const alt = chosen?.hit.alternative
  const dateAlternative: DateAlternative | null = alt ? { pref: alt.pref, value: alt.value, date: fmtDate(alt.date) } : null
  text = text.replace(/\s{2,}/g, ' ').trim()

  // 4 · people
  const refs: Ref[] = []
  const assigned: string[] = []
  const assign = (ref: Ref) => {
    if (ref.status === 'unknown') {
      warnings.push(ref.mention
        ? `@${ref.display} isn’t a user — pick someone below and Quick add will remember.`
        : `Who is “${ref.display}”? Pick someone below and Quick add will remember.`)
      refNotes.push({ token: ref.display, status: 'unknown' })
      return
    }
    if (ref.people && ref.people.length > 1) {
      warnings.push(`“${ref.display}” could be ${ref.people.map((p) => p.name).join(' or ')} — pick one and Quick add will remember.`)
      refNotes.push({ token: ref.display, status: 'ambiguous', candidates: ref.people.map((p) => p.id) })
      return
    }
    const person = ref.people?.[0]
    if (!person) return
    refNotes.push({ token: ref.display, status: ref.status, personId: person.id })
    if (ref.status === 'guessed') found.guesses.push(`@${ref.display} → ${person.name}`)
    if (!assigned.includes(person.id)) {
      assigned.push(person.id)
      found.assignees.push(person.name)
    }
  }
  const assignAll = (s: string) => placeholderIds(s).forEach((i) => assign(refs[i]))

  const folded = foldSame(text)
  let out = ''
  let last = 0
  for (const m of Array.from(folded.matchAll(new RegExp(ctx.index.regex.source, 'gi')))) {
    const at = m.index ?? 0
    const shown = text.slice(at, at + m[0].length)
    const mention = shown.startsWith('@')
    // "name@example.com" is an e-mail address, not a mention.
    if (mention && at > 0 && /\w/.test(text[at - 1])) continue
    out += text.slice(last, at)
    last = at + m[0].length
    const display = mention ? shown.slice(1) : shown
    let ref: Ref
    if (m[2]) {
      const key = lowerFold(m[2]).replace(/\s+/g, ' ')
      ref = { display, mention, people: ctx.index.byKey.get(key) ?? null, status: ctx.index.learned.has(key) ? 'learned' : 'matched' }
    } else {
      // Unknown @name: a close spelling of a real person is a guess ("@Mai" → Mia), shown as such.
      const guess = closestWord(display, ctx.index.keys, 3)
      const people = guess ? ctx.index.byKey.get(guess.word) ?? null : null
      ref = people && people.length === 1 ? { display, mention, people, status: 'guessed' } : { display, mention, people: null, status: 'unknown' }
    }
    refs.push(ref)
    out += placeholder(refs.length - 1)
  }
  text = out + text.slice(last)

  let spanishSubject = false
  for (const clause of CLAUSES) {
    if (!text.includes('\u0001')) break
    text = rewrite(text, clause.re, (h) => {
      const scope = clause.onlyAfter ? h.text.slice(Math.max(0, lowerFold(h.text).lastIndexOf(clause.onlyAfter))) : h.text
      if (placeholderIds(scope).length === 0) return null
      assignAll(scope)
      if (clause.spanishSubject) spanishSubject = true
      return clause.keep ? clause.keep(h) : ''
    })
  }

  // Unknown names in a clear "who" slot ("Jimmy should…", "quiero que Pepe…").
  for (const re of UNKNOWN_SLOTS) {
    text = rewrite(text, re, (h) => {
      const token = h.groups[1] ?? ''
      const key = lowerFold(token)
      if (!/^[A-Z]/.test(stripDiacritics(token)) || NOT_NAMES.has(key) || KNOWN_WORDS.has(key) || spanishVerb(key)) return null
      assign({ display: token, mention: false, people: null, status: 'unknown' })
      if (/que|debe|tiene|va |necesita|puede|encarga/i.test(lowerFold(h.text))) spanishSubject = true
      return ''
    })
  }

  // Whatever is left: an "@name" still assigns; a bare name stays as words.
  text = text.replace(/\u0001(\d+)\u0002/g, (m, i: string, offset: number, whole: string) => {
    const ref = refs[+i]
    if (!ref.mention) return ref.display
    assign(ref)
    const before = whole.slice(0, offset)
    const after = whole.slice(offset + m.length)
    return /^[\s,:;-]*$/.test(before) || /^[\s,.:;!?)-]*$/.test(after) ? '' : ref.display
  })

  // 5 · first person → the person typing.
  if (assigned.length === 0 && !refNotes.some((r) => r.status === 'unknown' || r.status === 'ambiguous')) {
    for (const re of ME_PATTERNS) {
      if (!findAll(text, re).length) continue
      text = rewrite(text, re, () => '')
      if (ctx.meId) {
        assigned.push(ctx.meId)
        found.assignees.push('you')
      }
      if (/recuerdame|tengo|debo|voy|necesito|toca|quiero/.test(re.source)) spanishSubject = true
      break
    }
  }

  // 6 · title
  let title = cleanTitle(text)
  if (language === 'es') title = spanishTitle(title, spanishSubject)

  return { title, assigneeIds: assigned, date: dueDate, dateAlternative, priority, labels, found, warnings, refs: refNotes }
}

// ─── Public API ──────────────────────────────────────────────────────────────

function sameText(a: string, b: string) {
  return comparable(a) === comparable(b)
}

export function parseQuickAdd(input: string, options: QuickAddOptions): ParsedCard[] {
  const now = options.now ?? new Date()
  const people = options.people ?? []
  const index = buildPeopleIndex(people, options.memory)
  const ctx: Ctx = {
    now,
    today: startOfDay(now),
    index,
    people,
    meId: options.currentUserId && people.some((p) => p.id === options.currentUserId) ? options.currentUserId : null,
    splitLists: options.splitLists !== false,
    memory: options.memory ?? null,
  }

  let text = (input ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[“”«»]/g, '"').replace(/[‘’´]/g, "'")
  // Guess misspelled control words, never names or known words.
  const protect = new Set<string>([...KNOWN_WORDS, ...index.keys.flatMap((k) => k.split(' '))])
  const typo = correctTypos(text, protect)
  text = typo.text

  const sentences = toSentences(text)

  // Group sentences: follow-ups ("She has until Friday") join the previous card.
  const groups: string[][] = []
  for (const sentence of sentences) {
    const previous = groups[groups.length - 1]
    if (previous && !sentence.bullet && isContinuation(sentence.text, ctx)) previous.push(sentence.text)
    else groups.push([sentence.text])
  }

  const assignable = new Set(people.map((p) => p.id))
  const nameWords = new Set(index.keys.flatMap((k) => k.split(' ')))
  const cards: ParsedCard[] = []
  for (const group of groups) {
    if (cards.length >= MAX_CARDS) break
    const source = group.join(' ')
    const language = detectLanguage(source)
    const parts = ctx.splitLists ? splitList(group[0]) : [group[0]]
    let analyses = parts.map((part) => analyze(part, ctx, language))

    if (analyses.length > 1) {
      // A part with no task in it ("this is important", "urgente") is a remark about the others.
      const remarks = analyses.filter((a) => !a.title)
      const tasks = analyses.filter((a) => a.title)
      if (remarks.length > 0 && tasks.length > 0) {
        for (const remark of remarks) {
          for (const task of tasks) {
            for (const id of remark.assigneeIds) if (!task.assigneeIds.includes(id)) task.assigneeIds.push(id)
            if (!task.date && remark.date) { task.date = remark.date; task.found.date = remark.found.date; task.dateAlternative = remark.dateAlternative }
            if (!task.priority && remark.priority) { task.priority = remark.priority; task.found.priority = remark.found.priority }
          }
        }
        analyses = tasks
      }
    }

    // Shared by the whole sentence: a leading assignee, and a trailing date / priority.
    const first = analyses[0]
    const last = analyses[analyses.length - 1]
    for (const a of analyses) {
      if (a.assigneeIds.length === 0 && first.assigneeIds.length > 0) {
        a.assigneeIds = [...first.assigneeIds]
        a.found.assignees = [...first.found.assignees]
      }
      if (!a.date && last.date) { a.date = last.date; a.found.date = last.found.date; a.dateAlternative = last.dateAlternative }
      if (!a.priority && last.priority) { a.priority = last.priority; a.found.priority = last.found.priority }
    }

    // Follow-up sentences add details to every card in the group.
    for (const extra of group.slice(1)) {
      const e = analyze(extra, ctx, language)
      for (const a of analyses) {
        for (const id of e.assigneeIds) if (!a.assigneeIds.includes(id)) a.assigneeIds.push(id)
        for (const name of e.found.assignees) if (!a.found.assignees.includes(name)) a.found.assignees.push(name)
        if (e.date) { a.date = e.date; a.found.date = e.found.date; a.dateAlternative = e.dateAlternative }
        if (e.priority) { a.priority = e.priority; a.found.priority = e.found.priority }
        for (const label of e.labels) if (!a.labels.includes(label)) a.labels.push(label)
        for (const w of e.warnings) if (!a.warnings.includes(w)) a.warnings.push(w)
        a.refs.push(...e.refs)
        a.found.guesses.push(...e.found.guesses.filter((g) => !a.found.guesses.includes(g)))
      }
    }

    for (const a of analyses) {
      if (cards.length >= MAX_CARDS) break
      let title = a.title || cleanTitle(source) || source.trim()
      let truncated = false
      if (title.length > MAX_TITLE) {
        const cut = title.slice(0, MAX_TITLE - 1)
        title = `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : cut.length).trimEnd()}…`
        truncated = true
      }
      // Keep the original wording when details were pulled out of it, so nothing typed is lost.
      const hasDetails = Boolean(a.found.assignees.length || a.found.date || a.found.priority || a.labels.length || group.length > 1 || a.warnings.length)
      const description = (hasDetails || truncated) && !sameText(title, source) ? source : null

      const guesses = [...a.found.guesses]
      for (const c of typo.corrections) {
        const note = `“${c.from}” → ${c.to}`
        if (lowerFold(source).includes(lowerFold(c.to)) && !guesses.includes(note)) guesses.push(note)
      }
      for (const r of a.refs) {
        if (r.status === 'learned' && r.personId) {
          const note = `remembered: ${r.token} = ${people.find((p) => p.id === r.personId)?.name ?? ''}`
          if (!guesses.includes(note)) guesses.push(note)
        }
      }

      const priority = a.priority ?? 'normal'
      const suggestions: QuickSuggestion[] = suggestFromHistory(title, options.history, {
        hasAssignee: a.assigneeIds.length > 0,
        hasPriority: Boolean(a.found.priority) || priority !== 'normal',
        labels: a.labels,
        assignable,
        ignoreWords: nameWords,
      }).map((s) => {
        const share = `${s.support} of ${s.total} “${s.word}” cards`
        if (s.kind === 'assignee') return { kind: 'assignee', value: s.value, reason: `${people.find((p) => p.id === s.value)?.name ?? 'Someone'} did ${share}` }
        if (s.kind === 'priority') return { kind: 'priority', value: s.value, reason: `${share} were ${s.value}` }
        return { kind: 'label', value: s.value, reason: `${share} had #${s.value}` }
      })

      cards.push({
        title,
        description,
        assigneeIds: a.assigneeIds,
        dueDate: a.date,
        priority,
        labels: a.labels,
        source,
        language,
        found: { ...a.found, guesses },
        warnings: a.warnings,
        refs: a.refs,
        dateAlternative: a.dateAlternative,
        suggestions,
      })
    }
  }
  return cards
}

function isContinuation(sentence: string, ctx: Ctx): boolean {
  const folded = foldSame(sentence)
  if (STRONG_CONTINUATION.test(folded) || DEADLINE_REMARK.test(folded)) return true
  const a = analyze(sentence, ctx, detectLanguage(sentence))
  if (!a.title) return true
  if (WEAK_CONTINUATION.test(folded)) return Boolean(a.date || a.priority || a.assigneeIds.length > 0)
  return false
}
