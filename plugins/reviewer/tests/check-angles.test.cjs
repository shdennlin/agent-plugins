// node --test plugins/reviewer/tests/check-angles.test.cjs
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const { checkAngles } = require('../scripts/check-angles.cjs')
const YAML = fs.readFileSync(path.join(__dirname, '..', 'templates', 'review-angles.yaml'), 'utf8')
const SCRIPT = path.join(__dirname, '..', 'scripts', 'check-angles.cjs')

test('default expands to the section keys, composition excluded for spec', () => {
  assert.deepEqual(checkAngles('result', 'default', YAML).angles, ['coverage', 'robustness', 'correctness'])
  const spec = checkAngles('spec', 'default', YAML).angles
  assert.ok(spec.includes('scope') && spec.includes('design') && spec.includes('consistency'))
  assert.ok(!spec.includes('composition'))
})
test('csv is trimmed and order-preserving', () => {
  assert.deepEqual(checkAngles('result', ' robustness, coverage ', YAML).angles, ['robustness', 'coverage'])
})
test('unknown key names itself and the valid list', () => {
  assert.throws(() => checkAngles('result', 'security,coverage', YAML), /unknown angle 'security' for result; valid: coverage, robustness, correctness/)
})
test('composition may be requested explicitly for spec', () => {
  assert.ok(checkAngles('spec', 'scope,composition', YAML).angles.includes('composition'))
})
test('unknown section and empty csv are errors', () => {
  assert.throws(() => checkAngles('nope', 'default', YAML), /unknown section 'nope'/)
  assert.throws(() => checkAngles('result', ' , ', YAML), /no angle given/)
})
test('CLI: exit 1 + stderr on unknown key, exit 0 + JSON on default', () => {
  const bad = spawnSync('node', [SCRIPT, '--section', 'result', '--angles', 'security'], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /^check-angles: unknown angle 'security' for result; valid: coverage, robustness, correctness/)
  const ok = spawnSync('node', [SCRIPT, '--section', 'result', '--angles', 'default'], { encoding: 'utf8' })
  assert.equal(ok.status, 0)
  assert.deepEqual(JSON.parse(ok.stdout), { section: 'result', angles: ['coverage', 'robustness', 'correctness'] })
})
