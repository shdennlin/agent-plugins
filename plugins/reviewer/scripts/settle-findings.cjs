#!/usr/bin/env node
'use strict'
// Settle history rows after the human decided: list the rows of a run or a change, or rewrite the
// `outcome` of matching escalated/open rows in place (escalated → fixed | dismissed | residual).
// Nothing else in a row changes; rows already settled are counted as `left` and untouched.
//
//   settle-findings.cjs (--run-id <id> | --change <id>) [--title <substring>] --list
//   settle-findings.cjs (--run-id <id> | --change <id>) [--title <substring>] --set <fixed|dismissed|residual> [--all-matching] [--dry-run]
// The history file is <git-root>/openspec/reviews/history.jsonl when openspec/ exists, else
// <git-root>/.claude/reviewer/history.jsonl (read-rules.cjs --paths).

const fs = require('fs')
const path = require('path')
const { resolvePaths } = require('./read-rules.cjs')
const { normalizeChange, validateHistoryRow } = require('../mcp/schema.cjs')

const SETTLE_TO = ['fixed', 'dismissed', 'residual']
const SETTLE_FROM = ['escalated', 'open']

function parseArgs(argv) {
  const o = { runId: null, change: null, title: null, list: false, set: null, all: false, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--run-id') o.runId = argv[++i]
    else if (a === '--change') o.change = normalizeChange(argv[++i] ?? '')
    else if (a === '--title') o.title = String(argv[++i] ?? '').toLowerCase()
    else if (a === '--list') o.list = true
    else if (a === '--set') { o.set = argv[++i]; if (!SETTLE_TO.includes(o.set)) throw new Error(`--set must be one of ${SETTLE_TO.join(', ')} (got ${JSON.stringify(o.set)})`) }
    else if (a === '--all-matching') o.all = true
    else if (a === '--dry-run') o.dryRun = true
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!o.runId && !o.change) throw new Error('--run-id or --change is required')
  if (!o.list && !o.set) throw new Error('--list or --set <outcome> is required')
  return o
}

const fmt = (r, n) => `${n}. ${r.outcome} ${r.severity} ${r.title} (${r.location})`

function main(argv) {
  let o
  try { o = parseArgs(argv) } catch (e) { process.stderr.write(`settle-findings: ${e.message}\n`); return 1 }
  const file = resolvePaths(process.cwd()).history_path
  if (!fs.existsSync(file)) { process.stderr.write(`settle-findings: no history at ${file}\n`); return 1 }
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split('\n')
  const parsed = lines.map((l) => { if (!l.trim()) return null; try { return JSON.parse(l) } catch { return null } })
  const matches = []
  parsed.forEach((r, i) => {
    if (!r) return
    if (o.runId && r.run_id !== o.runId) return
    if (o.change && normalizeChange(r.change) !== o.change) return
    if (o.title && !String(r.title ?? '').toLowerCase().includes(o.title)) return
    matches.push(i)
  })
  if (o.list) {
    process.stdout.write(matches.map((i, k) => fmt(parsed[i], k + 1)).join('\n') + (matches.length ? '\n' : ''))
    return 0
  }
  if (matches.length > 1 && !o.all) {
    process.stderr.write(`settle-findings: ${matches.length} rows match${o.title ? ` --title ${JSON.stringify(o.title)}` : ''}; pass --all-matching to settle them all:\n${matches.map((i, k) => '  ' + fmt(parsed[i], k + 1)).join('\n')}\n`)
    return 1
  }
  let settled = 0, left = 0
  for (const i of matches) {
    const r = parsed[i]
    if (!SETTLE_FROM.includes(r.outcome)) { left++; continue }
    const next = { ...r, outcome: o.set }
    const v = validateHistoryRow(next)
    if (v.length) { process.stderr.write(`settle-findings: line ${i + 1} would not validate after the change (${v.join('; ')}); left as is\n`); left++; continue }
    lines[i] = JSON.stringify(next)
    settled++
  }
  if (!o.dryRun && settled) {
    const tmp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(tmp, lines.join('\n'))
    fs.renameSync(tmp, file)
  }
  process.stdout.write(`settled ${settled} row(s) → ${o.set} (left ${left})${o.dryRun ? ' [dry-run, nothing written]' : ''}\n`)
  return 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))
module.exports = { parseArgs }
