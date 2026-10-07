// node --test plugins/cache-keepalive/tests/widget.test.cjs
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { render } = require('../bin/keepalive-cache')

const NOW = Date.UTC(2026, 9, 4, 15, 0)
const MIN = 60_000

function transcript(rows) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ka-')), 't.jsonl')
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
  return file
}

const assistantAt = ms => ({
  type: 'assistant',
  timestamp: new Date(ms).toISOString(),
  message: { usage: { cache_read_input_tokens: 9, cache_creation_input_tokens: 0 } },
})

test('without a state file it matches the built-in cache-timer', () => {
  const file = transcript([assistantAt(NOW - 10 * MIN)])
  assert.equal(render(file, null, 3600, NOW), '🟢49:55')
})

test('a ping restarts the countdown (AC11)', () => {
  const file = transcript([assistantAt(NOW - 58 * MIN)])
  const state = { v: 1, phase: 'armed', ttlSec: 3600, lastPingAt: NOW - 1 * MIN, pings: 1, max: 2 }
  assert.equal(render(file, state, 3600, NOW), '🟢58:55 kp 1/2')
  assert.equal(render(file, null, 3600, NOW), '🔴1:55')
})

test('tags follow the phase', () => {
  const file = transcript([assistantAt(NOW - 40 * MIN)])
  const at = (phase, extra = {}) => render(file, { v: 1, phase, ttlSec: 3600, lastPingAt: 0, pings: 2, max: 2, ...extra }, 3600, NOW)
  assert.equal(at('capped'), '🟡19:55 kp 2/2 ⏸')
  assert.equal(at('stopped'), '🟡19:55 kp ⏸')
  assert.equal(at('small'), '🟡19:55')
  assert.equal(at('off', { offReason: 'ttl-mismatch' }), '🟡19:55 kp off')
  assert.equal(at('off', { offReason: '5m-ttl', ttlSec: 300 }), '❄️COLD')
})

test('a running turn shows HOT only while the mod says active', () => {
  const file = transcript([assistantAt(NOW - 5 * MIN), { type: 'user', timestamp: new Date(NOW).toISOString() }])
  assert.equal(render(file, null, 3600, NOW), '🔥HOT')
  assert.equal(render(file, { v: 1, phase: 'active', ttlSec: 3600, lastPingAt: 0 }, 3600, NOW), '🔥HOT')
  assert.equal(render(file, { v: 1, phase: 'armed', ttlSec: 3600, lastPingAt: 0, pings: 0, max: 2 }, 3600, NOW), '🟢54:55 kp 0/2')
})

test('sidechain rows are ignored', () => {
  const file = transcript([assistantAt(NOW - 30 * MIN), { ...assistantAt(NOW), isSidechain: true }])
  assert.equal(render(file, null, 3600, NOW), '🟡29:55')
})

test('an armed compact shows its time, or "✂ armed" while none is scheduled', () => {
  const file = transcript([assistantAt(NOW - 40 * MIN)])
  const hhmm = ms => {
    const d = new Date(ms)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const base = { v: 1, ttlSec: 3600, lastPingAt: 0, pings: 2, max: 2 }
  const due = NOW + 15 * MIN
  assert.equal(render(file, { ...base, phase: 'capped', compactArmed: true, compactAt: due }, 3600, NOW), `🟡19:55 kp 2/2 ⏸ ✂${hhmm(due)}`)
  assert.equal(render(file, { ...base, phase: 'stopped', compactArmed: true, compactAt: due }, 3600, NOW), `🟡19:55 kp ⏸ ✂${hhmm(due)}`)
  // Armed, but nothing scheduled yet (the turn that follows will schedule it).
  assert.equal(render(file, { ...base, phase: 'active', compactArmed: true, compactAt: null }, 3600, NOW), '🟡19:55 ✂armed')
  // The option alone with no time shows nothing; an old state file without the fields is unchanged.
  assert.equal(render(file, { ...base, phase: 'active', compactArmed: false, compactAt: null }, 3600, NOW), '🟡19:55')
  assert.equal(render(file, { ...base, phase: 'capped' }, 3600, NOW), '🟡19:55 kp 2/2 ⏸')
})

test('an armed compact stays visible while a turn runs (a /goal)', () => {
  const file = transcript([assistantAt(NOW - 5 * MIN), { type: 'user', timestamp: new Date(NOW).toISOString() }])
  const state = { v: 1, phase: 'active', ttlSec: 3600, lastPingAt: 0, compactArmed: true, compactAt: null }
  assert.equal(render(file, state, 3600, NOW), '🔥HOT ✂armed')
})
