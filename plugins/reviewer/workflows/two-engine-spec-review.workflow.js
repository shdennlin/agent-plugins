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
// others a JSON-encoded string. Normalize before reading fields so the dispatch
// caller can't break us by passing either form.
const A = typeof args === 'string' ? (args.trim() ? JSON.parse(args) : {}) : (args || {})
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
  // agent() returns null on failure → degrade to FAIL/empty so we never falsely pass.
  return { claude: claude || { verdict: 'FAIL', findings: [] },
           codex:  codex  || { verdict: 'FAIL', findings: [] } }
}

// Pure-code categorization. BLOCKER rule: MEDIUM+ in EITHER engine counts;
// a PASS verdict from one engine alone is NOT enough (matches the spec prompt).
function categorize({ claude, codex }) {
  const cMap = new Map(claude.findings.map(f => [keyOf(f), f]))
  const xMap = new Map(codex.findings.map(f => [keyOf(f), f]))
  const both = [], onlyClaude = [], onlyCodex = []
  for (const [k, f] of cMap) (xMap.has(k) ? both : onlyClaude).push(f)
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

phase('Review')
const history = []
let round = 1, cleared = null

while (round <= MAX_ROUNDS) {
  const cat = categorize(await reviewRound(round))
  // Standardized anchor line for humans / logs; the decision itself is pure code below.
  log(`Round ${round} REVIEW_RESULT(union): ${fmtCounts(cat.all)} | ` +
      `blockers=${cat.blockers.length} (both ${cat.both.length}, ` +
      `claude-only ${cat.onlyClaude.length}, codex-only ${cat.onlyCodex.length})`)
  history.push({ round, counts: fmtCounts(cat.all), blockers: cat.blockers.length })

  if (cat.blockers.length === 0) { cleared = cat; break }   // both engines MEDIUM-clean → done

  // Fix order: both-saw first (highest confidence), then claude-only, then codex-only. Blockers only.
  phase('Fix')
  const blockerOrdered = [...cat.both, ...cat.onlyClaude, ...cat.onlyCodex].filter(f => isBlocker(f.severity))
  await parallel(blockerOrdered.map(f => () => agent(
    fixPrompt(f, cat.both.includes(f)),
    { label: `fix:${f.id}`, phase: 'Fix', agentType: 'reviewer:spec-fixer' })))
  round++
  phase('Review')
}

if (!cleared) {
  return { ready: false, change: CHANGE, rounds: round - 1,
           reason: `still had blockers after ${MAX_ROUNDS} rounds`, history }
}

// After blockers clear, fix remaining LOW issues (no re-review needed).
const lows = cleared.all.filter(f => f.severity === 'LOW')
if (lows.length) {
  phase('Fix')
  await parallel(lows.map(f => () => agent(
    fixPrompt(f, cleared.both.includes(f)),
    { label: `fix-low:${f.id}`, phase: 'Fix', agentType: 'reviewer:spec-fixer' })))
}

return { ready: true, change: CHANGE, rounds: round, lowsFixed: lows.length, history }
