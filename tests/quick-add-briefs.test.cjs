// Quick add: long briefs written to one person (the real use case). Clock: Tue 17 Nov 2026, 10:00.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, plain } = require('./load-ts.cjs')

const { parseQuickAdd } = load('src/lib/quick-add/parse.ts')

const NOW = new Date(2026, 10, 17, 10, 0, 0)
const PEOPLE = [
  { id: 'noelia', name: 'Noelia Ramos', aliases: ['Noelia'] },
  { id: 'ana', name: 'Ana Reyes', aliases: ['Ana'] },
  { id: 'mia', name: 'Mia Porter', aliases: ['Mia'] },
]
const parse = (text, extra = {}) => plain(parseQuickAdd(text, { people: PEOPLE, currentUserId: 'ana', now: NOW, ...extra }))
const one = (text, extra) => {
  const cards = parse(text, extra)
  assert.equal(cards.length, 1, `expected 1 card, got ${JSON.stringify(cards.map((c) => c.title))}`)
  return cards[0]
}

const NOELIA = 'NOELIA, TU MAYOR TASK ES ELMSIGUIENTE, TIENES QUE HACER UN REASEARCH COMO EN WASHINGTON STATE. OREGON Y CALIFORNIA HACEN LOS POST DE SOCIAL MEDIA RELACIONADO A NYESTR COMPAÑIA DE COUNTERTOPS. LA IDEA ES QUE EXPLORE EL MERCADO Y APRENDA QUE ESTAMOS HACIENDO BIEN, MAL Y COMO DEBEMOS DE MEJORAR LA MARCA PARA ESTABLECERNOS A UNOS DE LOS PRINCIPALES FABRICANTES DE COUNTERTOPS AL MENOS EN LA CIUDSD DE SEATTLE POR VIA DEL SOCIAL MEDJA, TIENES 2 SEMANAS PARA MOSTRARNOS JN PLAN Y COMO EJECUTALO.'

test('the real brief: one card for Noelia, due in 2 weeks, high priority, deliverables as a checklist', () => {
  const card = one(NOELIA)
  assert.deepEqual(card.assigneeIds, ['noelia'])
  assert.equal(card.dueDate, '2026-12-01')
  assert.equal(card.priority, 'high')
  assert.equal(card.language, 'es')
  assert.match(card.title, /^Hacer un research como en Washington State, Oregon y California/)
  assert.ok(card.title.length <= 100, card.title)
  assert.doesNotMatch(card.title, /[A-Z]{4,}/) // no more shouting
  assert.equal(card.checklist.length, 3, JSON.stringify(card.checklist))
  assert.equal(card.checklist[0], 'Explorar el mercado')
  assert.match(card.checklist[1], /^Aprender que estamos haciendo bien, mal y como debemos de mejorar la marca/)
  assert.match(card.checklist[1], /Seattle/)
  assert.equal(card.checklist[2], 'Mostrarnos un plan y como ejecutalo')
  assert.equal(card.description, NOELIA.trim()) // the boss's words, exactly
  assert.ok(card.found.guesses.some((g) => /REASEARCH/.test(g)), JSON.stringify(card.found.guesses))
})

// ─── The pieces, one by one ──────────────────────────────────────────────────

test('a brief stays one card; a new task in the same message is still its own card', () => {
  assert.equal(parse('Fix the sink. The kitchen one, not the bathroom.').length, 1)
  assert.equal(parse('Pay the bill. This invoice is from last month').length, 1)
  assert.equal(parse('Call John. Email Mia the quote.').length, 2)
  assert.equal(parse('Ana should paint the office. Mia should clean the shop.').length, 2)
  assert.equal(parse('Pay the bill. Due to the rain, call the roofer').length, 2)
  assert.equal(parse('Revisar el presupuesto. El cliente quiere granito, no cuarzo.').length, 1)
  assert.equal(parse('Revisar el presupuesto. Llamar al cliente.').length, 2)
  // Separate lines are separate cards.
  assert.equal(parse('Fix the sink\nThe garage door is noisy').length, 2)
})

