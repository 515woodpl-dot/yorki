/**
 * quick-add/parse.ts — turn typed sentences into task cards. No AI, no network.
 *
 * Pure rules (regular expressions + a small calendar), so it is instant,
 * predictable and testable. It runs in the browser: you see the result as you
 * type, and your text never leaves the page until you press Create.
 *
 * What it understands
 *   people     "@Ana", "Ana should…", "have Ana…", "ask Ana to…", "assign … to Ana",
 *              "Ana: …", "remind me to…", "I'll…" (→ you)
 *   dates      today, tomorrow, Friday, next Friday, in 3 days, next week, end of month,
 *              Dec 5, 5th of December, 12/5, 2026-12-05, "the 15th", "until Friday"
 *   times      3pm, 3:30 pm, 15:00, noon
 *   priority   urgent / ASAP / right away → urgent · high priority → high ·
 *              no rush / whenever → low
 *   labels     #plumbing
 *   many cards one per line or bullet, per sentence, and "pay the bill, call John and
 *              email Ana" (verb lists). A follow-up sentence that starts with "She/He/
 *              They/It/This/That…" or "by/until/due…" adds to the previous card instead
 *              of creating a new one.
 *
 * Anything it is unsure about is left alone and reported in `warnings`; the UI
 * always shows a preview you can edit before anything is created.
 */

export type QuickPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface QuickPerson {
  id: string
  name: string
  /** Other ways people refer to them: display name, first part of their e-mail… */
  aliases?: string[]
}

export interface QuickAddOptions {
  people: QuickPerson[]
  /** The person typing (for "remind me to…", "I'll…"). */
  currentUserId?: string | null
  /** Override "now" (tests). */
  now?: Date
  /** Split "pay the bill and call John" into two cards. Default true. */
  splitLists?: boolean
}

export interface ParsedCard {
  title: string
  /** The original wording, when it says more than the title. */
  description: string | null
  assigneeIds: string[]
  /** "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:00" (local time), or null. */
  dueDate: string | null
  priority: QuickPriority
  labels: string[]
  /** The text this card was built from. */
  source: string
  /** What was recognised, for the preview ("until Friday", "@Ana", "ASAP"). */
  found: { assignees: string[]; date: string | null; priority: string | null }
  warnings: string[]
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
const comparable = (s: string) => stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, '')
const wordCount = (s: string) => (s.match(/\S+/g) ?? []).length

function addMonths(d: Date, n: number) {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last))
}

function makeDate(y: number, m: number, d: number): Date | null {
  const date = new Date(y, m, d)
  return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d ? date : null
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}
const NUM = '(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d{1,3})'
const toNumber = (word: string) => NUMBER_WORDS[word.toLowerCase()] ?? parseInt(word, 10)

const MONTH_NAMES = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const WEEKDAY_NAMES = 'mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|saturday|sunday'
const monthIndex = (name: string) =>
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(name.slice(0, 3).toLowerCase())
const weekdayIndex = (name: string) =>
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(name.slice(0, 3).toLowerCase())

// ─── Dates ───────────────────────────────────────────────────────────────────

interface DateHit { start: number; end: number; date: Date; label: string }

function upcomingWeekday(today: Date, weekday: number, includeToday: boolean) {
  const diff = (weekday - today.getDay() + 7) % 7
  return addDays(today, diff === 0 && !includeToday ? 7 : diff)
}

/** The given weekday in the *next calendar week* (Mon–Sun). */
function weekdayNextWeek(today: Date, weekday: number) {
  const mondayThisWeek = addDays(today, -((today.getDay() + 6) % 7))
  return addDays(mondayThisWeek, 7 + ((weekday + 6) % 7))
}

