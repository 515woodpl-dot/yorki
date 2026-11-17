// Quick add: Spanish, typo-guessing, and learning. Clock: Tuesday 17 Nov 2026, 10:00.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, plain } = require('./load-ts.cjs')

const { parseQuickAdd, detectLanguage } = load('src/lib/quick-add/parse.ts')
const learn = load('src/lib/quick-add/learn.ts')
const fuzzy = load('src/lib/quick-add/fuzzy.ts')

const NOW = new Date(2026, 10, 17, 10, 0, 0)
const ANA = { id: 'ana', name: 'Ana Reyes', aliases: ['Ana', 'ana'] }
const MIA = { id: 'mia', name: 'Mia Porter', aliases: ['Mia', 'mia'] }
const GEORGE = { id: 'george', name: 'George', aliases: ['george'] }
const PEOPLE = [ANA, MIA, GEORGE]

const parse = (text, extra = {}) => plain(parseQuickAdd(text, { people: PEOPLE, currentUserId: 'george', now: NOW, ...extra }))
const one = (text, extra) => {
  const cards = parse(text, extra)
  assert.equal(cards.length, 1, `expected 1 card for "${text}", got ${JSON.stringify(cards.map((c) => c.title))}`)
  return cards[0]
}

// ─── Spanish ─────────────────────────────────────────────────────────────────

test('ES: the request example — one card, assigned, deadline from the follow-up', () => {
  const card = one('Quiero que @Ana trabaje en este proyecto. Ella tiene hasta el 5 de diciembre')
  assert.equal(card.title, 'Trabajar en este proyecto')
  assert.deepEqual(card.assigneeIds, ['ana'])
  assert.equal(card.dueDate, '2026-12-05')
  assert.equal(card.language, 'es')
})

test('ES: "vamos a…", "o pagar…"', () => {
  assert.equal(one('Vamos a trabajar en este proyecto').title, 'Trabajar en este proyecto')
  assert.deepEqual(parse('Vamos a trabajar en este proyecto. O pagar esta factura').map((c) => c.title), ['Trabajar en este proyecto', 'Pagar esta factura'])
})

test('ES: who does it', () => {
  const cases = {
    'Ana tiene que llamar al proveedor': ['Llamar al proveedor', ['ana']],
    'Ana debe revisar el presupuesto': ['Revisar el presupuesto', ['ana']],
    'Mia va a pulir la encimera': ['Pulir la encimera', ['mia']],
    'Pídele a Mia que revise el presupuesto': ['Revisar el presupuesto', ['mia']],
    'Necesito que Ana mida la cocina': ['Medir la cocina', ['ana']],
    'Que Mia haga la plantilla': ['Hacer la plantilla', ['mia']],
    'Asigna esto a Mia: sellar la encimera': ['Sellar la encimera', ['mia']],
    'Asignar la instalación a Ana': ['La instalación', ['ana']],
    'Mia, llama al cliente': ['Llamar al cliente', ['mia']],
    'Para Ana: cotizar el baño': ['Cotizar el baño', ['ana']],
    'Ana y Mia tienen que limpiar el taller': ['Limpiar el taller', ['ana', 'mia']],
  }
  for (const [text, [title, ids]] of Object.entries(cases)) {
    const card = one(text)
    assert.equal(card.title, title, text)
    assert.deepEqual(card.assigneeIds, ids, text)
  }
})

test('ES: a name that is only the topic is not the assignee', () => {
  assert.deepEqual(one('Llamar a Mia mañana').assigneeIds, [])
  assert.deepEqual(one('Dile a Mia que el camión llega tarde').assigneeIds, []) // informing, not asking
})

test('ES: first person → you', () => {
  for (const text of ['Recuérdame llamar a Juan', 'Tengo que pagar la luz', 'Voy a pedir los azulejos', 'Asígnamelo: pedir los azulejos']) {
    assert.deepEqual(one(text).assigneeIds, ['george'], text)
  }
  assert.equal(one('Recuérdame llamar a Juan').title, 'Llamar a Juan')
  assert.deepEqual(one('Necesito que alguien limpie el taller').assigneeIds, []) // "que…" is not me
})

