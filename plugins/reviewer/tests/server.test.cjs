'use strict'
// node --test plugins/reviewer/tests/server.test.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { dispatch } = require('../mcp/server.cjs')
const { handleReportReview } = require('../mcp/report-review.cjs')

function mkRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewer-srv-'))
  const run = path.join(root, '.claude', 'reviewer', 'runs', 'r1')
  fs.mkdirSync(run, { recursive: true })
  fs.writeFileSync(path.join(run, 'manifest.json'), JSON.stringify({ files: ['src/a.py', 'src/b.py'] }))
  return run
}

function validReport(run) {
  return {
    run_dir: run,
    angle: 'correctness',
    files: [
      { path: 'src/a.py', verdict: 'issues', issue_count: 1 },
      { path: 'src/b.py', verdict: 'clean', issue_count: 0 },
    ],
    issues: [{
      severity: 'HIGH', title: 'parse drops input', location: 'src/a.py:parse', category: 'logic',
      expected: 'all input parsed', actual: 'tail dropped', impact: 'data loss', recommendation: 'fix loop bound',
    }],
    verdict: 'FAIL',
  }
}

async function text(stream) {
  let s = ''
  for await (const chunk of stream) s += chunk
  return s
}

test('initialize advertises protocol and tools capability', () => {
  const res = dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
  assert.equal(res.result.serverInfo.name, 'reviewer-review')
  assert.ok(res.result.capabilities.tools)
})

test('tools/list exposes report_review with the contract schema', () => {
  const res = dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  assert.equal(res.result.tools[0].name, 'report_review')
  assert.deepEqual(res.result.tools[0].inputSchema.required.slice().sort(), ['angle', 'files', 'issues', 'run_dir', 'verdict'])
})

test('unknown method returns -32601, notification returns nothing', () => {
  assert.equal(dispatch({ jsonrpc: '2.0', id: 3, method: 'resources/list' }).error.code, -32601)
  assert.equal(dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined)
})

test('tools/call with an unknown tool returns -32602; valid call wraps the handler result', () => {
  assert.equal(dispatch({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } }).error.code, -32602)
  const res = dispatch({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'report_review', arguments: {} } })
  assert.equal(res.error, undefined)
  assert.equal(res.result.isError, true)
})

test('report_review writes <run_dir>/<angle>.json on valid input', () => {
  const run = mkRun()
  const res = handleReportReview(validReport(run))
  assert.notEqual(res.isError, true)
  const written = JSON.parse(fs.readFileSync(path.join(run, 'correctness.json'), 'utf8'))
  assert.equal(written.angle, 'correctness')
  assert.equal(written.via, 'report_review')
  assert.ok(written.reported_at)
})

test('report_review returns isError and writes nothing on violations', () => {
  const run = mkRun()
  const bad = validReport(run)
  bad.files.pop()
  const res = handleReportReview(bad)
  assert.equal(res.isError, true)
  assert.match(res.content[0].text, /src\/b\.py missing/)
  assert.equal(fs.existsSync(path.join(run, 'correctness.json')), false)
})

test('report_review refuses a run_dir without manifest.json', () => {
  const res = handleReportReview({ ...validReport('/tmp/nope/.claude/reviewer/runs/zz') })
  assert.equal(res.isError, true)
  assert.match(res.content[0].text, /manifest\.json/)
})

test('report_review returns isError for non-string or relative run_dir instead of throwing', () => {
  for (const run_dir of [undefined, 42, 'relative/dir']) {
    const res = handleReportReview({ ...validReport('/x'), run_dir })
    assert.equal(res.isError, true)
  }
  assert.equal(handleReportReview(null).isError, true)
})

test('stdio round-trip: initialize then tools/call', async () => {
  const run = mkRun()
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'server.cjs')])
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n')
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'report_review', arguments: validReport(run) } }) + '\n')
  child.stdin.write('not json\n')
  child.stdin.end()
  const lines = (await text(child.stdout)).trim().split('\n').map(JSON.parse)
  assert.equal(lines.length, 3)
  assert.equal(lines[1].id, 2)
  assert.notEqual(lines[1].result.isError, true)
  assert.equal(lines[2].error.code, -32700)
  assert.equal(lines[2].id, null)
})

