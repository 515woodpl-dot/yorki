/**
 * quick-add/fuzzy.ts — guess the word that was meant ("tomorow", "wensday", "urgnet", "@Mai").
 *
 * Deliberately narrow so it never "fixes" real words:
 *  - only towards a short list of control words (days, today/tomorrow, urgent,
 *    priority…, see GUESSABLE_WORDS) or towards real people's names;
 *  - same first letter, at most 1 edit (2 for words of 8+ letters);
 *  - never inside @mentions, #labels, e-mail addresses or links;
 *  - a best match that is tied with another is ignored.
 * Every correction is reported so the preview can show it.
 */

import { GUESSABLE_WORDS, MISSPELLINGS, NEVER_CORRECT } from './vocabulary'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Optimal-string-alignment distance (insert, delete, substitute, swap neighbours). */
export function editDistance(a: string, b: string, limit = 3): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0)
    row[0] = i
    return row
  })
  for (let j = 0; j < cols; j++) d[0][j] = j
  for (let i = 1; i < rows; i++) {
    let best = limit + 1
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      best = Math.min(best, d[i][j])
    }
    if (best > limit) return limit + 1
  }
  return d[a.length][b.length]
}

const allowedEdits = (length: number) => (length >= 8 ? 2 : 1)

/** The single closest candidate within the allowed edits (same first letter), or null. */
export function closestWord(word: string, candidates: readonly string[], minLength = 5): { word: string; distance: number } | null {
  const w = fold(word)
  if (w.length < minLength) return null
  const max = allowedEdits(w.length)
  let best: { word: string; distance: number } | null = null
  let tie = false
  for (const candidate of candidates) {
    const c = fold(candidate)
    if (c === w) return { word: candidate, distance: 0 }
    if (c[0] !== w[0] || Math.abs(c.length - w.length) > max) continue
    const distance = editDistance(w, c, max)
    if (distance > max) continue
    if (!best || distance < best.distance) { best = { word: candidate, distance }; tie = false }
    else if (distance === best.distance && fold(best.word) !== c) tie = true
  }
  return best && !tie ? best : null
}

// ─── Ordinary words (stricter) ───────────────────────────────────────────────

const KEYBOARD = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const KEY_POS = new Map<string, [number, number]>()
KEYBOARD.forEach((row, r) => Array.from(row).forEach((ch, c) => KEY_POS.set(ch, [r, c + r * 0.5])))
KEY_POS.set('ñ', [1, 9.5])

/** Keys next to each other on a QWERTY keyboard ("j" and "i", "s" and "a"). */
export function keyboardNeighbours(a: string, b: string): boolean {
  const pa = KEY_POS.get(a)
  const pb = KEY_POS.get(b)
  if (!pa || !pb || a === b) return false
  return Math.abs(pa[0] - pb[0]) <= 1 && Math.abs(pa[1] - pb[1]) <= 1
}

/** One neighbouring-key slip or two swapped letters ("medja" → "media", "reserach" → "research"). */
function isFingerSlip(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const diff: number[] = []
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i)
  if (diff.length === 1) return keyboardNeighbours(a[diff[0]], b[diff[0]])
  return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]
}

const isPluralOf = (word: string, base: string) => word === `${base}s` || word === `${base}es` || base === `${word}s` || base === `${word}es`

/**
 * Closest ordinary word for a likely typo. Stricter than closestWord:
 *  - 5-letter words: only a neighbouring-key slip or swapped letters;
 *  - 6–7 letters: one edit; 8+: two edits;
 *  - never a plural/singular of the target ("marcas" stays "marcas").
 */
export function closestGeneral(word: string, targets: readonly string[]): { word: string; distance: number } | null {
  const w = fold(word)
  if (w.length < 5) return null
  const max = allowedEdits(w.length)
  let best: { word: string; distance: number } | null = null
  let tie = false
  for (const target of targets) {
    const t = fold(target)
    if (t === w) return null
    if (t[0] !== w[0] || Math.abs(t.length - w.length) > max || isPluralOf(w, t)) continue
    const distance = editDistance(w, t, max)
    if (distance > max) continue
    if (w.length === 5 && !isFingerSlip(w, t)) continue
    if (!best || distance < best.distance) { best = { word: target, distance }; tie = false }
    else if (distance === best.distance && fold(best.word) !== t) tie = true
  }
  return best && !tie ? best : null
}

export interface GeneralTypoOptions {
  /** Ordinary words to correct towards. */
  targets: readonly string[]
  /** Real words that are one slip away from a target and must be left alone ("marker" ≠ "market"). */
  realWords: ReadonlySet<string>
  /** Other words known to be real (e.g. Spanish verb + pronoun: "ejecútalo", "mostrarnos"). */
  isKnown?: (folded: string) => boolean
}

export interface Correction { from: string; to: string }

function matchCase(original: string, replacement: string) {
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase()
  if (original[0] === original[0].toUpperCase()) return replacement.charAt(0).toUpperCase() + replacement.slice(1)
  return replacement
}

/**
 * Fix misspelled control words. `protect` holds words that must never change
 * (people's names, known verbs…), already folded (lowercase, no accents).
 */
export function correctTypos(text: string, protect: Set<string>, general?: GeneralTypoOptions): { text: string; corrections: Correction[] } {
  const corrections: Correction[] = []
  const out = text.replace(/[\p{L}\p{N}][\p{L}\p{N}']*/gu, (token, offset: number, whole: string) => {
    const before = whole[offset - 1] ?? ''
    const after = whole[offset + token.length] ?? ''
    const afterNext = whole[offset + token.length + 1] ?? ''
    // Leave @mentions, #labels, e-mail addresses, links and file names alone.
    if ('@#/\\_'.includes(before) || after === '@' || (after === '.' && /\p{L}/u.test(afterNext)) || before === '.') return token
    const key = fold(token)
    if (protect.has(key) || NEVER_CORRECT.has(key)) return token

    const known = MISSPELLINGS[key] ?? MISSPELLINGS[token.toLowerCase()]
    if (known) {
      const replacement = matchCase(token, known)
      corrections.push({ from: token, to: replacement })
      return replacement
    }
    // Possessives and contractions ("Friday's", "today's", "it's") are real words, never typos.
    if (/\d/.test(token) || token.includes("'") || GUESSABLE_WORDS.includes(key)) return token
    const guess = closestWord(token, GUESSABLE_WORDS)
      ?? (general && !general.realWords.has(key) && !general.isKnown?.(key) ? closestGeneral(token, general.targets) : null)
    if (!guess || guess.distance === 0) return token
    const replacement = matchCase(token, guess.word)
    corrections.push({ from: token, to: replacement })
    return replacement
  })
  return { text: out, corrections }
}