test('ES: dates (accents optional)', () => {
  const cases = {
    'pagar la renta hoy': '2026-11-17',
    'pagar la renta mañana': '2026-11-18',
    'pagar la renta manana': '2026-11-18',
    'pagar la renta pasado mañana': '2026-11-19',
    'pagar la renta el viernes': '2026-11-20',
    'pagar la renta este viernes': '2026-11-20',
    'pagar la renta el próximo viernes': '2026-11-20', // in Spanish "próximo" = the coming one
    'pagar la renta el viernes que viene': '2026-11-20',
    'pagar la renta el viernes de la próxima semana': '2026-11-27',
    'pagar la renta el miércoles': '2026-11-18',
    'pagar la renta el miercoles': '2026-11-18',
    'pagar la renta hasta el sábado': '2026-11-21',
    'pagar la renta en 3 días': '2026-11-20',
    'pagar la renta dentro de dos semanas': '2026-12-01',
    'pagar la renta en un mes': '2026-12-17',
    'pagar la renta la semana que viene': '2026-11-24',
    'pagar la renta la próxima semana': '2026-11-24',
    'pagar la renta esta semana': '2026-11-20',
    'pagar la renta a fin de mes': '2026-11-30',
    'pagar la renta el 5 de diciembre': '2026-12-05',
    'pagar la renta el 5 de dic. de 2027': '2027-12-05',
    'pagar la renta para el 25': '2026-11-25',
    'pagar la renta antes del 10': '2026-12-10',
    'pagar la renta el 5/12': '2026-12-05', // día/mes in Spanish
    'pagar la renta, fecha límite: el viernes': '2026-11-20',
  }
  for (const [text, expected] of Object.entries(cases)) {
    const card = one(text)
    assert.equal(card.dueDate, expected, text)
    assert.equal(card.title, 'Pagar la renta', text)
  }
})

test('ES: times', () => {
  assert.equal(one('llamar al cliente mañana a las 10 de la mañana').dueDate, '2026-11-18T10:00:00')
  assert.equal(one('llamar al cliente mañana por la mañana').dueDate, '2026-11-18T09:00:00')
  assert.equal(one('llamar al cliente mañana por la tarde').dueDate, '2026-11-18T14:00:00')
  assert.equal(one('llamar al cliente el viernes al mediodía').dueDate, '2026-11-20T12:00:00')
  assert.equal(one('llamar al cliente a las 4').dueDate, '2026-11-17T16:00:00') // "a las 4" in working hours = 4 pm
  assert.equal(one('llamar al cliente a las 9 y media').dueDate, '2026-11-18T09:30:00') // already past today
  assert.equal(one('llamar al cliente el lunes a las 15:00').dueDate, '2026-11-23T15:00:00')
  assert.equal(one('llamar al cliente mañana a las 10 de la mañana').title, 'Llamar al cliente')
})

test('ES: priority', () => {
  const cases = {
    'urgente: pagar la luz': 'urgent',
    'pagar la luz lo antes posible': 'urgent',
    'pagar la luz cuanto antes': 'urgent',
    'pagar la luz, prioridad alta': 'high',
    'pagar la luz, es muy importante': 'high',
    'pagar la luz sin prisa': 'low',
    'pagar la luz cuando puedas': 'low',
    'no es urgente, pagar la luz': 'low',
  }
  for (const [text, level] of Object.entries(cases)) {
    const card = one(text)
    assert.equal(card.priority, level, text)
    assert.equal(card.title, 'Pagar la luz', text)
  }
})

