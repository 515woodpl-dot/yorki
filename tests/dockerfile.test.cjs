const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// The runtime image must carry next.config.mjs. Without it `next start` drops the /task base path the
// build used, pages load their scripts from mixed addresses and never start (buttons silently do nothing).
test('Dockerfile copies next.config.mjs into the runtime image', () => {
  const docker = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8')
  const runner = docker.slice(docker.indexOf('AS runner'))
  assert.match(runner, /COPY --from=build [^\n]*\/app\/next\.config\.mjs/)
})