test('report_review refuses reserved/unsafe angles and symlinked targets', () => {
  const run = mkRun()
  for (const angle of ['manifest', '../x', '.hid', 'a/b']) {
    const res = handleReportReview({ ...validReport(run), angle })
    assert.equal(res.isError, true, angle)
  }
  assert.ok(fs.existsSync(path.join(run, 'manifest.json')))
  const victim = path.join(path.dirname(run), 'victim.txt')
  fs.writeFileSync(victim, 'keep')
  fs.symlinkSync(victim, path.join(run, 'correctness.json'))
  const res = handleReportReview(validReport(run))
  assert.equal(res.isError, true)
  assert.equal(fs.readFileSync(victim, 'utf8'), 'keep')
})

test('report_review reads manifest.mode: a spec run rejects coverage and accepts § locations', () => {
  const run = mkRun()
  fs.writeFileSync(path.join(run, 'manifest.json'), JSON.stringify({ mode: 'spec', files: ['design.md'] }))
  const rep = { run_dir: run, angle: 'clarity', verdict: 'FAIL', files: [{ path: 'design.md', verdict: 'issues', issue_count: 1 }],
    issues: [{ severity: 'HIGH', title: 't', location: 'design.md §2', category: 'c', expected: 'e', actual: 'a', impact: 'i', recommendation: 'r' }] }
  assert.notEqual(handleReportReview(rep).isError, true)
  const bad = { ...rep, coverage: [{ requirement: 'R1', status: 'missing' }] }
  const res = handleReportReview(bad)
  assert.equal(res.isError, true); assert.match(res.content[0].text, /coverage: not allowed in spec mode/)
})

test('report_review refuses the orchestrator-owned names merged and outcomes as angles', () => {
  const run = mkRun()
  for (const angle of ['merged', 'outcomes', 'manifest']) {
    const res = handleReportReview({ ...validReport(run), angle })
    assert.equal(res.isError, true, angle); assert.match(res.content[0].text, /angle/)
  }
})

// --- batch G: verify_review tool
const { handleVerifyReview } = require('../mcp/verify-review.cjs')
test('tools/list exposes verify_review next to report_review', () => {
  const res = dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  assert.deepEqual(res.result.tools.map((t) => t.name).sort(), ['report_review', 'verify_review'])
})
test('verify_review validates against merged.json ids and writes verify/<batch>.json', () => {
  const run = mkRun()
  fs.writeFileSync(path.join(run, 'merged.json'), JSON.stringify({ issues: [{ id: 'F1' }, { id: 'F2' }] }))
  const res = handleVerifyReview({ run_dir: run, batch: 'b1', verdicts: [{ id: 'F1', status: 'refuted', evidence: 'guarded' }] })
  assert.notEqual(res.isError, true, JSON.stringify(res))
  const w = JSON.parse(fs.readFileSync(path.join(run, 'verify', 'b1.json'), 'utf8'))
  assert.equal(w.via, 'verify_review'); assert.ok(w.reported_at); assert.equal(w.verdicts[0].id, 'F1')
  const bad = handleVerifyReview({ run_dir: run, batch: 'b2', verdicts: [{ id: 'F7', status: 'refuted', evidence: 'x' }] })
  assert.equal(bad.isError, true); assert.match(bad.content[0].text, /F7 not in merged\.json/)
  const noMerged = handleVerifyReview({ run_dir: mkRun(), batch: 'b1', verdicts: [] })
  assert.equal(noMerged.isError, true); assert.match(noMerged.content[0].text, /merged\.json/)
})
test('report_review refuses verify as an angle name', () => {
  const res = handleReportReview({ ...validReport(mkRun()), angle: 'verify' })
  assert.equal(res.isError, true); assert.match(res.content[0].text, /angle/)
})

test('verify_review refuses a verify/ directory that is a symlink out of the run dir (no write through it)', () => {
  const run = mkRun()
  fs.writeFileSync(path.join(run, 'merged.json'), JSON.stringify({ issues: [{ id: 'F1' }] }))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewer-outside-'))
  fs.symlinkSync(outside, path.join(run, 'verify'))
  const res = handleVerifyReview({ run_dir: run, batch: 'b1', verdicts: [{ id: 'F1', status: 'confirmed', evidence: 'x' }] })
  assert.equal(res.isError, true); assert.match(res.content[0].text, /symlink/)
  assert.ok(!fs.existsSync(path.join(outside, 'b1.json')), 'nothing written through the symlink')
})
