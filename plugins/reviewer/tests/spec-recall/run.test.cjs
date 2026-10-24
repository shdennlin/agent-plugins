// node --test plugins/reviewer/tests/spec-recall/run.test.cjs  (dry-run path only; no Claude)
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
const mkTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-recall-run-')); dirs.push(d); return d }
const write = (dir, name, obj) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(obj)); return p }

test('dry-run scores spec merged.json files against the six seeds, reads a sibling pre-verify merge, and writes summary.json', () => {
  const out = mkTmp()
  const hit = { id: 'F1', severity: 'MEDIUM', title: 'Storage picks SQLite with no alternative considered', location: 'openspec/changes/demo/design.md §Storage', locations: ['openspec/changes/demo/design.md §Storage'] }
  const noise = { id: 'F2', severity: 'LOW', title: 'typo', location: 'openspec/changes/demo/design.md §Context', locations: ['openspec/changes/demo/design.md §Context'] }
  write(out, 'a.pre-verify.json', { issues: [hit, noise], complete: true, verdict: 'FAIL' })
  const a = write(out, 'a.json', { issues: [hit], refuted: [{ ...noise, verified: 'refuted' }], verification: { checked: 2, confirmed: 1, refuted: 1, unverified: 0, not_checked: 0 }, complete: true, verdict: 'FAIL', counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 } })
  const r = spawnSync(process.execPath, [RUN, '--dry-run', a, path.join(out, 'missing.json'), '--out', out], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const s = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'))
  assert.equal(s.seeds, 6); assert.equal(s.okRuns, 1); assert.equal(s.runs[1].ok, false)
  assert.equal(s.perSeed['design-no-alternatives'].hits, 1)
  assert.equal(s.runs[0].refuted, 1); assert.equal(s.runs[0].before.extra, 1); assert.equal(s.runs[0].extra, 0); assert.equal(s.falseRefutation, 0)
  assert.match(r.stdout, /design-no-alternatives/); assert.match(r.stdout, /false refutation 0/)
})
test('--dry-run with no paths exits 1; the live prompt is built from the plugin dir name and targets /…:spec', () => {
  const r = spawnSync(process.execPath, [RUN, '--dry-run'], { encoding: 'utf8' })
  assert.equal(r.status, 1)
  const src = fs.readFileSync(RUN, 'utf8')
  assert.match(src, /pluginName\(opts\.pluginDir\)/); assert.match(src, /:spec openspec\/changes\/demo --no-explore/)
})
