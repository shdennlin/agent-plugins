// Stub harness for workflows/spec-dual.workflow.js — the plugin's only regression
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
const scriptPath = join(HERE, '..', 'workflows', 'spec-dual.workflow.js')
const scenario = process.argv[2]
const ALL = ['reject', 'reraise', 'delivery', 'legit', 'drift', 'finalreview', 'gate', 'lowgate', 'fixerdown', 'failverdict', 'reraisecodex', 'fixerledger', 'gateunblamed', 'gatenotrun', 'badindex', 'fanout', 'angledown', 'anglecollapse', 'noangles', 'badangles', 'composition', 'rules', 'badrules', 'angledownclean']
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
  // (l) gate regressed but the fixer could not attribute it -> synthetic escalation, still not ready
  gateunblamed: {
    'claude:1': { verdict: 'FAIL', findings: [F('C1','MEDIUM','Vague verb','spec.md:9')] },
    'codex:1':  { verdict: 'PASS', findings: [] },
    'fix:round1': { applied: [{ index: 1 }], rejected: [], gate: { ran: true, regressed: true, detail: 'validate: invalid frontmatter', blamed: [] } },
    'claude:2': { verdict: 'PASS', findings: [] },
    'codex:2':  { verdict: 'PASS', findings: [] },
  },
  // (m) gate command unavailable -> surfaced, does not block ready
  gatenotrun: {
    'claude:1': { verdict: 'FAIL', findings: [F('C1','MEDIUM','Vague verb','spec.md:9')] },
    'codex:1':  { verdict: 'PASS', findings: [] },
    'fix:round1': { applied: [{ index: 1 }], rejected: [], gate: { ran: false, regressed: false, detail: 'spectra: command not found' } },
    'claude:2': { verdict: 'PASS', findings: [] },
    'codex:2':  { verdict: 'PASS', findings: [] },
  },
  // (n) fixer reports a 0-based / duplicate / missing index -> flagged, not remapped
  badindex: {
    'claude:1': { verdict: 'FAIL', findings: [F('C1','HIGH','A','spec.md:1'), F('C2','MEDIUM','B','spec.md:2'), F('C3','MEDIUM','C','spec.md:3')] },
    'codex:1':  { verdict: 'PASS', findings: [] },
    'fix:round1': { applied: [{ index: 0 }, { index: 1 }], rejected: [{ index: 1, disposition: 'bogus', reason: 'x' }] },
    'claude:2': { verdict: 'PASS', findings: [] },
    'codex:2':  { verdict: 'PASS', findings: [] },
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
  // (fanout) Claude side runs one agent per angle in round 1 and one per group afterwards
  fanout: {
    'claude:1': { verdict: 'FAIL', findings: [
      F('C1','HIGH','Goal unmeasurable','proposal.md:4',{ category: 'scope' }),
      F('C2','MEDIUM','No rollback section','design.md:30',{ category: 'design' }),
      F('C3','LOW','Task 7 lacks done criteria','tasks.md:40',{ category: 'tasks', pattern: 'done criteria' }) ] },
    'codex:1':  { verdict: 'PASS', findings: [F('X9','LOW','Codex note without category','tasks.md:9', { category: '' })] },
    'fix:round1': { applied: [{ index: 1 }, { index: 2 }], rejected: [] },
    'fix-low': { applied: [{ index: 1 }], rejected: [] },
    // round 2: blockers fixed; the LOW is re-reported (it was not fixed) so the clearing round carries it to fix-low
    'claude:2': { verdict: 'PASS', findings: [F('C3','LOW','Task 7 lacks done criteria','tasks.md:40',{ category: 'tasks', priorId: 'R1-3' })] },
    'codex:2':  { verdict: 'PASS', findings: [] },
  },
  // project rules reach the matching angle prompts, the groups, and the Codex prompt
  rules: {
    'claude:1': { verdict: 'FAIL', findings: [F('C1','MEDIUM','No non-goals','proposal.md:1',{ category: 'scope' })] },
    'codex:1': { verdict: 'PASS', findings: [] }, 'fix:round1': { applied: [{ index: 1 }], rejected: [] },
    'claude:2': { verdict: 'PASS', findings: [] }, 'codex:2': { verdict: 'PASS', findings: [] },
  },
  // projectRules arrives as a YAML string -> ignored with a log line, no rules section anywhere
  badrules: { __rules: 'proposal:\n  - not parsed', 'claude:1': { verdict: 'PASS', findings: [] }, 'codex:1': { verdict: 'PASS', findings: [] } },
  // one angle dead in round 1: degraded, not cleared, live findings still fixed
  angledown: {
    'claude:scope:1': null,
    'claude:1': { verdict: 'FAIL', findings: [F('C1','MEDIUM','Missing error path','spec.md:9',{ category: 'completeness' })] },
    'codex:1': { verdict: 'PASS', findings: [] },
    'fix:round1': { applied: [{ index: 1 }], rejected: [] },
    'claude:2': { verdict: 'PASS', findings: [] }, 'codex:2': { verdict: 'PASS', findings: [] },
  },
  // one angle dead, every other agent PASS with no findings: zero blockers must NOT clear
  angledownclean: {
    'claude:scope:1': null,
    'claude:1': { verdict: 'PASS', findings: [] },
    'codex:1': { verdict: 'PASS', findings: [] },
  },
  // same key from two angles: one finding, worse severity
  anglecollapse: {
    'claude:scope:1':  { verdict: 'FAIL', findings: [F('S1','LOW','Ambiguous owner','proposal.md:2',{ category: 'scope' })] },
    'claude:design:1': { verdict: 'FAIL', findings: [F('D1','HIGH','Ambiguous owner','proposal.md:2',{ category: 'design' })] },
    'claude:1': { verdict: 'PASS', findings: [] }, 'codex:1': { verdict: 'PASS', findings: [] },
    'fix:round1': { applied: [{ index: 1 }], rejected: [] },
    'claude:2': { verdict: 'PASS', findings: [] }, 'codex:2': { verdict: 'PASS', findings: [] },
  },
  // legacy: no angles -> single agent, old labels
  noangles: { __angles: null, 'claude:1': { verdict: 'PASS', findings: [] }, 'codex:1': { verdict: 'PASS', findings: [] } },
  // angles arrives as a string -> treated as absent, one log line, no crash
  badangles: { __angles: 'not-json', 'claude:1': { verdict: 'PASS', findings: [] }, 'codex:1': { verdict: 'PASS', findings: [] } },
  // composition present + an unknown key
  composition: {
    __angles: 'SPEC_ANGLES_PLUS',
    'claude:1': { verdict: 'FAIL', findings: [F('C1','MEDIUM','Unit A assumes Linux','design.md:1',{ category: 'cross-cutting' })] },
    'codex:1': { verdict: 'PASS', findings: [] },
    'fix:round1': { applied: [{ index: 1 }], rejected: [] },
    'claude:2': { verdict: 'PASS', findings: [] }, 'codex:2': { verdict: 'PASS', findings: [] },
  },
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
// Default spec angles (keys are what matters; labels/focus mirror templates/review-angles.yaml).
// A scenario may set `__angles` (reserved key, not a stub label): null -> legacy single-agent path,
// any other value is passed to args verbatim (a string exercises the malformed case).
const SPEC_ANGLES = [
  { key: 'scope',        label: 'Scope & Boundaries',           focus: 'Scope and intent clarity.' },
  { key: 'completeness', label: 'Completeness & Edge Cases',    focus: 'Spec completeness and missing elements.' },
  { key: 'tasks',        label: 'Task Coverage & Done Criteria', focus: 'Task readiness and coverage.' },
  { key: 'platform',     label: 'Platform & Tool Feasibility',  focus: 'Platform, runtime, and third-party tool assumptions.' },
  { key: 'design',       label: 'Design Soundness',             focus: 'Whether the design holds up architecturally.' },
  { key: 'consistency',  label: 'Internal Consistency',         focus: 'Whether the spec set contradicts itself.' },
]
const ANGLES_ARG = ('__angles' in S)
  ? (S.__angles === null ? undefined
     : S.__angles === 'SPEC_ANGLES_PLUS' ? [...SPEC_ANGLES, { key: 'composition', label: 'Cross-Cutting Composition', focus: 'x' }, { key: 'mystery', label: 'Mystery', focus: 'y' }]
     : S.__angles)
  : SPEC_ANGLES
// Project rules fixture: one rule per artifact area. `__rules` (reserved key) overrides: null -> none, else verbatim.
const DEFAULT_RULES = { proposal: ['RULE-PROPOSAL'], specs: ['RULE-SPECS'], design: ['RULE-DESIGN'], tasks: ['RULE-TASKS'] }
const RULES_ARG = ('__rules' in S) ? (S.__rules === null ? undefined : S.__rules) : DEFAULT_RULES
globalThis.args = { change: 'openspec/changes/identity-x/', maxRounds: ['reraise','reraisecodex','fixerledger'].includes(scenario) ? 3 : 2,
  ...(ANGLES_ARG === undefined ? {} : { angles: ANGLES_ARG }),
  ...(RULES_ARG === undefined ? {} : { projectRules: RULES_ARG }) }
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
// category -> angle key (the one exception: composition findings carry category "cross-cutting")
const keyOfCategory = c => (c === 'cross-cutting' ? 'composition' : c)
const firstClaudeLabelOfRound = {}   // round -> the first per-angle label requested (uncategorized findings go there)
globalThis.agent = async (prompt, opts = {}) => {
  calls.push({ label: opts.label, prompt })
  let r
  if (opts.label in S) {
    r = S[opts.label]
  } else {
    // Per-angle / per-group Claude label: derive from the scenario's per-round stub by category.
    const m = /^claude:([^:]+):(\d+)$/.exec(opts.label || '')
    if (!m) throw new Error(`scenario "${scenario}" has no stub for label "${opts.label}" — define it (null = dead agent)`)
    const [, x, round] = m
    const base = S['claude:' + round]
    if (base === undefined) throw new Error(`scenario "${scenario}" has no stub for label "${opts.label}" nor for "claude:${round}"`)
    if (base === null) { r = null } else {
      const keys = x.split('+')
      if (!firstClaudeLabelOfRound[round]) firstClaudeLabelOfRound[round] = opts.label
      const isFirst = firstClaudeLabelOfRound[round] === opts.label
      const allKeys = new Set((Array.isArray(globalThis.args.angles) ? globalThis.args.angles : []).map(a => a.key))
      const mine = f => {
        const k = keyOfCategory(f.category)
        if (k && allKeys.has(k)) return keys.includes(k)
        return isFirst   // uncategorized or unknown category -> first Claude label of the round
      }
      r = { ...base, findings: base.findings.filter(mine) }
    }
  }
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
// Claude labels are `claude:<round>` (legacy) or `claude:<angle|group>:<round>` (fan-out); assertions use these helpers.
const claudeCalls = round => calls.filter(c => c.label === `claude:${round}` || new RegExp(`^claude:[^:]+:${round}$`).test(c.label))
const hasClaudeRound = round => claudeCalls(round).length > 0
if (scenario === 'reraise') {
  const labels = calls.map(c => c.label)
  assert(result.needsHuman.length === 1, 'linked re-raise does not duplicate needsHuman (got ' + result.needsHuman.length + ')')
  assert(!labels.includes('fix:round2'), 'a re-raise linked to an escalated root is not sent to the fixer')
  assert(!hasClaudeRound(3), 'loop stops once only escalated blockers remain')
  assert(result.ready === false, 'an unresolved HIGH in human hands is NOT ready (got ready=' + result.ready + ')')
  const r2 = claudeCalls(2)[0]
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
if (scenario === 'gateunblamed') {
  const gh = result.needsHuman.find(h => h.disposition === 'gate-regression')
  assert(gh && /invalid frontmatter/.test(gh.reason), 'unattributed gate regression yields a synthetic needsHuman entry')
  assert(gh && gh.severity === 'HIGH', 'synthetic entry is HIGH so it blocks ready')
  assert(result.enginesClean === true && result.ready === false, 'engines clean but gate regression keeps ready:false')
}
if (scenario === 'gatenotrun') {
  assert(result.ready === true, 'missing gate tool does not block ready')
  assert(result.gateRan === false, 'result surfaces gateRan:false')
  assert(/command not found/.test(result.history[0].gate.detail), 'history keeps the gate detail')
}
if (scenario === 'badindex') {
  assert(result.history[0].fixerReportMismatch === true, 'index 0 flags the whole fixer report')
  assert(result.needsHuman.length === 0, 'suspect report is not used to escalate (nothing remapped)')
  assert(/index 0|0-based/i.test(logs.join('\n')), 'mismatch is logged')
}
if (scenario === 'lowgate') {
  assert(result.history[0].lowGate && result.history[0].lowGate.regressed === true, 'LOW-pass gate outcome is recorded in history')
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
  assert(hasClaudeRound(3) && labels.includes('codex:3'), 'a review-only pass runs after the last fix (calls: ' + labels.join(' ') + ')')
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
  assert(!hasClaudeRound(3), 'loop stops when only the stale item remains')
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
  const r2 = claudeCalls(2)[0]
  assert(r2 && r2.prompt.includes('Add frontend work'), 'round-2 review prompt lists the escalated finding so it is not re-reported')
  assert(result.enginesClean === true, 'engines clean on round 2 -> enginesClean:true')
  assert(result.ready === false && /escalated to the human/.test(result.reason), 'a HIGH in human hands keeps ready:false with a reason')
}
if (scenario === 'fanout') {
  const labels = calls.map(c => c.label)
  for (const k of ['scope','design','tasks','completeness','platform','consistency'])
    assert(labels.includes(`claude:${k}:1`), `round 1 spawns claude:${k}:1`)
  assert(labels.includes('codex:1'), 'codex runs in round 1')
  const r2 = labels.filter(l => /^claude:.*:2$/.test(l) || l === 'claude:2')
  assert(JSON.stringify(r2) === JSON.stringify(['claude:scope+design:2','claude:completeness+consistency:2','claude:tasks+platform:2']), 'round 2 uses exactly the three groups (got ' + r2.join(' ') + ')')
  assert(!labels.includes('claude:1') && !labels.includes('claude:2'), 'legacy single-agent labels are never used when angles are passed')
  const scope1 = calls.find(c => c.label === 'claude:scope:1')
  assert(scope1 && /Your review angle: Scope/.test(scope1.prompt) && !/completeness/i.test(scope1.prompt), 'per-angle prompt names only its own angle')
  assert(result.history[0].claudeAgents?.length === 6, 'history[0].claudeAgents lists 6 labels (got ' + JSON.stringify(result.history[0].claudeAgents) + ')')
  assert(result.history[1].claudeAgents?.length === 3, 'history[1].claudeAgents lists 3 groups')
  assert(result.rounds === 2, 'two reviews (got ' + result.rounds + ')')
  const fix1 = calls.find(c => c.label === 'fix:round1')
  assert(fix1 && (fix1.prompt.match(/^\d+\. \[/gm) || []).length === 2, 'round fixer receives the 2 blockers only')
  assert(labels.includes('fix-low'), 'the LOW is cleared by fix-low afterwards')
  const codex1 = calls.find(c => c.label === 'codex:1')
  assert(codex1 && /Cover these angles: Scope & Boundaries/.test(codex1.prompt), 'codex prompt lists the template labels')
  // history v2: every round carries its union findings with engine/engines (never 'both')
  for (const [i, row] of result.history.entries()) assert(Array.isArray(row.findings), `history[${i}].findings is an array`)
  assert(result.history[0].findings.length >= 2, 'round 1 history row lists its findings (got ' + result.history[0].findings.length + ')')
  for (const f of result.history[0].findings) {
    assert(['claude', 'codex'].includes(f.engine), 'history finding engine is claude|codex (got ' + f.engine + ')')
    assert(Array.isArray(f.engines) && f.engines.length >= 1 && f.engines.every(e => ['claude', 'codex'].includes(e)), 'history finding engines[] lists the raising engines')
    assert(typeof f.title === 'string' && typeof f.location === 'string' && typeof f.severity === 'string' && typeof f.category === 'string' && f.category.length > 0, 'history finding carries a non-empty title/location/severity/category (codex findings get a default category)')
  }
  for (const f of result.findings) assert(Array.isArray(f.engines) && f.engine !== 'both', 'final findings carry engines[] and no both')
  assert(result.history[0].findings.some(f => f.pattern === 'done criteria'), 'a reviewer-given pattern passes through to the history row')
  // history v3: the workflow sets each row's outcome from what the fixer applied / escalated
  const o1 = Object.fromEntries(result.history[0].findings.map(f => [f.title, f.outcome]))
  assert(o1['Goal unmeasurable'] === 'fixed' && o1['No rollback section'] === 'fixed', 'round 1 applied blockers log fixed (got ' + JSON.stringify(o1) + ')')
  assert(o1['Task 7 lacks done criteria'] === 'open', 'a LOW not sent to the round fixer is open in round 1')
  const o2 = Object.fromEntries(result.history[1].findings.map(f => [f.title, f.outcome]))
  assert(o2['Task 7 lacks done criteria'] === 'fixed', 'the clearing round LOW fixed by fix-low logs fixed (got ' + JSON.stringify(o2) + ')')
  for (const h of result.history) for (const f of h.findings) assert(['open', 'fixed', 'escalated', 'residual'].includes(f.outcome), 'every history finding carries an outcome')
}
if (scenario === 'angledown') {
  assert(result.history[0].degraded === true, 'a dead angle degrades the round')
  assert((result.history[0].enginesDown || []).includes('claude:scope'), 'enginesDown names the dead angle (got ' + JSON.stringify(result.history[0].enginesDown) + ')')
  const fix1 = calls.find(c => c.label === 'fix:round1')
  assert(fix1 && (fix1.prompt.match(/^\d+\. \[/gm) || []).length === 1, 'the live angle finding still reaches the fixer')
  assert(result.history[0].blockers === 1 && result.ready === true, 'round 2 (all angles live, no blockers) clears (ready=' + result.ready + ')')
}
if (scenario === 'anglecollapse') {
  assert(result.history[0].fresh === 1, 'two angles, same key -> one fresh finding (got ' + result.history[0].fresh + ')')
  const fix1 = calls.find(c => c.label === 'fix:round1')
  assert(fix1 && (fix1.prompt.match(/^\d+\. \[HIGH\] Ambiguous owner/gm) || []).length === 1 && !/\[LOW\] Ambiguous owner/.test(fix1.prompt), 'fixer item list shows the collapsed finding once, at HIGH (the ledger block above it also names it, which is fine)')
  assert(logs.some(l => /reported by 2 angles — collapsed/.test(l)), 'collapse is logged')
}
if (scenario === 'noangles') {
  const labels = calls.map(c => c.label)
  assert(JSON.stringify(labels) === JSON.stringify(['claude:1','codex:1']), 'legacy path uses the old labels (got ' + labels.join(' ') + ')')
  assert(JSON.stringify(result.history[0].claudeAgents) === JSON.stringify(['claude:1']), 'claudeAgents on the legacy path')
  const c1 = calls.find(c => c.label === 'claude:1')
  assert(c1 && ['RULE-PROPOSAL','RULE-SPECS','RULE-DESIGN','RULE-TASKS'].every(r => c1.prompt.includes(r)), 'legacy single agent carries every rule area')
}
if (scenario === 'badangles') {
  const labels = calls.map(c => c.label)
  assert(JSON.stringify(labels) === JSON.stringify(['claude:1','codex:1']), 'malformed angles -> legacy labels (got ' + labels.join(' ') + ')')
  assert(logs.some(l => /angles ignored/.test(l)), 'malformed angles are logged')
}
if (scenario === 'composition') {
  const labels = calls.map(c => c.label)
  assert(labels.filter(l => /^claude:.*:1$/.test(l)).length === 8, 'round 1 spawns 8 Claude agents (6 + composition + mystery)')
  assert(labels.includes('claude:completeness+consistency+composition:2'), 'composition rides in G2 in round 2')
  assert(labels.includes('claude:tasks+platform+mystery:2'), 'unknown key lands in G3')
  const fix1 = calls.find(c => c.label === 'fix:round1')
  assert(fix1 && /Unit A assumes Linux/.test(fix1.prompt), 'the cross-cutting finding reaches the fixer')
}
if (scenario === 'rules') {
  const P = l => (calls.find(c => c.label === l) || {}).prompt || ''
  assert(/## Project Rules/.test(P('claude:scope:1')) && P('claude:scope:1').includes('RULE-PROPOSAL') && !P('claude:scope:1').includes('RULE-SPECS'), 'scope angle gets proposal rules only')
  assert(!/## Project Rules/.test(P('claude:platform:1')) && !/## Project Rules/.test(P('claude:consistency:1')), 'angles with no artifact area get no rules section')
  const g1 = P('claude:scope+design:2')
  assert(g1.includes('RULE-PROPOSAL') && g1.includes('RULE-DESIGN') && !g1.includes('RULE-TASKS'), 'scope+design group gets proposal and design rules')
  const g2 = P('claude:completeness+consistency:2')
  assert(g2.includes('RULE-SPECS') && !g2.includes('RULE-PROPOSAL') && !g2.includes('RULE-DESIGN') && !g2.includes('RULE-TASKS'), 'completeness+consistency group gets specs rules only')
  const cx = P('codex:1')
  assert(['proposal','specs','design','tasks'].every(a => cx.includes('### ' + a)) && ['RULE-PROPOSAL','RULE-SPECS','RULE-DESIGN','RULE-TASKS'].every(r => cx.includes(r)), 'codex prompt carries every area under its own heading')
}
if (scenario === 'badrules') {
  const labels = calls.map(c => c.label)
  assert(labels.includes('claude:scope:1') && labels.includes('codex:1'), 'labels unaffected by malformed rules')
  assert(calls.every(c => !/## Project Rules/.test(c.prompt)), 'no rules section anywhere')
  assert(logs.some(l => /projectRules ignored/.test(l)), 'malformed projectRules are logged')
}
if (scenario === 'noangles') {
  assert(Array.isArray(result.history[0].findings) && result.history[0].findings.length === 0, 'a round with an empty union has findings: []')
}
if (scenario === 'angledownclean') {
  const labels = calls.map(c => c.label)
  assert(result.ready === false, 'a dead angle with zero blockers is not ready (got ready=' + result.ready + ')')
  assert(result.history[0].degraded === true && (result.history[0].enginesDown || []).includes('claude:scope'), 'round is degraded and names the dead angle')
  assert(result.rounds === 1 && !labels.includes('fix:round1'), 'nothing to fix, loop stops after one round (rounds=' + result.rounds + ')')
  assert(result.enginesClean === false, 'enginesClean is false when a Claude angle died')
}
