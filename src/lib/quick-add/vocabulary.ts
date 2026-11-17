/**
 * quick-add/vocabulary.ts — the words Quick add understands, in English and Spanish.
 *
 * Everything the parser "knows" lives here as plain lists, so the team can add
 * words without touching the rules. All matching ignores case and accents
 * ("miércoles" = "miercoles"). Keep entries lowercase.
 *
 * Sections
 *   1. Action verbs (EN + ES, incl. stone / countertop / install work)
 *   2. Spanish verb forms → infinitive ("llame", "revisa", "envíale" → llamar, revisar, enviar)
 *   3. Dates and times
 *   4. Priority
 *   5. Filler words stripped from titles
 *   6. Follow-up and introduction words (how sentences connect)
 *   7. Common misspellings and the words typo-guessing may correct
 *   8. Stop words (ignored when learning from past cards)
 */

// ─── 1 · Action verbs ────────────────────────────────────────────────────────

/** English verbs people start tasks with. Multi-word entries allowed. */
export const EN_VERBS = [
  // talk to people
  'call', 'call back', 'email', 'e-mail', 'text', 'message', 'ping', 'contact', 'reach out', 'follow up', 'follow-up',
  'remind', 'ask', 'tell', 'notify', 'invite', 'meet', 'visit', 'attend', 'join', 'answer', 'reply', 'respond',
  // paperwork and money
  'pay', 'bill', 'invoice', 'charge', 'collect', 'deposit', 'refund', 'reconcile', 'quote', 'estimate', 'price',
  'sign', 'approve', 'submit', 'file', 'renew', 'register', 'apply', 'print', 'scan', 'fax', 'send', 'mail', 'post',
  'publish', 'share', 'upload', 'download', 'record', 'log', 'track', 'report', 'review', 'check', 'verify', 'confirm',
  'cancel', 'book', 'schedule', 'reschedule', 'plan', 'organize', 'organise', 'prepare', 'prep', 'draft', 'write',
  'update', 'create', 'design', 'research', 'find', 'look', 'look into', 'figure out', 'decide', 'choose', 'hire',
  'interview', 'train', 'onboard',
  // buying and stock
  'buy', 'order', 'reorder', 'purchase', 'restock', 'stock', 'count', 'inventory', 'receive', 'return', 'exchange',
  'pick up', 'drop off', 'get', 'bring', 'take', 'deliver', 'ship', 'pack', 'unpack', 'load', 'unload', 'haul', 'move',
  'store', 'label', 'tag', 'sort', 'crate',
  // shop and job-site work (stone, countertops, installs)
  'measure', 'template', 'fabricate', 'cut', 'polish', 'hone', 'grind', 'buff', 'seal', 'reseal', 'caulk', 'glue',
  'epoxy', 'drill', 'level', 'shim', 'install', 'uninstall', 'remove', 'demo', 'demolish', 'dispose', 'recycle',
  'inspect', 'test', 'fix', 'repair', 'patch', 'replace', 'upgrade', 'service', 'maintain', 'clean', 'sweep', 'mop',
  'wash', 'paint', 'build', 'assemble', 'set up', 'setup', 'mount', 'hang', 'photograph', 'stage', 'protect', 'cover',
  // general
  'do', 'make', 'start', 'finish', 'complete', 'close', 'open', 'handle', 'process', 'add', 'change', 'delete',
  'arrange', 'work', 'wrap up', 'back up', 'deploy',
  // research, marketing and planning
  'explore', 'learn', 'improve', 'analyze', 'analyse', 'compare', 'define', 'present', 'show', 'execute', 'study',
  'investigate', 'audit', 'benchmark', 'survey', 'launch', 'promote', 'grow', 'research', 'brainstorm', 'pitch',
]

