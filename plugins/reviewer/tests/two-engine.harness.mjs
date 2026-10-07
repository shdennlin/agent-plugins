// Stub harness for workflows/two-engine-spec-review.workflow.js — the plugin's only regression
// test. Replaces agent()/parallel()/log()/phase()/args with scripted responses and evals the
// script, then asserts per scenario. No network, no Claude.
//
//   node plugins/reviewer/tests/two-engine.harness.mjs            # all scenarios, exit 1 on any failure
//   node plugins/reviewer/tests/two-engine.harness.mjs delivery   # one scenario, verbose (logs + result)
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const HERE = dirname(fileURLToPath(import.meta.url))
const scriptPath = join(HERE, '..', 'workflows', 'two-engine-spec-review.workflow.js')
const scenario = process.argv[2]
const ALL = ['reject', 'reraise', 'delivery', 'legit', 'drift', 'finalreview', 'gate', 'lowgate', 'fixerdown', 'failverdict', 'reraisecodex', 'fixerledger']
if (!scenario) {
  let failed = 0
  for (const sc of ALL) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), sc], { encoding: 'utf8' })
    const out = r.stdout + r.stderr
    const ok = (out.match(/^ok: /gm) || []).length, bad = (out.match(/^ASSERT FAIL/gm) || []).length
    console.log(`${sc.padEnd(12)} ok=${ok} fail=${bad}${r.status ? ' (exit ' + r.status + ')' : ''}`)
    if (bad || r.status) { failed++; console.log(out.split('\n').filter(l => /ASSERT FAIL|Error/.test(l)).join('\n')) }
  }
  process.exit(failed ? 1 : 0)
}
let src = readFileSync(scriptPath, 'utf8').replace(/^export const meta = \{[\s\S]*?\n\}\n/m, 'const meta = {}\n')

const F = (id, sev, title, loc, extra = {}) => ({ id, severity: sev, title, location: loc, rationale: 'r', category: 'design', ...extra })
const logs = []
const calls = []

