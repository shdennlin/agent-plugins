#!/usr/bin/env node
// Rewrite a v1 history.jsonl into schema-v2 rows (mcp/schema.cjs HISTORY_ROW), in place, behind --dry-run.
//   node migrate-history.cjs <history.jsonl> [--dry-run] [--second-engine <name>]
// Maps: engine '' or 'claude-result' → claude; 'both' → engine claude + engines [claude, <second-engine>]
// (without --second-engine: [claude] and a stderr count); round → integer; change normalized; locations
// defaults to [location]; pattern/run_id null; v 2. Rows already at v 2 and rows that cannot validate
// after mapping (unknown severity, empty title…) are kept verbatim; the latter are counted as unmigratable
// with their line numbers on stderr and make the exit status 1. A real run writes <file>.v1.bak first and
// refuses to run when that backup already exists. Never run this against a file you have not backed up.
'use strict'
const fs = require('fs')
const { validateHistoryRow, normalizeChange, ENGINES } = require('../mcp/schema.cjs')

function migrateRow(row, opts) {
  const n = { engineEmpty: 0, claudeResult: 0, both: 0, roundInt: 0, changeNorm: 0 }
  if (row && row.v === 2) return { row, already: true, n }
  const r = { ...row }
  let engine = typeof r.engine === 'string' ? r.engine : ''
  let engines
  if (engine === '') { engine = 'claude'; n.engineEmpty = 1 }
  else if (engine === 'claude-result') { engine = 'claude'; n.claudeResult = 1 }
  else if (engine === 'both') { engine = 'claude'; engines = opts.secondEngine ? ['claude', opts.secondEngine] : ['claude']; n.both = 1 }
  if (!ENGINES.includes(engine) && !/^other:/.test(engine)) engine = `other:${engine}`
  const round = typeof r.round === 'number' ? r.round : (/^\d+$/.test(String(r.round)) ? Number(r.round) : r.round)
  if (typeof r.round !== 'number' && typeof round === 'number') n.roundInt = 1
  const change = normalizeChange(r.change)
  if (change !== r.change) n.changeNorm = 1
  const locs = Array.isArray(r.locations) && r.locations.length ? r.locations.map(String) : (r.location ? [String(r.location)] : [])
  const out = {
    v: 2, ts: r.ts, change, source: r.source, round, run_id: typeof r.run_id === 'string' ? r.run_id : null,
    engine, engines: engines || [engine], severity: r.severity, category: r.category, title: r.title, location: r.location,
    locations: locs, pattern: typeof r.pattern === 'string' && r.pattern.trim() ? r.pattern : null,
  }
  return { row: out, already: false, n }
}

function main(argv) {
  let file = null, dryRun = false, secondEngine = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') dryRun = true
    else if (argv[i] === '--second-engine') secondEngine = argv[++i]
    else if (argv[i].startsWith('--')) { process.stderr.write(`migrate-history: unknown argument ${argv[i]}\n`); return 1 }
    else file = argv[i]
  }
  if (!file) { process.stderr.write('migrate-history: <history.jsonl> is required\n'); return 1 }
  if (secondEngine && !ENGINES.includes(secondEngine) && !/^other:/.test(secondEngine)) { process.stderr.write(`migrate-history: --second-engine must be one of ${ENGINES.join(', ')} or other:<skill>\n`); return 1 }
  const bak = file + '.v1.bak'
  if (!dryRun && fs.existsSync(bak)) { process.stderr.write(`migrate-history: ${bak} already exists; refusing to overwrite a backup\n`); return 1 }
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split('\n')
  const totals = { rows: 0, migrated: 0, already: 0, engineEmpty: 0, claudeResult: 0, both: 0, roundInt: 0, changeNorm: 0, unmigratable: 0 }
  const out = lines.map((line, idx) => {
    if (!line.trim()) return line
    totals.rows++
    let row
    try { row = JSON.parse(line) } catch (e) { totals.unmigratable++; process.stderr.write(`migrate-history: line ${idx + 1}: not JSON (${e.message}); kept verbatim\n`); return line }
    const { row: m, already, n } = migrateRow(row, { secondEngine })
    if (already) { totals.already++; return line }
    const v = validateHistoryRow(m)
    if (v.length) { totals.unmigratable++; process.stderr.write(`migrate-history: line ${idx + 1}: ${v.join('; ')}; kept verbatim\n`); return line }
    totals.migrated++; for (const k of Object.keys(n)) totals[k] += n[k]
    return JSON.stringify(m)
  })
  if (totals.both && !secondEngine) process.stderr.write(`migrate-history: ${totals.both} 'both' row(s) kept engines [claude]: pass --second-engine <name> to record the second engine\n`)
  process.stdout.write(`rows: ${totals.rows}, migrated: ${totals.migrated}, already-v2: ${totals.already}, engine '' → claude: ${totals.engineEmpty}, claude-result → claude: ${totals.claudeResult}, both → engines: ${totals.both} (second engine: ${secondEngine || 'unknown'}), round→int: ${totals.roundInt}, change normalized: ${totals.changeNorm}, unmigratable: ${totals.unmigratable}${dryRun ? ' [dry-run, nothing written]' : ''}\n`)
  if (!dryRun) { fs.writeFileSync(bak, text); fs.writeFileSync(file, out.join('\n')) }
  return totals.unmigratable ? 1 : 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))
module.exports = { migrateRow }
