// node --test plugins/reviewer/tests/log-findings.test.cjs — scripts/log-findings.cjs (v2 rows, validated, all-or-nothing)
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync, execSync } = require('child_process')

const CJS = path.join(__dirname, '..', 'scripts', 'log-findings.cjs')
const SH = path.join(__dirname, '..', 'scripts', 'log-findings.sh')

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logf-'))
  execSync('git init -q', { cwd: dir })
  return { dir, history: path.join(dir, '.claude', 'reviewer', 'history.jsonl') }
}
const run = (script, args, input, cwd) => spawnSync(script === SH ? 'bash' : 'node', [script, ...args], { input, cwd, encoding: 'utf8' })
const rows = (p) => fs.readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const good = (extra = {}) => ({ severity: 'HIGH', title: 't', location: 'a.py:f', category: 'correctness', engine: 'claude', ...extra })

test('completes partial rows to v2 and appends them', () => {
  const { dir, history } = repo()
  const r = run(CJS, ['--change', './openspec/changes/x/', '--source', 'result', '--round', '1', '--run-id', 'r9'], JSON.stringify([good(), good({ pattern: 'int(', locations: ['a.py:f', 'b.py:g'] }), good({ engine: 'other:my-skill' })]), dir)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^logged 3 finding\(s\) to \.claude\/reviewer\/history\.jsonl/)
  const rs = rows(history)
  assert.equal(rs.length, 3)
  assert.equal(rs[0].v, 2); assert.equal(rs[0].round, 1); assert.equal(rs[0].change, 'openspec/changes/x'); assert.equal(rs[0].run_id, 'r9')
  assert.deepEqual(rs[0].engines, ['claude']); assert.deepEqual(rs[0].locations, ['a.py:f']); assert.equal(rs[0].pattern, null)
  assert.equal(rs[1].pattern, 'int('); assert.deepEqual(rs[1].locations, ['a.py:f', 'b.py:g'])
  assert.equal(rs[2].engine, 'other:my-skill')
  assert.match(rs[0].ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
})
test('round must be numeric', () => {
  const { dir } = repo()
  const r = run(CJS, ['--change', 'x', '--source', 'spec', '--round', 'two'], '[]', dir)
  assert.equal(r.status, 1); assert.match(r.stderr, /round/)
})
test('an invalid row rejects the whole batch (all-or-nothing) and names the row', () => {
  const { dir, history } = repo()
  const r = run(CJS, ['--change', 'x', '--source', 'result', '--round', '1'], JSON.stringify([good(), good({ engine: '' }), good({ engine: 'claude-result' })]), dir)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /row 1 rejected: engine/); assert.match(r.stderr, /row 2 rejected: engine/)
  assert.ok(!fs.existsSync(history), 'nothing appended when any row is invalid')
})
test('the .sh wrapper forwards to the .cjs with the same result', () => {
  const { dir, history } = repo()
  const r = run(SH, ['--change', 'x', '--source', 'spec-dual', '--round', '2'], JSON.stringify([good({ engine: 'codex' })]), dir)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /logged 1 finding\(s\)/)
  assert.equal(rows(history)[0].source, 'spec-dual'); assert.equal(rows(history)[0].round, 2)
})
test('openspec repos log under openspec/reviews/history.jsonl', () => {
  const { dir } = repo(); fs.mkdirSync(path.join(dir, 'openspec'))
  const r = run(CJS, ['--change', 'x', '--source', 'spec', '--round', '1'], JSON.stringify([good()]), dir)
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /openspec\/reviews\/history\.jsonl/)
})
test('empty stdin and a non-array are errors; an empty array logs nothing with exit 0', () => {
  const { dir } = repo()
  assert.equal(run(CJS, ['--change', 'x', '--source', 'spec'], '', dir).status, 1)
  assert.equal(run(CJS, ['--change', 'x', '--source', 'spec'], '{}', dir).status, 1)
  const r = run(CJS, ['--change', 'x', '--source', 'spec'], '[]', dir); assert.equal(r.status, 0); assert.match(r.stdout, /logged 0 finding/)
})