test('ES: several cards, shared assignee and date', () => {
  assert.deepEqual(parse('Llamar al proveedor, pedir los azulejos y pagar la factura').map((c) => c.title),
    ['Llamar al proveedor', 'Pedir los azulejos', 'Pagar la factura'])
  const cards = parse('Quiero que Ana llame al proveedor y pague la factura el viernes')
  assert.deepEqual(cards.map((c) => c.title), ['Llamar al proveedor', 'Pagar la factura'])
  assert.deepEqual(cards.map((c) => c.assigneeIds), [['ana'], ['ana']])
  assert.deepEqual(cards.map((c) => c.dueDate), ['2026-11-20', '2026-11-20'])
})

test('ES: nouns are not split or turned into verbs', () => {
  assert.equal(parse('Comprar sal y pimienta').length, 1)
  assert.equal(parse('Pagar la luz y el agua').length, 1)
  assert.equal(one('Entrega de material el lunes').title, 'Entrega de material')
  assert.equal(one('Factura del cliente García').title, 'Factura del cliente García')
  assert.equal(parse('Debido a la lluvia, llamar al techador').length, 1)
})

test('ES: object pronouns stay with the verb', () => {
  assert.equal(one('Que Mia le envíe el presupuesto').title, 'Enviarle el presupuesto')
  assert.equal(one('Mia, llámalo mañana').title, 'Llamarlo')
})

test('several @names in a row', () => {
  const card = one('@Ana @Mia call the plumber')
  assert.equal(card.title, 'Call the plumber')
  assert.deepEqual(card.assigneeIds, ['ana', 'mia'])
  assert.equal(one('Pintar la oficina del lunes al viernes').title, 'Pintar la oficina')
  assert.equal(one('Pintar la oficina del lunes al viernes').dueDate, '2026-11-20')
})

test('mixed English and Spanish in one sentence', () => {
  const card = one('Mia tiene que call the supplier mañana, urgent')
  assert.deepEqual(card.assigneeIds, ['mia'])
  assert.equal(card.dueDate, '2026-11-18')
  assert.equal(card.priority, 'urgent')
  assert.equal(card.title, 'Call the supplier')
})

test('language detection', () => {
  assert.equal(detectLanguage('pagar la factura el viernes'), 'es')
  assert.equal(detectLanguage('pay the bill on Friday'), 'en')
  assert.equal(detectLanguage('5/12'), 'en')
})

test('English dates keep their meaning ("5/12" = May 12, "next Friday" = next week)', () => {
  assert.equal(one('pay the bill 5/12').dueDate, '2027-05-12')
  assert.equal(one('pay the bill next Friday').dueDate, '2026-11-27')
})

// ─── Guessing words ──────────────────────────────────────────────────────────

test('misspelled dates and priority are understood, and reported', () => {
  const cases = {
    'pay the bill tomorow': '2026-11-18',
    'pay the bill tommorrow': '2026-11-18',
    'pay the bill on wensday': '2026-11-18',
    'pay the bill on Thrusday': '2026-11-19',
    'pay the bill fridy': '2026-11-20',
    'pagar la renta el viernez': '2026-11-20',
    'pagar la renta el jueves': '2026-11-19',
    'pagar la renta el juebes': '2026-11-19',
  }
  for (const [text, expected] of Object.entries(cases)) {
    const card = one(text)
    assert.equal(card.dueDate, expected, text)
  }
  const card = one('pay the bill tomorow')
  assert.ok(card.found.guesses.some((g) => /tomorow/.test(g) && /tomorrow/i.test(g)), JSON.stringify(card.found.guesses))
  assert.equal(one('fix the sink, urgnet').priority, 'urgent')
  assert.equal(one('arreglar el lavabo, urjente').priority, 'urgent')
})

test('typo-guessing never changes real words', () => {
  assert.equal(one('Fridge repair').dueDate, null)
  assert.equal(one('Fridge repair').title, 'Fridge repair')
  assert.equal(one('Match the colors').title, 'Match the colors')
  assert.equal(one('Trade show prep').title, 'Trade show prep')
  assert.equal(one('Review the mondays report').title, 'Review the mondays report')
  assert.equal(one("Review Friday's report").dueDate, null)
  assert.equal(one('Email tomorow@example.com').dueDate, null)
})

