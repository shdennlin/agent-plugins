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

test('function match hits regardless of title', () => {
  const r = scoreRun(merged([{ title: 'x', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] }]), seeds.slice(0, 1))
  assert.deepEqual(r.hits, ['type-none'])
  assert.equal(r.extra, 0)
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
    { title: 'a', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] },
    { title: 'b', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] }]), seeds.slice(0, 1))
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
