// Load TypeScript modules from src/ in tests without a build step.
// Relative imports ("./vocabulary") are loaded the same way; packages via require.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const cache = new Map()

/** "src/lib/utils" → "src/lib/utils.ts" or "src/lib/utils/index.ts" */
const resolveTs = (base) => (fs.existsSync(`${base}.ts`) ? `${base}.ts` : path.join(base, 'index.ts'))

/**
 * load('src/lib/x.ts', { '@/lib/db': fakeDb }) — `mocks` replace imports by name;
 * other "@/…" imports load the real file from src/.
 */
function load(file, mocks = null) {
  const full = path.resolve(file)
  if (!mocks && cache.has(full)) return cache.get(full).exports
  const mod = { exports: {} }
  if (!mocks) cache.set(full, mod)
  const js = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(js, {
    module: mod,
    exports: mod.exports,
    process,
    require: (name) => {
      if (mocks && name in mocks) return mocks[name]
      if (name.startsWith('./')) return load(resolveTs(path.join(path.dirname(full), name)))
      if (name.startsWith('@/')) return load(resolveTs(path.join('src', name.slice(2))))
      return require(name)
    },
  })
  return mod.exports
}

/** JSON round-trip: objects built inside vm have another realm's prototypes, which deepEqual rejects. */
const plain = (value) => JSON.parse(JSON.stringify(value))

module.exports = { load, plain }
