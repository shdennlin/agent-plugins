#!/usr/bin/env node
// Seeded recall harness for /reviewer:result. Builds a scratch repo with known bugs, runs the
// review headlessly N times, scores each run's merged.json against seeds.json and prints recall
// per run and per seed. A measurement, not a gate: exit 0 unless --min-recall is given or
// verification refuted a seed hit (a false refutation always exits 1).
//
//   node plugins/reviewer/tests/recall/run.mjs [--runs 3] [--model sonnet]
//        [--angles coverage,robustness,correctness] [--plugin-dir <abs>] [--out <dir>]
//        [--min-recall 0.0] [--keep] [--dry-run <merged.json>...]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const { buildFixture, SEEDS } = require('./fixture.cjs')
const { scoreRun } = require('./score.cjs')

// ---- args ---------------------------------------------------------------------------------
const opts = { runs: 3, model: 'sonnet', angles: 'coverage,robustness,correctness',
  pluginDir: path.resolve(HERE, '..', '..'), out: '', minRecall: null, keep: false, dryRun: [] }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  const next = () => { if (i + 1 >= argv.length) { console.error(`recall: ${a} needs a value`); process.exit(1) } return argv[++i] }
  if (a === '--runs') opts.runs = Number(next())
  else if (a === '--model') opts.model = next()
  else if (a === '--angles') opts.angles = next()
  else if (a === '--plugin-dir') opts.pluginDir = path.resolve(next())
  else if (a === '--out') opts.out = path.resolve(next())
  else if (a === '--min-recall') opts.minRecall = Number(next())
  else if (a === '--keep') opts.keep = true
  else if (a === '--dry-run') { opts.dryRunSeen = true; while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opts.dryRun.push(path.resolve(argv[++i])) }
  else { console.error(`recall: unknown argument: ${a}`); process.exit(1) }
}
if (opts.dryRunSeen && !opts.dryRun.length) { console.error('recall: --dry-run needs at least one merged.json path'); process.exit(1) }
if (!opts.out) opts.out = path.join(os.tmpdir(), `reviewer-recall-${new Date().toISOString().replace(/[:.]/g, '-')}`)
fs.mkdirSync(opts.out, { recursive: true })

// ---- one run ------------------------------------------------------------------------------
function readMerged(file) {
  try { return { merged: JSON.parse(fs.readFileSync(file, 'utf8')), error: null } }
  catch (e) { return { merged: null, error: e.message } }
}

function newestMerged(repo) {
  const runs = path.join(repo, '.claude', 'reviewer', 'runs')
  if (!fs.existsSync(runs)) return null
  const dirs = fs.readdirSync(runs).filter(d => fs.existsSync(path.join(runs, d, 'merged.json'))).sort()
  return dirs.length ? path.join(runs, dirs[dirs.length - 1], 'merged.json') : null
}

// the pre-verification merge sits beside merged.json as merged.pre-verify.json (or <name>.pre-verify.json)
const preVerifyPath = (mergedFile) => mergedFile.replace(/\.json$/, '.pre-verify.json')
function toRun(n, mergedFile, extra = {}) {
  if (!mergedFile) return { run: n, ok: false, error: 'no merged.json', ...extra }
  const { merged, error } = readMerged(mergedFile)
  if (!merged) return { run: n, ok: false, error, ...extra }
  const pre = fs.existsSync(preVerifyPath(mergedFile)) ? readMerged(preVerifyPath(mergedFile)).merged : null
  return { run: n, ok: true, file: mergedFile, ...scoreRun(merged, SEEDS, { preVerify: pre }), ...extra }
}

function liveRun(n) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `recall-run${n}-`))
  const { repo } = buildFixture(tmp)
  const prompt = `/reviewer:result docs/spec.md --base main --angles ${opts.angles}`
  const t0 = Date.now()
  const r = spawnSync('claude', ['-p', prompt, '--plugin-dir', opts.pluginDir, '--model', opts.model,
    '--output-format', 'text', '--max-turns', '60'], { cwd: repo, encoding: 'utf8', timeout: 20 * 60 * 1000 })
  const seconds = Math.round((Date.now() - t0) / 1000)
  fs.writeFileSync(path.join(opts.out, `run-${n}.txt`), `${r.stdout || ''}\n--- stderr ---\n${r.stderr || ''}\nexit=${r.status}\n`)
  const mergedFile = newestMerged(repo)
  const kept = mergedFile ? path.join(opts.out, `run-${n}-merged.json`) : null
  if (mergedFile) fs.copyFileSync(mergedFile, kept)
  if (mergedFile && fs.existsSync(preVerifyPath(mergedFile))) fs.copyFileSync(preVerifyPath(mergedFile), preVerifyPath(kept))
  const spawnError = r.error ? `${r.error.code || ''} ${r.error.message || ''}`.trim() : (r.signal ? `signal ${r.signal}` : null)
  const result = toRun(n, kept, { seconds, claudeExit: r.status, ...(spawnError ? { spawnError } : {}) })
  if (!result.ok && spawnError) result.error = `${result.error} (${spawnError})`
  if (!opts.keep) fs.rmSync(tmp, { recursive: true, force: true }); else result.repo = repo
  return result
}