/** Regular Spanish verbs (infinitive). Their forms are generated below. */
export const ES_REGULAR_VERBS = [
  // hablar con gente
  'llamar', 'contactar', 'avisar', 'confirmar', 'preguntar', 'contestar', 'responder', 'hablar', 'mandar', 'enviar',
  'escribir', 'visitar', 'invitar', 'notificar', 'informar', 'coordinar', 'agendar', 'programar', 'reprogramar',
  'reservar', 'cancelar', 'citar',
  // papeles y dinero
  'pagar', 'cobrar', 'facturar', 'cotizar', 'presupuestar', 'depositar', 'reembolsar', 'firmar', 'imprimir',
  'escanear', 'archivar', 'registrar', 'renovar', 'entregar', 'presentar', 'revisar', 'chequear', 'checar',
  'verificar', 'actualizar', 'crear', 'redactar', 'preparar', 'organizar', 'ordenar', 'planear', 'planificar',
  'investigar', 'buscar', 'decidir', 'contratar', 'capacitar', 'entrenar', 'publicar', 'compartir', 'subir',
  'descargar', 'anotar', 'reportar', 'terminar', 'acabar', 'finalizar', 'completar', 'trabajar', 'continuar',
  'empacar', 'embalar', 'etiquetar',
  // compras e inventario
  'comprar', 'recoger', 'llevar', 'cargar', 'transportar', 'almacenar', 'guardar', 'surtir', 'recibir', 'cambiar',
  'reemplazar', 'quitar', 'eliminar', 'borrar', 'agregar', 'añadir', 'dejar', 'esperar', 'manejar', 'mover-reg',
  // taller y obra (piedra, encimeras, instalaciones)
  'cortar', 'pulir', 'sellar', 'lijar', 'nivelar', 'pegar', 'taladrar', 'perforar', 'montar', 'instalar',
  'desinstalar', 'fabricar', 'ensamblar', 'medir-irr', 'plantillar', 'reparar', 'arreglar', 'pintar', 'limpiar',
  'lavar', 'barrer', 'trapear', 'inspeccionar', 'fotografiar', 'proteger', 'cubrir', 'fijar', 'ajustar', 'rellenar',
  'demoler', 'desechar', 'retirar', 'colocar', 'diseñar', 'tomar', 'sacar', 'usar', 'probar-irr', 'solucionar',
  // investigar, mercadeo y planes
  'explorar', 'aprender', 'mejorar', 'ejecutar', 'analizar', 'estudiar', 'comparar', 'definir', 'establecer', 'lanzar',
  'promocionar', 'posicionar', 'auditar', 'crecer', 'aumentar', 'identificar', 'documentar',
].filter((v) => !v.includes('-'))

/** Irregular / stem-changing Spanish verbs: infinitive → common forms (accents removed). */
export const ES_IRREGULAR_VERBS: Record<string, string[]> = {
  hacer: ['haz', 'hace', 'hacen', 'haga', 'hagan'],
  poner: ['pon', 'pone', 'ponen', 'ponga', 'pongan'],
  reponer: ['repon', 'repone', 'reponen', 'reponga', 'repongan'],
  ir: ['ve', 'vaya', 'vayan'],
  traer: ['trae', 'traen', 'traiga', 'traigan'],
  decir: ['di', 'dice', 'dicen', 'diga', 'digan'],
  venir: ['ven', 'viene', 'vienen', 'venga', 'vengan'],
  tener: ['ten', 'tenga', 'tengan'],
  pedir: ['pide', 'piden', 'pida', 'pidan'],
  medir: ['mide', 'miden', 'mida', 'midan'],
  seguir: ['sigue', 'siguen', 'siga', 'sigan'],
  conseguir: ['consigue', 'consiguen', 'consiga', 'consigan'],
  devolver: ['devuelve', 'devuelven', 'devuelva', 'devuelvan'],
  resolver: ['resuelve', 'resuelven', 'resuelva', 'resuelvan'],
  mover: ['mueve', 'mueven', 'mueva', 'muevan'],
  aprobar: ['aprueba', 'aprueban', 'apruebe', 'aprueben'],
  probar: ['prueba', 'prueban', 'pruebe', 'prueben'],
  comprobar: ['comprueba', 'comprueban', 'compruebe', 'comprueben'],
  encontrar: ['encuentra', 'encuentran', 'encuentre', 'encuentren'],
  recordar: ['recuerda', 'recuerdan', 'recuerde', 'recuerden'],
  contar: ['cuenta', 'cuentan', 'cuente', 'cuenten'],
  mostrar: ['muestra', 'muestran', 'muestre', 'muestren'],
  colgar: ['cuelga', 'cuelgan', 'cuelgue', 'cuelguen'],
  empezar: ['empieza', 'empiezan', 'empiece', 'empiecen'],
  comenzar: ['comienza', 'comienzan', 'comience', 'comiencen'],
  cerrar: ['cierra', 'cierran', 'cierre', 'cierren'],
  atender: ['atiende', 'atienden', 'atienda', 'atiendan'],
  conducir: ['conduce', 'conducen', 'conduzca', 'conduzcan'],
  construir: ['construye', 'construyen', 'construya', 'construyan'],
  sustituir: ['sustituye', 'sustituyen', 'sustituya', 'sustituyan'],
  incluir: ['incluye', 'incluyen', 'incluya', 'incluyan'],
  abastecer: ['abastece', 'abastecen', 'abastezca', 'abastezcan'],
  elegir: ['elige', 'eligen', 'elija', 'elijan'],
  escoger: ['escoge', 'escogen', 'escoja', 'escojan'],
  ver: ['vea', 'vean'],
  abrir: ['abre', 'abren', 'abra', 'abran'],
}

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Spanish orthography for the subjunctive stem: pagar→pague, buscar→busque, organizar→organice, recoger→recoja. */
function spanishForms(infinitive: string): string[] {
  const inf = stripAccents(infinitive)
  const ending = inf.slice(-2)
  const stem = inf.slice(0, -2)
  if (ending === 'ar') {
    let subj = stem
    if (stem.endsWith('c')) subj = `${stem.slice(0, -1)}qu`
    else if (stem.endsWith('g')) subj = `${stem}u`
    else if (stem.endsWith('z')) subj = `${stem.slice(0, -1)}c`
    return [`${stem}a`, `${stem}an`, `${subj}e`, `${subj}en`]
  }
  let subj = stem
  if (stem.endsWith('g')) subj = `${stem.slice(0, -1)}j`
  else if (stem.endsWith('gu')) subj = stem.slice(0, -1)
  else if (/[aeiou]c$/.test(stem)) subj = `${stem.slice(0, -1)}zc`
  else if (stem.endsWith('c')) subj = `${stem.slice(0, -1)}z`
  return [`${stem}e`, `${stem}en`, `${subj}a`, `${subj}an`]
}

