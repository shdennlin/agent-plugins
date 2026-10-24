// node --test plugins/reviewer/tests/log-findings.test.cjs — scripts/log-findings.cjs (v2 rows, validated, all-or-nothing)
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync, execSync } = require('child_process')

const CJS = path.join(__dirname, '..', 'scripts', 'log-findings.cjs')

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logf-'))
  execSync('git init -q', { cwd: dir })
  return { dir, history: path.join(dir, '.claude', 'reviewer', 'history.jsonl') }
}
const run = (script, args, input, cwd) => spawnSync('node', [script, ...args], { input, cwd, encoding: 'utf8' })
const rows = (p) => fs.readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const good = (extra = {}) => ({ severity: 'HIGH', title: 't', location: 'a.py:f', category: 'correctness', engine: 'claude', ...extra })

test('completes partial rows to v3 and appends them', () => {
  const { dir, history } = repo()
  const r = run(CJS, ['--change', './openspec/changes/x/', '--source', 'result', '--round', '1', '--run-id', 'r9'], JSON.stringify([good(), good({ pattern: 'int(', locations: ['a.py:f', 'b.py:g'] }), good({ engine: 'other:my-skill' })]), dir)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^logged 3 finding\(s\) to \.claude\/reviewer\/history\.jsonl/)
  const rs = rows(history)
  assert.equal(rs.length, 3)
  assert.equal(rs[0].v, 3); assert.equal(rs[0].round, 1); assert.equal(rs[0].change, 'openspec/changes/x'); assert.equal(rs[0].run_id, 'r9')
  assert.deepEqual(rs[0].engines, ['claude']); assert.deepEqual(rs[0].locations, [{ path: 'a.py', symbol: 'f' }]); assert.equal(rs[0].pattern, null); assert.equal(rs[0].outcome, 'unknown')
  assert.equal(rs[1].pattern, 'int('); assert.deepEqual(rs[1].locations, [{ path: 'a.py', symbol: 'f' }, { path: 'b.py', symbol: 'g' }])
  assert.equal(rs[2].engine, 'other:my-skill')
  assert.match(rs[0].ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
})
test('round must be numeric', () => {
  const { dir } = repo()
  const r = run(CJS, ['--change', 'x', '--source', 'spec', '--round', 'two'], '[]', dir)
  assert.equal(r.status, 1); assert.match(r.stderr, /round/)
})
test('invalid rows are dropped and named; valid rows in the same batch are still appended', () => {
  const { dir, history } = repo()
  const r = run(CJS, ['--change', 'x', '--source', 'result', '--round', '1'], JSON.stringify([good(), good({ severity: 'BLOCKER' }), good({ title: '' })]), dir)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stderr, /row 1 rejected: severity/); assert.match(r.stderr, /row 2 rejected: title/)
  assert.match(r.stdout, /^logged 1 finding\(s\) to \.claude\/reviewer\/history\.jsonl \(2 rejected\)$/m)
  assert.equal(rows(history).length, 1)
})
test('rows are normalized before validation: engine default, other: prefix, severity case, engines dedupe', () => {
  const { dir, history } = repo()
  const r = run(CJS, ['--change', 'x', '--source', 'result', '--round', '1'], JSON.stringify([
    good({ engine: undefined }), good({ engine: 'pr-review-toolkit:Review-PR' }), good({ severity: 'high' }), good({ engine: 'codex', engines: ['claude', 'claude'] }), good({ engine: 'claude-result' }),
  ]), dir)
  assert.equal(r.status, 0, r.stderr)
  const rs = rows(history); assert.equal(rs.length, 5)
  assert.equal(rs[0].engine, 'claude', 'missing engine defaults to claude for spec/result sources')
  assert.equal(rs[1].engine, 'other:pr-review-toolkit:review-pr'); assert.deepEqual(rs[1].engines, ['other:pr-review-toolkit:review-pr'])
  assert.equal(rs[2].severity, 'HIGH')
  assert.deepEqual(rs[3].engines, ['codex', 'claude'], 'engine itself is first and duplicates are dropped')
  assert.equal(rs[4].engine, 'claude', 'the retired claude-result maps to claude')
})
test('a batch with no valid row exits 1 and appends nothing', () => {
  const { dir, history } = repo()
  const r = run(CJS, ['--change', 'x', '--source', 'result', '--round', '1'], JSON.stringify([good({ title: '' })]), dir)
  assert.equal(r.status, 1); assert.ok(!fs.existsSync(history))
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

// --- batch F: history v3 — structured locations and outcome
const { parseLocation } = require('../scripts/log-findings.cjs')
test('parseLocation turns the location forms into objects; the unparseable keep the whole string as path plus raw', () => {
  assert.deepEqual(parseLocation('src/a.py:12'), { path: 'src/a.py', line: 12 })
  assert.deepEqual(parseLocation('src/a.py:12-20'), { path: 'src/a.py', line: 12, endLine: 20 })
  assert.deepEqual(parseLocation('src/a.py:parse_row'), { path: 'src/a.py', symbol: 'parse_row' })
  assert.deepEqual(parseLocation('design.md §3 Rollback'), { path: 'design.md', section: '3 Rollback' })
  assert.deepEqual(parseLocation('design.md'), { path: 'design.md' })
  assert.deepEqual(parseLocation('a.py:12:5 weird'), { path: 'a.py:12:5 weird', raw: 'a.py:12:5 weird' })
  assert.deepEqual(parseLocation('src/a.py:parse()'), { path: 'src/a.py', symbol: 'parse' })
  assert.deepEqual(parseLocation('src/a.py:L12'), { path: 'src/a.py', line: 12 })
  assert.deepEqual(parseLocation('src/a.py:Foo::bar'), { path: 'src/a.py', symbol: 'Foo::bar' })
})
test('outcome: default unknown, --outcome sets the batch default, a row\'s own outcome wins, --outcomes maps by title+location', () => {
  const { dir, history } = repo()
  const map = path.join(dir, 'outcomes.json')
  fs.writeFileSync(map, JSON.stringify([{ title: 'T', location: 'a.py:f', outcome: 'fixed' }, { title: 'other', location: 'b.py:g', outcome: 'escalated' }]))
  const r = run(CJS, ['--change', 'x', '--source', 'result', '--outcome', 'open', '--outcomes', map], JSON.stringify([good({ title: 'T' }), good({ title: 'U', location: 'b.py:g' }), good({ title: 'V', outcome: 'dismissed' })]), dir)
  assert.equal(r.status, 0, r.stderr)
  const rs = rows(history)
  assert.deepEqual(rs.map((x) => x.outcome), ['fixed', 'open', 'dismissed'])
  const bad = run(CJS, ['--change', 'x', '--source', 'result', '--outcome', 'done'], JSON.stringify([good()]), dir)
  assert.equal(bad.status, 1); assert.match(bad.stderr, /--outcome/)
})