function findDateHits(text: string, today: Date): DateHit[] {
  const hits: DateHit[] = []
  const push = (m: RegExpMatchArray, date: Date | null, from = 0) => {
    if (date && m.index !== undefined) hits.push({ start: m.index + from, end: m.index + m[0].length, date, label: m[0].slice(from) })
  }
  // Month/day with no year: if it already passed this year, mean next year.
  const monthDay = (month: number, day: number, year?: number) => {
    if (year !== undefined) return makeDate(year, month, day)
    const thisYear = makeDate(today.getFullYear(), month, day)
    if (thisYear && thisYear >= today) return thisYear
    return makeDate(today.getFullYear() + 1, month, day)
  }
  const fullYear = (y: string) => (y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10))

  for (const m of Array.from(text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g))) {
    push(m, makeDate(+m[1], +m[2] - 1, +m[3]))
  }
  for (const m of Array.from(text.matchAll(new RegExp(`\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(20\\d{2})\\b)?`, 'gi')))) {
    push(m, monthDay(monthIndex(m[1]), +m[2], m[3] ? +m[3] : undefined))
  }
  for (const m of Array.from(text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_NAMES})\\b\\.?(?:,?\\s*(20\\d{2})\\b)?`, 'gi')))) {
    push(m, monthDay(monthIndex(m[2]), +m[1], m[3] ? +m[3] : undefined))
  }
  // 12/5, 12/5/26 (US order; if the first number can't be a month, read it as day/month)
  for (const m of Array.from(text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g))) {
    let month = +m[1] - 1
    let day = +m[2]
    if (month > 11 && day <= 12) [month, day] = [day - 1, month + 1]
    push(m, monthDay(month, day, m[3] ? fullYear(m[3]) : undefined))
  }
  for (const m of Array.from(text.matchAll(/\b(\d{1,2})-(\d{1,2})-(\d{2,4})\b/g))) {
    push(m, makeDate(fullYear(m[3]), +m[1] - 1, +m[2]))
  }
  // today / tomorrow …
  for (const m of Array.from(text.matchAll(/\b(today|tonight|tomorrow|tmrw|tmr|(?:the\s+)?day\s+after\s+tomorrow)\b(?!'s)/gi))) {
    const word = m[1].toLowerCase()
    push(m, /after/.test(word) ? addDays(today, 2) : /^(tomorrow|tmrw|tmr)$/.test(word) ? addDays(today, 1) : today)
  }
  // in 3 days / within 2 weeks / 3 days from now
  for (const m of Array.from(text.matchAll(new RegExp(`\\b(?:in|within)\\s+${NUM}\\s+(day|week|month)s?\\b`, 'gi')))) {
    push(m, relative(today, toNumber(m[1]), m[2]))
  }
  for (const m of Array.from(text.matchAll(new RegExp(`\\b${NUM}\\s+(day|week|month)s?\\s+from\\s+(?:now|today)\\b`, 'gi')))) {
    push(m, relative(today, toNumber(m[1]), m[2]))
  }
  // Friday, next Friday, this Friday
  for (const m of Array.from(text.matchAll(new RegExp(`\\b(?:(this|next|coming|upcoming)\\s+)?(${WEEKDAY_NAMES})\\b(?!['’]s)`, 'gi')))) {
    const qualifier = m[1]?.toLowerCase()
    const weekday = weekdayIndex(m[2])
    push(m, qualifier === 'this' ? upcomingWeekday(today, weekday, true)
      : qualifier === 'next' ? weekdayNextWeek(today, weekday)
      : upcomingWeekday(today, weekday, false))
  }
  // next week, end of month, eod …
  for (const m of Array.from(text.matchAll(/\b(next\s+week|this\s+week|next\s+month|end\s+of\s+(?:the\s+)?(?:week|month|year|day)|eow|eom|eoy|eod|cob|close\s+of\s+business|(?:this\s+)?weekend)\b(?!['’]s)/gi))) {
    const key = m[1].toLowerCase().replace(/\s+/g, ' ').replace('the ', '')
    let date: Date | null = null
    if (key === 'next week') date = addDays(today, 7)
    else if (key === 'this week' || key === 'end of week' || key === 'eow') date = upcomingWeekday(today, 5, true)
    else if (key === 'next month') date = addMonths(today, 1)
    else if (key === 'end of month' || key === 'eom') date = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    else if (key === 'end of year' || key === 'eoy') date = new Date(today.getFullYear(), 11, 31)
    else if (/weekend/.test(key)) date = upcomingWeekday(today, 6, true)
    else date = today // end of day / eod / cob
    push(m, date)
  }
  // "by the 15th", "on the 3rd"
  for (const m of Array.from(text.matchAll(/\b(?:by|on|until|till|before|due)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/gi))) {
    const day = +m[1]
    const lead = m[0].length - m[0].replace(/^\S+\s+(?:the\s+)?/i, '').length
    const thisMonth = makeDate(today.getFullYear(), today.getMonth(), day)
    const nextMonth = makeDate(today.getFullYear(), today.getMonth() + 1, day)
    push(m, thisMonth && thisMonth >= today ? thisMonth : nextMonth, lead)
  }

  // Resolve overlaps: earliest first, longer wins on a tie.
  hits.sort((a, b) => a.start - b.start || b.end - a.end)
  const kept: DateHit[] = []
  for (const hit of hits) {
    const last = kept[kept.length - 1]
    if (!last || hit.start >= last.end) kept.push(hit)
  }
  return kept
}

function relative(today: Date, n: number, unit: string) {
  if (!Number.isFinite(n)) return null
  const u = unit.toLowerCase()
  return u === 'day' ? addDays(today, n) : u === 'week' ? addDays(today, n * 7) : addMonths(today, n)
}

const DEADLINE_LEAD = /(?:\b(?:by|until|till|before|due|deadline|through|thru|no\s+later\s+than)\s*(?:is|:|on|date)?\s*)$/i
// Words just before a date that belong to it ("she has until", "due on", "deadline is").
const LEAD_RE = /(?:(?:\b(?:she|he|they|it|we|you|i)\s+)?\b(?:has|have|had|needs?|gets?|got)\s+)?(?:\b(?:the\s+)?(?:deadline|due\s+date)\s*(?:is|=|:)?\s*|\b(?:due|done|finished|completed|ready|submitted|paid|delivered|needed)\s+)?(?:\b(?:by|until|till|before|due|on|for|at|no\s+later\s+than|through|thru|ending)\s+)?$/i

function leadStart(text: string, start: number) {
  const m = LEAD_RE.exec(text.slice(0, start))
  return m ? start - m[0].length : start
}

function chooseDate(text: string, hits: DateHit[]): DateHit | null {
  if (hits.length === 0) return null
  if (hits.length > 1) {
    // "from Monday to Friday" / "Monday - Friday": the deadline is the later one.
    for (let i = 1; i < hits.length; i++) {
      if (/^\s*(?:to|until|till|through|thru|-|–|—)\s*$/i.test(text.slice(hits[i - 1].end, hits[i].start))) return hits[i]
    }
    const withDeadline = hits.filter((h) => DEADLINE_LEAD.test(text.slice(0, h.start)))
    if (withDeadline.length > 0) return withDeadline[withDeadline.length - 1]
  }
  return hits[0]
}

interface TimeHit { start: number; end: number; hour: number; minute: number }

function findTime(text: string): TimeHit | null {
  const candidates: TimeHit[] = []
  for (const m of Array.from(text.matchAll(/(?:(?:\bat|\bby)\s*|@\s*)?\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?!\w)/gi))) {
    let hour = +m[1]
    const minute = m[2] ? +m[2] : 0
    if (hour < 1 || hour > 12 || minute > 59) continue
    const pm = m[3].toLowerCase().startsWith('p')
    hour = (hour % 12) + (pm ? 12 : 0)
    candidates.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, hour, minute })
  }
  for (const m of Array.from(text.matchAll(/(?:(?:\bat|\bby)\s+)?\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*[ap]\.?m)/gi))) {
    candidates.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, hour: +m[1], minute: +m[2] })
  }
  for (const m of Array.from(text.matchAll(/(?:(?:\bat|\bby)\s+)?\b(noon|midday)\b/gi))) {
    candidates.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, hour: 12, minute: 0 })
  }
  candidates.sort((a, b) => a.start - b.start)
  return candidates[0] ?? null
}

