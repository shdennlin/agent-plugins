// node --test plugins/reviewer/tests/recall/fixture.test.cjs
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('node:child_process')

const { buildFixture, SEEDS } = require('./fixture.cjs')

const dirs = []
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) })
const mkTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-fx-')); dirs.push(d); return d }
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })

test('seeds.json has the four kinds with the required fields', () => {
  assert.deepEqual([...new Set(SEEDS.map(s => s.kind))].sort(), ['boundary', 'crossfile', 'dataflow', 'type'])
  for (const s of SEEDS) for (const k of ['id', 'kind', 'file', 'function', 'pattern', 'titleHints']) assert.ok(k in s, `${s.id}.${k}`)
  assert.deepEqual(SEEDS.find(s => s.kind === 'crossfile').crossFile, ['src/parse.py', 'src/importer.py'])
})

test('buildFixture makes a repo whose main...feat diff contains every seed pattern', () => {
  const { repo } = buildFixture(mkTmp())
  const diff = git(repo, 'diff', 'main...feat')
  for (const s of SEEDS) assert.ok(diff.includes(s.pattern), `pattern of ${s.id} not in diff`)
  // a crossFile seed's pattern must appear in EVERY listed file's hunk, not just somewhere in the diff
  const hunks = Object.fromEntries(diff.split(/^diff --git a\/(\S+) b\/\S+$/m).slice(1).reduce((acc, v, i, arr) => (i % 2 === 0 ? acc.concat([[v, arr[i + 1]]]) : acc), []))
  for (const s of SEEDS.filter(x => x.crossFile)) for (const f of s.crossFile) assert.ok((hunks[f] || '').includes(s.pattern), `${s.id}: pattern missing in ${f}`)
  assert.ok(!diff.includes('parse_amount_field'), 'no dead helper function in the fixture')
  assert.equal(git(repo, 'rev-list', '--count', 'main..feat').trim(), '1')
  assert.ok(fs.existsSync(path.join(repo, 'docs/spec.md')))
})

test('two builds are independent repos, each with exactly one feature commit', () => {
  const a = buildFixture(mkTmp()).repo, b = buildFixture(mkTmp()).repo
  assert.notEqual(a, b)
  for (const r of [a, b]) assert.equal(git(r, 'rev-list', '--count', 'main..feat').trim(), '1')
})

test('the harness carries seven seeds: three cross-file, one buried in a large file', () => {
  assert.equal(SEEDS.length, 7)
  assert.equal(SEEDS.filter(x => x.crossFile).length, 3)
  const buried = SEEDS.find(x => x.id === 'buried-range')
  assert.ok(buried && buried.file === 'src/legacy_big.py')
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'recall-fx-'))
  const { repo } = buildFixture(tmp)
  const big = fs.readFileSync(path.join(repo, 'src/legacy_big.py'), 'utf8')
  assert.ok(big.split('\n').length >= 600, 'legacy_big.py is at least 600 lines')
  assert.ok(big.includes(buried.pattern))
  const added = git(repo, 'diff', '--numstat', 'main...feat', '--', 'src/legacy_big.py').split('\t')[0]
  assert.ok(Number(added) >= 500, `the buried seed must sit inside a large hunk, not an 8-line diff (added ${added})`)
  fs.rmSync(tmp, { recursive: true, force: true })
})