test('a misspelled @name is guessed — and shown as a guess', () => {
  const card = one('@Mai to order paint')
  assert.deepEqual(card.assigneeIds, ['mia'])
  assert.equal(card.title, 'Order paint')
  assert.ok(card.found.guesses.includes('@Mai → Mia Porter'))
  assert.equal(card.refs[0].status, 'guessed')
  // Too far from anyone: not guessed.
  assert.deepEqual(one('@Zed to order paint').assigneeIds, [])
})

test('edit distance', () => {
  assert.equal(fuzzy.editDistance('tomorow', 'tomorrow'), 1)
  assert.equal(fuzzy.editDistance('thrusday', 'thursday'), 1) // swapped letters count once
  assert.equal(fuzzy.editDistance('abc', 'xyz'), 3)
})

// ─── Learning from corrections ───────────────────────────────────────────────

test('an unknown nickname is asked about, then remembered', () => {
  const first = one('Jimmy should call the supplier')
  assert.equal(first.title, 'Call the supplier')
  assert.deepEqual(first.assigneeIds, [])
  assert.match(first.warnings.join(' '), /Who is “Jimmy”/)

  // The person picks Mia in the preview and creates the card.
  const lessons = plain(learn.lessonsFromEdit(first, { assigneeIds: ['mia'], dueDate: null }))
  assert.deepEqual(lessons, [{ kind: 'alias', key: 'jimmy', value: 'mia' }])

  const memory = { aliases: [{ token: 'jimmy', personId: 'mia' }], prefs: {} }
  const next = one('Jimmy should call the supplier', { memory })
  assert.deepEqual(next.assigneeIds, ['mia'])
  assert.equal(next.warnings.length, 0)
  assert.ok(next.found.guesses.some((g) => /remembered: Jimmy = Mia Porter/.test(g)))
  assert.deepEqual(one('@jimmy to sweep the shop', { memory }).assigneeIds, ['mia'])
  assert.deepEqual(one('Que Jimmy limpie el taller', { memory }).assigneeIds, ['mia'])
})

test('unknown names in Spanish slots are asked about too', () => {
  const card = one('Quiero que Pepe llame al proveedor')
  assert.equal(card.title, 'Llamar al proveedor')
  assert.match(card.warnings.join(' '), /Who is “Pepe”/)
  assert.equal(one('Alguien debe limpiar el taller').warnings.length, 0) // "alguien" is not a name
})

test('ambiguous first names: your pick is remembered', () => {
  const people = [ANA, { id: 'ana2', name: 'Ana Lopez', aliases: ['Ana'] }, MIA]
  const first = one('@Ana to call the plumber', { people })
  assert.deepEqual(first.assigneeIds, [])
  assert.equal(first.refs[0].status, 'ambiguous')
  const lessons = plain(learn.lessonsFromEdit(first, { assigneeIds: ['ana2'], dueDate: null }))
  assert.deepEqual(lessons, [{ kind: 'alias', key: 'ana', value: 'ana2' }])
  const memory = { aliases: [{ token: 'ana', personId: 'ana2' }], prefs: {} }
  const again = one('@Ana to call the plumber', { people, memory })
  assert.deepEqual(again.assigneeIds, ['ana2'])
  assert.equal(again.warnings.length, 0)
  // Picking someone who wasn't one of the two Anas teaches nothing.
  assert.deepEqual(plain(learn.lessonsFromEdit(first, { assigneeIds: ['mia'], dueDate: null })), [])
})

test('keeping a guessed name confirms it; removing it teaches nothing', () => {
  const card = one('@Mai to order paint')
  assert.deepEqual(plain(learn.lessonsFromEdit(card, { assigneeIds: ['mia'], dueDate: null })), [{ kind: 'alias', key: 'mai', value: 'mia' }])
  assert.deepEqual(plain(learn.lessonsFromEdit(card, { assigneeIds: [], dueDate: null })), [])
})

