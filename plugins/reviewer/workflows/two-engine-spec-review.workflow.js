export const meta = {
  name: 'two-engine-spec-review',
  description: 'Claude + Codex dual-engine spec review; each round fixes all fresh union blockers in ONE coherent session-model pass, escalating findings it cannot resolve, then clears LOW.',
  phases: [
    { title: 'Review', detail: 'Claude and Codex review the same change in parallel' },
    { title: 'Fix',    detail: 'One session-model fixer resolves all fresh blockers together with shared context; stale ones escalate' },
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
// Project gates the fixer must leave clean. Default: the Spectra analyzer + validator when the
// change is a single openspec/changes/<name> folder; args.gateCommands (string[]) overrides,
// [] disables. The script has no shell — the fixer runs them (it has Bash for this purpose).
const changeName = (() => {
  const m = String(CHANGE).trim().match(/^openspec\/changes\/([^\/\s]+)\/?$/)
  return m ? m[1] : ''
})()
const GATES = Array.isArray(A.gateCommands)
  ? A.gateCommands.filter(c => typeof c === 'string' && c.trim())
  : (changeName ? [`spectra analyze ${changeName} --json`, `spectra validate ${changeName} --json`] : [])

const SEVS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

// Both engines return this shape → union / dedup / blocker-count are pure code
// (a hard boolean), not an LLM judgement and not a brittle string match.
const FINDINGS = {
  type: 'object',
  required: ['verdict', 'findings'],
  properties: {
    verdict:  { enum: ['PASS', 'FAIL'] },
    // How the engine actually ran. A wrapper that could not obtain the engine's output
    // reports 'withheld' / 'error' with findings: [] — NEVER a placeholder finding.
    engineStatus: { enum: ['ok', 'withheld', 'error'] },
    findings: { type: 'array', items: {
      type: 'object',
      required: ['id', 'severity', 'title', 'location'],
      properties: {
        id:        { type: 'string' },
        severity:  { enum: SEVS },
        title:     { type: 'string' },
        location:  { type: 'string' },   // file:line or artifact name
        rationale: { type: 'string' },
        category: { type: 'string' },
      },
    }},
  },
}

// The fixer reports a DISPOSITION per finding (by its 1-based index in the prompt list, so
// the mapping back is deterministic and does not depend on LLM-worded keys). Anything it
// rejects is escalated to the human instead of being re-fixed next round — this is the
// async stand-in for spec-orchestrator's AskUserQuestion triage, which a background
// Workflow cannot run.
const DISPOSITIONS = ['out-of-scope', 'contradicts-spec', 'new-mechanism', 'bogus', 'already-escalated']
const FIX_RESULT = {
  type: 'object',
  required: ['applied', 'rejected'],
  properties: {
    applied: { type: 'array', items: {
      type: 'object', required: ['index'],
      properties: { index: { type: 'integer' }, note: { type: 'string' } },
    }},
    rejected: { type: 'array', items: {
      type: 'object', required: ['index', 'disposition', 'reason'],
      properties: { index: { type: 'integer' }, disposition: { enum: DISPOSITIONS }, reason: { type: 'string' } },
    }},
    // Outcome of the project gates (see GATES). A regression is an ESCALATION signal: the fixer
    // neither auto-reverts nor auto-patches; it names the finding(s) whose fix caused it.
    gate: { type: 'object', required: ['ran', 'regressed'], properties: {
      ran:       { type: 'boolean' },
      regressed: { type: 'boolean' },
      detail:    { type: 'string' },
      blamed:    { type: 'array', items: { type: 'object', required: ['index'],
                   properties: { index: { type: 'integer' }, detail: { type: 'string' } } } },
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

// Findings already handed to the human. Rendered into BOTH engines' review prompts and the
// fixer prompt, so a re-found-with-different-wording item is recognised by meaning, not by
// string key (LLM-worded keys drift between rounds; see keyOf).
const dismissed = []           // { severity, title, location, disposition, reason }
const escalatedBlock = () => dismissed.length
  ? `\n\n## Already escalated to the human — out of this loop's reach\n` +
    `Do NOT re-report or re-fix these (or restatements of them); they are being decided by a person:\n` +
    dismissed.map(d => `- [${d.severity}] ${d.title} (${d.location}) — ${d.disposition}: ${d.reason}`).join('\n') + '\n'
  : ''

const reviewPrompt = engine =>
  `Review the spec/proposal/design under "${CHANGE}" (relative to git root). ` +
  `Do NOT modify any files — report findings only. ` +
  `Cover these angles: ${ANGLES}. Assign each finding a severity ` +
  `(CRITICAL/HIGH/MEDIUM/LOW). Treat MEDIUM as a real blocker, not a nitpick. ` +
  `Also assign each finding a category: scope, completeness, design, tasks, platform, consistency, or cross-cutting. ` +
  (CONTEXT ? `\n\n## Codebase context\n${CONTEXT}\n` : '') +
  escalatedBlock() +
  `\n(Engine: ${engine}.)`

// One full dual-engine round. The barrier is real: both engines' findings must
// be in hand to build the union, categorize, and count blockers.
// A delivery failure dressed up as a finding (seen in the wild: a schema-forced wrapper
// emitted `DELIVERY-1 MEDIUM "Codex findings not transcribed: output withheld…"` whose own
// rationale said "placeholder, not a review finding"). It must never count as a blocker.
// Match only SELF-DECLARED delivery failures — never the bare word "placeholder", which real
// findings use all the time ("design.md still has placeholder diagrams").
const isPlaceholder = f =>
  /^DELIVERY-/i.test(f.id || '') ||
  /\b(not transcribed|output withheld|not a review finding|this (entry|finding) is a placeholder)\b/i
    .test(`${f.title || ''} ${f.rationale || ''}`)

// Decide whether an engine's result is a real review. A schema-satisfying object is NOT
// proof of life: the engine is down if agent() returned null, if it reported a non-ok
// engineStatus, or if it emitted only delivery placeholders. Placeholders are stripped
// from the findings either way so they can never reach the union.
function liveness(res, name) {
  if (!res) return { res: { verdict: 'FAIL', findings: [] }, ok: false }
  const real = (res.findings || []).filter(f => !isPlaceholder(f))
  const droppedList = (res.findings || []).filter(isPlaceholder)
  const dropped = droppedList.length
  // Log each dropped title so a false positive is visible, not silent.
  if (dropped) log(`${name}: dropped ${dropped} delivery placeholder(s) — not review findings: ` +
                   droppedList.map(f => `"${f.title}"`).join(', '))
  const statusBad = res.engineStatus && res.engineStatus !== 'ok'
  const onlyPlaceholders = dropped > 0 && real.length === 0
  return { res: { ...res, findings: real }, ok: !(statusBad || onlyPlaceholders) }
}

async function reviewRound(round) {
  const [claudeRaw, codexRaw] = await parallel([
    () => agent(reviewPrompt('Claude'),
      { label: `claude:${round}`, phase: 'Review', schema: FINDINGS }),
    () => agent(
      `On the Codex side, run /reviewer:spec for the change under "${CHANGE}". ` +
      `Do NOT pass --fix or --fix-all. Report findings only.\n` +
      `If Codex produced no usable output (withheld, blocked, timed out, errored), set engineStatus to ` +
      `"withheld" or "error" and return findings: [] — do NOT fabricate a placeholder finding to describe the failure. ` +
      `Set engineStatus "ok" when the findings are genuinely Codex's.\n` + reviewPrompt('Codex'),
      { label: `codex:${round}`, phase: 'Review', agentType: 'codex:codex-rescue', schema: FINDINGS }),
  ])
  const c = liveness(claudeRaw, `claude:${round}`)
  const x = liveness(codexRaw,  `codex:${round}`)
  // A dead engine must NOT count as a clean review — the *Ok flags gate `cleared`.
  return { claude: c.res, codex: x.res, claudeOk: c.ok, codexOk: x.ok }
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
    `Triage and resolve the following spec/design findings for the change under "${CHANGE}" (relative to git root). ` +
    `They are INTERRELATED — read every affected artifact in full first, then apply ONE coherent set of edits ` +
    `that resolves them together without contradicting each other. Work in severity order (CRITICAL first). ` +
    `Preserve existing structure, style and formatting; make the minimal edits needed.` +
    `\n\n## Constraints — decide BEFORE editing, per finding\n` +
    `"Resolve" is not the only valid outcome. For each finding, first decide whether it is yours to fix. ` +
    `REJECT it (do not edit) with one of these dispositions when:\n` +
    `- out-of-scope: the remedy adds work the proposal's Non-Goals / scope section excludes, or touches a repository or component the change does not own.\n` +
    `- contradicts-spec: the finding conflicts with another already-clear part of the spec and you cannot tell which side is the source of truth.\n` +
    `- new-mechanism: the remedy requires inventing a NEW requirement, capability, field, parameter, or mechanism rather than clarifying an existing one. Resolving an ambiguity by writing the current (possibly hazardous) behaviour into a SHALL counts as new-mechanism — do not codify the status quo to make a finding disappear.\n` +
    `- bogus: you verified it against the artifacts and it is not real, or it is trivial.\n` +
    `- already-escalated: it restates an item in the "Already escalated" list below.\n` +
    `APPLY a fix only when it is a clarification, restatement, or filling in obviously-missing structure, or when the fix is mechanically forced by the spec's own statements. ` +
    `Multiple valid fixes that change product behaviour, API shape, or scope → reject (new-mechanism), the human owns that call.\n` +
    `Report every finding exactly once, in applied[] or rejected[], by its 1-based index in the list below.` +
    (GATES.length
      ? `\n\n## Project gates — hard post-condition\n` +
        `Before editing anything, run each gate from the git root and keep its output as the BEFORE snapshot:\n` +
        GATES.map(g => `- \`${g}\``).join('\n') + '\n' +
        `After all edits, run them again and compare AFTER against BEFORE. Any new finding, warning, or ` +
        `failure that was not present before is a REGRESSION caused by this round's fixes — it is not a ` +
        `fix. Do NOT silence it by adding more content (e.g. adding a task to cover a requirement you just ` +
        `added), and do NOT revert on your own: report gate.regressed=true with gate.detail (the new ` +
        `gate output) and gate.blamed = the index(es) of the finding(s) whose edit introduced it. ` +
        `The human decides. If a gate command is unavailable, set gate.ran=false and say why in gate.detail.`
      : '') +
    (CONTEXT ? `\n\n## Codebase context (shared)\n${CONTEXT}\n` : '') +
    escalatedBlock() +
    `\n\n## Findings to triage (${findings.length})\n${items}`
  )
}

// One fixer per round (session model by default), holding all the findings + shared context at once.
// Returns the fixer's structured dispositions; a dead fixer yields nothing applied and nothing rejected.
// A dead fixer (agent() → null) is reported as `down: true` — the caller must not treat it as
// "applied nothing" (that would let the stale tracker claim fixes ran when none did).
async function runFix(findings, cat, label) {
  const r = await agent(batchFixPrompt(findings, cat),
    { label, phase: 'Fix', agentType: 'reviewer:spec-fixer', schema: FIX_RESULT,
      ...(FIX_MODEL ? { model: FIX_MODEL } : {}) })
  if (!r) { log(`${label}: ⚠️ FIXER DOWN — no fix was applied this pass`); return { applied: [], rejected: [], down: true } }
  return { ...r, down: false }
}

// Move fixer-rejected findings out of the loop: escalate by key (so this round's exact key is
// not re-fixed) AND by meaning (dismissed → rendered into every later prompt).
function escalateRejected(fixResult, ordered, cat) {
  let n = 0
  for (const rej of fixResult.rejected || []) {
    const f = ordered[Number(rej.index) - 1]
    if (!f) { log(`fixer rejected index ${rej.index} which is out of range — ignored`); continue }
    const k = keyOf(f)
    if (escalated.has(k)) continue
    escalated.add(k)
    // A restatement of something already in the human's hands: silence this round's key so the
    // stale tracker stops counting it, but do NOT add a second copy to needsHuman/dismissed.
    if (rej.disposition === 'already-escalated') continue
    const entry = { severity: f.severity, title: f.title, location: f.location, rationale: f.rationale || '',
                    seenBy: seenBy(cat, f), disposition: rej.disposition, reason: rej.reason || '' }
    needsHuman.push(entry)
    dismissed.push(entry)
    n++
  }
  // A fix that regressed the project gate is escalated too (disposition gate-regression); the
  // edit stays in place for the human to judge, but the loop stops re-fixing that finding.
  const g = fixResult.gate
  if (g && g.regressed) {
    for (const b of g.blamed || []) {
      const f = ordered[Number(b.index) - 1]
      if (!f) continue
      const k = keyOf(f)
      if (escalated.has(k)) continue
      escalated.add(k)
      const entry = { severity: f.severity, title: f.title, location: f.location, rationale: f.rationale || '',
                      seenBy: seenBy(cat, f), disposition: 'gate-regression',
                      reason: b.detail || g.detail || 'fix regressed the project gate' }
      needsHuman.push(entry)
      dismissed.push(entry)
      n++
    }
  }
  return n
}

phase('Review')
const history = []
const survival = new Map()    // blocker key -> consecutive rounds it has persisted
const escalated = new Set()   // keys already moved to needsHuman (don't re-fix or re-escalate)
const needsHuman = []         // findings the fixer can't resolve -> returned for human judgement
let round = 1, cleared = null
let fixRounds = 0             // fix passes actually run (the loop may exit before fixing)
let fixerDownRounds = 0       // fix passes where the fixer agent died (nothing applied)
let lastAll = []              // final round's union findings, returned for history logging
let lastCat = null            // final round's categorization, used to attribute engine provenance

// MAX_ROUNDS bounds the number of FIX passes. Every fix pass is followed by a review, so the
// loop runs up to MAX_ROUNDS + 1 reviews: the last one is a verification-only pass whose
// findings are what the result reports — never a pre-fix snapshot.
const isVerifyOnly = () => round > MAX_ROUNDS

while (round <= MAX_ROUNDS + 1) {
  const r = await reviewRound(round)
  const cat = categorize(r)
  lastAll = cat.all
  lastCat = cat
  const enginesOk = r.claudeOk && r.codexOk
  // The verdict field is informational only: "blocker" is defined in code as MEDIUM+, and an
  // engine's own PASS/FAIL is never consulted for clearing. Log a mismatch so it is visible.
  for (const [name, res] of [['claude', r.claude], ['codex', r.codex]])
    if (res.verdict === 'FAIL' && !res.findings.some(f => isBlocker(f.severity)))
      log(`${name}:${round} said FAIL but reported no MEDIUM+ finding — verdict ignored, blockers rule`)
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
    const entry = { severity: f.severity, title: f.title, location: f.location,
                    rationale: f.rationale || '', seenBy: seenBy(cat, f),
                    disposition: 'stale',
                    reason: fixRounds > 0
                      ? `survived ${STALE} consecutive review rounds despite fixes`
                      : `survived ${STALE} consecutive review rounds (no fix pass ran — see history.fixerDown)` }
    needsHuman.push(entry)
    dismissed.push(entry)
  }

  log(`Round ${round} REVIEW_RESULT(union): ${fmtCounts(cat.all)} | ` +
      `blockers=${cat.blockers.length} (both ${cat.both.length}, ` +
      `claude-only ${cat.onlyClaude.length}, codex-only ${cat.onlyCodex.length}) | ` +
      `fresh=${fresh.length} escalated=${escalated.size}` +
      (down.length ? ` | ⚠️ ENGINE DOWN: ${down.join('+')} — NOT a clean review` : ''))
  history.push({ round, counts: fmtCounts(cat.all), blockers: cat.blockers.length,
                 // intersection = findings BOTH engines reported (by key). ~0 is normal with independent
                 // engines and means every blocker is single-engine; surfaced so the consumer can weigh it.
                 intersection: cat.both.length, claudeOnly: cat.onlyClaude.length, codexOnly: cat.onlyCodex.length,
                 fresh: fresh.length, escalated: escalated.size, degraded: down.length > 0,
                 enginesDown: down })   // degraded ⇒ this round was single-engine; the either-engine rule had nothing to union

  // Clear only when both engines ran and NO blockers remain (verdict strings are not consulted).
  if (enginesOk && cat.blockers.length === 0) { cleared = cat; break }

  // If nothing fresh is left to auto-fix (only human-judgement blockers remain),
  // stop looping and escalate rather than burning rounds re-finding the same items.
  if (fresh.length === 0) break

  // Fix budget exhausted: this review was the verification pass; its findings stand as-is.
  if (isVerifyOnly()) break

  phase('Fix')
  const freshKeys = new Set(fresh.map(keyOf))
  const blockerOrdered = [...cat.both, ...cat.onlyClaude, ...cat.onlyCodex]
    .filter(f => isBlocker(f.severity) && freshKeys.has(keyOf(f)))
    .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity])  // CRITICAL first
  const fixResult = await runFix(blockerOrdered, cat, `fix:round${round}`)
  if (fixResult.down) { history[history.length - 1].fixerDown = true; fixerDownRounds++ } else fixRounds++
  const rejectedN = escalateRejected(fixResult, blockerOrdered, cat)
  const gate = fixResult.gate || { ran: false, regressed: false }
  history[history.length - 1].gate = gate
  log(`Round ${round} FIX_RESULT: applied=${(fixResult.applied || []).length} rejected=${rejectedN}` +
      (rejectedN ? ` → escalated to human (${escalated.size} total)` : '') +
      (gate.regressed ? ` | ⚠️ GATE REGRESSED: ${gate.detail || ''}` : (gate.ran ? ' | gate clean' : (GATES.length ? ' | gate not run' : ''))))
  round++
  phase('Review')
}

// Cross-engine agreement on the final round, for the result object. `both` is the count of
// findings the two engines reported identically; `anyRound` is the max over all rounds.
const intersectionSummary = () => ({
  both: lastCat ? lastCat.both.length : 0,
  claudeOnly: lastCat ? lastCat.onlyClaude.length : 0,
  codexOnly: lastCat ? lastCat.onlyCodex.length : 0,
  anyRound: Math.max(0, ...history.map(h => h.intersection || 0)),
  rounds: history.length,
})

if (!cleared) {
  const lastDegraded = history.length > 0 && history[history.length - 1].degraded
  const reason = lastDegraded
    ? 'an engine was DOWN on the final round — the review is NOT trustworthy (see history)'
    : fixerDownRounds > 0 && fixRounds === 0
      ? `the fixer agent was DOWN on every fix pass (${fixerDownRounds}) — nothing was fixed (see history.fixerDown)`
      : needsHuman.length > 0
        ? `${needsHuman.length} blocker(s) need human judgement — the fixer would not or could not resolve them (see needsHuman)` +
          (fixerDownRounds ? `; the fixer was DOWN on ${fixerDownRounds} pass(es)` : '')
        : `still had ${lastCat ? lastCat.blockers.length : '?'} blocker(s) after ${fixRounds} fix round(s); ` +
          `the listed findings are from a verification review of the post-fix artifacts`
  return { ready: false, change: CHANGE, rounds: history.length, fixRounds, reason, needsHuman, history,
            intersection: intersectionSummary(),
            findings: lastAll.map(f => ({ ...f, engine: lastCat ? seenBy(lastCat, f) : '' })) }
}

// After blockers clear, fix remaining LOW issues (no re-review needed).
const lows = cleared.all.filter(f => f.severity === 'LOW')
let lowsFixed = 0
if (lows.length) {
  phase('Fix')
  const lowResult = await runFix(lows, cleared, 'fix-low')
  lowsFixed = (lowResult.applied || []).length
  // LOW rejections are informational only (not blockers), but a LOW fix that regresses the
  // project gate is still a gate-regression and must reach the human.
  const lowRejected = (lowResult.rejected || []).length
  const lowGate = lowResult.gate || { ran: false, regressed: false }
  if (lowGate.regressed) escalateRejected({ rejected: [], gate: lowGate }, lows, cleared)
  log(`LOW pass: applied=${lowsFixed} rejected=${lowRejected}` +
      (lowGate.regressed ? ` | ⚠️ GATE REGRESSED: ${lowGate.detail || ''}` : ''))
}

// ready:true means both engines are MEDIUM-clean on the last review; needsHuman may still be
// non-empty (fixer-rejected items the engines were told not to re-report) — the caller must
// surface them.
return { ready: true, change: CHANGE, rounds: history.length, fixRounds, lowsFixed, needsHuman, history,
         intersection: intersectionSummary(),
         findings: lastAll.map(f => ({ ...f, engine: lastCat ? seenBy(lastCat, f) : '' })) }
