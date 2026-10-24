// node --test plugins/reviewer/tests/spec-recall/score.test.cjs
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { scoreRun } = require('./score.cjs')

const CHANGE = 'openspec/changes/demo'
const SEEDS = [
  { id: 'scope-no-nongoals', kind: 'scope', file: 'proposal.md', phrase: '## What changes', titleHints: ['non-goals', 'out of scope'], expectedSeverity: 'MEDIUM' },
  { id: 'design-no-alternatives', kind: 'design', file: 'design.md', section: 'Storage', phrase: 'SQLite', titleHints: ['alternative', 'rejected'], expectedSeverity: 'MEDIUM' },
  { id: 'tasks-no-done', kind: 'tasks', file: 'tasks.md', line: 4, phrase: 'Add tests', titleHints: ['done criteri', 'verif'], expectedSeverity: 'LOW' },
]
const iss = (id, loc, title, extra = {}) => ({ id, severity: 'MEDIUM', title, location: loc, locations: [loc], category: 'c', ...extra })

test('a seed hits when the issue sits in its file (section or line) and a title hint matches; the wrong file or no hint is not a hit', () => {
  const merged = { issues: [
    iss('F1', `${CHANGE}/design.md §Storage`, 'SQLite chosen with no alternative considered'),
    iss('F2', `${CHANGE}/tasks.md:4`, 'Task 3 has no done criterion'),
    iss('F3', `${CHANGE}/design.md §Storage`, 'Proposal lacks a Non-goals section'),
    iss('F4', `${CHANGE}/proposal.md §What changes`, 'Export format unclear'),
  ] }
  const s = scoreRun(merged, SEEDS, CHANGE)
  assert.deepEqual(s.hits.sort(), ['design-no-alternatives', 'tasks-no-done'])
  assert.deepEqual(s.misses, ['scope-no-nongoals'])
  assert.equal(s.extra, 2, 'the non-goals remark on the wrong file and the unrelated export issue are extra')
})
test('a pattern or title containing the phrase also counts as being at the seed, when the file matches', () => {
  const merged = { issues: [iss('F1', `${CHANGE}/design.md`, 'Storage decision lists no rejected alternative', { pattern: 'Storage: SQLite, one file per import' })] }
  const s = scoreRun(merged, SEEDS, CHANGE)
  assert.deepEqual(s.hits, ['design-no-alternatives'])
})
test('verification fields mirror the result scorer: refuted count, before/after and false refutations', () => {
  const hit = iss('F1', `${CHANGE}/tasks.md:4`, 'Task 3 has no done criterion')
  const pre = { issues: [hit, iss('F2', `${CHANGE}/proposal.md`, 'noise')] }
  const post = { issues: [], refuted: [{ ...hit, verified: 'refuted' }, { ...pre.issues[1], verified: 'refuted' }] }
  const s = scoreRun(post, SEEDS, CHANGE, { preVerify: pre })
  assert.equal(s.refuted, 2); assert.deepEqual(s.false_refutation, ['tasks-no-done']); assert.equal(s.before.extra, 1)
})
