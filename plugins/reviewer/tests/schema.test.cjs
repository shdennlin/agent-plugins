'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const NORMALIZE_CASES = require('./fixtures/normalize-cases.json')
const { REPORT_SCHEMA, validateReport, normalizePath } = require('../mcp/schema.cjs')

const FILES = ['src/a.py', 'src/b.py']
const good = () => ({
  run_dir: '/tmp/x/.claude/reviewer/runs/r1', angle: 'correctness',
  files: [{ path: 'src/a.py', verdict: 'issues', issue_count: 1 }, { path: 'src/b.py', verdict: 'clean', issue_count: 0 }],
  issues: [{ severity: 'HIGH', title: 't', location: 'src/a.py:parse', category: 'correctness', pattern: 'int(', expected: 'e', actual: 'a', impact: 'i', recommendation: 'r' }],
  verdict: 'FAIL',
})
test('valid report has no violations', () => assert.deepEqual(validateReport(good(), FILES), []))
test('schema advertises required top-level keys', () => assert.deepEqual([...REPORT_SCHEMA.required].sort(), ['angle', 'files', 'issues', 'run_dir', 'verdict']))
test('missing manifest path is named', () => { const r = good(); r.files.pop(); assert.match(validateReport(r, FILES).join('\n'), /src\/b\.py.*missing/) })
test('path outside manifest is named', () => { const r = good(); r.files.push({ path: 'src/c.py', verdict: 'clean', issue_count: 0 }); assert.match(validateReport(r, FILES).join('\n'), /src\/c\.py.*not in manifest/) })
test('clean file with issue_count>0 is rejected', () => { const r = good(); r.files[1].issue_count = 2; assert.equal(validateReport(r, FILES).length, 1) })
test('issue_count must equal issues under that path', () => { const r = good(); r.files[0].issue_count = 3; assert.match(validateReport(r, FILES).join('\n'), /src\/a\.py.*issue_count 3.*1 issue/) })
test('severity outside enum is rejected', () => { const r = good(); r.issues[0].severity = 'BLOCKER'; assert.match(validateReport(r, FILES).join('\n'), /severity/) })
test('run_dir outside a runs directory is rejected', () => { const r = good(); r.run_dir = '/etc'; assert.match(validateReport(r, FILES).join('\n'), /run_dir/) })
test('coverage is optional and validated when present', () => { const r = good(); r.coverage = [{ requirement: 'R1', status: 'done' }]; assert.match(validateReport(r, FILES).join('\n'), /coverage\[0\]\.status/) })
test('skimmed file with issue_count>0 is rejected', () => { const r = good(); r.files[1].verdict = 'skimmed'; r.files[1].issue_count = 1; assert.equal(validateReport(r, FILES).length, 1) })
test('skimmed file with zero issues is valid', () => { const r = good(); r.files[1].verdict = 'skimmed'; assert.deepEqual(validateReport(r, FILES), []) })
test('issues verdict with issue_count 0 is rejected', () => { const r = good(); r.files[0].issue_count = 0; r.issues = []; assert.match(validateReport(r, FILES).join('\n'), /src\/a\.py.*issues/) })
test('via and reported_at are accepted', () => { const r = good(); r.via = 'mcp'; r.reported_at = '2026-10-22T00:00:00Z'; assert.deepEqual(validateReport(r, FILES), []) })
test('non-object report returns violations without throwing', () => { for (const v of [null, 'x', [], 3]) assert.ok(validateReport(v, FILES).length > 0) })
test('normalizePath strips ./ and trailing slash, keeps rename target', () => {
  assert.equal(normalizePath('./src/a.py'), 'src/a.py')
  assert.equal(normalizePath('src/dir/'), 'src/dir')
  assert.equal(normalizePath('old/name.py => new/name.py'), 'new/name.py')
  assert.equal(normalizePath('src/{old => new}/f.py'), 'src/new/f.py')
  assert.equal(normalizePath('src/{ => new}/f.py'), 'src/new/f.py')
})
test('validateReport matches ./-prefixed report paths to manifest paths', () => {
  const r = good(); r.files[0].path = './src/a.py'; r.issues[0].location = './src/a.py:parse'
  assert.deepEqual(validateReport(r, FILES), [])
})
test('normalizePath matches the pinned table (shared with the setup script)', () => {
  for (const [input, expected] of NORMALIZE_CASES) assert.equal(normalizePath(input), expected, input)
})

// --- verdict/issue consistency, non-empty strings, run_dir traversal (refactor batch A)
test('PASS with a CRITICAL or HIGH issue is rejected', () => { const r = good(); r.verdict = 'PASS'; assert.match(validateReport(r, FILES).join('\n'), /verdict: PASS but 1 CRITICAL\/HIGH/) })
test('FAIL with zero issues is rejected', () => { const r = good(); r.issues = []; r.files[0] = { path: 'src/a.py', verdict: 'clean', issue_count: 0 }; assert.match(validateReport(r, FILES).join('\n'), /verdict: FAIL but no issues/) })
test('FAIL with only LOW issues is valid', () => { const r = good(); r.issues[0].severity = 'LOW'; assert.deepEqual(validateReport(r, FILES), []) })
test('PASS with only MEDIUM issues is valid', () => { const r = good(); r.issues[0].severity = 'MEDIUM'; r.verdict = 'PASS'; assert.deepEqual(validateReport(r, FILES), []) })
test('empty title, location, category or recommendation is rejected', () => {
  for (const k of ['title', 'location', 'category', 'recommendation']) { const r = good(); r.issues[0][k] = ''; assert.match(validateReport(r, FILES).join('\n'), new RegExp(`issues\\[0\\]\\.${k}: must not be empty`)) }
})
test('run_dir with a .. segment is rejected', () => { const r = good(); r.run_dir = '/tmp/x/.claude/reviewer/runs/../../etc'; assert.match(validateReport(r, FILES).join('\n'), /run_dir: must not contain a \.\. segment/) })

