export const meta = {
  name: 'two-engine-spec-review',
  description: 'Claude + Codex dual-engine spec review; each round fixes all fresh union blockers in ONE coherent Opus pass, escalating findings it cannot resolve, then clears LOW.',
  phases: [
    { title: 'Review', detail: 'Claude and Codex review the same change in parallel' },
    { title: 'Fix',    detail: 'One Opus fixer resolves all fresh blockers together with shared context; stale ones escalate' },
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
// A blocker that survives this many consecutive rounds (the fixer can't resolve it)
// is escalated to the human instead of looping forever.
const STALE = Number(A.staleThreshold) > 0 ? Number(A.staleThreshold) : 2
// The fix phase runs as a SINGLE strong-model agent per round (not one-agent-per-finding),
// so it holds all of the round's blockers + the codebase context in one context and can make
// coherent cross-file edits — the way a single long-context session would. Default: inherit the session model;
// override via args.fixModel if a run needs something cheaper.
const FIX_MODEL = (typeof A.fixModel === 'string' && A.fixModel.trim()) ? A.fixModel.trim() : ''

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
  // explicitly via *Ok flags: a dead engine must NOT count as a clean review.
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

const seenBy = (cat, f) =>
  cat.both.includes(f) ? 'both' : (cat.onlyClaude.includes(f) ? 'claude' : 'codex')

// Build ONE directive covering all of a round's findings. Findings on a spec are
// highly interrelated (the same license/workspace/path decision shows up across
// design.md, tasks.md and spec.md), so fixing them in a single context lets the
// fixer make consistent cross-file edits instead of contradictory local ones.
// Per finding we say whether BOTH engines saw it (trust it) or only one (verify
// first, to guard against a single reviewer hallucinating).
function batchFixPrompt(findings, cat) {
  const items = findings.map((f, i) => {
    const who = seenBy(cat, f)
    const trust = who === 'both'
      ? 'Both engines flagged this — treat it as real.'
      : `Only the ${who} engine flagged this — verify it is real (not a hallucination) before editing; skip if bogus or trivial.`
    return `${i + 1}. [${f.severity}] ${f.title}\n` +
           `   Location: ${f.location}\n` +
           `   ${trust}\n` +
           `   Rationale: ${f.rationale || '(none provided)'}`
  }).join('\n\n')
  return (
    `Resolve the following spec/design findings for the change under "${CHANGE}" (relative to git root). ` +
    `They are INTERRELATED — read every affected artifact in full first, then apply ONE coherent set of edits ` +
    `that resolves them together without contradicting each other. Work in severity order (CRITICAL first). ` +
    `Preserve existing structure, style and formatting; make the minimal edits needed.` +
    (CONTEXT ? `\n\n## Codebase context (shared)\n${CONTEXT}\n` : '') +
    `\n\n## Findings to resolve (${findings.length})\n${items}`
  )
}

// One strong-model fixer per round, holding all the findings + shared context at once.
async function runFix(findings, cat, label) {
  await agent(batchFixPrompt(findings, cat),
    { label, phase: 'Fix', agentType: 'reviewer:spec-fixer',
      ...(FIX_MODEL ? { model: FIX_MODEL } : {}) })
}

phase('Review')
const history = []
const survival = new Map()    // blocker key -> consecutive rounds it has persisted
const escalated = new Set()   // keys already moved to needsHuman (don't re-fix or re-escalate)
const needsHuman = []         // findings the fixer can't resolve -> returned for human judgement
let round = 1, cleared = null
let lastAll = []              // final round's union findings, returned for history logging

while (round <= MAX_ROUNDS) {
  const r = await reviewRound(round)
  const cat = categorize(r)
  lastAll = cat.all
  const enginesOk = r.claudeOk && r.codexOk
  const noFailVerdict = r.claude.verdict !== 'FAIL' && r.codex.verdict !== 'FAIL'
  const down = [!r.claudeOk && 'claude', !r.codexOk && 'codex'].filter(Boolean)

  // Track persistence of each blocker NOT already escalated. A blocker still
  // present after STALE consecutive rounds is one the fixer can't resolve.
  const live = cat.blockers.filter(f => !escalated.has(keyOf(f)))
  const seenNow = new Set(live.map(keyOf))
  for (const k of [...survival.keys()]) if (!seenNow.has(k)) survival.delete(k)  // fixed -> reset
  for (const f of live) survival.set(keyOf(f), (survival.get(keyOf(f)) || 0) + 1)

  const stale = live.filter(f => survival.get(keyOf(f)) >= STALE)
  const fresh = live.filter(f => survival.get(keyOf(f)) < STALE)
  for (const f of stale) {
    escalated.add(keyOf(f))
    needsHuman.push({ severity: f.severity, title: f.title, location: f.location,
                      rationale: f.rationale || '', seenBy: seenBy(cat, f) })
  }

  log(`Round ${round} REVIEW_RESULT(union): ${fmtCounts(cat.all)} | ` +
      `blockers=${cat.blockers.length} (both ${cat.both.length}, ` +
      `claude-only ${cat.onlyClaude.length}, codex-only ${cat.onlyCodex.length}) | ` +
      `fresh=${fresh.length} escalated=${escalated.size}` +
      (down.length ? ` | ⚠️ ENGINE DOWN: ${down.join('+')} — NOT a clean review` : ''))
  history.push({ round, counts: fmtCounts(cat.all), blockers: cat.blockers.length,
                 fresh: fresh.length, escalated: escalated.size, degraded: down.length > 0 })

  // Clear only when both engines ran, neither said FAIL, and NO blockers remain.
  if (enginesOk && noFailVerdict && cat.blockers.length === 0) { cleared = cat; break }

  // If nothing fresh is left to auto-fix (only human-judgement blockers remain),
  // stop looping and escalate rather than burning rounds re-finding the same items.
  if (fresh.length === 0) break

  phase('Fix')
  const freshKeys = new Set(fresh.map(keyOf))
  const blockerOrdered = [...cat.both, ...cat.onlyClaude, ...cat.onlyCodex]
    .filter(f => isBlocker(f.severity) && freshKeys.has(keyOf(f)))
    .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity])  // CRITICAL first
  await runFix(blockerOrdered, cat, `fix:round${round}`)
  round++
  phase('Review')
}

if (!cleared) {
  const lastDegraded = history.length > 0 && history[history.length - 1].degraded
  const reason = lastDegraded
    ? 'an engine was DOWN on the final round — the review is NOT trustworthy (see history)'
    : needsHuman.length > 0
      ? `${needsHuman.length} blocker(s) need human judgement — the fixer could not resolve them (see needsHuman)`
      : `still had blockers after ${MAX_ROUNDS} rounds; final-round fixes were applied but NOT re-reviewed`
  return { ready: false, change: CHANGE, rounds: round - 1, reason, needsHuman, history, findings: lastAll }
}

// After blockers clear, fix remaining LOW issues (no re-review needed).
const lows = cleared.all.filter(f => f.severity === 'LOW')
if (lows.length) {
  phase('Fix')
  await runFix(lows, cleared, 'fix-low')
}

return { ready: true, change: CHANGE, rounds: round, lowsFixed: lows.length, needsHuman: [], history, findings: lastAll }
