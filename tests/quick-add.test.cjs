const { test } = require('node:test')
const assert = require('node:assert/strict')

const { load } = require('./load-ts.cjs')
const { parseQuickAdd } = load('src/lib/quick-add/parse.ts')

// Tuesday 17 November 2026, 10:00 local time.
const NOW = new Date(2026, 10, 17, 10, 0, 0)
const ANA = { id: 'ana', name: 'Ana Reyes', aliases: ['Ana', 'ana'] }
const MIA = { id: 'mia', name: 'Mia Porter', aliases: ['Mia', 'mia'] }
const GEORGE = { id: 'george', name: 'George', aliases: ['george'] }
const PEOPLE = [ANA, MIA, GEORGE]

// JSON round-trip: objects built inside vm have another realm's prototypes, which deepEqual rejects.
const parse = (text, extra = {}) =>
  JSON.parse(JSON.stringify(parseQuickAdd(text, { people: PEOPLE, currentUserId: 'george', now: NOW, ...extra })))
const one = (text, extra) => {
  const cards = parse(text, extra)
  assert.equal(cards.length, 1, `expected 1 card for "${text}", got ${cards.length}: ${JSON.stringify(cards.map((c) => c.title))}`)
  return cards[0]
}

// ─── The examples from the request ───────────────────────────────────────────

test('"I want @person to work in this project. She has until this date…" → one card, assigned', () => {
  const card = one('I want @Ana to work in this project. Shr has until this date to work o.n that')
  assert.equal(card.title, 'Work in this project')
  assert.deepEqual(card.assigneeIds, ['ana'])
  assert.equal(card.dueDate, null) // "this date" is not a real date — nothing invented
  assert.match(card.description, /Shr has until this date/) // original wording kept
})

test('the follow-up sentence supplies the deadline', () => {
  const card = one('I want @Ana to work in this project. She has until Dec 5 to finish that')
  assert.equal(card.title, 'Work in this project')
  assert.deepEqual(card.assigneeIds, ['ana'])
  assert.equal(card.dueDate, '2026-12-05')
})

test('"lets work on this project"', () => {
  const card = one('lets work on this project')
  assert.equal(card.title, 'Work on this project')
  assert.deepEqual(card.assigneeIds, [])
  assert.equal(card.priority, 'normal')
  assert.equal(card.description, null)
})

test('"pay this bill"', () => {
  assert.equal(one('pay this bill').title, 'Pay this bill')
})

test('several prompts at once → several cards', () => {
  const cards = parse('lets work on this project. Or pay this bill')
  assert.deepEqual(cards.map((c) => c.title), ['Work on this project', 'Pay this bill'])
})

// ─── People ──────────────────────────────────────────────────────────────────

test('assignee phrasings', () => {
  const cases = {
    'Ana should call the supplier': ['Call the supplier', ['ana']],
    'Have Mia review the quote': ['Review the quote', ['mia']],
    'Ask Ana to send the invoice': ['Send the invoice', ['ana']],
    'Mia: order paint': ['Order paint', ['mia']],
    'Ana to review the contract': ['Review the contract', ['ana']],
    'I need Mia to book the truck': ['Book the truck', ['mia']],
    'Assign this to Ana: fix the gate': ['Fix the gate', ['ana']],
    'Fix the gate @Ana': ['Fix the gate', ['ana']],
    'Fix the gate, assigned to Ana': ['Fix the gate', ['ana']],
    'Ana and Mia should paint the office': ['Paint the office', ['ana', 'mia']],
    'I want @Ana Reyes and @Mia to clean the shop': ['Clean the shop', ['ana', 'mia']],
  }
  for (const [text, [title, ids]] of Object.entries(cases)) {
    const card = one(text)
    assert.equal(card.title, title, text)
    assert.deepEqual(card.assigneeIds, ids, text)
  }
})