// ─── 2 · Spanish verb form → infinitive ─────────────────────────────────────

/** "llame" / "revisa" / "pague" / "haga" → infinitive (all accent-free). */
export const ES_FORM_TO_INFINITIVE: Map<string, string> = (() => {
  const map = new Map<string, string>()
  for (const verb of ES_REGULAR_VERBS) {
    const inf = stripAccents(verb)
    map.set(inf, verb)
    for (const form of spanishForms(verb)) if (!map.has(form)) map.set(form, verb)
  }
  for (const [verb, forms] of Object.entries(ES_IRREGULAR_VERBS)) {
    map.set(stripAccents(verb), verb)
    for (const form of forms) if (!map.has(form)) map.set(form, verb)
  }
  return map
})()

/** Object pronouns glued to Spanish imperatives: "llámalo", "envíaselo", "mándale". */
export const ES_CLITICS = ['selos', 'selas', 'selo', 'sela', 'melos', 'melas', 'melo', 'mela', 'noslo', 'nosla', 'los', 'las', 'les', 'nos', 'lo', 'la', 'le', 'me']

/** Words that may follow a verb used as an order ("Factura al cliente" yes, "Factura del cliente" no). */
export const ES_OBJECT_STARTERS = [
  'el', 'la', 'los', 'las', 'al', 'a', 'un', 'una', 'unos', 'unas', 'lo', 'le', 'les', 'con', 'en', 'para', 'por',
  'su', 'sus', 'mi', 'mis', 'tu', 'tus', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'todo',
  'toda', 'todos', 'todas', 'que', 'otra', 'otro', 'nuevo', 'nueva', 'bien',
]

/** Verb forms that are too short or too common to use for splitting lists ("sal" = salt, "di", "va"). */
export const ES_FORMS_NOT_FOR_SPLITTING = new Set(['di', 've', 'ven', 'pon', 'ten', 'sal', 'da', 'de', 'den', 'vea', 'haz'])

// ─── 3 · Dates and times ─────────────────────────────────────────────────────

export const NUMBER_WORDS: Record<string, number> = {
  // English
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, couple: 2,
  // Spanish
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30,
}

/** Month names / abbreviations (EN + ES) → month index. */
export const MONTHS: Array<[string, number]> = [
  ['january', 0], ['jan', 0], ['enero', 0], ['ene', 0],
  ['february', 1], ['feb', 1], ['febrero', 1],
  ['march', 2], ['mar', 2], ['marzo', 2],
  ['april', 3], ['apr', 3], ['abril', 3], ['abr', 3],
  ['may', 4], ['mayo', 4],
  ['june', 5], ['jun', 5], ['junio', 5],
  ['july', 6], ['jul', 6], ['julio', 6],
  ['august', 7], ['aug', 7], ['agosto', 7], ['ago', 7],
  ['september', 8], ['sept', 8], ['sep', 8], ['septiembre', 8], ['setiembre', 8], // not 'set' ("set 5 chairs")
  ['october', 9], ['oct', 9], ['octubre', 9],
  ['november', 10], ['nov', 10], ['noviembre', 10],
  ['december', 11], ['dec', 11], ['diciembre', 11], ['dic', 11],
]

/** Weekday names / abbreviations (EN + ES, accent-free) → 0 = Sunday. */
export const WEEKDAYS: Array<[string, number]> = [
  ['sunday', 0], ['domingo', 0],
  ['monday', 1], ['mon', 1], ['lunes', 1],
  ['tuesday', 2], ['tues', 2], ['tue', 2], ['martes', 2],
  ['wednesday', 3], ['wed', 3], ['miercoles', 3],
  ['thursday', 4], ['thurs', 4], ['thur', 4], ['thu', 4], ['jueves', 4],
  ['friday', 5], ['fri', 5], ['viernes', 5],
  ['saturday', 6], ['sabado', 6],
]

/** Parts of the day → default time. */
export const PARTS_OF_DAY: Array<[string, number]> = [
  ['in the morning', 9], ['this morning', 9], ['por la manana', 9], ['en la manana', 9], ['de manana', 9],
  ['in the afternoon', 14], ['this afternoon', 14], ['por la tarde', 14], ['en la tarde', 14],
  ['in the evening', 18], ['this evening', 18], ['por la noche', 19], ['en la noche', 19], ['de noche', 19],
]