test('"next Friday": correcting it once changes your default', () => {
  const card = one('pay the bill next Friday')
  assert.equal(card.dueDate, '2026-11-27')
  assert.deepEqual(card.dateAlternative, { pref: 'nextWeekday', value: 'upcoming', date: '2026-11-20' })
  const lessons = plain(learn.lessonsFromEdit(card, { assigneeIds: [], dueDate: '2026-11-20' }))
  assert.deepEqual(lessons, [{ kind: 'pref', key: 'nextWeekday', value: 'upcoming' }])
  assert.equal(one('pay the bill next Friday', { memory: { aliases: [], prefs: { nextWeekday: 'upcoming' } } }).dueDate, '2026-11-20')
  // A different date entirely is not a lesson about "next".
  assert.deepEqual(plain(learn.lessonsFromEdit(card, { assigneeIds: [], dueDate: '2026-12-01' })), [])
})

test('day/month order: correcting it once changes your default', () => {
  const card = one('pay the bill 5/12')
  assert.equal(card.dueDate, '2027-05-12')
  assert.equal(card.dateAlternative.date, '2026-12-05')
  assert.deepEqual(plain(learn.lessonsFromEdit(card, { assigneeIds: [], dueDate: '2026-12-05' })), [{ kind: 'pref', key: 'numericOrder', value: 'dmy' }])
  assert.equal(one('pay the bill 6/12', { memory: { aliases: [], prefs: { numericOrder: 'dmy' } } }).dueDate, '2026-12-06')
})

test('alias tokens are validated', () => {
  assert.equal(learn.normalizeAliasToken('@Jimmy '), 'jimmy')
  assert.equal(learn.normalizeAliasToken('José'), 'jose')
  assert.equal(learn.normalizeAliasToken('<script>'), null)
  assert.equal(learn.normalizeAliasToken(''), null)
})

// ─── Learning from past cards ────────────────────────────────────────────────

const HISTORY = [
  { title: 'Fix leak under sink', assigneeIds: ['mia'], priority: 'urgent', labels: ['plumbing'] },
  { title: 'Leak in unit 4', assigneeIds: ['mia'], priority: 'urgent', labels: ['plumbing'] },
  { title: 'Roof leak', assigneeIds: ['mia'], priority: 'urgent', labels: [] },
  { title: 'Check the leak again', assigneeIds: ['mia'], priority: 'urgent', labels: ['plumbing'] },
  { title: 'Leaks in the showroom', assigneeIds: ['ana'], priority: 'normal', labels: [] },
  { title: 'Polish the quartz slabs', assigneeIds: ['ana'], priority: 'normal', labels: [] },
  { title: 'Order paint', assigneeIds: [], priority: 'low', labels: [] },
]

test('suggestions from past cards (never applied on their own)', () => {
  const history = plain(learn.buildHistoryModel(HISTORY))
  const card = one('fix the leak in the kitchen', { history })
  assert.deepEqual(card.assigneeIds, []) // not applied
  assert.equal(card.priority, 'normal') // not applied
  const byKind = Object.fromEntries(card.suggestions.map((s) => [s.kind, s]))
  assert.equal(byKind.assignee.value, 'mia')
  assert.equal(byKind.assignee.reason, 'Mia Porter did 4 of 5 “leak / gotera” cards')
  assert.equal(byKind.priority.value, 'urgent')
  assert.equal(byKind.label.value, 'plumbing')
})

test('no suggestion when you already said it, or the evidence is thin', () => {
  const history = plain(learn.buildHistoryModel(HISTORY))
  const card = one('Ana should fix the leak asap #plumbing', { history })
  assert.deepEqual(card.suggestions, [])
  assert.deepEqual(one('polish the slabs', { history }).suggestions, []) // only 1 past card
  assert.deepEqual(one('fix the leak', { history: plain(learn.buildHistoryModel(HISTORY.slice(0, 2))) }).suggestions, [])
})

