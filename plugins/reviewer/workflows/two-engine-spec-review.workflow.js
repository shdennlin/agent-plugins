export const meta = {
  name: 'two-engine-spec-review',
  description: 'Claude + Codex dual-engine spec review; loops fixes until both engines are MEDIUM-clean, then clears LOW.',
  phases: [
    { title: 'Review', detail: 'Claude and Codex review the same change in parallel' },
    { title: 'Fix',    detail: 'Fix union blockers (both-saw first), then clear LOW' },
  ],
}

// --- Inputs (passed by the command / SKILL.md via args) ---
// Be robust to how the runtime delivers args: some hand the script the raw object,
// others a JSON-encoded string. Normalize before reading fields. A non-JSON string
// gets a friendly error instead of a raw SyntaxError.
let A
if (typeof args === 'string') {
  try { A = args.trim() ? JSON.parse(args) : {} }
  catch {
    throw new Error('two-engine-spec-review: args arrived as a non-JSON string; expected an object (or JSON-encoded object) with a `change` field')
  }
} else {
  A = args || {}
}
if (!A.change) {
  throw new Error('two-engine-spec-review: args.change (path to the change, relative to git root) is required')
}
const CHANGE = A.change
const MAX_ROUNDS = Number(A.maxRounds) > 0 ? Number(A.maxRounds) : 3
const CONTEXT = A.codebaseContext || ''   // optional code-explorer summary, shared by both engines

const SEVS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

// Both engines return this shape → union / dedup / blocker-count are pure code
// (a hard boolean), not an LLM judgement and not a brittle string match.
const FINDINGS = {
  type: 'object',
  required: ['verdict', 'findings'],
  properties: {
    verdict:  { enum: ['PASS', 'FAIL'] },
    findings: { type: 'array', items: {
      type: 'object',
      required: ['id', 'severity', 'title', 'location'],
      properties: {
        id:        { type: 'string' },
        severity:  { enum: SEVS },
        title:     { type: 'string' },
        location:  { type: 'string' },   // file:line or artifact name
        rationale: { type: 'string' },
      },
    }},
  },
}

const isBlocker = s => s === 'CRITICAL' || s === 'HIGH' || s === 'MEDIUM'
const SEV_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }
const worseSeverity = (a, b) => (SEV_RANK[b] > SEV_RANK[a] ? b : a)
const keyOf = f => `${f.location}::${f.title}`.toLowerCase().replace(/\s+/g, ' ')
const fmtCounts = fs => SEVS.map(s => `${s.toLowerCase()}=${fs.filter(f => f.severity === s).length}`).join(' ')

// Multi-angle review intent encoded in the prompt (decoupled from reviewer's
// internal agent names, which are mid-refactor). Mirrors reviewer's angles.
const ANGLES =
  'scope (problem clarity, goals, boundaries), completeness (missing requirements/cases), ' +
  'tasks (task list correctness/ordering), platform (platform-specific gaps), ' +
  'design (design soundness vs the proposal), consistency (contradictions across artifacts)'

const reviewPrompt = engine =>
  `Review the spec/proposal/design under "${CHANGE}" (relative to git root). ` +
  `Do NOT modify any files — report findings only. ` +
  `Cover these angles: ${ANGLES}. Assign each finding a severity ` +
  `(CRITICAL/HIGH/MEDIUM/LOW). Treat MEDIUM as a real blocker, not a nitpick. ` +
  (CONTEXT ? `\n\n## Codebase context\n${CONTEXT}\n` : '') +
  `\n(Engine: ${engine}.)`

// One full dual-engine round. The barrier is real: both engines' findings must
// be in hand to build the union, categorize, and count blockers.
async function reviewRound(round) {
  const [claude, codex] = await parallel([
    () => agent(reviewPrompt('Claude'),
      { label: `claude:${round}`, phase: 'Review', schema: FINDINGS }),
    () => agent(
      `On the Codex side, run /reviewer:spec for the change under "${CHANGE}". ` +
      `Do NOT pass --fix or --fix-all. Report findings only.\n` + reviewPrompt('Codex'),
      { label: `codex:${round}`, phase: 'Review', agentType: 'codex:codex-rescue', schema: FINDINGS }),
  ])
  // agent() returns null on failure (engine died / plugin missing). Track that
  // explicitly via *Ok flags: a dead engine must NOT count as a clean review
  // (see the clear condition below) — otherwise a missing Codex would silently
  // downgrade to a single-engine PASS.
  return {
    claude:   claude || { verdict: 'FAIL', findings: [] },
    codex:    codex  || { verdict: 'FAIL', findings: [] },
    claudeOk: !!claude,
    codexOk:  !!codex,
  }
}

