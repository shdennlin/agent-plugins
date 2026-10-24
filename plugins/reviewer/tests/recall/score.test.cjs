// node --test plugins/reviewer/tests/recall/score.test.cjs
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { scoreRun } = require('./score.cjs')

const seeds = [
  { id: 'type-none', kind: 'type', file: 'src/parse.py', function: 'parse_amount', pattern: 'return int(s)', titleHints: ['TypeError', '\\bNone\\b'] },
  { id: 'crossfile-cast', kind: 'crossfile', file: 'src/parse.py', function: 'parse_amount_field', pattern: 'int(raw)', titleHints: ['non-numeric'], crossFile: ['src/parse.py', 'src/importer.py'] },
]
const merged = (issues) => ({ issues, complete: true, verdict: 'FAIL', counts: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 } })

test('function match still needs a title hint: an unrelated issue in the seeded function is extra', () => {
  const r = scoreRun(merged([{ title: 'parse_amount lacks a docstring', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] }]), seeds.slice(0, 1))
  assert.deepEqual(r.misses, ['type-none'])
  assert.equal(r.extra, 1)
  const h = scoreRun(merged([{ title: 'TypeError escapes', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] }]), seeds.slice(0, 1))
  assert.deepEqual(h.hits, ['type-none'])
  assert.equal(h.extra, 0)
})

test('crossfile seed also needs a title hint: a two-file issue about something else is extra', () => {
  const r = scoreRun(merged([{ title: 'missing type hints', location: 'src/parse.py', locations: ['src/parse.py', 'src/importer.py'] }]), seeds.slice(1))
  assert.deepEqual(r.misses, ['crossfile-cast'])
  assert.equal(r.extra, 1)
})

test('matched counts how many issues hit each seed', () => {
  const r = scoreRun(merged([
    { title: 'TypeError on None', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] },
    { title: 'None escapes as TypeError', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] }]), seeds.slice(0, 1))
  assert.deepEqual(r.matched, { 'type-none': 2 })
})

test('bare path location hits only with a title hint, and only for its own file', () => {
  const a = scoreRun(merged([{ title: 'None input raises TypeError', location: 'src/parse.py', locations: ['src/parse.py'] }]), seeds.slice(0, 1))
  assert.deepEqual(a.hits, ['type-none'])
  const b = scoreRun(merged([{ title: 'None input raises TypeError', location: 'src/other.py', locations: ['src/other.py'] }]), seeds.slice(0, 1))
  assert.deepEqual(b.misses, ['type-none'])
  assert.equal(b.extra, 1)
})

test('crossfile seed: both files in one issue -> hit; one file -> partial; two separate issues -> partial', () => {
  const one = scoreRun(merged([{ title: 'non-numeric cast', location: 'src/parse.py:parse_amount_field', locations: ['src/parse.py:parse_amount_field', 'src/importer.py:parse_row'] }]), seeds.slice(1))
  assert.deepEqual(one.hits, ['crossfile-cast'])
  const half = scoreRun(merged([{ title: 'non-numeric cast', location: 'src/parse.py:parse_amount_field', locations: ['src/parse.py:parse_amount_field'] }]), seeds.slice(1))
  assert.deepEqual(half.partial, ['crossfile-cast'])
  assert.deepEqual(half.hits, [])
  const two = scoreRun(merged([
    { title: 'non-numeric cast', location: 'src/parse.py:parse_amount_field', locations: ['src/parse.py:parse_amount_field'] },
    { title: 'non-numeric cast', location: 'src/importer.py:parse_row', locations: ['src/importer.py:parse_row'] }]), seeds.slice(1))
  assert.deepEqual(two.partial, ['crossfile-cast'])
  assert.equal(two.extra, 0)
})

test('a seed counts once even when two issues match it', () => {
  const r = scoreRun(merged([
    { title: 'TypeError on None', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] },
    { title: 'None is not handled', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] }]), seeds.slice(0, 1))
  assert.deepEqual(r.hits, ['type-none'])
  assert.equal(r.extra, 0)
})

test('issues matching no seed are extra; complete/verdict/counts pass through', () => {
  const r = scoreRun(merged([{ title: 'unrelated', location: 'src/report.py:build_report', locations: ['src/report.py:build_report'] }]), seeds.slice(0, 1))
  assert.equal(r.extra, 1)
  assert.deepEqual(r.misses, ['type-none'])
  assert.equal(r.complete, true)
  assert.equal(r.verdict, 'FAIL')
  assert.equal(r.counts.HIGH, 1)
})

// --- batch E: severity-match rate
test('a hit seed at the wrong severity counts toward recall but not toward the exact rate; one level off counts within1', () => {
  const s = [{ id: 'type-none', kind: 'type', file: 'src/parse.py', function: 'parse_amount', pattern: 'return int(s)', titleHints: ['TypeError'], expectedSeverity: 'HIGH' },
    { id: 'boundary-slice', kind: 'boundary', file: 'src/paginate.py', function: 'page', pattern: 'x', titleHints: ['off-by-one'], expectedSeverity: 'MEDIUM' }]
  const r = scoreRun(merged([
    { title: 'TypeError escapes', severity: 'LOW', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] },
    { title: 'off-by-one in slice', severity: 'HIGH', location: 'src/paginate.py:page', locations: ['src/paginate.py:page'] },
  ]), s)
  assert.deepEqual(r.hits, ['type-none', 'boundary-slice'])
  assert.deepEqual(r.severity, { exact: 0, within1: 1, n: 2 })
  const e = scoreRun(merged([{ title: 'TypeError escapes', severity: 'HIGH', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] }]), [s[0]])
  assert.deepEqual(e.severity, { exact: 1, within1: 1, n: 1 })
})
test('every seed in seeds.json carries an expectedSeverity', () => {
  for (const seed of require('./seeds.json')) assert.match(seed.expectedSeverity || '', /^(CRITICAL|HIGH|MEDIUM|LOW)$/, seed.id)
})
