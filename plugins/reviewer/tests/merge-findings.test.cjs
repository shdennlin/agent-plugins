// node --test plugins/reviewer/tests/merge-findings.test.cjs
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const { merge, foldByPattern } = require('../scripts/merge-findings.cjs')

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

test('same location with a different title stays two issues', () => {
  const reports = clone(run.reports)
  reports[1].issues[0].title = 'Request handler returns 500' // robustness, src/a.py:parse
  const m = merge(run.manifest, reports, run.diff)
  const hit = m.issues.filter((i) => i.location === 'src/a.py:parse')
  assert.equal(hit.length, 2)
  assert.deepEqual(hit.map((i) => i.severity), ['CRITICAL', 'HIGH'])
})

test('same location dedup ignores title case and surrounding whitespace', () => {
  const reports = clone(run.reports)
  reports[1].issues[0].title = '  UNCHECKED INT() CONVERSION '
  const m = merge(run.manifest, reports, run.diff)
  assert.equal(m.issues.filter((i) => i.location === 'src/a.py:parse').length, 1)
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
  // correctness says R1 partial (no location), coverage says R1 implemented at src/a.py
  const m = merge(run.manifest, run.reports, run.diff)
  assert.deepEqual(m.coverage.map((c) => [c.requirement, c.status]), [['R1', 'partial'], ['R2', 'missing']])
  assert.equal(m.coverage[0].location, 'src/a.py')
})

// One-issue correctness report whose pattern sweep runs over `diff`.
const sweep = (diff) => {
  const r = clone(run.reports[2])
  return merge(run.manifest, [r], diff).issues[0].locations
}
const section = (header, plus, line) =>
  `${header}\nindex 1..2 100644\n--- a/x\n${plus}\n@@ -1 +1,2 @@\n ctx\n+${line}\n`

test('sweep reads quoted (non-ASCII) paths and never leaks them into the previous file', () => {
  const diff =
    section('diff --git a/src/b.py b/src/b.py', '+++ b/src/b.py', 'pass') +
    section('diff --git "a/src/caf\\303\\251.py" "b/src/caf\\303\\251.py"', '+++ "b/src/caf\\303\\251.py"', 'v = int(s)')
  assert.deepEqual(sweep(diff), ['src/a.py:parse', 'src/café.py'])
})

test('sweep takes the path from +++ even when it contains " b/"', () => {
  const diff = section('diff --git a/d b/c.py b/d b/c.py', '+++ b/d b/c.py\t', 'v = int(s)')
  assert.deepEqual(sweep(diff), ['src/a.py:parse', 'd b/c.py'])
})

test('expect: an expected angle with no report is invalid and not_reviewed everywhere', () => {
  const m = merge(run.manifest, run.reports, run.diff, { expect: ['coverage', 'robustness', 'correctness', 'security'] })
  assert.deepEqual(m.invalid_reports.find((r) => r.angle === 'security'), { angle: 'security', violations: ['no report written'] })
  assert.ok(m.angles.includes('security'))
  assert.equal(m.via.security, undefined) // no report arrived, so it arrived by no route
  for (const f of m.files) {
    assert.equal(f.verdict, 'not_reviewed')
    assert.ok(f.not_reviewed_by.includes('security'), f.path)
  }
})

// run-basic with robustness covering src/c.py too: every angle reported every file, validly.
const completeReports = () => {
  const reports = clone(run.reports)
  reports[1].files.push({ path: 'src/c.py', verdict: 'clean', issue_count: 0 })
  return reports
}

test('complete: true when every report is valid and every file was reviewed', () => {
  const m = merge(run.manifest, completeReports(), run.diff)
  assert.deepEqual(m.invalid_reports, [])
  assert.equal(m.complete, true)
})

