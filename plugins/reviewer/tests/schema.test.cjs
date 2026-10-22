'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { REPORT_SCHEMA, validateReport } = require('../mcp/schema.cjs')

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
