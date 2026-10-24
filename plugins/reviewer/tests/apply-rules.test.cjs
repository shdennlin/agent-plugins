// node --test plugins/reviewer/tests/apply-rules.test.cjs — scripts/apply-rules.cjs (init's append-only rules delta)
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { applyRules } = require('../scripts/apply-rules.cjs')
const { parseRulesYaml } = require('../scripts/read-rules.cjs')

const SCRIPT = path.join(__dirname, '..', 'scripts', 'apply-rules.cjs')
const FIX = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8')
const TPL = 'proposal:\n  - "State the problem being solved in one sentence"\n  - "New proposal rule"\nspecs:\n  - "Cover all edge cases with explicit expected behavior"\ndesign:\n  - "New design rule"\ntasks:\n  - "New tasks rule"\n'

test('openspec target with rules: between other keys — append inside rules:, everything else byte-identical', () => {
  const before = FIX('config-with-rules.yaml')
  const { text, added, skipped } = applyRules({ templateText: TPL, targetText: before, kind: 'openspec' })
  assert.deepEqual(added, { proposal: ['New proposal rule'], specs: [], design: ['New design rule'], tasks: ['New tasks rule'] })
  assert.equal(skipped, 2)
  const bl = before.split('\n'), tl = text.split('\n')
  for (const line of bl) assert.ok(tl.includes(line), `original line lost: ${line}`)
  assert.ok(tl.indexOf('    - "New proposal rule"') === tl.indexOf("    - 'Old rule with ''quotes'''") + 1, 'new proposal rule follows the last existing one')
  assert.ok(tl.indexOf('  design:') > tl.indexOf('  specs:') && tl.indexOf('  design:') < tl.indexOf('context: |'), 'new area lands inside rules:, before the next top-level key')
  assert.ok(tl.indexOf('  free text block') === tl.indexOf('context: |') + 1, 'block scalar after rules untouched')
  const parsed = parseRulesYaml(text, { nested: true })
  assert.deepEqual(parsed.proposal, ['State the problem being solved in one sentence', "Old rule with 'quotes'", 'New proposal rule'])
  assert.deepEqual(parsed.design, ['New design rule'])
})
test('openspec target without rules: — section appended at EOF', () => {
  const { text, added } = applyRules({ templateText: TPL, targetText: FIX('config-no-rules.yaml'), kind: 'openspec' })
  assert.ok(text.startsWith(FIX('config-no-rules.yaml')))
  assert.match(text, /\nrules:\n  proposal:\n    - "State the problem being solved in one sentence"\n    - "New proposal rule"\n  specs:\n/)
  assert.equal(added.proposal.length, 2)
})
test('portable target missing or empty — four areas written flat', () => {
  const { text, added } = applyRules({ templateText: TPL, targetText: '', kind: 'portable' })
  assert.match(text, /^proposal:\n  - "State the problem/)
  assert.deepEqual(parseRulesYaml(text, { nested: false }).tasks, ['New tasks rule'])
  assert.equal(Object.values(added).flat().length, 5)
})
test('duplicates are detected on the unquoted, trimmed text', () => {
  const target = 'proposal:\n  - State the problem being solved in one sentence   # plain\n'
  const { added, skipped } = applyRules({ templateText: 'proposal:\n  - "State the problem being solved in one sentence"\n', targetText: target, kind: 'portable' })
  assert.deepEqual(added.proposal, []); assert.equal(skipped, 1)
})
test('CLI: --dry-run prints the delta and writes nothing; a real run writes and creates the parent dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-'))
  const tpl = path.join(dir, 'tpl.yaml'); fs.writeFileSync(tpl, TPL)
  const target = path.join(dir, '.claude', 'reviewer', 'rules.yaml')
  const dry = spawnSync('node', [SCRIPT, '--template', tpl, '--target', target, '--kind', 'portable', '--dry-run'], { encoding: 'utf8' })
  assert.equal(dry.status, 0, dry.stderr)
  const j = JSON.parse(dry.stdout); assert.equal(j.written, false); assert.equal(j.added.design[0], 'New design rule'); assert.equal(j.target, target)
  assert.ok(!fs.existsSync(target))
  const real = spawnSync('node', [SCRIPT, '--template', tpl, '--target', target, '--kind', 'portable'], { encoding: 'utf8' })
  assert.equal(JSON.parse(real.stdout).written, true); assert.ok(fs.existsSync(target))
  const again = spawnSync('node', [SCRIPT, '--template', tpl, '--target', target, '--kind', 'portable'], { encoding: 'utf8' })
  const k = JSON.parse(again.stdout); assert.equal(k.written, false); assert.equal(k.skipped, 5)
})
test('CLI: a template with no rules is an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-'))
  const tpl = path.join(dir, 'tpl.yaml'); fs.writeFileSync(tpl, '# nothing\n')
  const r = spawnSync('node', [SCRIPT, '--template', tpl, '--target', path.join(dir, 'x.yaml'), '--kind', 'portable'], { encoding: 'utf8' })
  assert.equal(r.status, 1); assert.match(r.stderr, /no rules/)
})

// --- batch D review fixes
const countKey = (text, re) => text.split('\n').filter((l) => re.test(l)).length
test('a missing area in the middle never duplicates the areas after it (OpenSpec rejects duplicate keys)', () => {
  const target = 'name: demo\nrules:\n  proposal:\n    - "P existing"\n  tasks:\n    - "T existing"\n'
  const { text, added } = applyRules({ templateText: 'specs:\n  - "S new"\ndesign:\n  - "D new"\ntasks:\n  - "T new"\n', targetText: target, kind: 'openspec' })
  assert.equal(countKey(text, /^  tasks:$/), 1, 'tasks: written once\n' + text)
  assert.equal(countKey(text, /^  proposal:$/), 1)
  assert.deepEqual(added.tasks, ['T new'])
  assert.deepEqual(parseRulesYaml(text, { nested: true }).tasks, ['T existing', 'T new'])
  assert.deepEqual(parseRulesYaml(text, { nested: true }).warnings, [])
})
test('areas out of template order with additions in both never duplicate keys', () => {
  const target = 'rules:\n  tasks:\n    - "T1"\n  proposal:\n    - "P1"\n'
  const { text } = applyRules({ templateText: 'proposal:\n  - "P2"\ntasks:\n  - "T2"\n', targetText: target, kind: 'openspec' })
  assert.equal(countKey(text, /^  tasks:$/), 1); assert.equal(countKey(text, /^  proposal:$/), 1)
  assert.deepEqual(parseRulesYaml(text, { nested: true }).tasks, ['T1', 'T2'])
})
test('shapes the line editor does not understand are refused, not corrupted', () => {
  const tpl = 'proposal:\n  - "P new"\n'
  for (const [name, target, kind] of [
    ['4-space areas', 'rules:\n    proposal:\n      - "P1"\n', 'openspec'],
    ['sequence at key indent', 'rules:\n  proposal:\n  - "P1"\n', 'openspec'],
    ['folded last item', 'rules:\n  proposal:\n    - >\n      long rule\n', 'openspec'],
    ['flow rules', 'rules: {}\n', 'openspec'],
    ['portable column-0 items', 'proposal:\n- "P1"\n', 'portable'],
  ]) assert.throws(() => applyRules({ templateText: tpl, targetText: target, kind }), /does not understand/, name)
})
test('a template with lines the parser skips is refused (from-history templates are LLM-written)', () => {
  assert.throws(() => applyRules({ templateText: 'proposal:\n    - "four spaces"\nspecs:\n  - >\n    folded\n', targetText: '', kind: 'portable' }), /template.*does not understand/)
})
