// node --test plugins/reviewer/tests/resolve-engine.test.cjs — scripts/resolve-engine.cjs (the -c lookup, pure + CLI)
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { resolveEngine, parseEngines } = require('../scripts/resolve-engine.cjs')

const YAML = fs.readFileSync(path.join(__dirname, '..', 'templates', 'review-engines.yaml'), 'utf8')
const SCRIPT = path.join(__dirname, '..', 'scripts', 'resolve-engine.cjs')
const man = (strategy, base_name) => ({ diff_strategy: strategy, base_name })

test('parseEngines reads every entry with its fields, lists, maps and folded text', () => {
  const e = parseEngines(YAML)
  assert.deepEqual(Object.keys(e).sort(), ['_default', 'code-review', 'spectra-review'])
  assert.deepEqual(e['code-review'].levels, ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(e['code-review'].never_pass, ['--fix', '--comment'])
  assert.equal(e['code-review'].severity_map.CONFIRMED, 'medium')
  assert.equal(e['spectra-review'].scope, 'self'); assert.equal(e['spectra-review'].base_arg, ' --base <base>')
  assert.ok(e['spectra-review'].findings_from.includes('Findings'))
  assert.ok(Array.isArray(e['code-review'].notes) && e['code-review'].notes.length === 2)
})
test('a level token selects code-review with that level and the manifest base', () => {
  const r = resolveEngine({ token: 'medium', specPaths: ['openspec/changes/x/'], manifest: man('develop...HEAD', 'develop') }, YAML)
  assert.equal(r.engine, 'code-review'); assert.equal(r.level, 'medium'); assert.equal(r.skill, 'code-review')
  assert.equal(r.args, 'medium develop --max-findings all'); assert.deepEqual(r.base, { name: 'develop', given: false }); assert.equal(r.change_name, 'x'); assert.equal(r.scope, 'base')
})
test('spectra-review resolves its own scope; --base is appended only when given', () => {
  const a = resolveEngine({ token: 'spectra-review', specPaths: ['openspec/changes/x/'], manifest: man('develop...HEAD', 'develop') }, YAML)
  assert.equal(a.args, 'x'); assert.equal(a.scope, 'self'); assert.equal(a.level, null)
  const b = resolveEngine({ token: 'spectra-review', specPaths: ['openspec/changes/x/'], base: 'develop', manifest: man('develop...HEAD', 'develop') }, YAML)
  assert.equal(b.args, 'x --base develop'); assert.deepEqual(b.base, { name: 'develop', given: true })
})
test('an unknown skill uses _default with skill = token; change_name falls back to the first spec path', () => {
  const r = resolveEngine({ token: 'pr-review-toolkit:review-pr', specPaths: ['docs/spec.md'], manifest: man('main...HEAD', 'main') }, YAML)
  assert.equal(r.engine, 'pr-review-toolkit:review-pr'); assert.equal(r.skill, 'pr-review-toolkit:review-pr'); assert.equal(r.args, 'main'); assert.equal(r.change_name, 'docs/spec.md')
  assert.deepEqual(r.never_pass, ['--fix', '--comment', '--apply', '--write'])
})
test('errors: level on a level-less engine, missing level, missing base without manifest', () => {
  assert.throws(() => resolveEngine({ token: 'high', specPaths: ['x'], manifest: man('main...HEAD', 'main') }, YAML.replace(/^    levels: \[.*\]\n/m, '')), /level 'high'.*no engine/)
  assert.throws(() => resolveEngine({ token: 'code-review', specPaths: ['x'], manifest: man('main...HEAD', 'main') }, YAML), /needs a level/)
  assert.throws(() => resolveEngine({ token: 'medium', specPaths: ['x'] }, YAML), /base.*--base|--manifest/)
})
test('CLI prints the JSON and exits 1 with a reason on error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 're-')); const mf = path.join(dir, 'manifest.json'); fs.writeFileSync(mf, JSON.stringify(man('develop...HEAD', 'develop')))
  const ok = spawnSync('node', [SCRIPT, '--token', 'spectra-review', '--spec', 'openspec/changes/y/', '--manifest', mf], { encoding: 'utf8' })
  assert.equal(ok.status, 0, ok.stderr); assert.equal(JSON.parse(ok.stdout).args, 'y')
  const bad = spawnSync('node', [SCRIPT, '--token', 'code-review', '--spec', 'x', '--manifest', mf], { encoding: 'utf8' })
  assert.equal(bad.status, 1); assert.match(bad.stderr, /^resolve-engine: /)
})

// --- batch D review fixes
test('--check validates the token up front: charset, _default, and level-required engines', () => {
  for (const bad of ['Medium', '_default', 'foo$(id)', 'code-review']) assert.throws(() => resolveEngine({ token: bad, check: true }, YAML), new RegExp(bad.replace(/[$()]/g, '\\$&')), bad)
  assert.deepEqual(resolveEngine({ token: 'medium', check: true }, YAML), { engine: 'code-review', level: 'medium', ok: true })
  assert.deepEqual(resolveEngine({ token: 'spectra-review', check: true }, YAML), { engine: 'spectra-review', level: null, ok: true })
})
test('WORKTREE with a base-scoped engine yields no args and a skip reason; self-scoped engines still run', () => {
  const r = resolveEngine({ token: 'medium', specPaths: ['x'], manifest: man('WORKTREE', '') }, YAML)
  assert.equal(r.args, null); assert.match(r.skip_reason, /HEAD is on the base branch/)
  const s = resolveEngine({ token: 'spectra-review', specPaths: ['openspec/changes/x/'], manifest: man('WORKTREE', '') }, YAML)
  assert.equal(s.args, 'x'); assert.equal(s.skip_reason, null)
})
test('a range strategy without base_name falls back to the strategy prefix', () => {
  const r = resolveEngine({ token: 'medium', specPaths: ['x'], manifest: { diff_strategy: 'trunk...HEAD' } }, YAML)
  assert.deepEqual(r.base, { name: 'trunk', given: false })
})
test('parser: entry keys with digits, missing required fields, unknown lines', () => {
  const e = parseEngines(YAML + '\n  gpt5-review:\n    skill: gpt5-review\n    args: "<base>"\n    findings_from: x\n    severity_map:\n      high: high\n    notes: []\n    never_pass: []\n')
  assert.equal(e['gpt5-review'].skill, 'gpt5-review'); assert.equal(e['spectra-review'].skill, 'spectra-review')
  assert.throws(() => resolveEngine({ token: 'broken', specPaths: ['x'], base: 'main' }, YAML + '\n  broken:\n    args: "<base>"\n'), /broken.*lacks.*skill/)
  assert.throws(() => parseEngines(YAML + '\n  weird:\n\tskill: tabbed\n'), /line .* not understood/)
})
