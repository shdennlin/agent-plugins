// node --test plugins/reviewer/tests/read-rules.test.cjs
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('node:child_process')

const SCRIPT = path.join(__dirname, '..', 'scripts', 'read-rules.cjs')
const { readRules, parseRulesYaml } = require('../scripts/read-rules.cjs')

const dirs = []
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) })

// temp root with the given relative files written
function mk(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'read-rules-'))
  dirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
  }
  return root
}

test('config.yaml rules section wins when the file exists', () => {
  const root = mk({
    'openspec/config.yaml': 'name: x\nrules:\n  proposal:\n    - "P1"\n  design:\n    - D1\nproject:\n  owner: me\n',
    '.claude/reviewer/rules.yaml': 'proposal:\n  - "IGNORED"\n',
  })
  const r = readRules(root)
  assert.equal(r.source, 'openspec/config.yaml')
  assert.deepEqual(r.proposal, ['P1'])
  assert.deepEqual(r.design, ['D1'])
  assert.deepEqual(r.specs, [])
  assert.deepEqual(r.tasks, [])
})

test('openspec dir without config.yaml falls back to rules.yaml', () => {
  const root = mk({ 'openspec/changes/.keep': '', '.claude/reviewer/rules.yaml': 'tasks:\n  - "T1"\n' })
  const r = readRules(root)
  assert.equal(r.source, '.claude/reviewer/rules.yaml')
  assert.deepEqual(r.tasks, ['T1'])
})

test('neither file: empty shape, source null', () => {
  const r = readRules(mk({}))
  assert.equal(r.source, null)
  assert.deepEqual(r.proposal, [])
  assert.deepEqual(r.specs, [])
  assert.deepEqual(r.design, [])
  assert.deepEqual(r.tasks, [])
})

test('rules section stops at the next top-level key', () => {
  const p = parseRulesYaml('rules:\n  specs:\n    - "S1"\nother:\n  specs:\n    - "NOT"\n', { nested: true })
  assert.deepEqual(p.specs, ['S1'])
})

test('config.yaml without rules section -> empty, source kept', () => {
  const root = mk({ 'openspec/config.yaml': 'name: x\n' })
  const r = readRules(root)
  assert.equal(r.source, 'openspec/config.yaml')
  assert.deepEqual(r.design, [])
})

test('items keep colons, hashes inside quotes, and escaped quotes', () => {
  const p = parseRulesYaml('design:\n  - "Rollback: name an owner # not a comment"\n  - "Say \\"why\\""\n  - plain item   # trailing comment\n', { nested: false })
  assert.deepEqual(p.design, ['Rollback: name an owner # not a comment', 'Say "why"', 'plain item'])
})

test('unknown keys ignored, odd lines warned, CRLF tolerated', () => {
  const p = parseRulesYaml('adr:\r\n  - "A"\r\nproposal:\r\n  - [flow, seq]\r\n  - "P1"\r\n', { nested: false })
  assert.deepEqual(p.proposal, ['P1'])
  assert.equal(p.warnings.length, 1)
  assert.match(p.warnings[0], /line 4/)
})

test('CLI prints JSON for --root', () => {
  const root = mk({ '.claude/reviewer/rules.yaml': 'specs:\n  - "S"\n' })
  const out = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' })
  assert.equal(out.status, 0, out.stderr)
  assert.deepEqual(JSON.parse(out.stdout).specs, ['S'])
})

test('quoted item followed by a trailing comment is unquoted', () => {
  const p = parseRulesYaml('tasks:\n  - "T1"   # comment\n  - \'T2\' # c\n', { nested: false })
  assert.deepEqual(p.tasks, ['T1', 'T2'])
})

// --- --paths: the one rules/history path oracle (refactor batch D)
const { resolvePaths } = require('../scripts/read-rules.cjs')
test('resolvePaths: openspec repo → config.yaml target and openspec history', () => {
  const root = mk({ 'openspec/README.md': 'x' })
  const p = resolvePaths(root)
  assert.deepEqual(p, { git_root: root, rules_kind: 'openspec', rules_target: path.join(root, 'openspec/config.yaml'), rules_exists: false, history_path: path.join(root, 'openspec/reviews/history.jsonl') })
  fs.writeFileSync(path.join(root, 'openspec/config.yaml'), 'rules:\n')
  assert.equal(resolvePaths(root).rules_exists, true)
})
test('resolvePaths: plain repo → portable rules.yaml and .claude/reviewer history', () => {
  const root = mk({ 'README.md': 'x' })
  const p = resolvePaths(root)
  assert.equal(p.rules_kind, 'portable'); assert.equal(p.rules_target, path.join(root, '.claude/reviewer/rules.yaml')); assert.equal(p.rules_exists, false)
  assert.equal(p.history_path, path.join(root, '.claude/reviewer/history.jsonl'))
})
test('CLI --paths prints the JSON', () => {
  const root = mk({ 'openspec/config.yaml': 'rules:\n' })
  const r = spawnSync('node', [SCRIPT, '--paths', '--root', root], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const j = JSON.parse(r.stdout); assert.equal(j.rules_kind, 'openspec'); assert.equal(j.rules_exists, true); assert.equal(j.git_root, root)
})
