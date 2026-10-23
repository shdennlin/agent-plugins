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
const { validateHistoryRow, normalizeChange } = require('../mcp/schema.cjs')

const SOURCES = ['spec', 'result', 'spec-dual']

function usage() {
  return `Usage: log-findings.cjs --change <name> --source <spec|result|spec-dual> [--round <N>] [--run-id <id>] <<'JSON'
  [ { "severity": "HIGH", "title": "...", "location": "path:fn", "category": "...", "engine": "claude",
      "engines": ["claude"], "locations": ["path:fn"], "pattern": "int(" } ]
JSON
engine: claude | codex | code-review | spectra-review | other:<skill>. Defaults: engines=[engine],
locations=[location], pattern=null, run_id from --run-id (else the row's, else null).`
}

function gitRoot(cwd) {
  try { return execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return cwd }
}
function historyPath(root) {
  return fs.existsSync(path.join(root, 'openspec')) ? path.join(root, 'openspec', 'reviews', 'history.jsonl') : path.join(root, '.claude', 'reviewer', 'history.jsonl')
}

// Complete one partial row into a v2 row (no validation here).
function completeRow(r, o, ts) {
  const row = r && typeof r === 'object' && !Array.isArray(r) ? r : {}
  const locs = row.locations === undefined || row.locations === null ? [row.location] : Array.isArray(row.locations) ? row.locations : [row.locations]
  return {
    v: 2, ts, change: normalizeChange(o.change), source: o.source, round: o.round,
    run_id: o.runId !== null ? o.runId : (typeof row.run_id === 'string' ? row.run_id : null),
    engine: row.engine === undefined ? '' : row.engine,
    engines: Array.isArray(row.engines) && row.engines.length ? row.engines.map(String) : [row.engine === undefined ? '' : row.engine],
    severity: row.severity, category: row.category, title: row.title, location: row.location,
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
  let bad = 0
  rows.forEach((row, i) => { for (const v of validateHistoryRow(row)) { bad++; process.stderr.write(`log-findings: row ${i} rejected: ${v}\n`) } })
  if (bad) { process.stderr.write(`log-findings: ${bad} violation(s); nothing appended\n`); return 1 }
  const root = gitRoot(process.cwd())
  const out = historyPath(root)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  if (rows.length) fs.appendFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
  process.stdout.write(`logged ${rows.length} finding(s) to ${path.relative(root, out)}\n`)
  return 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))
module.exports = { completeRow, historyPath }