const scenarios = {
  // (a) round 2 codex returns only a DELIVERY placeholder
  delivery: {
    'claude:1': { verdict: 'FAIL', findings: [F('C1','HIGH','Thing A','spec.md:10'), F('C2','MEDIUM','Thing B','spec.md:20')] },
    'codex:1':  { verdict: 'FAIL', findings: [F('X1','MEDIUM','Other C','tasks.md:3')] },
    'fix:round1': { applied: [{ index: 1 }, { index: 2 }, { index: 3 }], rejected: [] },
    'fix:round2': { applied: [{ index: 1 }], rejected: [] },
    'claude:2': { verdict: 'FAIL', findings: [F('C1','HIGH','Thing A','spec.md:10')] },
    'codex:2':  { verdict: 'FAIL', findings: [F('DELIVERY-1','MEDIUM','Codex findings not transcribed: output withheld by a safety classifier','n/a',{rationale:'This entry is a placeholder, not a review finding.'})] },
  },
  // (b) same finding, reworded each round -> never goes stale
  drift: {
    'claude:1': { verdict: 'FAIL', findings: [F('C1','HIGH','Missing session param guard','spec.md:10')] },
    'codex:1':  { verdict: 'PASS', findings: [] },
    'fix:round1': { applied: [{ index: 1 }], rejected: [] },
    'claude:2': { verdict: 'FAIL', findings: [F('C1','HIGH','Session parameter is optional with no guard','spec.md:11',{ priorId: 'R1-1' })] },
    'codex:2':  { verdict: 'PASS', findings: [] },
  },
  // (c) fixer rejects a finding as out of scope; next round it should not loop
  reject: {
    'claude:1': { verdict: 'FAIL', findings: [F('C1','HIGH','Add frontend work','design.md:5'), F('C2','MEDIUM','Typo in goal','proposal.md:2')] },
    'codex:1':  { verdict: 'PASS', findings: [] },
    'fix:round1': { applied: [{ index: 2 }], rejected: [{ index: 1, disposition: 'out-of-scope', reason: 'Non-Goals excludes frontend' }], gate: { ran: true, regressed: false } },
    'claude:2': { verdict: 'PASS', findings: [] },
    'codex:2':  { verdict: 'PASS', findings: [] },
  },
  // (e) rejected item re-raised with drifted wording -> fixer says already-escalated -> must NOT duplicate
  reraise: {
    'claude:1': { verdict: 'FAIL', findings: [F('C1','HIGH','Add frontend work','design.md:5')] },
    'codex:1':  { verdict: 'PASS', findings: [] },
    'fix:round1': { applied: [], rejected: [{ index: 1, disposition: 'out-of-scope', reason: 'Non-Goals excludes frontend' }] },
    'claude:2': { verdict: 'FAIL', findings: [F('C1','HIGH','Frontend changes are required but missing','design.md:9',{ priorId: 'R1-1' })] },
    'codex:2':  { verdict: 'PASS', findings: [] },
  },
  // (e2) Codex side cannot carry priorId: an exact-key re-raise still links (fallback), a reworded one
  //      reaches the fixer, which can still say already-escalated
  reraisecodex: {
    'claude:1': { verdict: 'PASS', findings: [] },
    'codex:1':  { verdict: 'FAIL', findings: [F('X1','HIGH','Add frontend work','design.md:5')] },
    'fix:round1': { applied: [], rejected: [{ index: 1, disposition: 'out-of-scope', reason: 'Non-Goals excludes frontend' }] },
    'claude:2': { verdict: 'PASS', findings: [] },
    'codex:2':  { verdict: 'FAIL', findings: [F('X1','HIGH','Frontend work is still missing','design.md:9')] },
    'fix:round2': { applied: [], rejected: [{ index: 1, disposition: 'already-escalated', reason: 'restates R1-1' }] },
    'claude:3': { verdict: 'PASS', findings: [] },
    'codex:3':  { verdict: 'PASS', findings: [] },
  },
  // (f) fixer applied a fix that regressed the project gate -> escalate, do not loop on it
  gate: {
    'claude:1': { verdict: 'FAIL', findings: [F('C1','HIGH','Add MODIFY requirement for X','spec.md:5'), F('C2','MEDIUM','Vague verb','spec.md:9')] },
    'codex:1':  { verdict: 'FAIL', findings: [F('X1','HIGH','Add MODIFY requirement for X','spec.md:5')] },   // identical key -> both
    'fix:round1': { applied: [{ index: 1 }, { index: 2 }], rejected: [],
                    gate: { ran: true, regressed: true, detail: 'spectra analyze: 1 WARNING (requirement X has no task)', blamed: [{ index: 1, detail: 'new MODIFY requirement has no matching task' }] } },
    'claude:2': { verdict: 'PASS', findings: [] },
    'codex:2':  { verdict: 'PASS', findings: [] },
  },
  // (g) a legitimate finding that merely mentions "placeholder" must survive; a real placeholder beside it is dropped
  legit: {
    'claude:1': { verdict: 'PASS', findings: [] },
    'codex:1':  { verdict: 'FAIL', findings: [
      F('X1','MEDIUM','design.md still has placeholder diagrams','design.md:40'),
      F('DELIVERY-1','MEDIUM','Codex findings not transcribed','n/a',{rationale:'This entry is a placeholder, not a review finding.'}),
    ] },
    'fix:round1': { applied: [{ index: 1 }], rejected: [] },
    'claude:2': { verdict: 'PASS', findings: [] },
    'codex:2':  { verdict: 'PASS', findings: [] },
  },
  // (h) LOW pass regresses the gate -> must still escalate
  lowgate: {
    'claude:1': { verdict: 'PASS', findings: [F('C1','LOW','Minor wording','spec.md:3')] },
    'codex:1':  { verdict: 'PASS', findings: [] },
    'fix-low':  { applied: [{ index: 1 }], rejected: [], gate: { ran: true, regressed: true, detail: 'validate: invalid', blamed: [{ index: 1, detail: 'broke frontmatter' }] } },
  },
  // (k) escalated ledger reaches the round-2 fixer prompt; unlinked new finding is fresh
  fixerledger: {
    'claude:1': { verdict: 'FAIL', findings: [F('C1','HIGH','Add frontend work','design.md:5'), F('C2','MEDIUM','Vague verb','spec.md:9')] },
    'codex:1':  { verdict: 'PASS', findings: [] },
    'fix:round1': { applied: [{ index: 2 }], rejected: [{ index: 1, disposition: 'out-of-scope', reason: 'Non-Goals excludes frontend' }] },
    'claude:2': { verdict: 'FAIL', findings: [F('C3','MEDIUM','Brand-new concern','tasks.md:2')] },
    'codex:2':  { verdict: 'PASS', findings: [] },
    'fix:round2': { applied: [{ index: 1 }], rejected: [] },
    'claude:3': { verdict: 'PASS', findings: [] },
    'codex:3':  { verdict: 'PASS', findings: [] },
  },
  // (i) fixer dies (agent() -> null): must be visible, must not count as a fix pass
  fixerdown: {
    'claude:1': { verdict: 'FAIL', findings: [F('C1','HIGH','Thing A','spec.md:10')] },
    'codex:1':  { verdict: 'PASS', findings: [] },
    'fix:round1': null,
    'claude:2': { verdict: 'FAIL', findings: [F('C1','HIGH','Thing A','spec.md:10')] },
    'codex:2':  { verdict: 'PASS', findings: [] },
    'fix:round2': null,
    'claude:3': { verdict: 'FAIL', findings: [F('C1','HIGH','Thing A','spec.md:10')] },
    'codex:3':  { verdict: 'PASS', findings: [] },
  },
  // (j) an engine says FAIL but reports only a LOW: blockers=0 is the rule, not the verdict
  failverdict: {
    'claude:1': { verdict: 'PASS', findings: [] },
    'codex:1':  { verdict: 'FAIL', findings: [F('X1','LOW','Nit','spec.md:3')] },
    'fix-low':  { applied: [{ index: 1 }], rejected: [], gate: { ran: true, regressed: false } },
  },
  // (d) clean on final re-review after last-round fix
  finalreview: {
    'claude:1': { verdict: 'FAIL', findings: [F('C1','MEDIUM','A','spec.md:1')] },
    'codex:1':  { verdict: 'PASS', findings: [] },
    'fix:round1': { applied: [{ index: 1 }], rejected: [] },
    'claude:2': { verdict: 'FAIL', findings: [F('C2','MEDIUM','B','spec.md:2')] },
    'codex:2':  { verdict: 'PASS', findings: [] },
    'fix:round2': { applied: [{ index: 1 }], rejected: [] },
    'claude:3': { verdict: 'PASS', findings: [] },
    'codex:3':  { verdict: 'PASS', findings: [] },
  },
}
const S = scenarios[scenario]
globalThis.args = { change: 'openspec/changes/identity-x/', maxRounds: ['reraise','reraisecodex','fixerledger'].includes(scenario) ? 3 : 2 }
globalThis.log = m => logs.push(m)
globalThis.phase = () => {}
globalThis.parallel = async thunks => Promise.all(thunks.map(t => t().catch(() => null)))
// Minimal contract check so stubs cannot drift from the schemas the script declares.
const SEVS = ['CRITICAL','HIGH','MEDIUM','LOW']
const DISP = ['out-of-scope','contradicts-spec','new-mechanism','bogus','already-escalated']
function checkShape(label, r) {
  const bad = m => { throw new Error(`stub "${label}" violates contract: ${m}`) }
  if (r === null) return
  if (/^(claude|codex):/.test(label)) {
    if (!['PASS','FAIL'].includes(r.verdict)) bad('verdict')
    if (!Array.isArray(r.findings)) bad('findings[]')
    for (const f of r.findings) for (const k of ['id','severity','title','location']) if (typeof f[k] !== 'string') bad(`finding.${k}`)
    for (const f of r.findings) if (!SEVS.includes(f.severity)) bad('severity enum')
    if (r.engineStatus && !['ok','withheld','error'].includes(r.engineStatus)) bad('engineStatus enum')
  } else if (/^fix/.test(label)) {
    if (!Array.isArray(r.applied) || !Array.isArray(r.rejected)) bad('applied[]/rejected[]')
    for (const a of r.applied) if (!Number.isInteger(a.index)) bad('applied.index integer')
    for (const x of r.rejected) { if (!Number.isInteger(x.index)) bad('rejected.index'); if (!DISP.includes(x.disposition)) bad('disposition enum'); if (typeof x.reason !== 'string') bad('reason') }
    if (r.gate && (typeof r.gate.ran !== 'boolean' || typeof r.gate.regressed !== 'boolean')) bad('gate.ran/regressed')
  }
}
globalThis.agent = async (prompt, opts = {}) => {
  calls.push({ label: opts.label, prompt })
  if (!(opts.label in S)) throw new Error(`scenario "${scenario}" has no stub for label "${opts.label}" — define it (null = dead agent)`)
  const r = S[opts.label]
  checkShape(opts.label, r)
  return r
}
const fn = new (Object.getPrototypeOf(async function(){}).constructor)(src)
const result = await fn()
console.log(logs.join('\n'))
console.log('CALLS:', calls.map(c => c.label).join(' '))
console.log(JSON.stringify(result, null, 1))