// ─── Priority ────────────────────────────────────────────────────────────────

// Order matters: "not urgent" must be tested before "urgent".
const PRIORITY_RULES: Array<[QuickPriority, string]> = [
  ['low', "low[- ]priority|no\\s+rush|not\\s+urgent|whenever(?:\\s+you(?:'re|\\s+are)?\\s+(?:free|can|able))?|when\\s+(?:you\\s+)?(?:can|have\\s+time|get\\s+a\\s+chance)|nice\\s+to\\s+have|someday|at\\s+some\\s+point"],
  ['urgent', 'urgent(?:ly)?|a\\.?s\\.?a\\.?p\\.?|right\\s+away|immediately|emergency|critical|drop\\s+everything|top\\s+priority|time[- ]sensitive'],
  ['high', "high[- ]priority|priority\\s*[:=]?\\s*high|high\\s+importance|(?:very|really|extremely|super)\\s+important|(?:this|it)(?:\\s+is|'s)\\s+important|important!+"],
  ['normal', 'normal\\s+priority|regular\\s+priority|priority\\s*[:=]?\\s*normal'],
]

// ─── Verbs (used to split "pay the bill and call John" and to spot "Ana review…") ─

const VERBS = [
  'call', 'email', 'e-mail', 'text', 'message', 'send', 'pay', 'buy', 'order', 'book', 'schedule', 'fix', 'repair',
  'review', 'check', 'update', 'create', 'write', 'finish', 'complete', 'submit', 'prepare', 'clean', 'install',
  'renew', 'file', 'follow up', 'follow-up', 'contact', 'ask', 'tell', 'remind', 'pick up', 'drop off', 'get', 'make',
  'print', 'sign', 'approve', 'confirm', 'cancel', 'return', 'ship', 'deliver', 'measure', 'quote', 'invoice',
  'inspect', 'design', 'draft', 'plan', 'organize', 'organise', 'research', 'find', 'set up', 'setup', 'test', 'upload',
  'download', 'deploy', 'remove', 'delete', 'add', 'change', 'move', 'arrange', 'collect', 'assemble', 'paint', 'build',
  'wash', 'pack', 'take', 'bring', 'visit', 'meet', 'attend', 'join', 'post', 'publish', 'share', 'bill', 'charge',
  'refund', 'reconcile', 'count', 'restock', 'replace', 'upgrade', 'back up', 'work', 'do', 'start', 'handle', 'look',
  'prep', 'process', 'record', 'track', 'verify', 'wrap up', 'close', 'open', 'cut', 'sort', 'ping', 'reach out',
]
const VERB_ALT = VERBS.map((v) => escapeRe(v).replace(/\\? /g, '\\s+')).join('|')
const VERB = `(?:${VERB_ALT})`