// --- history row schema v2 (refactor batch B)
const { HISTORY_ROW, ENGINES, validateHistoryRow, normalizeChange } = require('../mcp/schema.cjs')
const goodRow = () => ({ v: 2, ts: '2026-10-24T00:00:00Z', change: 'openspec/changes/x', source: 'result', round: 1, run_id: 'r1',
  engine: 'claude', engines: ['claude'], severity: 'HIGH', category: 'correctness', title: 't', location: 'a.py:f', locations: ['a.py:f'], pattern: 'int(' })
test('a complete v2 row validates', () => assert.deepEqual(validateHistoryRow(goodRow()), []))
test('HISTORY_ROW names the fields and ENGINES is the closed vocabulary', () => {
  assert.deepEqual([...HISTORY_ROW.required].sort(), ['category', 'change', 'engine', 'engines', 'location', 'locations', 'pattern', 'round', 'run_id', 'severity', 'source', 'title', 'ts', 'v'])
  assert.deepEqual(ENGINES, ['claude', 'codex', 'code-review', 'spectra-review'])
})
test('engine must be in the vocabulary or other:<skill>; empty and legacy names are rejected', () => {
  for (const bad of ['', 'claude-result', 'both', 'Claude']) { const r = goodRow(); r.engine = bad; assert.match(validateHistoryRow(r).join('\n'), /^engine: /m, `engine ${JSON.stringify(bad)} accepted`) }
  const r = goodRow(); r.engine = 'other:my-skill'; assert.deepEqual(validateHistoryRow(r), [])
})
test('round must be an integer ≥ 1 and engines non-empty', () => {
  const r = goodRow(); r.round = '1'; assert.match(validateHistoryRow(r).join('\n'), /round: must be integer/)
  const z = goodRow(); z.round = 0; assert.match(validateHistoryRow(z).join('\n'), /round: must be >= 1/)
  const e = goodRow(); e.engines = []; assert.match(validateHistoryRow(e).join('\n'), /engines: must have at least 1/)
})
test('pattern and run_id may be null; title/category/location must not be empty; no extra fields', () => {
  const r = goodRow(); r.pattern = null; r.run_id = null; assert.deepEqual(validateHistoryRow(r), [])
  for (const k of ['title', 'category', 'location']) { const x = goodRow(); x[k] = ''; assert.match(validateHistoryRow(x).join('\n'), new RegExp(`${k}: must not be empty`)) }
  const extra = goodRow(); extra.outcome = 'fixed'; assert.match(validateHistoryRow(extra).join('\n'), /outcome: unknown property/)
})
test('normalizeChange strips ./, trailing slashes and doubled slashes', () => {
  assert.equal(normalizeChange('./openspec/changes/x/'), 'openspec/changes/x')
  assert.equal(normalizeChange(' openspec//changes/x '), 'openspec/changes/x')
  assert.equal(normalizeChange('docs/spec.md'), 'docs/spec.md')
})

// --- batch F: spec mode (manifest.mode === 'spec')
const SPEC_FILES = ['proposal.md', 'design.md', 'specs/a/spec.md']
const specGood = () => ({
  run_dir: '/tmp/x/openspec/reviews/runs/r', angle: 'clarity', verdict: 'FAIL',
  files: [{ path: 'proposal.md', verdict: 'clean', issue_count: 0 }, { path: 'design.md', verdict: 'issues', issue_count: 1 }, { path: 'specs/a/spec.md', verdict: 'issues', issue_count: 1 }],
  issues: [
    { severity: 'HIGH', title: 'section 3 contradicts the proposal', location: 'design.md §3', category: 'consistency', expected: 'e', actual: 'a', impact: 'i', recommendation: 'r' },
    { severity: 'MEDIUM', title: 'requirement without scenario', location: 'specs/a/spec.md:12', category: 'completeness', expected: 'e', actual: 'a', impact: 'i', recommendation: 'r' },
  ],
})
test('spec mode: § section locations and :line locations count toward their file; pattern is optional', () => {
  assert.deepEqual(validateReport(specGood(), SPEC_FILES, { mode: 'spec' }), [])
})
test('spec mode: coverage is not allowed', () => {
  const r = specGood(); r.coverage = [{ requirement: 'R1', status: 'implemented' }]
  assert.match(validateReport(r, SPEC_FILES, { mode: 'spec' }).join('\n'), /coverage: not allowed in spec mode/)
})
test('spec mode: issue_count still has to match the issues under the file', () => {
  const r = specGood(); r.files[1].issue_count = 2
  assert.match(validateReport(r, SPEC_FILES, { mode: 'spec' }).join('\n'), /design\.md issue_count 2 but 1 issue/)
})
test('result mode (default) does not treat § as a path separator', () => {
  const r = good(); r.issues[0].location = 'src/a.py §3'
  assert.match(validateReport(r, FILES).join('\n'), /src\/a\.py issue_count 1 but 0 issue/)
})