// --- assertions (TDD): expected behaviour per scenario ---
const assert = (cond, msg) => { if (!cond) { console.error('ASSERT FAIL: ' + msg); process.exitCode = 1 } else console.log('ok: ' + msg) }
if (scenario === 'reraise') {
  const labels = calls.map(c => c.label)
  assert(result.needsHuman.length === 1, 'linked re-raise does not duplicate needsHuman (got ' + result.needsHuman.length + ')')
  assert(!labels.includes('fix:round2'), 'a re-raise linked to an escalated root is not sent to the fixer')
  assert(!labels.includes('claude:3'), 'loop stops once only escalated blockers remain')
  assert(result.ready === false, 'an unresolved HIGH in human hands is NOT ready (got ready=' + result.ready + ')')
  const r2 = calls.find(c => c.label === 'claude:2')
  assert(/R1-1\b.*out-of-scope/.test(r2?.prompt || ''), 'round-2 review prompt lists R1-1 with its escalated status')
  assert(result.history[1].linked === 1, 'history row counts priorId-linked findings (got ' + result.history[1].linked + ')')
}
if (scenario === 'reraisecodex') {
  const labels = calls.map(c => c.label)
  assert(labels.includes('fix:round2'), 'reworded Codex re-raise without priorId reaches the fixer')
  assert(result.needsHuman.length === 1, 'already-escalated from the fixer does not duplicate needsHuman')
  assert(result.ready === false, 'unresolved HIGH escalated -> ready:false')
}
if (scenario === 'fixerledger') {
  const f2 = calls.find(c => c.label === 'fix:round2')
  assert(f2 && /R1-1\b.*out-of-scope/.test(f2.prompt), 'round-2 FIXER prompt carries the escalated ledger entry')
  assert(result.history[1].fresh === 1 && result.history[1].linked === 0, 'unlinked new finding counts as fresh')
}
if (scenario === 'fixerdown') {
  assert(result.history[0].fixerDown === true, 'dead fixer is recorded on the history row')
  assert(result.fixRounds === 0, 'dead fixer does not count as a fix pass (got ' + result.fixRounds + ')')
  assert(!result.needsHuman.some(h => /despite fixes/.test(h.reason)), 'stale escalation does not claim fixes ran when none did')
  assert(result.ready === false && /fixer/i.test(result.reason), 'reason names the fixer outage')
}
if (scenario === 'failverdict') {
  assert(result.ready === true, 'FAIL verdict with zero MEDIUM+ still clears (got ready=' + result.ready + ')')
  assert(calls.some(c => c.label === 'fix-low'), 'LOW pass runs after clearing')
  assert(result.fixRounds === 0, 'no fix round ran')
}
if (scenario === 'legit') {
  assert(result.history[0].blockers === 1, 'legitimate "placeholder diagrams" finding survives as a blocker (got ' + result.history[0].blockers + ')')
  assert(result.history[0].degraded === false, 'codex is NOT marked down when a real finding came back beside the placeholder')
  assert(result.history[0].codexOnly === 1, 'exactly one codex finding kept')
}
if (scenario === 'lowgate') {
  assert(result.ready === true, 'cleared on round 1')
  const gh = result.needsHuman.find(h => h.disposition === 'gate-regression')
  assert(gh && gh.title === 'Minor wording', 'LOW-pass gate regression escalates to needsHuman')
}
if (scenario === 'gate') {
  const fixCall = calls.find(c => c.label === 'fix:round1')
  assert(fixCall && /spectra analyze identity-x --json/.test(fixCall.prompt) && /spectra validate identity-x --json/.test(fixCall.prompt), 'fixer prompt names the default Spectra gate commands for the change')
  assert(/before.*after|snapshot/i.test(fixCall?.prompt || ''), 'fixer prompt says to snapshot gates before editing and compare after')
  const gh = result.needsHuman.find(h => h.disposition === 'gate-regression')
  assert(gh && gh.title === 'Add MODIFY requirement for X', 'blamed finding escalates as gate-regression')
  assert(gh && /no matching task/.test(gh.reason), 'gate-regression reason carries the gate detail')
  assert(result.history[0].gate && result.history[0].gate.regressed === true, 'history row records the gate outcome')
  assert(/GATE REGRESSED/.test(logs.join('\n')), 'gate regression is logged')
  assert(result.history[0].intersection === 1, 'history row exposes cross-engine intersection (got ' + result.history[0].intersection + ')')
  assert(result.intersection && result.intersection.both === 0 && result.intersection.rounds === 2, 'result exposes intersection summary for the final round')
  assert(result.enginesClean === true && result.ready === false, 'engines clean but the HIGH gate-regression keeps ready:false')
}
if (scenario === 'finalreview') {
  const labels = calls.map(c => c.label)
  assert(labels.includes('claude:3') && labels.includes('codex:3'), 'a review-only pass runs after the last fix (calls: ' + labels.join(' ') + ')')
  assert(!labels.includes('fix:round3'), 'the verification pass does not fix again')
  assert(result.history.length === 3 && result.history[2].blockers === 0, 'history carries the verification round (len=' + result.history.length + ')')
  assert(result.findings.length === 0, 'result findings come from the verification pass, not the pre-fix snapshot (got ' + result.findings.length + ')')
  assert(result.ready === true, 'clean verification pass -> ready:true')
  assert(result.fixRounds === 2, 'fixRounds=2 after two fix passes (got ' + result.fixRounds + ')')
  assert(!/NOT re-reviewed/.test(result.reason || ''), 'reason no longer says NOT re-reviewed')
}
if (scenario === 'drift') {
  // reworded re-raise linked via priorId: same root survives one fix -> stale -> human, loop stops
  const labels = calls.map(c => c.label)
  assert(result.needsHuman.length === 1 && result.needsHuman[0].disposition === 'stale', 'reworded re-raise escalates as stale after ONE fix (got ' + JSON.stringify(result.needsHuman.map(h => h.disposition)) + ')')
  assert(!labels.includes('fix:round2'), 'stale item is not re-fixed')
  assert(!labels.includes('claude:3'), 'loop stops when only the stale item remains')
  assert(result.ready === false, 'still dirty -> ready:false')
  assert(result.history[1].fresh === 0, 'fresh is 0 once the only blocker is linked+stale (got ' + result.history[1].fresh + ')')
  assert(result.findings[0].root === 'R1-1', 'result findings carry the root id')
}
if (scenario === 'delivery') {
  assert(result.fixRounds === 1, 'fixRounds counts fixes actually run on the escalation-only exit (got ' + result.fixRounds + ')')
  const h2 = result.history[1]
  assert(h2.blockers === 1, 'placeholder is not counted as a blocker (round-2 blockers=' + h2.blockers + ')')
  assert(h2.degraded === true, 'round 2 is marked degraded')
  assert(result.history[0].degraded === false, 'round 1 stays non-degraded')
  assert(/ENGINE DOWN: codex/.test(logs[logs.findIndex(l => l.startsWith('Round 2 REVIEW'))]), 'round-2 log says codex is down')
  assert(/DOWN/.test(result.reason), 'reason reports the engine outage')
  assert(!result.findings.some(f => /^DELIVERY-/i.test(f.id)), 'placeholder is not returned in findings')
  const codexCall = calls.find(c => c.label === 'codex:1')
  assert(codexCall && /engineStatus/.test(codexCall.prompt), 'codex prompt tells the wrapper to report engineStatus instead of a fake finding')
}
if (scenario === 'reject') {
  const fixCall = calls.find(c => c.label === 'fix:round1')
  assert(fixCall && /disposition/i.test(fixCall.prompt), 'fixer prompt offers reject dispositions')
  assert(result.needsHuman.length === 1, 'rejected finding lands in needsHuman (got ' + result.needsHuman.length + ')')
  assert(result.needsHuman[0]?.disposition === 'out-of-scope', 'needsHuman carries the disposition')
  assert(result.needsHuman[0]?.title === 'Add frontend work', 'needsHuman maps index back to the right finding')
  const r2 = calls.find(c => c.label === 'claude:2')
  assert(r2 && r2.prompt.includes('Add frontend work'), 'round-2 review prompt lists the escalated finding so it is not re-reported')
  assert(result.enginesClean === true, 'engines clean on round 2 -> enginesClean:true')
  assert(result.ready === false && /escalated to the human/.test(result.reason), 'a HIGH in human hands keeps ready:false with a reason')
}