test('"assign X to Y" assigns only Y', () => {
  const card = one("Assign Ana's report to Mia")
  assert.deepEqual(card.assigneeIds, ['mia'])
})

test('a name that is only the topic is NOT an assignee', () => {
  for (const text of ['Email Mia about the invoice', 'Call Ana tomorrow', 'Send the quote to Mia']) {
    const card = one(text)
    assert.deepEqual(card.assigneeIds, [], text)
    assert.match(card.title, /Mia|Ana/, text)
  }
})

test('first person means you', () => {
  assert.deepEqual(one('Remind me to call John').assigneeIds, ['george'])
  assert.equal(one('Remind me to call John').title, 'Call John')
  assert.deepEqual(one('I need to pay this bill').assigneeIds, ['george'])
  assert.deepEqual(one("I'll order the tiles").assigneeIds, ['george'])
  assert.deepEqual(one('lets work on this project').assigneeIds, []) // "we", not "I"
})

test('unknown and ambiguous people are reported, never guessed', () => {
  const unknown = one('@bob to paint the fence')
  assert.deepEqual(unknown.assigneeIds, [])
  assert.equal(unknown.title, 'Paint the fence')
  assert.match(unknown.warnings.join(' '), /@bob/)

  const people = [ANA, { id: 'ana2', name: 'Ana Lopez', aliases: ['Ana'] }, MIA]
  const ambiguous = one('@Ana to call the plumber', { people })
  assert.deepEqual(ambiguous.assigneeIds, [])
  assert.match(ambiguous.warnings.join(' '), /Ana Reyes or Ana Lopez/)
  assert.deepEqual(one('@Ana Lopez to call the plumber', { people }).assigneeIds, ['ana2'])
})

test('e-mail addresses are not mentions', () => {
  const card = one('Send the file to bob@mia.com')
  assert.deepEqual(card.assigneeIds, [])
  assert.match(card.title, /bob@mia\.com/)
})

test('accents and case do not matter', () => {
  const people = [{ id: 'jose', name: 'José García', aliases: ['José'] }]
  assert.deepEqual(one('jose should fix the roof', { people }).assigneeIds, ['jose'])
  assert.deepEqual(one('@JOSÉ GARCÍA to fix the roof', { people }).assigneeIds, ['jose'])
})

// ─── Dates ───────────────────────────────────────────────────────────────────

test('dates', () => {
  const cases = {
    'pay the bill today': '2026-11-17',
    'pay the bill tomorrow': '2026-11-18',
    'pay the bill by Friday': '2026-11-20',
    'pay the bill this Friday': '2026-11-20',
    'pay the bill next Friday': '2026-11-27',
    'pay the bill on Tuesday': '2026-11-24', // today is Tuesday → next one
    'pay the bill in 3 days': '2026-11-20',
    'pay the bill in two weeks': '2026-12-01',
    'pay the bill next week': '2026-11-24',
    'pay the bill by end of month': '2026-11-30',
    'pay the bill eow': '2026-11-20',
    'pay the bill by Dec 5': '2026-12-05',
    'pay the bill by December 5th': '2026-12-05',
    'pay the bill on 5th of December': '2026-12-05',
    'pay the bill by 12/5': '2026-12-05',
    'pay the bill by 2026-12-05': '2026-12-05',
    'pay the bill by Dec 5, 2027': '2027-12-05',
    'pay the bill by Nov 10': '2027-11-10', // already passed → next year
    'pay the bill by the 25th': '2026-11-25',
    'pay the bill on the 10th': '2026-12-10',
    'pay the bill until Friday': '2026-11-20',
    'pay the bill, due Friday': '2026-11-20',
    'Friday: pay the bill': '2026-11-20',
  }
  for (const [text, expected] of Object.entries(cases)) {
    const card = one(text)
    assert.equal(card.dueDate, expected, text)
    assert.equal(card.title, 'Pay the bill', text)
  }
})