// ─── 4 · Priority ────────────────────────────────────────────────────────────
// Regular-expression fragments, tried in this order (so "not urgent" wins over "urgent").

export const PRIORITY_PHRASES: Array<['low' | 'urgent' | 'high' | 'normal', string[]]> = [
  ['low', [
    'low[- ]priority', 'no\\s+rush', 'not\\s+urgent', 'no\\s+hurry', 'whenever(?:\\s+you(?:\'re|\\s+are)?\\s+(?:free|can|able))?',
    'when\\s+(?:you\\s+)?(?:can|have\\s+time|get\\s+a\\s+chance)', 'nice\\s+to\\s+have', 'someday', 'at\\s+some\\s+point',
    'baja\\s+prioridad', 'prioridad\\s+baja', 'sin\\s+prisa', 'no\\s+es\\s+urgente', 'no\\s+urge', 'no\\s+corre\\s+prisa',
    'cuando\\s+(?:puedas|pueda|puedan|tengas\\s+tiempo|se\\s+pueda)', 'algun\\s+dia', 'sin\\s+apuro',
  ]],
  ['urgent', [
    'urgent(?:ly)?', 'a\\.?s\\.?a\\.?p\\.?', 'right\\s+away', 'right\\s+now', 'immediately', 'emergency', 'critical',
    'drop\\s+everything', 'top\\s+priority', 'time[- ]sensitive', 'today\\s+no\\s+matter\\s+what',
    'urgente(?:mente)?', 'lo\\s+antes\\s+posible', 'lo\\s+mas\\s+pronto\\s+posible', 'cuanto\\s+antes', 'de\\s+inmediato',
    'inmediatamente', 'ya\\s+mismo', 'emergencia', 'critico', 'prioridad\\s+maxima', 'maxima\\s+prioridad', 'para\\s+ayer',
    'es\\s+para\\s+ya', 'sin\\s+falta', 'de\\s+urgencia',
  ]],
  ['high', [
    // "tu mayor task es el siguiente", "your main task is the following"
    '(?:tu|su|your|the|la|el|my|mi|our|nuestra)\\s+(?:mayor|principal|main|biggest|most\\s+important|primera|first|big)\\s+(?:task|tarea|prioridad|priority|proyecto|project|trabajo|job|mision|mission|pendiente)(?:\\s+(?:es|is|sera|will\\s+be)(?:\\s+(?:el|la|lo|the))?(?:\\s+(?:siguiente|following))?)?',
    // Spanish order: "tu tarea principal es la siguiente", "tu prioridad número uno"
    '(?:tu|su|la|el|mi|nuestra)\\s+(?:task|tarea|prioridad|proyecto|trabajo|mision|pendiente)\\s+(?:principal|mas\\s+importante|prioritaria|numero\\s+uno)(?:\\s+(?:es|sera)(?:\\s+(?:el|la|lo))?(?:\\s+siguiente)?)?',
    'high[- ]priority', 'priority\\s*[:=]?\\s*high', 'high\\s+importance', '(?:very|really|extremely|super)\\s+important',
    "(?:this|it)(?:\\s+is|'s)\\s+important", 'important!+', 'must[- ]do',
    'prioridad\\s+alta', 'alta\\s+prioridad', 'muy\\s+importante', 'es\\s+importante', 'importante!+', 'prioritario',
  ]],
  ['normal', [
    'normal\\s+priority', 'regular\\s+priority', 'priority\\s*[:=]?\\s*normal', 'prioridad\\s+(?:normal|media)',
  ]],
]

// ─── 5 · Filler stripped from the start of titles ────────────────────────────

