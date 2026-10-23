#!/usr/bin/env node
// Append review findings (JSON array on stdin) to the project's review history JSONL as
// schema-v3 rows (mcp/schema.cjs HISTORY_ROW). Every row is completed (v, ts, normalized change,
// source, integer round, run_id, engines, structured locations, pattern, outcome) and validated;
// an invalid row is dropped and named, the rest are appended. Target:
// <git-root>/openspec/reviews/history.jsonl when openspec/ exists, else <git-root>/.claude/reviewer/history.jsonl.
//
//   log-findings.cjs --change <id> --source <spec|result|spec-dual> [--round <N>] [--run-id <id>]
//                    [--outcome <default>] [--outcomes <file.json>] < rows.json
// --outcome: the outcome for rows that carry none (default unknown). --outcomes: a JSON array of
// {title, location, outcome} (what the fixer applied / the human escalated); a row matching on
// title + location (else title) takes that outcome.
'use strict'
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { validateHistoryRow, normalizeChange, ENGINES, OUTCOMES } = require('../mcp/schema.cjs')

const SOURCES = ['spec', 'result', 'spec-dual']

function usage() {
  return `Usage: log-findings.cjs --change <name> --source <spec|result|spec-dual> [--round <N>] [--run-id <id>] [--outcome <o>] [--outcomes <file>] <<'JSON'
  [ { "severity": "HIGH", "title": "...", "location": "path:fn", "category": "...", "engine": "claude",
      "engines": ["claude"], "locations": ["path:fn"], "pattern": "int(", "outcome": "open" } ]
JSON
engine: claude | codex | code-review | spectra-review | other:<skill> (unknown names become other:<name>;
missing → claude for spec/result). Defaults: engines=[engine],
locations=[location] (each parsed into {path, line|endLine|symbol|section|raw}), pattern=null,
run_id from --run-id (else the row's, else null), outcome from the row, else --outcomes, else --outcome, else unknown.`
}

function gitRoot(cwd) {
  try { return execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return cwd }
}
function historyPath(root) {
  return fs.existsSync(path.join(root, 'openspec')) ? path.join(root, 'openspec', 'reviews', 'history.jsonl') : path.join(root, '.claude', 'reviewer', 'history.jsonl')
}

// Engine names as stored: the closed vocabulary, the retired aliases mapped, anything else → other:<lowercased>.
const LEGACY = { 'claude-result': 'claude', '': null }
function normalizeEngine(e, source) {
  let v = typeof e === 'string' ? e.trim() : ''
  if (v in LEGACY) v = LEGACY[v]
  if (!v) return ['spec', 'result'].includes(source) ? 'claude' : ''   // spec-dual rows must say which engine
  v = v.toLowerCase()
  if (ENGINES.includes(v) || /^other:/.test(v)) return v
  return `other:${v}`
}

// `path:12` (or `:L12`) → line, `path:12-20` → line/endLine, `path:name` / `name()` / `A::b` → symbol, `path §heading` → section,
// `path` alone → path; anything else keeps the whole string as the path and in `raw`.
function parseLocation(loc) {
  const s = String(loc ?? '').trim()
  const sec = s.indexOf(' §')
  if (sec !== -1) {
    const path = s.slice(0, sec).trim(), section = s.slice(sec + 2).trim()
    if (path && section && !path.includes(':')) return { path, section }
    return { path: s, raw: s }
  }
  const i = s.indexOf(':')
  if (i === -1) return s ? { path: s } : { path: s, raw: s }
  const path = s.slice(0, i), detail = s.slice(i + 1)
  let m
  if (path && (m = detail.match(/^L?(\d+)$/))) return { path, line: Number(m[1]) }
  if (path && (m = detail.match(/^L?(\d+)-L?(\d+)$/))) return { path, line: Number(m[1]), endLine: Number(m[2]) }
  if (path && (m = detail.match(/^([A-Za-z_$][\w.$]*(?:::[A-Za-z_$][\w.$]*)*)(?:\(\))?$/))) return { path, symbol: m[1] }
  return { path: s, raw: s }
}
const keyOf = (title, location) => `${String(title ?? '').trim().toLowerCase()}|${String(location ?? '').trim()}`
function outcomeFor(row, o) {
  if (typeof row.outcome === 'string' && row.outcome) return row.outcome
  if (o.outcomes) {
    const hit = o.outcomes.get(keyOf(row.title, row.location))
    if (hit) return hit
    const byTitle = o.outcomesByTitle.get(String(row.title ?? '').trim().toLowerCase())
    if (byTitle) return byTitle
  }
  return o.outcome
}

