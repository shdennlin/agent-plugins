// node --test plugins/reviewer/tests/spec-recall/fixture.test.cjs
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('node:child_process')
const { buildFixture, SEEDS } = require('./fixture.cjs')

const dirs = []
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) })
const mkTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-recall-fx-')); dirs.push(d); return d }

test('seeds.json holds six spec defects across the spec angles, each with file, phrase, titleHints and expectedSeverity', () => {
  assert.equal(SEEDS.length, 6)
  assert.deepEqual([...new Set(SEEDS.map((s) => s.kind))].sort(), ['completeness', 'consistency', 'design', 'scope', 'tasks'])
  for (const s of SEEDS) for (const k of ['id', 'kind', 'file', 'phrase', 'titleHints', 'expectedSeverity']) assert.ok(k in s, `${s.id}.${k}`)
  for (const s of SEEDS) assert.ok(Array.isArray(s.titleHints) && s.titleHints.length >= 2, `${s.id} has at least two hints`)
})
test('buildFixture makes a git repo with a Spectra change whose files contain every seed phrase, and a config.yaml carrying the decisions rule', () => {
  const { repo, change } = buildFixture(mkTmp())
  assert.equal(change, 'openspec/changes/demo')
  assert.ok(fs.existsSync(path.join(repo, '.git')))
  for (const s of SEEDS) {
    const text = fs.readFileSync(path.join(repo, change, s.file), 'utf8')
    assert.ok(text.includes(s.phrase), `${s.id}: phrase not in ${s.file}`)
  }
  const cfg = fs.readFileSync(path.join(repo, 'openspec', 'config.yaml'), 'utf8')
  assert.match(cfg, /alternative/i)
  assert.match(cfg, /^rules:/m)
  for (const f of ['proposal.md', 'design.md', 'tasks.md', 'specs/export/spec.md', 'specs/limits/spec.md']) assert.ok(fs.existsSync(path.join(repo, change, f)), f)
  assert.equal(execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'everything committed')
})
