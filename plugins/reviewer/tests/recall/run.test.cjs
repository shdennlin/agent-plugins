// node --test plugins/reviewer/tests/recall/run.test.cjs  (dry-run path only; no Claude)
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('node:child_process')

const RUN = path.join(__dirname, 'run.mjs')
const dirs = []
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) })
const mkTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-run-')); dirs.push(d); return d }
const write = (dir, name, obj) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(obj)); return p }

test('dry-run scores given merged.json files and writes summary.json', () => {
  const out = mkTmp()
  const good = write(out, 'good.json', {
    issues: [{ title: 'None -> TypeError', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] }],
    complete: true, verdict: 'FAIL', counts: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 },
  })
  const r = spawnSync(process.execPath, [RUN, '--dry-run', good, path.join(out, 'missing.json'), '--out', out], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const s = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'))
  assert.equal(s.runs.length, 2)
  assert.equal(s.okRuns, 1)
  assert.equal(s.runs[1].ok, false)
  assert.equal(s.perSeed['type-none'].hits, 1)
  assert.equal(s.perSeed['type-none'].outOf, 1)
  assert.ok(Math.abs(s.meanRecall - 1 / s.seeds) < 1e-9, `meanRecall=${s.meanRecall} (one hit of ${s.seeds} seeds)`)
  assert.match(r.stdout, /type-none/)
})

test('--min-recall gates the exit code', () => {
  const out = mkTmp()
  const good = write(out, 'g.json', { issues: [], complete: true, verdict: 'PASS', counts: {} })
  const r = spawnSync(process.execPath, [RUN, '--dry-run', good, '--out', out, '--min-recall', '0.5'], { encoding: 'utf8' })
  assert.equal(r.status, 1)
  // exit 1 must come from the gate, not a crash: the summary was still written and the table printed
  assert.ok(fs.existsSync(path.join(out, 'summary.json')), 'summary.json written before gating')
  assert.match(r.stdout, /mean recall 0\.00/)
  assert.match(r.stderr, /below --min-recall/)
})

test('--dry-run with no paths exits 1 and never falls through to live runs', () => {
  const out = mkTmp()
  const r = spawnSync(process.execPath, [RUN, '--dry-run', '--out', out], { encoding: 'utf8', env: { ...process.env, PATH: '' } })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /--dry-run needs at least one merged.json/)
  assert.ok(!fs.existsSync(path.join(out, 'run-1.txt')), 'no live run started')
})

// --- batch G: verification effect in dry-run (a sibling <name>.pre-verify.json is the pre-verification merge)
test('dry-run reads <merged>.pre-verify.json beside each merged.json, reports extra before → after, refuted and false refutations, and exits 1 on a false refutation', () => {
  const out = mkTmp()
  const hit = { id: 'F1', title: 'None -> TypeError', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'], severity: 'HIGH' }
  const noise = { id: 'F2', title: 'style nit', location: 'src/report.py:build', locations: ['src/report.py:build'], severity: 'LOW' }
  write(out, 'clean.pre-verify.json', { issues: [hit, noise], complete: true, verdict: 'FAIL' })
  const clean = write(out, 'clean.json', { issues: [hit], refuted: [{ ...noise, verified: 'refuted' }], verification: { checked: 2, confirmed: 1, refuted: 1, unverified: 0, not_checked: 0 }, complete: true, verdict: 'FAIL', counts: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 } })
  const r = spawnSync(process.execPath, [RUN, '--dry-run', clean, '--out', out], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const s = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'))
  assert.equal(s.runs[0].refuted, 1); assert.deepEqual(s.runs[0].false_refutation, []); assert.equal(s.runs[0].before.extra, 1); assert.equal(s.runs[0].extra, 0)
  assert.equal(s.falseRefutation, 0); assert.equal(s.meanExtraBefore, 1)
  assert.match(r.stdout, /extra 1 → 0|1 → 0/)
  assert.match(r.stdout, /false refutation/i)
  const out2 = mkTmp()
  write(out2, 'bad.pre-verify.json', { issues: [hit], complete: true, verdict: 'FAIL' })
  const bad = write(out2, 'bad.json', { issues: [], refuted: [{ ...hit, verified: 'refuted' }], verification: { checked: 1, confirmed: 0, refuted: 1, unverified: 0, not_checked: 0 }, complete: true, verdict: 'PASS', counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } })
  const r2 = spawnSync(process.execPath, [RUN, '--dry-run', bad, '--out', out2], { encoding: 'utf8' })
  assert.equal(r2.status, 1, 'a false refutation fails the run')
  assert.match(r2.stdout + r2.stderr, /type-none/)
  const s2 = JSON.parse(fs.readFileSync(path.join(out2, 'summary.json'), 'utf8'))
  assert.deepEqual(s2.runs[0].false_refutation, ['type-none']); assert.equal(s2.falseRefutation, 1)
})
