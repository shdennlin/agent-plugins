// node --test plugins/reviewer/tests/fold-findings.test.cjs
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { foldFindings } = require('../scripts/fold-findings.cjs')
const SCRIPT = path.join(__dirname, '..', 'scripts', 'fold-findings.cjs')

const F = (title, location, severity, engine, extra = {}) => ({ title, location, severity, category: 'scope', engine, engines: [engine], ...extra })

test('two engines naming one defect at one location fold (same significant words); engines are unioned; worst severity survives', () => {
  const out = foldFindings([
    F('Goal is not measurable', 'proposal.md:4', 'MEDIUM', 'claude'),
    F('The goal not measurable!', 'proposal.md:4', 'HIGH', 'codex'),
    F('No rollback section', 'design.md:30', 'MEDIUM', 'claude'),
  ])
  assert.equal(out.findings.length, 2)
  const goal = out.findings.find((f) => f.location === 'proposal.md:4')
  assert.equal(goal.severity, 'HIGH'); assert.equal(goal.engine, 'claude'); assert.deepEqual(goal.engines, ['claude', 'codex'])
  assert.equal(out.folded, 1)
})
test('different defects at one location stay apart even when their titles open alike; agreement is never invented', () => {
  const out = foldFindings([
    F('Missing acceptance criteria for upload', 'specs/a/spec.md', 'HIGH', 'claude'),
    F('Missing acceptance criteria for download', 'specs/a/spec.md', 'HIGH', 'codex'),
  ])
  assert.equal(out.findings.length, 2)
  for (const f of out.findings) assert.equal(f.engines.length, 1)
})
test('a shared pattern folds across locations and wordings (normKey); a pattern-less twin at the same location+title joins the pattern group', () => {
  const out = foldFindings([
    F('TAX_RATE used as percent', 'cart.md:3', 'HIGH', 'claude', { pattern: 'TAX_RATE / 100' }),
    F('tax rate divided by 100', 'pricing.md:9', 'MEDIUM', 'codex', { pattern: 'TAX_RATE/100' }),
    F('Goal is not measurable', 'proposal.md:4', 'LOW', 'claude', { pattern: 'measurable goal' }),
    F('Goal is not measurable', 'proposal.md:4', 'LOW', 'codex'),
    F('Goal is not measurable', 'design.md:4', 'LOW', 'codex'),
  ])
  assert.equal(out.findings.length, 3)
  const tax = out.findings.find((f) => f.pattern === 'TAX_RATE / 100')
  assert.deepEqual(tax.engines, ['claude', 'codex']); assert.deepEqual(tax.locations, ['cart.md:3', 'pricing.md:9'])
  const goal = out.findings.find((f) => f.location === 'proposal.md:4')
  assert.deepEqual(goal.engines, ['claude', 'codex'], 'pattern-less twin folded into the pattern group')
})
test('outcome: escalated wins over the others in a fold; engine defaults to claude when missing', () => {
  const out = foldFindings([F('Missing non-goals', 'proposal.md:1', 'HIGH', 'claude', { outcome: 'fixed' }), F('Missing non-goals', 'proposal.md:1', 'LOW', 'codex', { outcome: 'escalated' }), { title: 'x', location: 'a.md', severity: 'LOW' }])
  assert.equal(out.findings.length, 2)
  assert.equal(out.findings[0].outcome, 'escalated')
  assert.equal(out.findings[1].engine, 'claude'); assert.deepEqual(out.findings[1].engines, ['claude'])
})
test('CLI: stdin array → stdout {findings, folded}; a non-array is exit 1', () => {
  const r = spawnSync('node', [SCRIPT], { input: JSON.stringify([F('A b c d e', 'p.md:1', 'LOW', 'claude'), F('a, B: c d e!', 'p.md:1', 'LOW', 'codex')]), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.findings.length, 1); assert.equal(out.folded, 1)
  assert.equal(spawnSync('node', [SCRIPT], { input: '{"x":1}', encoding: 'utf8' }).status, 1)
})
