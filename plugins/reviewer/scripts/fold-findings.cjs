#!/usr/bin/env node
'use strict'
// Fold a round's union of findings (spec-dual: Claude angles + Codex) into one entry per defect
// before they are logged, with the same key the result merge uses:
//   - a `pattern` folds on merge-findings' normKey (whitespace, quotes and the statement around a
//     call do not matter), across files and wordings;
//   - otherwise the key is the location plus every significant title word, so two engines naming one
//     defect at one location fold and different defects ("…for upload" / "…for download") stay apart;
//   - a pattern-less finding whose location+title matches a pattern-bearing one joins that group.
// `outcome`: escalated if any member is, else the worst member's.
// `engines` is the union of the raising engines; the worst severity's wording survives.
//
//   node fold-findings.cjs < findings.json   → {"findings":[...], "folded": N}
// stdin: a JSON array of {title, location, severity, category?, engine?, engines?, pattern?}.

const fs = require('node:fs')
const { normKey } = require('./merge-findings.cjs')

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
const rank = (s) => { const i = SEVERITIES.indexOf(String(s ?? '').toUpperCase()); return i === -1 ? SEVERITIES.length : i }
const STOP = new Set(['a', 'an', 'the', 'is', 'are', 'in', 'of', 'to', 'no', 'not', 'for', 'and', 'or', 'on', 'at', 'by', 'with', 'be', 'it', 'its', 'this', 'that'])
// every significant word of the title, in order: two engines naming one defect at one location agree on
// these; "…for upload" and "…for download" do not
const titleKey = (title) => String(title ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).join(' ')
const locKey = (location) => String(location ?? '').trim().replace(/\s+/g, ' ')
const tKey = (f) => `t:${locKey(f.location)}|${titleKey(f.title)}`
const pKey = (f) => { const k = typeof f.pattern === 'string' ? normKey(f.pattern) : null; return k === null ? null : `p:${k}` }
function foldKey(f) { return pKey(f) || tKey(f) }

// outcome of a fold: a member in the human's hands keeps the row escalated; otherwise the worst member's
const OUTCOME_RANK = ['escalated', 'fixed', 'residual', 'open', 'dismissed', 'unknown']
const outcomeOf = (g, worst) => {
  if (g.some((f) => f.outcome === 'escalated')) return 'escalated'
  return typeof worst.outcome === 'string' && OUTCOME_RANK.includes(worst.outcome) ? worst.outcome : undefined
}

// Union-find over keys: a finding joins its pattern group; its location+title group joins the same
// group, so a pattern-less twin (the other engine gave no pattern) lands with it.
function foldFindings(findings) {
  const parent = new Map()
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k) } return k }
  const add = (k) => { if (!parent.has(k)) parent.set(k, k) }
  const union = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
  const prepared = findings.map((raw) => {
    const f = { ...raw }
    f.engine = typeof f.engine === 'string' && f.engine ? f.engine : 'claude'
    f.engines = Array.isArray(f.engines) && f.engines.length ? [...f.engines] : [f.engine]
    const t = tKey(f), pk = pKey(f)
    add(t); if (pk) union(t, pk)
    return f
  })
  const groups = new Map()
  for (const f of prepared) {
    const root = find(pKey(f) || tKey(f))
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(f)
  }
  let folded = 0
  const out = []
  for (const g of groups.values()) {
    const worst = g.reduce((a, b) => (rank(b.severity) < rank(a.severity) ? b : a))
    const engines = [...new Set(g.flatMap((f) => f.engines))].sort()
    const locations = [...new Set(g.map((f) => locKey(f.location)).filter(Boolean))]
    // history vocabulary: agreement is the engines list and `engine` is the primary (claude when it raised it)
    const entry = { ...worst, engines, engine: engines.includes('claude') ? 'claude' : engines[0] }
    const outcome = outcomeOf(g, worst)
    if (outcome) entry.outcome = outcome
    if (!entry.pattern) { const withP = g.find((f) => typeof f.pattern === 'string' && f.pattern); if (withP) entry.pattern = withP.pattern }
    if (locations.length > 1) entry.locations = locations
    if (g.length > 1) entry.folded = g.length - 1
    folded += g.length - 1
    out.push(entry)
  }
  return { findings: out, folded }
}

function main() {
  let input
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')) } catch (e) { process.stderr.write(`fold-findings: stdin is not JSON: ${e.message}\n`); process.exit(1) }
  if (!Array.isArray(input)) { process.stderr.write('fold-findings: stdin must be a JSON array of findings\n'); process.exit(1) }
  process.stdout.write(JSON.stringify(foldFindings(input)) + '\n')
}

module.exports = { foldFindings, foldKey, titleKey }
if (require.main === module) main()