test('times', () => {
  assert.equal(one('call John Friday at 3:30pm').dueDate, '2026-11-20T15:30:00')
  assert.equal(one('call John tomorrow at 9am').dueDate, '2026-11-18T09:00:00')
  assert.equal(one('call John at 15:00').dueDate, '2026-11-17T15:00:00')
  assert.equal(one('call John by noon tomorrow').dueDate, '2026-11-18T12:00:00')
  assert.equal(one('call John at 9am').dueDate, '2026-11-18T09:00:00') // 9am already passed today
  assert.equal(one('call John Friday at 3pm').title, 'Call John')
})

test('"from Monday to Friday": the deadline is the later date', () => {
  assert.equal(one('paint the office from Monday to Friday').dueDate, '2026-11-20')
})

test('words that merely contain a date word are left alone', () => {
  const card = one("Review Friday's report and tomorrow's agenda", { splitLists: false })
  assert.equal(card.dueDate, null)
  assert.equal(card.title, "Review Friday's report and tomorrow's agenda")
  assert.equal(one('Order 3 decks of tiles').dueDate, null)
  assert.equal(one('Buy 5 may flowers').dueDate, '2027-05-05') // "5 may" is a date; documented behaviour
})

test('a made-up year is not a date', () => {
  assert.equal(one('Order Dec 5 1500 tiles').dueDate, '2026-12-05')
  assert.match(one('Order Dec 5 1500 tiles').title, /1500 tiles/)
})

test('explicit past dates are flagged', () => {
  assert.match(one('pay the bill by 2025-01-01').warnings.join(' '), /passed/)
})

// ─── Priority and labels ─────────────────────────────────────────────────────

test('priority', () => {
  assert.equal(one('fix the sink asap').priority, 'urgent')
  assert.equal(one('URGENT: fix the sink').priority, 'urgent')
  assert.equal(one('fix the sink right away').priority, 'urgent')
  assert.equal(one('fix the sink, high priority').priority, 'high')
  assert.equal(one('this is important, fix the sink').priority, 'high')
  assert.equal(one('no rush: fix the sink').priority, 'low')
  assert.equal(one('not urgent, fix the sink').priority, 'low')
  assert.equal(one('fix the sink whenever you can').priority, 'low')
  assert.equal(one('fix the sink').priority, 'normal')
  for (const text of ['fix the sink asap', 'URGENT: fix the sink', 'no rush: fix the sink', 'fix the sink, high priority']) {
    assert.equal(one(text).title, 'Fix the sink', text)
  }
})

test('#labels', () => {
  const card = one('#plumbing #q4 fix the sink')
  assert.deepEqual(card.labels, ['plumbing', 'q4'])
  assert.equal(card.title, 'Fix the sink')
})

test('everything together', () => {
  const card = one('Ana should call the supplier by Friday at 2pm, urgent #vendors')
  assert.deepEqual(
    { title: card.title, ids: card.assigneeIds, due: card.dueDate, priority: card.priority, labels: card.labels },
    { title: 'Call the supplier', ids: ['ana'], due: '2026-11-20T14:00:00', priority: 'urgent', labels: ['vendors'] },
  )
  assert.equal(card.description, 'Ana should call the supplier by Friday at 2pm, urgent #vendors')
  assert.deepEqual(card.found, { assignees: ['Ana Reyes'], date: 'by Friday at 2pm', priority: 'urgent', guesses: [] })
})

// ─── Several cards ───────────────────────────────────────────────────────────

test('one card per line and per bullet', () => {
  const cards = parse('- Pay the bill by Friday\n- Call John\n3) Order paint')
  assert.deepEqual(cards.map((c) => c.title), ['Pay the bill', 'Call John', 'Order paint'])
  assert.deepEqual(cards.map((c) => c.dueDate), ['2026-11-20', null, null])
})