// ---- aggregate ----------------------------------------------------------------------------
export function summarize(runs, seeds) {
  const ok = runs.filter(r => r.ok)
  const perSeed = Object.fromEntries(seeds.map(s => [s.id, { kind: s.kind, hits: 0, partial: 0, matched: 0, outOf: ok.length }]))
  for (const r of ok) {
    for (const id of r.hits) perSeed[id].hits++
    for (const id of r.partial) perSeed[id].partial++
    for (const [id, n] of Object.entries(r.matched || {})) perSeed[id].matched += n
  }
  const recall = r => r.hits.length / seeds.length
  const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
  return {
    seeds: seeds.length, runs, okRuns: ok.length,
    meanRecall: mean(ok.map(recall)), meanExtra: mean(ok.map(r => r.extra)), perSeed,
    meanExtraBefore: mean(ok.filter(r => r.before).map(r => r.before.extra)),
    refuted: ok.reduce((a, r) => a + (r.refuted || 0), 0),
    falseRefutation: ok.reduce((a, r) => a + (r.false_refutation || []).length, 0),
    severity: ok.reduce((acc, r) => ({ exact: acc.exact + (r.severity?.exact || 0), within1: acc.within1 + (r.severity?.within1 || 0), n: acc.n + (r.severity?.n || 0) }), { exact: 0, within1: 0, n: 0 }),
  }
}

function table(summary) {
  const lines = ['run | ok | recall | hits | partial | extra (before → after) | refuted | false refutation | complete | verdict | seconds']
  for (const r of summary.runs) {
    const extra = r.ok ? (r.before ? `${r.before.extra} → ${r.extra}` : String(r.extra)) : '-'
    lines.push(r.ok
      ? `${r.run} | yes | ${(r.hits.length / summary.seeds).toFixed(2)} | ${r.hits.join(',') || '-'} | ${r.partial.join(',') || '-'} | ${extra} | ${r.refuted || 0} | ${(r.false_refutation || []).join(',') || '-'} | ${r.complete} | ${r.verdict}${r.seconds ? ` | ${r.seconds}s` : ''}`
      : `${r.run} | NO | - | - | - | - | - | - | - | ${r.error}`)
  }
  lines.push('', 'seed | kind | hits/outOf | partial | issues per hit')
  for (const [id, s] of Object.entries(summary.perSeed)) lines.push(`${id} | ${s.kind} | ${s.hits}/${s.outOf} | ${s.partial} | ${s.hits ? (s.matched / s.hits).toFixed(1) : '-'}`)
  lines.push('', `mean recall ${summary.meanRecall === null ? '-' : summary.meanRecall.toFixed(2)} over ${summary.okRuns} ok run(s); mean extra ${summary.meanExtra === null ? '-' : summary.meanExtra.toFixed(1)}`)
  const sv = summary.severity || { exact: 0, within1: 0, n: 0 }
  lines.push(`severity match over ${sv.n} hit seed(s): exact ${sv.n ? (sv.exact / sv.n).toFixed(2) : '-'}, within one level ${sv.n ? (sv.within1 / sv.n).toFixed(2) : '-'}`)
  lines.push(`verification: refuted ${summary.refuted || 0} issue(s); false refutation ${summary.falseRefutation || 0}; mean extra before ${summary.meanExtraBefore === null || summary.meanExtraBefore === undefined ? '-' : summary.meanExtraBefore.toFixed(1)} → after ${summary.meanExtra === null ? '-' : summary.meanExtra.toFixed(1)}`)
  return lines.join('\n')
}

// ---- main ---------------------------------------------------------------------------------
const runs = opts.dryRun.length
  ? opts.dryRun.map((f, i) => toRun(i + 1, fs.existsSync(f) ? f : null))
  : Array.from({ length: opts.runs }, (_, i) => liveRun(i + 1))
const summary = summarize(runs, SEEDS)
fs.writeFileSync(path.join(opts.out, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(table(summary))
console.log(`\nsummary: ${path.join(opts.out, 'summary.json')}`)
if (opts.minRecall !== null && (summary.meanRecall === null || summary.meanRecall < opts.minRecall)) {
  console.error(`recall: mean recall below --min-recall ${opts.minRecall}`)
  process.exit(1)
}
if (summary.falseRefutation > 0) {
  const names = [...new Set(runs.flatMap(r => r.false_refutation || []))]
  console.error(`recall: verification refuted ${summary.falseRefutation} seed hit(s): ${names.join(', ')} — recall lost to the verifier`)
  process.exit(1)
}
