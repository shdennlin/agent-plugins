#!/usr/bin/env node
// Seeded harness for /reviewer:spec. Builds a scratch Spectra repo with six seeded spec defects, runs
// the review headlessly N times, scores each run's merged.json against seeds.json and prints recall
// per run and per seed, plus what verification did. Exit 1 only for --min-recall or a false refutation.
//
//   node plugins/reviewer/tests/spec-recall/run.mjs [--runs 3] [--model sonnet] [--plugin-dir <abs>]
//        [--out <dir>] [--min-recall 0.0] [--keep] [--dry-run <merged.json>...]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const { buildFixture, SEEDS, CHANGE } = require('./fixture.cjs')
const { scoreRun } = require('./score.cjs')
const { pluginName } = require('../recall/plugin-name.cjs')
const { summarize, table, gate } = require('../recall/report.cjs')

const opts = { runs: 3, model: 'sonnet', pluginDir: path.resolve(HERE, '..', '..'), out: '', minRecall: null, keep: false, dryRun: [] }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  const next = () => { if (i + 1 >= argv.length) { console.error(`spec-recall: ${a} needs a value`); process.exit(1) } return argv[++i] }
  if (a === '--runs') opts.runs = Number(next())
  else if (a === '--model') opts.model = next()
  else if (a === '--plugin-dir') opts.pluginDir = path.resolve(next())
  else if (a === '--out') opts.out = path.resolve(next())
  else if (a === '--min-recall') opts.minRecall = Number(next())
  else if (a === '--keep') opts.keep = true
  else if (a === '--dry-run') { opts.dryRunSeen = true; while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opts.dryRun.push(path.resolve(argv[++i])) }
  else { console.error(`spec-recall: unknown argument: ${a}`); process.exit(1) }
}
if (opts.dryRunSeen && !opts.dryRun.length) { console.error('spec-recall: --dry-run needs at least one merged.json path'); process.exit(1) }
if (!opts.out) opts.out = path.join(os.tmpdir(), `reviewer-spec-recall-${new Date().toISOString().replace(/[:.]/g, '-')}`)
fs.mkdirSync(opts.out, { recursive: true })

const readJson = (f) => { try { return { json: JSON.parse(fs.readFileSync(f, 'utf8')), error: null } } catch (e) { return { json: null, error: e.message } } }
const preVerifyPath = (f) => f.replace(/\.json$/, '.pre-verify.json')
function newestMerged(repo) {
  const runs = path.join(repo, 'openspec', 'reviews', 'runs')
  if (!fs.existsSync(runs)) return null
  const dirs = fs.readdirSync(runs).filter((d) => fs.existsSync(path.join(runs, d, 'merged.json'))).sort()
  return dirs.length ? path.join(runs, dirs[dirs.length - 1], 'merged.json') : null
}
function toRun(n, mergedFile, extra = {}) {
  if (!mergedFile) return { run: n, ok: false, error: 'no merged.json', ...extra }
  const { json: merged, error } = readJson(mergedFile)
  if (!merged) return { run: n, ok: false, error, ...extra }
  const pre = fs.existsSync(preVerifyPath(mergedFile)) ? readJson(preVerifyPath(mergedFile)).json : null
  return { run: n, ok: true, file: mergedFile, ...scoreRun(merged, SEEDS, CHANGE, { preVerify: pre }), ...extra }
}
function liveRun(n) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `spec-recall-run${n}-`))
  const { repo } = buildFixture(tmp)
  const prompt = `/${pluginName(opts.pluginDir)}:spec openspec/changes/demo --no-explore`
  const t0 = Date.now()
  const r = spawnSync('claude', ['-p', prompt, '--plugin-dir', opts.pluginDir, '--model', opts.model, '--output-format', 'text', '--max-turns', '60'], { cwd: repo, encoding: 'utf8', timeout: 20 * 60 * 1000 })
  const seconds = Math.round((Date.now() - t0) / 1000)
  fs.writeFileSync(path.join(opts.out, `run-${n}.txt`), `${r.stdout || ''}\n--- stderr ---\n${r.stderr || ''}\nexit=${r.status}\n`)
  const mergedFile = newestMerged(repo)
  const kept = mergedFile ? path.join(opts.out, `run-${n}-merged.json`) : null
  if (mergedFile) fs.copyFileSync(mergedFile, kept)
  if (mergedFile && fs.existsSync(preVerifyPath(mergedFile))) fs.copyFileSync(preVerifyPath(mergedFile), preVerifyPath(kept))
  const result = toRun(n, kept, { seconds, claudeExit: r.status })
  if (!opts.keep) fs.rmSync(tmp, { recursive: true, force: true }); else result.repo = repo
  return result
}

const runs = opts.dryRun.length ? opts.dryRun.map((f, i) => toRun(i + 1, fs.existsSync(f) ? f : null)) : Array.from({ length: opts.runs }, (_, i) => liveRun(i + 1))
const summary = summarize(runs, SEEDS)
fs.writeFileSync(path.join(opts.out, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(table(summary))
console.log(`\nsummary: ${path.join(opts.out, 'summary.json')}`)
const why = gate(summary, runs, opts.minRecall)
if (why) { console.error(`spec-recall: ${why}`); process.exit(1) }