test('verb lists split, and share the leading assignee and trailing date', () => {
  const cards = parse('Pay the rent, call the plumber and email Mia about the invoice')
  assert.deepEqual(cards.map((c) => c.title), ['Pay the rent', 'Call the plumber', 'Email Mia about the invoice'])

  const shared = parse('Ana should review the quote and approve the budget by Friday')
  assert.deepEqual(shared.map((c) => c.title), ['Review the quote', 'Approve the budget'])
  assert.deepEqual(shared.map((c) => c.assigneeIds), [['ana'], ['ana']])
  assert.deepEqual(shared.map((c) => c.dueDate), ['2026-11-20', '2026-11-20'])
})

test('a date in the first part stays with the first part', () => {
  const cards = parse('Pay the bill by Monday and call the plumber')
  assert.deepEqual(cards.map((c) => c.dueDate), ['2026-11-23', null])
})

test('splitting can be switched off', () => {
  const cards = parse('Pay the bill and call the plumber', { splitLists: false })
  assert.deepEqual(cards.map((c) => c.title), ['Pay the bill and call the plumber'])
})

test('plain "and" between nouns is never split', () => {
  assert.equal(parse('Research and development budget').length, 1)
  assert.equal(parse('Order tiles and grout').length, 1)
  assert.equal(parse('I want Ana, Mia and George to review the plan').length, 1)
})

test('follow-ups attach to the previous card; new tasks do not', () => {
  assert.equal(parse('Pay the bill. It is urgent').length, 1)
  assert.equal(parse('Pay the bill. It is urgent')[0].priority, 'urgent')
  assert.equal(parse('Pay the bill. Due Friday')[0].dueDate, '2026-11-20')
  assert.equal(parse('Pay the bill. Due to the rain, call the roofer').length, 2)
  assert.equal(parse('Pay the bill. This invoice is from last month').length, 1) // explains the same task
  assert.equal(parse('Pay the bill.\nThis invoice is from last month').length, 2) // a new line is a new card
})

test('abbreviations do not break sentences', () => {
  const cards = parse('Call Dr. Smith about the invoice by Dec. 5')
  assert.equal(cards.length, 1)
  assert.equal(cards[0].dueDate, '2026-12-05')
})

// ─── Robustness ──────────────────────────────────────────────────────────────

test('empty and junk input', () => {
  assert.deepEqual(parse(''), [])
  assert.deepEqual(parse('   \n  \n'), [])
  assert.deepEqual(parse('...'), [])
  assert.ok(parse('!!!??? ;;;').length === 0)
})

test('text with no recognisable details still becomes a card', () => {
  assert.equal(one('the garage door is making a weird noise').title, 'The garage door is making a weird noise')
})

test('long text gets a short title and keeps the full wording', () => {
  const long = `Please review ${'the very long contract clause '.repeat(10)}by Friday`
  const card = one(long)
  assert.ok(card.title.length <= 100)
  assert.ok(card.title.endsWith('…'))
  assert.equal(card.description, long)
})

test('works without any people', () => {
  const card = one('@Ana to pay the bill by Friday', { people: [] })
  assert.equal(card.title, 'Pay the bill')
  assert.equal(card.dueDate, '2026-11-20')
  assert.match(card.warnings.join(' '), /@Ana/)
})

test('at most 20 cards', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `Task number ${i + 1}`).join('\n')
  assert.equal(parse(lines).length, 20)
})

test('never throws on strange input', () => {
  const nasty = ['@', '@@@', '# #', '\u0001 1 \u0002', 'a'.repeat(5000), '((((', '$1 $& $`', '\\', 'Ana '.repeat(200), '1/1/1 1-1-1 99/99', '🙂🙂 call 🙂 tomorrow']
  for (const text of nasty) assert.doesNotThrow(() => parse(text), text.slice(0, 30))
})

test('fast on large input', () => {
  const started = Date.now()
  parse(Array.from({ length: 200 }, (_, i) => `Ana should pay bill ${i} by Friday, urgent and call Mia`).join('\n'))
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started}ms`)
})
