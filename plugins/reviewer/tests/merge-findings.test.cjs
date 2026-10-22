// node --test plugins/reviewer/tests/merge-findings.test.cjs
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const { merge } = require('../scripts/merge-findings.cjs')

const FIXTURES = path.join(__dirname, 'fixtures')
const SCRIPT = path.join(__dirname, '..', 'scripts', 'merge-findings.cjs')
const LOG_SCRIPT = path.join(__dirname, '..', 'scripts', 'log-findings.sh')

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const clone = (v) => structuredClone(v)

function loadFixture(name) {
  const dir = path.join(FIXTURES, name)
  return {
    manifest: readJson(path.join(dir, 'manifest.json')),
    reports: ['coverage', 'robustness', 'correctness'].map((a) => readJson(path.join(dir, `${a}.json`))),
    diff: fs.readFileSync(path.join(dir, 'diff.patch'), 'utf8'),
  }
}

const run = loadFixture('run-basic')

test('same location merges to worst severity with both recommendations', () => {
  const m = merge(run.manifest, run.reports, run.diff)
  const hit = m.issues.filter((i) => i.location === 'src/a.py:parse')
  assert.equal(hit.length, 1)
  assert.equal(hit[0].severity, 'CRITICAL')
  assert.deepEqual(hit[0].angles.sort(), ['correctness', 'robustness'])
  assert.match(hit[0].recommendation, /\n/)
})

test('pattern sweep adds files whose added lines contain the literal pattern', () => {
  const m = merge(run.manifest, run.reports, run.diff)
  assert.deepEqual(m.issues[0].locations, ['src/a.py:parse', 'src/b.py'])
})

test('pattern is literal, not regex', () => {
  const reports = clone(run.reports)
  reports[2].issues[0].pattern = 'x[0'
  assert.doesNotThrow(() => merge(run.manifest, reports, run.diff))
})

test('missing path in a report becomes not_reviewed_by that angle', () => {
  const m = merge(run.manifest, run.reports, run.diff)
  const c = m.files.find((f) => f.path === 'src/c.py')
  assert.equal(c.verdict, 'not_reviewed')
  assert.deepEqual(c.not_reviewed_by, ['robustness'])
  assert.equal(m.invalid_reports[0].angle, 'robustness')
})

test('per-file verdict is clean only when every angle is clean or skimmed', () => {
  const m = merge(run.manifest, run.reports, run.diff)
  assert.equal(m.files.find((f) => f.path === 'src/b.py').verdict, 'clean')
  assert.equal(m.files.find((f) => f.path === 'src/a.py').issue_count, 2)
  assert.equal(m.files.find((f) => f.path === 'lock.json').verdict, 'skimmed')
})

test('coverage unions with worst status winning', () => {
  const m = merge(run.manifest, run.reports, run.diff)
  assert.deepEqual(m.coverage.map((c) => c.status), ['implemented', 'missing'])
})

test('verdict FAIL on CRITICAL/HIGH, counts filled', () => {
  const m = merge(run.manifest, run.reports, run.diff)
  assert.equal(m.verdict, 'FAIL')
  assert.equal(m.counts.CRITICAL, 1)
  assert.equal(m.counts.LOW, 0)
})

test('via records tool vs fallback per angle', () => {
  const m = merge(run.manifest, run.reports, run.diff) // fixture: correctness has via, robustness does not
  assert.equal(m.via.correctness, 'report_review')
  assert.equal(m.via.robustness, 'file')
})

const hasJq = spawnSync('jq', ['--version']).status === 0

// Fresh temp git repo with the fixture run copied under .claude/reviewer/runs/run-basic.
function tempRepo() {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'merge-findings-')))
  spawnSync('git', ['init', '-q'], { cwd: repo })
  const runDir = path.join(repo, '.claude', 'reviewer', 'runs', 'run-basic')
  fs.mkdirSync(runDir, { recursive: true })
  for (const f of fs.readdirSync(path.join(FIXTURES, 'run-basic'))) {
    fs.copyFileSync(path.join(FIXTURES, 'run-basic', f), path.join(runDir, f))
  }
  const mf = path.join(runDir, 'manifest.json')
  fs.writeFileSync(mf, JSON.stringify({ ...readJson(mf), working_directory: repo }, null, 2))
  return { repo, runDir, history: path.join(repo, '.claude', 'reviewer', 'history.jsonl') }
}

test('CLI writes merged.json and logs through log-findings.sh with locations', (t) => {
  if (!hasJq) return t.skip('jq not installed')
  const { repo, runDir, history } = tempRepo()
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  const r = spawnSync('node', [SCRIPT, runDir, '--change', 'demo', '--round', '2', '--log-script', LOG_SCRIPT], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(fs.existsSync(path.join(runDir, 'merged.json')))
  assert.match(r.stdout, /logged 1 finding\(s\) to \.claude\/reviewer\/history\.jsonl/)
  const rows = fs.readFileSync(history, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].locations.length, 2)
  assert.equal(rows[0].engine, '')
})

test('CLI --no-log writes merged.json and no history file', (t) => {
  if (!hasJq) return t.skip('jq not installed')
  const { repo, runDir, history } = tempRepo()
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  const r = spawnSync('node', [SCRIPT, runDir, '--no-log'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(fs.existsSync(path.join(runDir, 'merged.json')))
  assert.equal(JSON.parse(r.stdout).verdict, 'FAIL')
  assert.ok(!fs.existsSync(history))
})