export const LEAD_FILLERS: RegExp[] = [
  /^(?:ok(?:ay)?|hey|hi|hello|so|also|and|or|but|then|please|pls|plz|kindly|just|well|now|yes|yeah|oye|hola|bueno|pues|entonces|luego|tambien|ademas|y|o|ojo)\b[\s,.:;-]*/i,
  /^(?:por\s+favor|porfa|favor\s+de|xfa)\b[\s,.:;-]*/i,
  /^(?:i|we)(?:'d|\s+would)\s+like\s+to\s+/i,
  /^(?:i|we)\s+(?:really\s+|also\s+)?(?:want|need|have|got|plan|wanna|gotta|must|should)\s+to\s+/i,
  /^(?:i|we)\s+(?:wanna|gotta|must|should)\s+/i,
  /^(?:i|we)(?:'ll|\s+will|'m\s+going\s+to|\s+am\s+going\s+to)\s+/i,
  /^(?:let'?s|lets|let\s+us)\s+(?:go\s+and\s+)?/i,
  /^(?:can|could|would|will)\s+(?:you|someone|somebody|anyone)\s+(?:please\s+)?/i,
  /^(?:don'?t\s+forget\s+to|remember\s+to|remind\s+me\s+to|reminder\s+to|make\s+sure\s+(?:to|that)?|be\s+sure\s+to|need\s+to|needs\s+to|has\s+to|have\s+to|got\s+to|gotta|time\s+to)\s*/i,
  /^(?:to-?do|todo|task|action|reminder|note|pendiente|tarea|recordatorio|nota)\s*[:\-–]\s*/i,
  // Briefs: "your task is the following:", "tienes que…", "you need to…"
  /^(?:tu|su|your)\s+(?:task|tarea|trabajo|job|mision|mission|assignment|asignacion)\s+(?:es|is)\s+(?:(?:el|la|lo|the)\s+)?(?:siguiente|following)?\s*[:,]?\s*/i,
  /^(?:tienes\s+que|tienen\s+que|debes|necesitas|you\s+need\s+to|you\s+have\s+to|you\s+must|you\s+should|you(?:'ll|\s+will)\s+need\s+to)\s+/i,
  // Spanish
  /^(?:hay\s+que|tenemos\s+que|tengo\s+que|debemos|debo|necesitamos|necesito|queremos|quiero|quisiera|me\s+gustaria|vamos\s+a|voy\s+a|hay\s+que\s+ir\s+a)\s+/i,
  /^(?:no\s+(?:te\s+)?olvides\s+(?:de\s+)?|no\s+olvidar\s+(?:de\s+)?|acuerdate\s+de\s+|recuerda\s+|recordar\s+|recuerdame\s+(?:que\s+)?|asegurate\s+de\s+)/i,
  /^(?:puedes|podrias|pueden|podrian|puede|podria)\s+(?:por\s+favor\s+)?/i,
  /^(?:to|that|que|de)\s+/i,
]

/** Words that should never end a title ("Pay the bill by", "Llamar al proveedor para"). */
export const TRAILING_WORDS = [
  'by', 'on', 'until', 'till', 'before', 'for', 'to', 'at', 'and', 'or', 'the', 'a', 'an', 'in', 'due', 'from', 'of',
  'with', 'but', 'so', 'then',
  'para', 'el', 'la', 'los', 'las', 'de', 'del', 'al', 'a', 'en', 'y', 'o', 'con', 'hasta', 'antes', 'por', 'que', 'e',
]

// ─── 6 · How sentences connect ───────────────────────────────────────────────

/** A sentence starting with these adds detail to the previous card. */
export const FOLLOW_UP_STARTERS = [
  'she', 'he', 'they', 'her', 'his', 'their', 'deadline', 'due', 'by', 'until', 'till', 'before', 'no later than', 'asap',
  'urgent', 'no rush', 'low priority', 'high priority', 'priority',
  // ("él" is not listed: without its accent it is "el", as in "El viernes…")
  'ella', 'ellos', 'ellas', 'su', 'sus', 'plazo', 'fecha limite', 'antes del', 'antes de', 'hasta el',
  'hasta', 'urgente', 'sin prisa', 'prioridad', 'lo antes posible', 'cuanto antes', 'tiene hasta', 'tienen hasta',
]

/** A sentence starting with these only joins the previous card if it carries a detail. */
export const WEAK_FOLLOW_UP_STARTERS = ['it', 'this', 'that', 'these', 'those', 'its', "it's", "that's", 'esto', 'eso', 'es', 'debe', 'tiene']

/** An introduction, not a list item: "Due to the rain, call the roofer". */
export const INTRO_WORDS = [
  'due to', 'because', 'since', 'as', 'after', 'before', 'when', 'while', 'if', 'once', 'until', 'unless', 'although',
  'though', 'given', 'with', 'in case', 'on account of', 'thanks to',
  'debido a', 'porque', 'como', 'despues de', 'antes de', 'cuando', 'mientras', 'si', 'una vez que', 'aunque', 'ya que',
  'dado que', 'en caso de', 'gracias a', 'por culpa de',
]

/** Never a person's name, even when capitalised in a name slot ("Someone should…"). */
export const NOT_NAMES = new Set([
  'i', 'you', 'we', 'they', 'he', 'she', 'it', 'someone', 'somebody', 'anyone', 'anybody', 'everyone', 'everybody',
  'nobody', 'none', 'all', 'team', 'the', 'this', 'that', 'who', 'one',
  'yo', 'tu', 'usted', 'ustedes', 'nosotros', 'ellos', 'ellas', 'el', 'ella', 'alguien', 'todos', 'nadie', 'equipo',
  'quien', 'esto', 'eso', 'todo',
])

// ─── 7 · Typos ───────────────────────────────────────────────────────────────

/** Frequent misspellings and shorthand → the word meant. */
export const MISSPELLINGS: Record<string, string> = {
  tomorow: 'tomorrow', tommorow: 'tomorrow', tommorrow: 'tomorrow', tmorrow: 'tomorrow', tomoro: 'tomorrow',
  tomorrrow: 'tomorrow', '2morrow': 'tomorrow', '2moro': 'tomorrow', '2day': 'today', tday: 'today', tonite: 'tonight',
  '2nite': 'tonight', wensday: 'wednesday', wendsday: 'wednesday', wednsday: 'wednesday', wedensday: 'wednesday',
  wedsday: 'wednesday', tusday: 'tuesday', teusday: 'tuesday', tuseday: 'tuesday', thurday: 'thursday',
  thrusday: 'thursday', thursady: 'thursday', saterday: 'saturday', satruday: 'saturday', firday: 'friday',
  fridy: 'friday', frday: 'friday', mondy: 'monday', monady: 'monday', urgnet: 'urgent', urjent: 'urgent',
  ugent: 'urgent', urgant: 'urgent', priorty: 'priority', prority: 'priority', piority: 'priority',
  importnat: 'important', untill: 'until', til: 'until', b4: 'before', nxt: 'next', wk: 'week', mnth: 'month',
  asaap: 'asap', assap: 'asap', plz: 'please', pls: 'please', resarch: 'research', reserch: 'research',
  elsiguiente: 'el siguiente', elmsiguiente: 'el siguiente', losiguiente: 'lo siguiente', nyestr: 'nuestra',
  nyestra: 'nuestra', nuestar: 'nuestra', jn: 'un',
  // Spanish
  mñana: 'mañana', manan: 'mañana', viernez: 'viernes', vierens: 'viernes', juebes: 'jueves', lunez: 'lunes',
  sabdo: 'sábado', urjente: 'urgente', urgnte: 'urgente', prioridda: 'prioridad', semna: 'semana', smana: 'semana',
  pasdo: 'pasado', porfa: 'por favor', xfa: 'por favor', proxsimo: 'próximo', poximo: 'próximo',
}

/** Words typo-guessing is allowed to correct towards (dates, priority, assignment). */
export const GUESSABLE_WORDS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'today', 'tonight', 'tomorrow',
  'weekend', 'morning', 'afternoon', 'evening', 'urgent', 'priority', 'deadline', 'until', 'assign', 'remind',
  'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo', 'manana', 'pasado', 'urgente',
  'prioridad', 'mediodia', 'semana', 'asignar', 'recuerdame', 'proximo', 'proxima',
]

/** Real words that look like a guessable word but must be left alone. */
export const NEVER_CORRECT = new Set([
  'sundae', 'mondays', 'fridays', 'trade', 'lunas', 'semanal', 'semanas', 'importance', 'pasada', 'pasados', 'until',
  'unit', 'units', 'morning', 'mourning', 'priorities', 'prioridades', 'assigns', 'assigned', 'asignado', 'asignada',
  'reminds', 'reminder', 'evenings', 'tonights', 'proximos', 'proximas', 'martes', 'marte',
])

// ─── 8 · Stop words (ignored when learning from past cards) ──────────────────

export const STOP_WORDS = new Set([
  // English
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'for', 'on', 'in', 'at', 'by', 'with', 'from', 'up', 'out', 'into',
  'about', 'this', 'that', 'these', 'those', 'it', 'its', 'is', 'are', 'be', 'was', 'were', 'will', 'should', 'can',
  'need', 'needs', 'please', 'new', 'all', 'some', 'any', 'more', 'our', 'their', 'his', 'her', 'my', 'your', 'we',
  'they', 'you', 'him', 'them', 'me', 'us', 'not', 'no', 'yes', 'get', 'got', 'do', 'make', 'work', 'task', 'job',
  'thing', 'things', 'stuff', 'today', 'tomorrow', 'week', 'next', 'asap', 'urgent',
  // Spanish
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'pero', 'de', 'del', 'al', 'a', 'en', 'con', 'por',
  'para', 'que', 'se', 'su', 'sus', 'lo', 'le', 'les', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'es', 'son',
  'hay', 'muy', 'mas', 'mi', 'mis', 'tu', 'tus', 'nuestro', 'nuestra', 'hoy', 'manana', 'semana', 'urgente',
  'hacer', 'tarea', 'cosa', 'cosas', 'favor',
])

// ─── 9 · Concepts: different words, same meaning (EN + ES) ───────────────────
// Used when learning from past cards, so "gotera", "fuga" and "leak" count as the
// same thing — a first step from matching words to matching meaning.
// Format: concept → [English words, Spanish words] (accent-free, lowercase).

export const CONCEPTS: Record<string, [string[], string[]]> = {
  // problems
  leak: [['leak', 'leaking', 'drip'], ['gotera', 'fuga', 'filtracion', 'goteo']],
  crack: [['crack', 'cracked', 'chip', 'chipped'], ['grieta', 'fisura', 'rajadura', 'despostillado']],
  stain: [['stain', 'mark'], ['mancha']],
  broken: [['broken', 'damaged', 'damage'], ['roto', 'rota', 'dano', 'danado', 'averiado', 'averia']],
  // stone and shop
  countertop: [['countertop', 'counter', 'worktop'], ['encimera', 'cubierta', 'meseta', 'mesada', 'tablero']],
  slab: [['slab'], ['losa', 'placa', 'plancha', 'bloque']],
  quartz: [['quartz'], ['cuarzo']],
  granite: [['granite'], ['granito']],
  marble: [['marble'], ['marmol']],
  tile: [['tile', 'tiling'], ['azulejo', 'baldosa', 'loseta', 'ceramica']],
  backsplash: [['backsplash'], ['salpicadero', 'zocalo']],
  sink: [['sink', 'basin'], ['lavabo', 'lavamanos', 'fregadero', 'tarja', 'pileta']],
  edge: [['edge', 'edging'], ['canto', 'borde']],
  seam: [['seam', 'joint'], ['junta', 'union']],
  template: [['template', 'templating'], ['plantilla', 'plantillar']],
  measure: [['measure', 'measurement', 'measuring'], ['medir', 'medida', 'medicion']],
  polish: [['polish', 'polishing', 'hone'], ['pulir', 'pulido', 'abrillantar']],
  seal: [['seal', 'sealer', 'sealing', 'sealant'], ['sellar', 'sellado', 'sellador']],
  cut: [['cut', 'cutting', 'saw'], ['cortar', 'corte', 'sierra']],
  install: [['install', 'installation'], ['instalar', 'instalacion', 'montaje', 'montar', 'colocar', 'colocacion']],
  repair: [['repair', 'fix', 'patch'], ['reparar', 'arreglar', 'reparacion', 'arreglo']],
  clean: [['clean', 'cleaning', 'sweep', 'mop'], ['limpiar', 'limpieza', 'barrer', 'trapear']],
  // rooms and places
  kitchen: [['kitchen'], ['cocina']],
  bathroom: [['bathroom', 'bath', 'restroom'], ['bano', 'aseo', 'sanitario']],
  roof: [['roof', 'roofing'], ['techo', 'tejado']],
  shop: [['shop', 'workshop', 'warehouse'], ['taller', 'bodega', 'almacen']],
  showroom: [['showroom'], ['exhibicion']],
  site: [['site', 'jobsite'], ['obra']],
  // people and companies
  customer: [['customer', 'client', 'homeowner'], ['cliente', 'clienta', 'propietario']],
  supplier: [['supplier', 'vendor', 'distributor'], ['proveedor', 'distribuidor']],
  contractor: [['contractor', 'builder'], ['contratista', 'constructor']],
  // money and paperwork
  quote: [['quote', 'estimate', 'bid'], ['presupuesto', 'cotizacion', 'cotizar', 'presupuestar', 'estimado']],
  invoice: [['invoice', 'bill', 'billing'], ['factura', 'facturar', 'facturacion']],
  payment: [['payment', 'pay', 'deposit'], ['pago', 'pagar', 'abono', 'deposito', 'anticipo']],
  contract: [['contract', 'agreement'], ['contrato', 'acuerdo']],
  permit: [['permit', 'license', 'licence'], ['permiso', 'licencia']],
  // logistics
  order: [['order', 'purchase'], ['pedido', 'pedir', 'orden', 'compra', 'comprar']],
  delivery: [['delivery', 'deliver', 'shipping'], ['entrega', 'entregar', 'envio', 'despacho']],
  pickup: [['pickup'], ['recoger', 'recogida']],
  truck: [['truck', 'van'], ['camion', 'camioneta']],
  stock: [['stock', 'inventory', 'restock'], ['inventario', 'existencias', 'surtir', 'reponer']],
  // talking
  call: [['call', 'phone'], ['llamar', 'llamada', 'telefonear']],
  email: [['email', 'mail'], ['correo']],
  meeting: [['meeting', 'meet', 'appointment'], ['reunion', 'cita']],
  schedule: [['schedule', 'reschedule', 'book'], ['programar', 'agendar', 'reprogramar', 'reservar']],
  // marketing and growth
  social: [['social', 'instagram', 'facebook', 'tiktok', 'post', 'reel', 'reels', 'story', 'stories'], ['redes', 'publicacion', 'publicar', 'historia', 'historias']],
  research: [['research', 'investigate', 'study', 'analysis', 'analyze'], ['investigacion', 'investigar', 'estudio', 'analisis', 'analizar']],
  brand: [['brand', 'branding', 'marketing', 'advertising', 'ads'], ['marca', 'mercadeo', 'publicidad', 'anuncios']],
  market: [['market', 'marketplace'], ['mercado']],
  competitor: [['competitor', 'competition', 'competing'], ['competencia', 'competidor', 'competidores']],
  plan: [['plan', 'strategy', 'roadmap'], ['estrategia', 'planificar', 'planear']],
  review: [['review', 'rating', 'testimonial'], ['resena', 'calificacion', 'testimonio', 'opinion']],
  photo: [['photo', 'picture', 'video', 'shoot'], ['foto', 'fotografia', 'imagen', 'grabar']],
  website: [['website', 'web', 'site', 'seo', 'google'], ['pagina', 'sitio']],
}

/** Word (accent-free, lowercase) → concept. */
export const CONCEPT_OF: Map<string, string> = (() => {
  const map = new Map<string, string>()
  for (const [concept, [en, es]] of Object.entries(CONCEPTS)) {
    for (const word of [...en, ...es]) if (!map.has(word)) map.set(word, concept)
  }
  return map
})()

/** "leak / gotera" — how a concept is named in explanations. */
export function conceptLabel(concept: string): string {
  const entry = CONCEPTS[concept]
  return entry ? `${entry[0][0]} / ${entry[1][0]}` : concept
}

// ─── 10 · Proper names (kept capitalised when a message is in ALL CAPS) ───────

/** Places the team talks about. Also stop a stray period from splitting "Washington. Oregon and California". */
export const PLACES = [
  // US states
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma',
  'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah',
  'Vermont', 'Virginia', 'Washington State', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
  // Pacific Northwest and West Coast
  'Pacific Northwest', 'Seattle', 'Bellevue', 'Tacoma', 'Redmond', 'Kirkland', 'Everett', 'Renton', 'Kent', 'Bothell',
  'Issaquah', 'Sammamish', 'Lynnwood', 'Olympia', 'Spokane', 'Puyallup', 'Federal Way', 'Shoreline', 'Woodinville',
  'Mercer Island', 'Snohomish', 'Vancouver', 'Portland', 'Salem', 'Eugene', 'Beaverton', 'Hillsboro', 'Bend',
  'Los Angeles', 'San Francisco', 'San Diego', 'San Jose', 'Sacramento', 'Oakland', 'Bay Area', 'Orange County',
  'Boise', 'Canada', 'Mexico', 'USA',
]

/** Brands, platforms and acronyms, with their usual spelling. */
export const PROPER_WORDS = [
  'Instagram', 'Facebook', 'TikTok', 'YouTube', 'LinkedIn', 'Pinterest', 'Houzz', 'Yelp', 'Google', 'Nextdoor',
  'WhatsApp', 'Angi', 'HomeAdvisor', 'Thumbtack', 'Canva', 'Shopify', 'WordPress', 'Wix', 'Squarespace', 'Excel',
  'Caesarstone', 'Silestone', 'Cambria', 'MSI', 'Dekton', 'Corian',
  'SEO', 'SEM', 'CRM', 'ROI', 'KPI', 'KPIs', 'LLC', 'PDF', 'CEO', 'HOA', 'ADU', 'CNC', 'CAD', 'QR', 'PNW', 'USA',
]

/**
 * Ordinary words typo-fixing may correct towards (besides verbs and concept words).
 * Accent-free, lowercase, 5+ letters. Typo-fixing is strict: same first letter, one
 * neighbouring-key slip for 5-letter words, plurals and real names never touched.
 */
export const COMMON_WORDS = [
  'research', 'social', 'media', 'marketing', 'market', 'mercado', 'marca', 'brand', 'branding', 'company', 'compania',
  'empresa', 'business', 'negocio', 'cliente', 'customer', 'project', 'proyecto', 'website', 'pagina', 'campaign',
  'campana', 'ciudad', 'nuestra', 'nuestro', 'report', 'reporte', 'informe', 'presentation', 'presentacion',
  'proposal', 'propuesta', 'strategy', 'estrategia', 'competition', 'competencia', 'competitor', 'competidor',
  'analysis', 'analisis', 'content', 'contenido', 'publicacion', 'sales', 'ventas', 'price', 'precio', 'pricing',
  'countertop', 'fabricante', 'manufacturer', 'principal', 'important', 'importante', 'establish', 'quality', 'calidad',
  'service', 'servicio', 'kitchen', 'cocina', 'quartz', 'granite', 'marble', 'cuarzo', 'granito', 'showroom',
  'photos', 'fotos', 'video', 'videos', 'review', 'reviews', 'resena', 'followers', 'seguidores', 'audience',
  'audiencia', 'budget', 'presupuesto', 'schedule', 'calendar', 'calendario', 'week', 'semana', 'month', 'semanas',
]

/** Ordinary words typo-fixing corrects towards: common words, concept words, verbs (5+ letters, accent-free). */
export function generalTypoTargets(): string[] {
  const fold = (w: string) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const words = new Set<string>()
  const add = (w: string) => { const f = fold(w); if (f.length >= 5 && /^[a-z]+$/.test(f)) words.add(f) }
  COMMON_WORDS.forEach(add)
  Object.values(CONCEPTS).forEach(([en, es]) => [...en, ...es].forEach(add))
  EN_VERBS.forEach(add)
  ES_REGULAR_VERBS.forEach(add)
  Object.keys(ES_IRREGULAR_VERBS).forEach(add)
  return Array.from(words).sort()
}