test('history model ignores filler words, merges plurals, and maps synonyms to one meaning', () => {
  assert.deepEqual(plain(learn.modelTokens('Fix the leaks in the Kitchen sinks')), ['~repair', '~leak', '~kitchen', '~sink'])
  assert.deepEqual(plain(learn.modelTokens('Pagar las facturas de la cocina')), ['~payment', '~invoice', '~kitchen'])
  assert.deepEqual(plain(learn.modelTokens('Arreglar la gotera del baño')), ['~repair', '~leak', '~bathroom'])
  assert.deepEqual(plain(learn.modelTokens('Order 3 boxes of grout')), ['~order', 'boxe', 'grout']) // unknown words stay words
})

test('meaning across words and languages: English "leak" cards inform a Spanish "gotera" card', () => {
  const history = plain(learn.buildHistoryModel(HISTORY)) // all in English
  for (const text of ['arreglar la gotera del baño', 'reparar la fuga de la cocina', 'fix the drip in unit 2']) {
    const card = one(text, { history })
    const assignee = card.suggestions.find((s) => s.kind === 'assignee')
    assert.ok(assignee, `${text}: ${JSON.stringify(card.suggestions)}`)
    assert.equal(assignee.value, 'mia', text)
    assert.match(assignee.reason, /“leak \/ gotera” cards/, text)
  }
  // A word with no known meaning gets no borrowed evidence.
  assert.deepEqual(one('order the grout', { history }).suggestions, [])
})

test('performance: a long Spanish + English message stays fast', () => {
  const text = Array.from({ length: 100 }, (_, i) => `Quiero que Ana llame al proveedor ${i} el viernes, urgente y pague la factura. Mia should call John tomorow at 3pm`).join('\n')
  const started = Date.now()
  parse(text, { history: plain(learn.buildHistoryModel(HISTORY)) })
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started}ms`)
})

// ─── Server: team-wide memory ────────────────────────────────────────────────

function serverFixture() {
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE quick_add_memory (user_id TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
      hits INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, kind, key));
    CREATE TABLE quick_add_alias_votes (key TEXT NOT NULL, person_id TEXT NOT NULL, user_id TEXT NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY (key, user_id));`)
  const users = [
    { id: 'ana', full_name: 'Ana Reyes', display_name: 'Ana', email: 'ana@x.com', role: 'admin', is_active: true },
    { id: 'ana2', full_name: 'Ana Lopez', display_name: 'Ana', email: 'alopez@x.com', role: 'staff', is_active: true },
    { id: 'mia', full_name: 'Mia Porter', display_name: 'Mia', email: 'mia@x.com', role: 'staff', is_active: true },
    { id: 'jim', full_name: 'James Lee', display_name: 'James', email: 'jlee@x.com', role: 'staff', is_active: true },
    { id: 'gone', full_name: 'Old Timer', display_name: 'Old', email: 'old@x.com', role: 'staff', is_active: false },
    { id: 'boss', full_name: 'The Owner', display_name: 'Owner', email: 'owner@x.com', role: 'super_admin', is_active: true },
  ]
  const session = { id: 'ana', role: 'admin' }
  const actions = load('src/lib/actions/quick-add.ts', {
    '@/lib/auth': { requireRole: async () => ({ ...session }) },
    '@/lib/db': { getDb: () => db },
    '@/lib/local-data': {
      getAllUsers: async () => users,
      getActiveTasks: async () => [
        { title: 'Fix leak', submitted_by: 'mia', assigned_to: 'mia', custom_fields: {}, priority: 'urgent', labels: [], created_at: '2026-01-01' },
        { title: 'Secret leak', submitted_by: 'ana', assigned_to: 'ana', custom_fields: {}, priority: 'urgent', labels: [], created_at: '2026-01-02' },
      ],
    },
  })
  /** Act as someone else. */
  const as = async (id, role, fn) => {
    const before = { ...session }
    Object.assign(session, { id, role })
    try { return plain(await fn()) } finally { Object.assign(session, before) }
  }
  const aliases = (id = 'ana', role = 'admin') => as(id, role, async () => (await actions.getQuickAddKnowledge()).memory.aliases)
  return { db, actions, as, aliases, users }
}