test('complete: false when an expected angle is missing, verdict stays the severity verdict', () => {
  const m = merge(run.manifest, completeReports(), run.diff, { expect: ['coverage', 'robustness', 'correctness', 'ghost'] })
  assert.equal(m.complete, false)
  assert.equal(m.verdict, 'FAIL') // still from counts: CRITICAL present
  const clean = completeReports().map((r) => ({ ...r, issues: [] }))
  for (const r of clean) for (const f of r.files) if (f.verdict === 'issues') Object.assign(f, { verdict: 'clean', issue_count: 0 })
  const m2 = merge(run.manifest, clean, run.diff, { expect: ['coverage', 'robustness', 'correctness', 'ghost'] })
  assert.equal(m2.verdict, 'PASS')
  assert.equal(m2.complete, false)
})

test('complete: false on run-basic as shipped (robustness omits src/c.py)', () => {
  assert.equal(merge(run.manifest, run.reports, run.diff).complete, false)
})

// Same defect (title + pattern) at two files, reported by two angles; each sweeps to the other file.
const twoFile = (sevA, sevB) => {
  const A = { ...clone(run.reports[2].issues[0]), severity: sevA } // correctness, src/a.py:parse, pattern int(
  const B = { ...clone(A), severity: sevB, location: 'src/b.py:load', recommendation: 'Validate before int()' }
  const ra = { ...clone(run.reports[2]), issues: [A] }
  const rb = { ...clone(completeReports()[1]), issues: [B] }
  return merge(run.manifest, [ra, rb], run.diff)
}

test('same title + pattern in two files folds into one issue', () => {
  const m = twoFile('HIGH', 'MEDIUM')
  const hit = m.issues.filter((i) => i.title === 'Unchecked int() conversion')
  assert.equal(hit.length, 1)
  assert.equal(hit[0].severity, 'HIGH')
  assert.equal(hit[0].location, 'src/a.py:parse')
  assert.deepEqual(hit[0].locations, ['src/a.py:parse', 'src/b.py:load'])
  assert.deepEqual(hit[0].angles, ['correctness', 'robustness'])
  assert.equal(m.counts.HIGH, 1)
  assert.equal(m.counts.MEDIUM, 0)
  // per-file issue_count is the angles' own count, untouched by the fold
  assert.equal(m.files.find((f) => f.path === 'src/a.py').issue_count, 2)
})

test('fold: equal severity picks the lowest location as primary', () => {
  const hit = twoFile('HIGH', 'HIGH').issues
  assert.equal(hit.length, 1)
  assert.equal(hit[0].location, 'src/a.py:parse')
})

test('fold: locations dedup by path, file:function wins over a swept bare path', () => {
  // B is worse, so B is primary: B = [b.py:load, a.py(swept)], A = [a.py:parse, b.py(swept)]
  const hit = twoFile('MEDIUM', 'CRITICAL').issues
  assert.equal(hit.length, 1)
  assert.equal(hit[0].location, 'src/b.py:load')
  assert.deepEqual(hit[0].locations, ['src/b.py:load', 'src/a.py:parse'])
})