// ─── Segmenting ──────────────────────────────────────────────────────────────

const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'st', 'vs', 'etc', 'inc', 'ltd', 'co', 'approx', 'est', 'dept', 'jr', 'sr', 'prof', 'fig',
  'a.m', 'p.m', 'e.g', 'i.e', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
])
const BULLET_RE = /^\s*(?:[-*•–—]|\d+[.)])\s+/

interface Sentence { text: string; bullet: boolean }

function splitSentences(line: string): string[] {
  const parts: string[] = []
  let last = 0
  for (const m of Array.from(line.matchAll(/([.!?]+|;)(\s+|$)/g))) {
    const index = m.index ?? 0
    if (m[1] === '.') {
      const token = (line.slice(0, index).match(/(\S+)$/)?.[1] ?? '').toLowerCase()
      if (ABBREVIATIONS.has(token)) continue
    }
    const end = index + (m[1] === ';' ? 0 : m[1].length)
    parts.push(line.slice(last, end))
    last = index + m[0].length
  }
  if (last < line.length) parts.push(line.slice(last))
  return parts.map((p) => p.trim()).filter((p) => /[\p{L}\p{N}]/u.test(p))
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

const INTRO_CLAUSE = /^(?:due\s+to|because|since|as|after|before|when|while|if|once|until|unless|although|though|given|with|in\s+case|on\s+account\s+of|thanks\s+to)\b/i

/** "pay the bill, call John and email Ana" → three parts (only at a verb). */
function splitList(sentence: string): string[] {
  const connector = new RegExp(`(?:,\\s*(?:and\\s+|then\\s+|also\\s+|plus\\s+)?|\\s+and\\s+(?:also\\s+)?|\\s+then\\s+|\\s+also\\s+|\\s+plus\\s+|\\s*\\+\\s*)(?=${VERB}\\b)`, 'gi')
  const cuts = Array.from(sentence.matchAll(connector)).map((m) => ({ at: m.index ?? 0, len: m[0].length }))
  // "Due to the rain, call the roofer" / "After lunch, email Mia": the first comma ends an
  // introduction, not a list item.
  if (INTRO_CLAUSE.test(sentence)) cuts.shift()
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

const STRONG_CONTINUATION = /^(?:and\s+|but\s+)?(?:she|he|they|her|his|their|deadline|due(?!\s+to\b)|by|until|till|before|no\s+later\s+than|asap|urgent|no\s+rush|low\s+priority|high\s+priority|priority)\b/i
// "<anything> has until…", "until this date", "deadline…": a deadline remark about the previous
// card, whatever the subject word is (people mistype "she", say "Mia has until…", etc.).
const DEADLINE_REMARK = /^\S{1,12}\s+(?:has|have|had|got|gets|needs?\s+it)\s+(?:until|till|by|before)\b|\b(?:until|by|before)\s+(?:this|that|the)\s+date\b|\bdeadline\b/i
const WEAK_CONTINUATION = /^(?:it|this|that|these|those|its|it's|that's)\b/i

// ─── People ──────────────────────────────────────────────────────────────────

interface Ref { display: string; mention: boolean; people: QuickPerson[] | null }

interface PeopleIndex { regex: RegExp | null; byKey: Map<string, QuickPerson[]> }

function buildPeopleIndex(people: QuickPerson[]): PeopleIndex {
  const norm = (s: string) => stripDiacritics(s).toLowerCase().replace(/\s+/g, ' ').trim()
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
  const keys = Array.from(byKey.keys()).sort((a, b) => b.length - a.length)
  const known = keys.map((k) => escapeRe(k).replace(/\\? /g, '\\s+')).join('|')
  const source = known
    ? `(@?)\\b(${known})\\b|@([A-Za-z][A-Za-z0-9_'-]{0,30})`
    : `()()@([A-Za-z][A-Za-z0-9_'-]{0,30})`
  return { regex: new RegExp(source, 'gi'), byKey }
}

const PH = '\\u0001\\d+\\u0002'
const PS = `${PH}(?:\\s*(?:,|&|\\band\\b)\\s*${PH})*`
const placeholder = (i: number) => `\u0001${i}\u0002`
const placeholderIds = (s: string) => Array.from(s.matchAll(/\u0001(\d+)\u0002/g)).map((m) => +m[1])

// ─── One card's worth of text ────────────────────────────────────────────────

interface Analysis {
  title: string
  assigneeIds: string[]
  date: string | null
  priority: QuickPriority | null
  labels: string[]
  found: { assignees: string[]; date: string | null; priority: string | null }
  warnings: string[]
}

interface Ctx {
  now: Date
  today: Date
  index: PeopleIndex
  people: QuickPerson[]
  meId: string | null
  splitLists: boolean
}

const WANT = "(?:(?:i|we)(?:'d|\\s+would)?\\s+)?(?:really\\s+)?(?:want|need|like|wish|expect|require|prefer)s?"

const LEAD_FILLERS: RegExp[] = [
  /^(?:ok(?:ay)?|hey|hi|hello|so|also|and|or|but|then|please|pls|kindly|just|well|now|yes|yeah)\b[\s,.:;-]*/i,
  /^(?:i|we)(?:'d|\s+would)\s+like\s+to\s+/i,
  /^(?:i|we)\s+(?:really\s+|also\s+)?(?:want|need|have|got|plan|wanna|gotta|must|should)\s+to\s+/i,
  /^(?:i|we)\s+(?:wanna|gotta|must|should)\s+/i,
  /^(?:i|we)(?:'ll|\s+will|'m\s+going\s+to|\s+am\s+going\s+to)\s+/i,
  /^(?:let'?s|lets|let\s+us)\s+(?:go\s+and\s+)?/i,
  /^(?:can|could|would|will)\s+(?:you|someone|somebody|anyone)\s+(?:please\s+)?/i,
  /^(?:don'?t\s+forget\s+to|remember\s+to|remind\s+me\s+to|reminder\s+to|make\s+sure\s+(?:to|that)?|be\s+sure\s+to|need\s+to|needs\s+to|has\s+to|have\s+to|got\s+to|gotta|time\s+to)\s*/i,
  /^(?:to-?do|todo|task|action|reminder|note)\s*[:\-–]\s*/i,
  /^(?:to|that)\s+/i,
]

const TRAILING_WORDS = /\b(?:by|on|until|till|before|for|to|at|and|or|the|a|an|in|due|from|of|with|but|so|then)$/i

function cleanTitle(raw: string): string {
  let t = raw
  for (let i = 0; i < 12; i++) {
    const before = t
    t = t.trim().replace(/^[\s,;:\-–—.!?'"()[\]]+/, '')
    for (const filler of LEAD_FILLERS) t = t.replace(filler, '')
    if (t === before) break
  }
  for (let i = 0; i < 12; i++) {
    const before = t
    t = t.replace(/[\s,;:\-–—.!?'"([]+$/, '').replace(TRAILING_WORDS, '').trim()
    if (t === before) break
  }
  t = t.replace(/\(\s*\)/g, '').replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function analyze(raw: string, ctx: Ctx): Analysis {
  const warnings: string[] = []
  const labels: string[] = []
  const found: Analysis['found'] = { assignees: [], date: null, priority: null }
  let text = raw.trim()

  // 1 · #labels
  text = text.replace(/(^|\s)#([a-z0-9][\w-]{1,30})/gi, (_m, pre: string, tag: string) => {
    labels.push(tag.toLowerCase())
    return pre
  })

  // 2 · priority
  let priority: QuickPriority | null = null
  for (const [level, source] of PRIORITY_RULES) {
    const re = new RegExp(`\\b(?:${source})(?!\\w)`, 'gi')
    const m = re.exec(text)
    if (m) {
      priority = level
      found.priority = m[0]
      text = text.replace(new RegExp(`\\b(?:${source})(?!\\w)`, 'gi'), ' ')
      break
    }
  }

  // 3 · date + time
  const hit = chooseDate(text, findDateHits(text, ctx.today))
  const time = findTime(text)
  let date: Date | null = hit?.date ?? null
  const cuts: Array<{ from: number; to: number }> = []
  if (hit) {
    const from = leadStart(text, hit.start)
    cuts.push({ from, to: hit.end })
    found.date = text.slice(from, hit.end).trim()
  }
  if (time && !(hit && time.start < hit.end && time.end > hit.start)) {
    cuts.push({ from: time.start, to: time.end })
    found.date = found.date ? `${found.date} ${text.slice(time.start, time.end).trim()}` : text.slice(time.start, time.end).trim()
  }
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

  text = text.replace(/\s{2,}/g, ' ').trim()

  // 4 · people
  const refs: Ref[] = []
  const assigned: string[] = []
  const assign = (ref: Ref) => {
    if (!ref.people) {
      warnings.push(`@${ref.display} isn’t a user — pick someone from the list.`)
    } else if (ref.people.length > 1) {
      warnings.push(`“${ref.display}” could be ${ref.people.map((p) => p.name).join(' or ')} — pick one.`)
    } else if (!assigned.includes(ref.people[0].id)) {
      assigned.push(ref.people[0].id)
      found.assignees.push(ref.people[0].name)
    }
  }
  const assignAll = (s: string) => placeholderIds(s).forEach((i) => assign(refs[i]))

  if (ctx.index.regex) {
    const plain = stripDiacritics(text)
    const source = plain.length === text.length ? plain : text
    let out = ''
    let last = 0
    for (const m of Array.from(source.matchAll(new RegExp(ctx.index.regex.source, 'gi')))) {
      const at = m.index ?? 0
      const shown = text.slice(at, at + m[0].length)
      const mention = shown.startsWith('@')
      // "name@example.com" is an e-mail address, not a mention.
      if (mention && at > 0 && /\w/.test(text[at - 1])) continue
      out += text.slice(last, at)
      last = at + m[0].length
      const key = (m[2] ?? '').toLowerCase().replace(/\s+/g, ' ')
      const display = mention ? shown.slice(1) : shown
      refs.push({ display, mention, people: m[2] ? ctx.index.byKey.get(key) ?? null : null })
      out += placeholder(refs.length - 1)
    }
    text = out + text.slice(last)
  }

  if (refs.length > 0) {
    const consume = (re: RegExp, replacement: string | ((m: string, ...g: string[]) => string) = '', onlyAfter?: string) => {
      text = text.replace(re, (...args) => {
        const m = args[0] as string
        // "assign Ana's report to Mia": only the people after " to " are assignees.
        assignAll(onlyAfter ? m.slice(Math.max(0, m.lastIndexOf(onlyAfter))) : m)
        return typeof replacement === 'function' ? replacement(m, ...(args.slice(1) as string[])) : replacement
      })
    }
    // "I want / need / ask / get / tell / remind  Ana (and Mia) to …"
    consume(new RegExp(`(?:${WANT}|\\b(?:please\\s+)?(?:ask|get|tell|remind))\\s+${PS}\\s+to\\s+(?=\\S)`, 'gi'))
    // "have Ana review …", "let Ana handle …"
    consume(new RegExp(`\\b(?:have|let)\\s+${PS}\\s+(?=${VERB}\\b)`, 'gi'))
    // "assign this to Ana", "assign the roof inspection to Ana"
    consume(new RegExp(`\\b(?:re)?assign(?:ed)?\\s+(?:this\\s+|it\\s+|the\\s+task\\s+)?to\\s+${PS}[\\s:,-]*`, 'gi'))
    consume(new RegExp(`\\b(?:re)?assign\\s+(.+?)\\s+to\\s+${PS}[\\s:,-]*`, 'gi'), (_m, what) => `${what} `, ' to ')
    // "Ana should …", "Ana needs to …", "Ana will …"
    consume(new RegExp(`${PS}\\s+(?:should|will|must|can|could|shall|may|needs?\\s+to|has\\s+to|have\\s+to|is\\s+to|are\\s+to|is\\s+going\\s+to|are\\s+going\\s+to|'ll)\\s+`, 'gi'))
    // "Ana: …", "For Ana, …", "Ana to review …", "Ana review …"
    consume(new RegExp(`^(?:for\\s+)?${PS}\\s*[:,\\-–—]\\s*`, 'i'))
    consume(new RegExp(`^${PS}\\s+to\\s+`, 'i'))
    consume(new RegExp(`^${PS}\\s+(?=(?:please\\s+)?${VERB}\\b)`, 'i'))
    // "done by Ana", "owner: Ana"
    consume(new RegExp(`\\b(?:done|handled|completed|finished|owned|taken\\s+care\\s+of)\\s+by\\s+${PS}`, 'gi'))
    consume(new RegExp(`\\b(?:assignee|owner|responsible|dri)\\s*[:=]?\\s*${PS}`, 'gi'))

    // Whatever is left: an "@name" is still an assignee; a bare name stays as words.
    text = text.replace(/\u0001(\d+)\u0002/g, (m, i: string, offset: number, whole: string) => {
      const ref = refs[+i]
      if (!ref.mention) return ref.display
      assign(ref)
      const before = whole.slice(0, offset)
      const after = whole.slice(offset + m.length)
      return /^[\s,:;-]*$/.test(before) || /^[\s,.:;!?)-]*$/.test(after) ? '' : ref.display
    })
  }

  // First person: "remind me to…", "assign to me", "I'll…" → the person typing.
  if (assigned.length === 0 && ctx.meId) {
    const me: RegExp[] = [
      /\bremind\s+me\s+to\s+/i,
      /\bassign(?:ed)?\s+(?:this\s+|it\s+)?to\s+me\b[\s:,-]*/i,
      /^(?:i'll|i\s+will|i\s+need\s+to|i\s+have\s+to|i\s+must|i\s+gotta|i\s+want\s+to|i\s+should|i\s+am\s+going\s+to|i'm\s+going\s+to|i\s+plan\s+to)\s+/i,
    ]
    for (const re of me) {
      if (re.test(text)) {
        text = text.replace(re, '')
        assigned.push(ctx.meId)
        found.assignees.push('you')
        break
      }
    }
  }

  return { title: cleanTitle(text), assigneeIds: assigned, date: dueDate, priority, labels, found, warnings }
}

// ─── Public API ──────────────────────────────────────────────────────────────

function sameText(a: string, b: string) {
  return comparable(a) === comparable(b)
}

export function parseQuickAdd(input: string, options: QuickAddOptions): ParsedCard[] {
  const now = options.now ?? new Date()
  const people = options.people ?? []
  const ctx: Ctx = {
    now,
    today: startOfDay(now),
    index: buildPeopleIndex(people),
    people,
    meId: options.currentUserId && people.some((p) => p.id === options.currentUserId) ? options.currentUserId : null,
    splitLists: options.splitLists !== false,
  }

  const text = (input ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  const sentences = toSentences(text)

  // Group sentences: follow-ups ("She has until Friday") join the previous card.
  const groups: string[][] = []
  for (const sentence of sentences) {
    const previous = groups[groups.length - 1]
    if (previous && !sentence.bullet && isContinuation(sentence.text, ctx)) previous.push(sentence.text)
    else groups.push([sentence.text])
  }

  const cards: ParsedCard[] = []
  for (const group of groups) {
    if (cards.length >= MAX_CARDS) break
    const source = group.join(' ')
    const parts = ctx.splitLists ? splitList(group[0]) : [group[0]]
    let analyses = parts.map((part) => analyze(part, ctx))
    if (analyses.length > 1) {
      // A part with no task in it ("this is important", "urgent") is a remark about the others.
      const remarks = analyses.filter((a) => !a.title)
      const tasks = analyses.filter((a) => a.title)
      if (remarks.length > 0 && tasks.length > 0) {
        for (const remark of remarks) {
          for (const task of tasks) {
            for (const id of remark.assigneeIds) if (!task.assigneeIds.includes(id)) task.assigneeIds.push(id)
            if (!task.date && remark.date) { task.date = remark.date; task.found.date = remark.found.date }
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
      if (!a.date && last.date) { a.date = last.date; a.found.date = last.found.date }
      if (!a.priority && last.priority) { a.priority = last.priority; a.found.priority = last.found.priority }
    }

    // Follow-up sentences add details to every card in the group.
    for (const extra of group.slice(1)) {
      const e = analyze(extra, ctx)
      for (const a of analyses) {
        for (const id of e.assigneeIds) if (!a.assigneeIds.includes(id)) a.assigneeIds.push(id)
        for (const name of e.found.assignees) if (!a.found.assignees.includes(name)) a.found.assignees.push(name)
        if (e.date) { a.date = e.date; a.found.date = e.found.date }
        if (e.priority) { a.priority = e.priority; a.found.priority = e.found.priority }
        for (const label of e.labels) if (!a.labels.includes(label)) a.labels.push(label)
        a.warnings.push(...e.warnings.filter((w) => !a.warnings.includes(w)))
      }
    }

    for (const a of analyses) {
      if (cards.length >= MAX_CARDS) break
      let title = a.title
      if (!title) title = cleanTitle(source) || source.trim()
      // Keep the original wording when we pulled details out of it (who / when / how
      // urgent) or had to shorten the title — so nothing the user typed is lost.
      const hasDetails = Boolean(a.found.assignees.length || a.found.date || a.found.priority || a.labels.length || group.length > 1 || a.warnings.length)
      let truncated = false
      if (title.length > MAX_TITLE) {
        const cut = title.slice(0, MAX_TITLE - 1)
        title = `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : cut.length).trimEnd()}…`
        truncated = true
      }
      const description = (hasDetails || truncated) && !sameText(title, source) ? source : null
      cards.push({
        title,
        description,
        assigneeIds: a.assigneeIds,
        dueDate: a.date,
        priority: a.priority ?? 'normal',
        labels: a.labels,
        source,
        found: a.found,
        warnings: a.warnings,
      })
    }
  }
  return cards
}

function isContinuation(sentence: string, ctx: Ctx): boolean {
  if (STRONG_CONTINUATION.test(sentence) || DEADLINE_REMARK.test(sentence)) return true
  const a = analyze(sentence, ctx)
  if (!a.title) return true
  if (WEAK_CONTINUATION.test(sentence)) return Boolean(a.date || a.priority || a.assigneeIds.length > 0)
  return false
}