test('team: a nickname taught by one person works for everyone', async () => {
  const { actions, as, aliases } = serverFixture()
  assert.deepEqual(await as('mia', 'staff', () => actions.rememberQuickAdd([{ kind: 'alias', key: '@Jimmy', value: 'jim' }])), { success: true, data: { learned: 1 } })
  const forAna = await aliases('ana', 'admin')
  assert.deepEqual(forAna, [{ token: 'jimmy', personId: 'jim', votes: 1, taughtBy: ['Mia Porter'], mine: false, contested: false }])
  assert.equal((await aliases('mia', 'staff'))[0].mine, true)
})

test('team: one vote per person; most votes wins, ties go to the most recent', async () => {
  const { db, actions, as, aliases } = serverFixture()
  await as('mia', 'staff', () => actions.rememberQuickAdd([{ kind: 'alias', key: 'jimmy', value: 'jim' }]))
  db.prepare("UPDATE quick_add_alias_votes SET updated_at = '2026-01-01'").run()
  await as('ana2', 'staff', () => actions.rememberQuickAdd([{ kind: 'alias', key: 'jimmy', value: 'mia' }]))
  let [jimmy] = await aliases()
  assert.equal(jimmy.personId, 'mia') // 1–1, the newer one wins
  assert.equal(jimmy.contested, true)
  await as('ana', 'admin', () => actions.rememberQuickAdd([{ kind: 'alias', key: 'jimmy', value: 'jim' }]))
  ;[jimmy] = await aliases()
  assert.equal(jimmy.personId, 'jim') // 2–1
  assert.equal(jimmy.votes, 2)
  // Re-teaching replaces your own vote, it doesn't add a second one.
  await as('ana', 'admin', () => actions.rememberQuickAdd([{ kind: 'alias', key: 'jimmy', value: 'jim' }]))
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM quick_add_alias_votes WHERE key = 'jimmy'").get().n, 3) // mia, ana2, ana
})

test('team: real names cannot be redefined; shared first names can be disambiguated', async () => {
  const { actions, as, aliases } = serverFixture()
  const result = await as('ana2', 'staff', () => actions.rememberQuickAdd([
    { kind: 'alias', key: 'mia', value: 'jim' },        // "Mia" is a real person
    { kind: 'alias', key: 'mia porter', value: 'jim' }, // full name too
    { kind: 'alias', key: 'james', value: 'mia' },      // display name
    { kind: 'alias', key: 'jlee', value: 'mia' },       // e-mail name
    { kind: 'alias', key: 'ana', value: 'mia' },        // "Ana" is two people, neither is Mia
    { kind: 'alias', key: 'ana', value: 'ana2' },       // ok: picks one of the Anas
    { kind: 'alias', key: 'ghost', value: 'gone' },     // deactivated person
    { kind: 'alias', key: 'owner', value: 'boss' },     // not assignable
    { kind: 'alias', key: '<b>x</b>', value: 'mia' },   // not a name
    { kind: 'role', key: 'admin', value: 'ana2' },      // unknown kind
  ]))
  assert.deepEqual(result, { success: true, data: { learned: 1 } })
  assert.deepEqual((await aliases()).map((a) => [a.token, a.personId]), [['ana', 'ana2']])
})

test('team: withdraw your own vote; only admins remove a nickname for everyone', async () => {
  const { actions, as, aliases } = serverFixture()
  await as('mia', 'staff', () => actions.rememberQuickAdd([{ kind: 'alias', key: 'jimmy', value: 'jim' }]))
  await as('ana2', 'staff', () => actions.rememberQuickAdd([{ kind: 'alias', key: 'jimmy', value: 'jim' }]))
  const denied = await as('mia', 'staff', () => actions.forgetQuickAdd('alias', 'jimmy', 'team'))
  assert.equal(denied.success, false)
  assert.match(denied.error, /Only admins/)
  await as('mia', 'staff', () => actions.forgetQuickAdd('alias', 'jimmy', 'mine'))
  assert.equal((await aliases())[0].votes, 1) // ana2's vote remains
  await as('ana', 'admin', () => actions.forgetQuickAdd('alias', 'jimmy', 'team'))
  assert.deepEqual(await aliases(), [])
})