// Complete one partial row into a v3 row (normalization only; validation happens afterwards).
function completeRow(r, o, ts) {
  const row = r && typeof r === 'object' && !Array.isArray(r) ? r : {}
  const locs = row.locations === undefined || row.locations === null ? [row.location] : Array.isArray(row.locations) ? row.locations : [row.locations]
  const engine = normalizeEngine(row.engine, o.source)
  const rest = (Array.isArray(row.engines) ? row.engines : []).map((e) => normalizeEngine(e, o.source)).filter((e) => e && e !== engine)
  return {
    v: 3, ts, change: normalizeChange(o.change), source: o.source, round: o.round,
    run_id: o.runId !== null ? o.runId : (typeof row.run_id === 'string' ? row.run_id : null),
    engine,
    engines: [engine, ...new Set(rest)].filter(Boolean),
    severity: typeof row.severity === 'string' ? row.severity.toUpperCase() : row.severity,
    category: row.category, title: row.title, location: row.location,
    locations: locs.map((l) => (l && typeof l === 'object' && !Array.isArray(l) ? l : parseLocation(l))),
    pattern: typeof row.pattern === 'string' && row.pattern.trim() ? row.pattern : null,
    outcome: outcomeFor(row, o),
  }
}

function parseArgs(argv) {
  const o = { change: null, source: null, round: 1, runId: null, outcome: 'unknown', outcomes: null, outcomesByTitle: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--change') o.change = argv[++i]
    else if (a === '--outcome') { const v = argv[++i]; if (!OUTCOMES.includes(v)) throw new Error(`--outcome must be one of: ${OUTCOMES.join(', ')} (got ${JSON.stringify(v)})`); o.outcome = v }
    else if (a === '--outcomes') {
      const f = argv[++i]
      let arr
      try { arr = JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { throw new Error(`--outcomes ${f}: ${e.message}`) }
      if (!Array.isArray(arr)) throw new Error(`--outcomes ${f}: must hold a JSON array of {title, location, outcome}`)
      o.outcomes = new Map(); o.outcomesByTitle = new Map()
      for (const x of arr) {
        if (!x || typeof x !== 'object' || !OUTCOMES.includes(x.outcome)) throw new Error(`--outcomes ${f}: every entry needs an outcome in ${OUTCOMES.join(', ')}`)
        o.outcomes.set(keyOf(x.title, x.location), x.outcome)
        o.outcomesByTitle.set(String(x.title ?? '').trim().toLowerCase(), x.outcome)
      }
    }
    else if (a === '--source') o.source = argv[++i]
    else if (a === '--round') { const v = argv[++i]; if (!/^\d+$/.test(String(v))) throw new Error(`--round must be a positive integer (got ${JSON.stringify(v)})`); o.round = Number(v) }
    else if (a === '--run-id') o.runId = argv[++i]
    else if (a === '-h' || a === '--help') { process.stdout.write(usage() + '\n'); process.exit(0) }
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!o.change || !o.source) throw new Error('--change and --source are required')
  if (!SOURCES.includes(o.source)) throw new Error(`--source must be one of: ${SOURCES.join(', ')} (got: ${o.source})`)
  return o
}

function main(argv) {
  let o
  try { o = parseArgs(argv) } catch (e) { process.stderr.write(`log-findings: ${e.message}\n${usage()}\n`); return 1 }
  const input = fs.readFileSync(0, 'utf8')
  if (!input.trim()) { process.stderr.write('log-findings: empty stdin, nothing to log\n'); return 1 }
  let arr
  try { arr = JSON.parse(input) } catch (e) { process.stderr.write(`log-findings: stdin is not JSON: ${e.message}\n`); return 1 }
  if (!Array.isArray(arr)) { process.stderr.write('log-findings: stdin is not a JSON array\n'); return 1 }
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const rows = arr.map((r) => completeRow(r, o, ts))
  // Row-level: a weak row is dropped and named, the rest of the batch is still appended, so one
  // malformed finding never costs the run its history. A batch with rows and no valid one exits 1.
  const kept = []
  let rejected = 0
  rows.forEach((row, i) => {
    const v = validateHistoryRow(row)
    if (v.length) { rejected++; process.stderr.write(`log-findings: row ${i} rejected: ${v.join('; ')}\n`); return }
    kept.push(row)
  })
  if (rows.length && !kept.length) { process.stderr.write(`log-findings: every row rejected; nothing appended\n`); return 1 }
  const root = gitRoot(process.cwd())
  const out = historyPath(root)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  if (kept.length) fs.appendFileSync(out, kept.map((r) => JSON.stringify(r)).join('\n') + '\n')
  process.stdout.write(`logged ${kept.length} finding(s) to ${path.relative(root, out)}${rejected ? ` (${rejected} rejected)` : ''}\n`)
  return 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))
module.exports = { completeRow, historyPath, parseLocation }