test('fold needs a non-empty equal pattern', () => {
  const ra = clone(run.reports[2])
  delete ra.issues[0].pattern
  const B = { ...clone(ra.issues[0]), location: 'src/b.py:load' }
  ra.issues.push(B)
  assert.equal(merge(run.manifest, [ra], run.diff).issues.length, 2)
  const rc = clone(run.reports[2])
  rc.issues.push({ ...clone(rc.issues[0]), location: 'src/b.py:load', pattern: 'int(x' })
  assert.equal(merge(run.manifest, [rc], run.diff).issues.length, 2)
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

// ---- foldByPattern: one merged issue per construct, across titles and files ----
const I = (sev, title, location, pattern, extra = {}) => ({ severity: sev, title, location, locations: [location], category: 'c', pattern, expected: 'e', actual: 'a', impact: 'i', recommendation: `fix ${title}`, angles: ['x'], ...extra })

test('same location + same pattern folds to the worst, other titles into rationale', () => {
  const out = foldByPattern([
    I('MEDIUM', 'page() returns size-1 items (off-by-one slice end)', 'src/paginate.py:page', 'size - 1', { angles: ['coverage'] }),
    I('HIGH', 'Off-by-one: page returns size-1 items', 'src/paginate.py:page', 'size - 1', { angles: ['correctness'] }),
    I('HIGH', 'page returns size-1 items (off-by-one)', 'src/paginate.py:page', 'size - 1', { angles: ['robustness'] }),
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].severity, 'HIGH')
  assert.equal(out[0].title, 'Off-by-one: page returns size-1 items')
  assert.equal(out[0].folded, 2)
  assert.equal(out[0].rationale, '"page returns size-1 items (off-by-one)" (robustness)\n"page() returns size-1 items (off-by-one slice end)" (coverage)')
  assert.deepEqual(out[0].angles, ['correctness', 'coverage', 'robustness'])
  assert.equal(out[0].recommendation.split('\n').length, 3)
})

test('same pattern in two files with different titles joins locations with file:function entries', () => {
  const out = foldByPattern([
    I('HIGH', 'parse_amount(None) raises TypeError', 'src/parse.py:parse_amount', 'int(', { locations: ['src/parse.py:parse_amount', 'src/importer.py'] }),
    I('HIGH', 'parse_row bypasses R1 rules', 'src/importer.py:parse_row', 'int(', { locations: ['src/importer.py:parse_row', 'src/parse.py'] }),
  ])
  assert.equal(out.length, 1)
  // equal severity: the lowest location string wins the tie, so importer.py is the survivor
  assert.equal(out[0].location, 'src/importer.py:parse_row')
  assert.deepEqual(out[0].locations, ['src/importer.py:parse_row', 'src/parse.py:parse_amount'])
})

test('same location with different patterns stays separate', () => {
  const out = foldByPattern([I('HIGH', 'a', 'src/parse.py:parse_amount', 'return int(s)'), I('MEDIUM', 'b', 'src/parse.py:parse_amount', 'isinstance(')])
  assert.equal(out.length, 2)
})

test('issues without a pattern or with a pattern under 3 chars never fold', () => {
  const out = foldByPattern([I('HIGH', 'a', 'x.py:f', undefined), I('HIGH', 'b', 'x.py:f', undefined), I('LOW', 'c', 'y.py:g', '('), I('LOW', 'd', 'z.py:h', '(')])
  assert.equal(out.length, 4)
  assert.ok(out.every((i) => i.folded === 0 && i.rationale === undefined))
})

test('identical titles are not repeated in rationale', () => {
  const out = foldByPattern([I('HIGH', 'Same', 'a.py:f', 'int('), I('LOW', 'same', 'b.py:g', 'int(')])
  assert.equal(out.length, 1)
  assert.equal(out[0].rationale, undefined)
  assert.equal(out[0].folded, 1)
})

test('end to end: run-basic merge still yields one a.py:parse issue, sweep fills locations, folded is numeric', () => {
  const m = merge(run.manifest, run.reports, run.diff)
  const hit = m.issues.filter((i) => i.location === 'src/a.py:parse')
  assert.equal(hit.length, 1)
  assert.deepEqual(hit[0].locations, ['src/a.py:parse', 'src/b.py'])
  assert.ok(m.issues.every((i) => typeof i.folded === 'number'))
})

test('merge: a pattern shorter than MIN_PATTERN is not swept either (locations stay primary only)', () => {
  const rc = clone(run.reports[2])
  rc.issues[0].pattern = '('
  const m = merge(run.manifest, [rc], run.diff)
  const hit = m.issues.find((i) => i.location === 'src/a.py:parse')
  assert.deepEqual(hit.locations, ['src/a.py:parse'])
  assert.equal(hit.folded, 0)
})

test('merge: pattern on one angle only at the same location+title gives one issue with that pattern, folded 0', () => {
  const ra = clone(run.reports[2])
  const rb = clone(run.reports[2])
  rb.angle = 'robustness'
  delete rb.issues[0].pattern
  const m = merge(run.manifest, [ra, rb], run.diff)
  const hit = m.issues.filter((i) => i.location === 'src/a.py:parse')
  assert.equal(hit.length, 1)
  assert.equal(hit[0].pattern, ra.issues[0].pattern)
  assert.equal(hit[0].folded, 0)
})

// --- Submodule-aware manifests (setup-result-review.sh expands changed gitlinks into "<sub>/<path>")

test('real superproject manifest: every file is prefixed by one of four sub-repos; merge accepts it with no reports', () => {
  const man = require('./fixtures/submodule-manifest.json')
  const subs = new Set(man.files.map((f) => f.split('/')[0]))
  assert.deepEqual([...subs].sort(), ['sub-a', 'sub-b', 'sub-c', 'sub-d'])
  assert.equal(man.files.length, 194)
  assert.equal(new Set(man.files).size, 194, 'paths are unique')
  assert.ok(man.files.every((f) => !/onelegion|\/src\//.test(f)), 'no project paths in the fixture')
  assert.ok(!/shdennlin|onelegion/.test(JSON.stringify(man)), 'no user or project names in the fixture')
  const m = merge(man, [], '', { expect: ['coverage'] })
  assert.equal(m.complete, false)
  assert.equal(m.files.length, 194)
  assert.ok(m.files.every((f) => f.verdict === 'not_reviewed'))
})

test('sweep crosses sub-repos through prefixed +++ headers', () => {
  const man = { run_id: 'x', files: ['central/a.py', 'core-api/b.go'], working_directory: '/tmp/x' }
  const patch = [
    'diff --git a/central/a.py b/central/a.py', '--- a/central/a.py', '+++ b/central/a.py', '@@ -0,0 +1 @@', '+x = int(raw)',
    'diff --git a/core-api/b.go b/core-api/b.go', '--- a/core-api/b.go', '+++ b/core-api/b.go', '@@ -0,0 +1 @@', '+y := int(raw)',
  ].join('\n')
  const rep = {
    angle: 'correctness', via: 'report_review', verdict: 'FAIL',
    files: [{ path: 'central/a.py', verdict: 'issues', issue_count: 1 }, { path: 'core-api/b.go', verdict: 'clean', issue_count: 0 }],
    issues: [{ severity: 'HIGH', title: 'unchecked cast', location: 'central/a.py:f', category: 'c', pattern: 'int(', expected: 'e', actual: 'a', impact: 'i', recommendation: 'r' }],
  }
  const m = merge(man, [rep], patch)
  assert.deepEqual(m.issues[0].locations, ['central/a.py:f', 'core-api/b.go'])
})

test('sweep matches on the trimmed pattern (trailing whitespace in pattern does not disable it)', () => {
  const man = { run_id: 'x', files: ['a.py', 'b.py'], working_directory: '/tmp/x' }
  const patch = ['diff --git a/a.py b/a.py', '+++ b/a.py', '@@ -0,0 +1 @@', '+x = int(raw)', 'diff --git a/b.py b/b.py', '+++ b/b.py', '@@ -0,0 +1 @@', '+y = int(raw)'].join('\n')
  const rep = { angle: 'correctness', via: 'report_review', verdict: 'FAIL', files: [{ path: 'a.py', verdict: 'issues', issue_count: 1 }, { path: 'b.py', verdict: 'clean', issue_count: 0 }],
    issues: [{ severity: 'HIGH', title: 't', location: 'a.py:f', category: 'c', pattern: 'int( ', expected: 'e', actual: 'a', impact: 'i', recommendation: 'r' }] }
  assert.deepEqual(merge(man, [rep], patch).issues[0].locations, ['a.py:f', 'b.py'])
})

test('merge: a file-written report whose verdict contradicts its issues is not invalid (the merge recomputes the verdict)', () => {
  const man = { run_id: 'x', files: ['a.py'], working_directory: '/tmp/x' }
  const rep = { run_dir: '/tmp/x/.claude/reviewer/runs/r1', angle: 'correctness', via: 'file', verdict: 'PASS', files: [{ path: 'a.py', verdict: 'issues', issue_count: 1 }],
    issues: [{ severity: 'HIGH', title: 't', location: 'a.py:f', category: 'c', expected: 'e', actual: 'a', impact: 'i', recommendation: 'r' }] }
  const out = merge(man, [rep], '')
  assert.deepEqual(out.invalid_reports, [])
  assert.equal(out.complete, true)
  assert.equal(out.verdict, 'FAIL')
})
