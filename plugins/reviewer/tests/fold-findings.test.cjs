// node --test plugins/reviewer/tests/fold-findings.test.cjs
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { foldFindings } = require('../scripts/fold-findings.cjs')
const SCRIPT = path.join(__dirname, '..', 'scripts', 'fold-findings.cjs')

const F = (title, location, severity, engine, extra = {}) => ({ title, location, severity, category: 'scope', engine, engines: [engine], ...extra })

test('two engines wording one defect at one location fold; engines are unioned; worst severity survives', () => {
  const out = foldFindings([
    F('Goal is not measurable in the proposal', 'proposal.md:4', 'MEDIUM', 'claude'),
    F('Goal not measurable: no success metric', 'proposal.md:4', 'HIGH', 'codex'),
    F('No rollback section', 'design.md:30', 'MEDIUM', 'claude'),
  ])
  assert.equal(out.findings.length, 2)
  const goal = out.findings.find((f) => f.location === 'proposal.md:4')
  assert.equal(goal.severity, 'HIGH'); assert.equal(goal.engine, 'claude'); assert.deepEqual(goal.engines, ['claude', 'codex'])
  assert.equal(out.folded, 1)
})
test('a shared pattern folds across locations and wordings (normKey); without one the title key needs the same location', () => {
  const out = foldFindings([
    F('TAX_RATE used as percent', 'cart.md:3', 'HIGH', 'claude', { pattern: 'TAX_RATE / 100' }),
    F('tax rate divided by 100', 'pricing.md:9', 'MEDIUM', 'codex', { pattern: 'TAX_RATE/100' }),
    F('Goal is not measurable', 'proposal.md:4', 'LOW', 'claude'),
    F('Goal is not measurable', 'design.md:4', 'LOW', 'codex'),
  ])
  assert.equal(out.findings.length, 3)
  const tax = out.findings.find((f) => f.pattern)
  assert.deepEqual(tax.engines, ['claude', 'codex']); assert.deepEqual(tax.locations, ['cart.md:3', 'pricing.md:9'])
})
test('different first words at one location stay apart; engine defaults to claude when missing', () => {
  const out = foldFindings([F('Missing non-goals', 'proposal.md:1', 'HIGH', 'claude'), F('Scope creep into billing', 'proposal.md:1', 'HIGH', 'codex'), { title: 'x', location: 'a.md', severity: 'LOW' }])
  assert.equal(out.findings.length, 3)
  assert.equal(out.findings[2].engine, 'claude'); assert.deepEqual(out.findings[2].engines, ['claude'])
})
test('CLI: stdin array → stdout {findings, folded}; a non-array is exit 1', () => {
  const r = spawnSync('node', [SCRIPT], { input: JSON.stringify([F('A b c d e', 'p.md:1', 'LOW', 'claude'), F('a B c d e f', 'p.md:1', 'LOW', 'codex')]), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.findings.length, 1); assert.equal(out.folded, 1)
  assert.equal(spawnSync('node', [SCRIPT], { input: '{"x":1}', encoding: 'utf8' }).status, 1)
})
