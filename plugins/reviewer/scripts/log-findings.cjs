#!/usr/bin/env node
// Append review findings (JSON array on stdin) to the project's review history JSONL as
// schema-v2 rows (mcp/schema.cjs HISTORY_ROW). Every row is completed (v, ts, normalized change,
// source, integer round, run_id, engines, locations, pattern) and validated; one invalid row rejects
// the whole batch (nothing is appended). Target: <git-root>/openspec/reviews/history.jsonl when
// openspec/ exists, else <git-root>/.claude/reviewer/history.jsonl.
//
//   log-findings.cjs --change <id> --source <spec|result|spec-dual> [--round <N>] [--run-id <id>] < rows.json
'use strict'
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { validateHistoryRow, normalizeChange, ENGINES } = require('../mcp/schema.cjs')

const SOURCES = ['spec', 'result', 'spec-dual']

function usage() {
  return `Usage: log-findings.cjs --change <name> --source <spec|result|spec-dual> [--round <N>] [--run-id <id>] <<'JSON'
  [ { "severity": "HIGH", "title": "...", "location": "path:fn", "category": "...", "engine": "claude",
      "engines": ["claude"], "locations": ["path:fn"], "pattern": "int(" } ]
JSON
engine: claude | codex | code-review | spectra-review | other:<skill> (unknown names become other:<name>;
missing → claude for spec/result). Defaults: engines=[engine],
locations=[location], pattern=null, run_id from --run-id (else the row's, else null).`
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

// Complete one partial row into a v2 row (normalization only; validation happens afterwards).
function completeRow(r, o, ts) {
  const row = r && typeof r === 'object' && !Array.isArray(r) ? r : {}
  const locs = row.locations === undefined || row.locations === null ? [row.location] : Array.isArray(row.locations) ? row.locations : [row.locations]
  const engine = normalizeEngine(row.engine, o.source)
  const rest = (Array.isArray(row.engines) ? row.engines : []).map((e) => normalizeEngine(e, o.source)).filter((e) => e && e !== engine)
  return {
    v: 2, ts, change: normalizeChange(o.change), source: o.source, round: o.round,
    run_id: o.runId !== null ? o.runId : (typeof row.run_id === 'string' ? row.run_id : null),
    engine,
    engines: [engine, ...new Set(rest)].filter(Boolean),
    severity: typeof row.severity === 'string' ? row.severity.toUpperCase() : row.severity,
    category: row.category, title: row.title, location: row.location,
    locations: locs.map((l) => String(l)),
    pattern: typeof row.pattern === 'string' && row.pattern.trim() ? row.pattern : null,
  }
}

function parseArgs(argv) {
  const o = { change: null, source: null, round: 1, runId: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--change') o.change = argv[++i]
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
module.exports = { completeRow, historyPath }