test('team: votes of people who left do not count', async () => {
  const { db, aliases } = serverFixture()
  db.prepare("INSERT INTO quick_add_alias_votes VALUES ('jimmy', 'jim', 'gone', '2026-01-01')").run()
  assert.deepEqual(await aliases(), [])
})

test('personal: date habits stay per person', async () => {
  const { actions, as } = serverFixture()
  await as('mia', 'staff', () => actions.rememberQuickAdd([{ kind: 'pref', key: 'numericOrder', value: 'dmy' }, { kind: 'pref', key: 'isAdmin', value: 'true' }]))
  assert.deepEqual((await as('mia', 'staff', () => actions.getQuickAddKnowledge())).memory.prefs, { numericOrder: 'dmy' })
  assert.deepEqual((await as('ana', 'admin', () => actions.getQuickAddKnowledge())).memory.prefs, {})
  await as('mia', 'staff', () => actions.forgetQuickAdd('pref', 'numericOrder'))
  assert.deepEqual((await as('mia', 'staff', () => actions.getQuickAddKnowledge())).memory.prefs, {})
})

test('server: staff only learn suggestions from cards they can see', async () => {
  const { actions, as } = serverFixture()
  assert.equal((await as('mia', 'staff', () => actions.getQuickAddKnowledge())).history.cards, 1) // not "Secret leak"
  assert.equal((await as('ana', 'admin', () => actions.getQuickAddKnowledge())).history.cards, 2)
})

test('server: rejects garbage input without throwing', async () => {
  const { actions } = serverFixture()
  assert.equal(plain(await actions.rememberQuickAdd('nope')).success, false)
  assert.deepEqual(plain(await actions.rememberQuickAdd([null, 5, {}])), { success: true, data: { learned: 0 } })
  assert.equal(plain(await actions.forgetQuickAdd('everything', 'x')).success, false)
})

test('migration: per-person nicknames from before become team votes', () => {
  const Database = require('better-sqlite3')
  const fs = require('node:fs')
  const migrate = fs.readFileSync('src/lib/db.ts', 'utf8').match(/INSERT OR IGNORE INTO quick_add_alias_votes[\s\S]*?DELETE FROM quick_add_memory WHERE kind = 'alias';/)[0]
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE quick_add_memory (user_id TEXT, kind TEXT, key TEXT, value TEXT, hits INTEGER, updated_at TEXT, PRIMARY KEY (user_id, kind, key));
    CREATE TABLE quick_add_alias_votes (key TEXT, person_id TEXT, user_id TEXT, updated_at TEXT, PRIMARY KEY (key, user_id));
    INSERT INTO quick_add_memory VALUES ('mia', 'alias', 'jimmy', 'jim', 3, '2026-01-01'), ('mia', 'pref', 'numericOrder', 'dmy', 1, '2026-01-01');`)
  db.exec(migrate)
  db.exec(migrate) // safe to run on every start
  assert.deepEqual(plain(db.prepare('SELECT key, person_id, user_id FROM quick_add_alias_votes').all()), [{ key: 'jimmy', person_id: 'jim', user_id: 'mia' }])
  assert.deepEqual(plain(db.prepare('SELECT kind FROM quick_add_memory').all()), [{ kind: 'pref' }])
})

test('performance: many names in a row cannot make the rules hang (backtracking guard)', () => {
  for (const text of [
    `${'@Ana @Mia '.repeat(40)}.`,
    `${'Ana, Mia and '.repeat(40)}George`,
    `${'Ana y Mia '.repeat(40)}no verb here`,
    `I want ${'Ana '.repeat(60)}`,
  ]) {
    const started = Date.now()
    parse(text)
    assert.ok(Date.now() - started < 500, `"${text.slice(0, 30)}…" took ${Date.now() - started}ms`)
  }
})
