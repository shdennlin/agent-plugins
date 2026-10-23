#!/usr/bin/env node
'use strict'
// Fold a round's union of findings (spec-dual: Claude angles + Codex) into one entry per defect
// before they are logged, with the same key the result merge uses:
//   - a `pattern` folds on merge-findings' normKey (whitespace, quotes and the statement around a
//     call do not matter), across files and wordings;
//   - without a pattern, the key is the location plus the first two significant title words, so
//     two engines wording one defect at one location fold and different defects stay apart.
// `engines` is the union of the raising engines; the worst severity's wording survives.
//
//   node fold-findings.cjs < findings.json   → {"findings":[...], "folded": N}
// stdin: a JSON array of {title, location, severity, category?, engine?, engines?, pattern?}.

const fs = require('node:fs')
const { normKey } = require('./merge-findings.cjs')

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
const rank = (s) => { const i = SEVERITIES.indexOf(String(s ?? '').toUpperCase()); return i === -1 ? SEVERITIES.length : i }
const STOP = new Set(['a', 'an', 'the', 'is', 'are', 'in', 'of', 'to', 'no', 'not', 'for', 'and', 'or', 'on', 'at', 'by', 'with', 'be', 'it', 'its', 'this', 'that'])
const titleKey = (title) => String(title ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).slice(0, 2).join(' ')
const locKey = (location) => String(location ?? '').trim().replace(/\s+/g, ' ')

function foldKey(f) {
  const pk = typeof f.pattern === 'string' ? normKey(f.pattern) : null
  if (pk !== null) return `p:${pk}`
  return `t:${locKey(f.location)}|${titleKey(f.title)}`
}

function foldFindings(findings) {
  const groups = new Map()
  for (const raw of findings) {
    const f = { ...raw }
    f.engine = typeof f.engine === 'string' && f.engine ? f.engine : 'claude'
    f.engines = Array.isArray(f.engines) && f.engines.length ? [...f.engines] : [f.engine]
    const k = foldKey(f)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(f)
  }
  let folded = 0
  const out = []
  for (const g of groups.values()) {
    const worst = g.reduce((a, b) => (rank(b.severity) < rank(a.severity) ? b : a))
    const engines = [...new Set(g.flatMap((f) => f.engines))].sort()
    const locations = [...new Set(g.map((f) => locKey(f.location)).filter(Boolean))]
    // history vocabulary: agreement is the engines list and `engine` is the primary (claude when it raised it)
    const entry = { ...worst, engines, engine: engines.includes('claude') ? 'claude' : engines[0] }
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