test('a stray period before a list of places does not split the sentence (it reads as a comma)', () => {
  const card = one('Research countertop companies in Washington. Oregon and California')
  assert.equal(card.title, 'Research countertop companies in Washington, Oregon and California')
  assert.equal(card.description, null) // nothing was pulled out, so no need to repeat it
  assert.equal(parse('Call the client in Seattle. Tacoma is next week.').length, 1) // not a list → normal rules
})

test('"you have 2 weeks" is a deadline', () => {
  const cases = {
    'Prepare the plan, you have 2 weeks': '2026-12-01',
    'Prepare the plan. You have 3 days': '2026-11-20',
    'Preparar el plan, tienes 2 semanas': '2026-12-01',
    'Preparar el plan, tiene un mes': '2026-12-17',
    'Preparar el plan con un plazo de 10 días': '2026-11-27',
    'Prepare the plan with a deadline of 2 weeks': '2026-12-01',
  }
  for (const [text, due] of Object.entries(cases)) assert.equal(one(text).dueDate, due, text)
})

test('"your main task" means high priority, and the lead-in is not the title', () => {
  for (const text of ['Mia, your main task is the following: audit the showroom', 'Mia, tu tarea principal es la siguiente: auditar el showroom', 'MIA, TU MAYOR TASK ES EL SIGUIENTE: AUDITAR EL SHOWROOM']) {
    const card = one(text)
    assert.equal(card.priority, 'high', text)
    assert.deepEqual(card.assigneeIds, ['mia'], text)
    assert.match(card.title, /^(Audit the|Auditar el) showroom$/i, text)
  }
  assert.equal(one('You need to call the supplier').title, 'Call the supplier')
  assert.equal(one('Tienes que llamar al proveedor').title, 'Llamar al proveedor')
})

test('ALL CAPS becomes normal writing, keeping names, places and brands', () => {
  const card = one('MIA, POST THE NEW QUARTZ PHOTOS ON INSTAGRAM AND TIKTOK FOR THE SEATTLE SHOWROOM BY FRIDAY')
  assert.equal(card.title, 'Post the new quartz photos on Instagram and TikTok for the Seattle showroom')
  assert.equal(card.dueDate, '2026-11-20')
  const es = one('ANA TIENE QUE LLAMAR AL CLIENTE DE BELLEVUE SOBRE EL SEO')
  assert.equal(es.title, 'Llamar al cliente de Bellevue sobre el SEO')
  // Normal capitalisation is left alone.
  assert.equal(one('Call the iPhone repair shop').title, 'Call the iPhone repair shop')
})

test('common typos in ordinary words are fixed — carefully', () => {
  assert.match(one('Hacer un reasearch del mercado').title, /research/)
  assert.match(one('Visitar la ciudsd de Tacoma').title, /ciudad/)
  assert.match(one('Revisar el social medja').title, /social media/)
  // Real words, plurals and names are never "fixed".
  assert.equal(one('Revisar las marcas').title, 'Revisar las marcas')
  assert.equal(one('Comprar un marco nuevo').title, 'Comprar un marco nuevo')
  assert.equal(one('Call Noelia about the slabs').title, 'Call Noelia about the slabs')
})

test('deliverables become a checklist; vague follow-ups do not', () => {
  const card = one('Mia should prepare the open house. The idea is to invite past clients, order flowers and print brochures.')
  assert.equal(card.title, 'Prepare the open house')
  assert.deepEqual(card.checklist, ['Invite past clients', 'Order flowers', 'Print brochures'])
  assert.deepEqual(one('I want @Mia to work on this project. She has until Dec 5 to finish that').checklist, [])
  assert.deepEqual(one('Pay the bill. It is urgent').checklist, [])
})