// Pure-code categorization. BLOCKER rule: MEDIUM+ in EITHER engine counts;
// a PASS verdict from one engine alone is NOT enough (matches the spec prompt).
function categorize({ claude, codex }) {
  const cMap = new Map(claude.findings.map(f => [keyOf(f), f]))
  const xMap = new Map(codex.findings.map(f => [keyOf(f), f]))
  const both = [], onlyClaude = [], onlyCodex = []
  for (const [k, f] of cMap) {
    if (xMap.has(k)) {
      // Both engines flagged it — keep the WORSE severity of the two, so a HIGH
      // from one engine is not masked by a LOW from the other (would undercount).
      both.push({ ...f, severity: worseSeverity(f.severity, xMap.get(k).severity) })
    } else {
      onlyClaude.push(f)
    }
  }
  for (const [k, f] of xMap) if (!cMap.has(k)) onlyCodex.push(f)
  const all = [...both, ...onlyClaude, ...onlyCodex]
  return { both, onlyClaude, onlyCodex, all, blockers: all.filter(f => isBlocker(f.severity)) }
}

// Single-engine findings (not both-saw) must be verified real before fixing,
// to guard against reviewer hallucination.
function fixPrompt(f, isBoth) {
  return `Fix this spec finding under "${CHANGE}": [${f.severity}] ${f.title} @ ${f.location}. ` +
    (isBoth ? '' : 'First verify it is real (not a reviewer hallucination); skip if bogus or trivial. ') +
    `Rationale: ${f.rationale || '(none provided)'}`
}

// Run fixers without clobbering: group findings by file (the part before ':'),
// so fixers on DIFFERENT files run in parallel, but fixers on the SAME file run
// sequentially — concurrent edits to one artifact would overwrite each other.
async function runFixers(findings, bothSet, labelPrefix) {
  const groups = new Map()
  for (const f of findings) {
    const file = String(f.location).split(':')[0].trim() || String(f.location)
    if (!groups.has(file)) groups.set(file, [])
    groups.get(file).push(f)
  }
  await parallel([...groups.values()].map(group => async () => {
    for (const f of group) {
      await agent(fixPrompt(f, bothSet.includes(f)),
        { label: `${labelPrefix}:${f.id}`, phase: 'Fix', agentType: 'reviewer:spec-fixer' })
    }
  }))
}

phase('Review')
const history = []
let round = 1, cleared = null

while (round <= MAX_ROUNDS) {
  const r = await reviewRound(round)
  const cat = categorize(r)
  // A dead engine (null result) or an engine self-reporting FAIL must NOT clear:
  // the dual-engine guarantee requires BOTH engines to actually run and pass.
  const enginesOk = r.claudeOk && r.codexOk
  const noFailVerdict = r.claude.verdict !== 'FAIL' && r.codex.verdict !== 'FAIL'
  const down = [!r.claudeOk && 'claude', !r.codexOk && 'codex'].filter(Boolean)

  log(`Round ${round} REVIEW_RESULT(union): ${fmtCounts(cat.all)} | ` +
      `blockers=${cat.blockers.length} (both ${cat.both.length}, ` +
      `claude-only ${cat.onlyClaude.length}, codex-only ${cat.onlyCodex.length})` +
      (down.length ? ` | ⚠️ ENGINE DOWN: ${down.join('+')} — NOT a clean review` : ''))
  history.push({ round, counts: fmtCounts(cat.all), blockers: cat.blockers.length, degraded: down.length > 0 })

  // Clear only when both engines ran, neither said FAIL, and the union has no blockers.
  if (enginesOk && noFailVerdict && cat.blockers.length === 0) { cleared = cat; break }

  // Fix order: both-saw first (highest confidence), then claude-only, then codex-only. Blockers only.
  phase('Fix')
  const blockerOrdered = [...cat.both, ...cat.onlyClaude, ...cat.onlyCodex].filter(f => isBlocker(f.severity))
  await runFixers(blockerOrdered, cat.both, 'fix')
  round++
  phase('Review')
}

if (!cleared) {
  const lastDegraded = history.length > 0 && history[history.length - 1].degraded
  return {
    ready: false, change: CHANGE, rounds: round - 1,
    reason: lastDegraded
      ? 'an engine was DOWN on the final round — the review is NOT trustworthy (see history)'
      : `still had blockers after ${MAX_ROUNDS} rounds; final-round fixes were applied but NOT re-reviewed`,
    history,
  }
}

// After blockers clear, fix remaining LOW issues (no re-review needed).
const lows = cleared.all.filter(f => f.severity === 'LOW')
if (lows.length) {
  phase('Fix')
  await runFixers(lows, cleared.both, 'fix-low')
}

return { ready: true, change: CHANGE, rounds: round, lowsFixed: lows.length, history }
