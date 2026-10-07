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
        // Set when this finding is the SAME concern as a prior-round finding listed in the
        // prompt (by the script-assigned id, e.g. "R1-3"), even if reworded or evolved by a fix.
        priorId:  { type: 'string' },
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

// ---- Cross-round identity -------------------------------------------------------------
// Measured on a real run: the same concern never gets the same title twice, and fixes shift
// line numbers, so `location::title` matches ~never across rounds. Identity is therefore a
// CHAIN the reviewer declares: every finding gets a script-assigned id (R{round}-{n}); the
// previous round's findings are rendered into the next review prompt with their status, and a
// reviewer that re-raises one sets `priorId`. root(f) follows the chain back to the first id.
// Exact keyOf is kept only as a fallback link for an engine that cannot carry priorId (the Codex
// wrapper), so that side degrades to the old behaviour instead of breaking.
const ledger = new Map()       // root id -> { id, severity, title, location, status, reason, escalated }
let prior = new Map()          // last round: rid -> { root, keyOf }
let priorByKey = new Map()     // last round: keyOf -> root (fallback link)

function rootOf(f) {
  if (f.priorId && prior.has(f.priorId)) return prior.get(f.priorId).root
  const byKey = priorByKey.get(keyOf(f))
  if (byKey) return byKey
  return f.rid
}
const isLinked = f => (f.priorId && prior.has(f.priorId)) || priorByKey.has(keyOf(f))

function setStatus(root, status, reason) {
  const e = ledger.get(root)
  if (e) { e.status = status; if (reason) e.reason = reason; if (/^(rejected:|stale|gate-regression)/.test(status)) e.escalated = true }
}

// Rendered into BOTH engines' review prompts and the fixer prompt: escalated entries always
// (they stay in the human's hands for the rest of the run), plus every entry from the last round.
const ledgerBlock = (forFixer) => {
  const rows = [...ledger.values()].filter(e => e.escalated || e.lastRound)
  if (!rows.length) return ''
  const lines = rows.map(e => `- ${e.id} [${e.severity}] ${e.title} (${e.location}) — ${e.status}${e.reason ? ': ' + e.reason : ''}`).join('\n')
  return forFixer
    ? `\n\n## Ledger of prior-round findings\n` +
      `Entries marked rejected:*, stale or gate-regression are in the human's hands: if a finding below restates one, ` +
      `reject it as already-escalated and name the id.\n${lines}\n`
    : `\n\n## Prior-round findings — for linkage only\n` +
      `Judge the CURRENT artifacts fresh; this list is not a checklist. If a finding you raise is the same concern as ` +
      `one below — even reworded, even changed by a fix — set its priorId to that id so it is tracked as one item. ` +
      `Entries marked rejected:*, stale or gate-regression are being decided by a person and will not be re-fixed, ` +
      `but still link them if you re-raise them.\n${lines}\n`
}

const reviewPrompt = engine =>
  `Review the spec/proposal/design under "${CHANGE}" (relative to git root). ` +
  `Do NOT modify any files — report findings only. ` +
  `Cover these angles: ${ANGLES}. Assign each finding a severity ` +
  `(CRITICAL/HIGH/MEDIUM/LOW). Treat MEDIUM as a real blocker, not a nitpick. ` +
  `Also assign each finding a category: scope, completeness, design, tasks, platform, consistency, or cross-cutting. ` +
  (CONTEXT ? `\n\n## Codebase context\n${CONTEXT}\n` : '') +
  ledgerBlock(false) +
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
function categorize({ claude, codex }, round) {
  // Two findings with the same key from ONE engine collapse (Map overwrite) — log it.
  for (const [name, fs] of [['claude', claude.findings], ['codex', codex.findings]]) {
    const seen = new Set()
    for (const f of fs) { const k = keyOf(f); if (seen.has(k)) log(`${name}:${round} reported "${f.title}" at ${f.location} twice — collapsed`); seen.add(k) }
  }
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
  // Script-assigned ids: the engine's own `id` is free text and is never used for identity.
  // A both-engine finding takes the Claude side's priorId, or the Codex side's if only it linked.
  all.forEach((f, i) => {
    f.rid = `R${round}-${i + 1}`
    if (!f.priorId && both.includes(f)) { const x = xMap.get(keyOf(f)); if (x && x.priorId) f.priorId = x.priorId }
    f.root = rootOf(f)
  })
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
    return `${i + 1}. [${f.severity}] ${f.title}  (id ${f.rid}${f.root !== f.rid ? ', continues ' + f.root : ''})\n` +
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
    `- already-escalated: it restates a ledger entry below that is marked rejected:*, stale or gate-regression.\n` +
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
    ledgerBlock(true) +
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
// Validate the fixer's index space against 1..n. A 0 means the fixer used 0-based indices, so
// every other index is suspect too: flag the whole report and do not remap. Duplicates and
// unreported indices are logged (and flagged) but the remaining report is still used.
function validateFixReport(fixResult, n, label) {
  const idx = [...(fixResult.applied || []), ...(fixResult.rejected || []), ...((fixResult.gate && fixResult.gate.blamed) || [])]
    .map(x => Number(x.index))
  const problems = []
  if (idx.includes(0)) problems.push('index 0 reported (0-based indices?) — whole report treated as suspect')
  const outOfRange = idx.filter(i => i < 0 || i > n || !Number.isInteger(i))
  if (outOfRange.length) problems.push(`out-of-range index(es) ${outOfRange.join(',')} of 1..${n}`)
  const seen = new Set(), dup = new Set()
  for (const i of [...(fixResult.applied || []), ...(fixResult.rejected || [])].map(x => Number(x.index))) { if (seen.has(i)) dup.add(i); seen.add(i) }
  if (dup.size) problems.push(`index(es) ${[...dup].join(',')} reported in both applied and rejected`)
  const missing = []; for (let i = 1; i <= n; i++) if (!seen.has(i)) missing.push(i)
  if (missing.length && !fixResult.down) problems.push(`index(es) ${missing.join(',')} not reported at all`)
  if (problems.length) log(`${label}: ⚠️ fixer report mismatch — ${problems.join('; ')}`)
  return { mismatch: problems.length > 0, suspect: idx.includes(0) }
}

function escalateRejected(fixResult, ordered, cat) {
  let n = 0
  if (fixResult.suspect) return 0   // see validateFixReport: never remap a 0-based report
  for (const a of fixResult.applied || []) {
    const f = ordered[Number(a.index) - 1]
    if (f && !escalated.has(f.root)) setStatus(f.root, 'applied', a.note || '')
  }
  for (const rej of fixResult.rejected || []) {
    const f = ordered[Number(rej.index) - 1]
    if (!f) { log(`fixer rejected index ${rej.index} which is out of range — ignored`); continue }
    if (escalated.has(f.root)) continue
    escalated.add(f.root)
    // A restatement of something already in the human's hands: silence this root so the stale
    // tracker stops counting it, but do NOT add a second copy to needsHuman.
    if (rej.disposition === 'already-escalated') { setStatus(f.root, 'rejected:already-escalated', rej.reason || ''); continue }
    setStatus(f.root, `rejected:${rej.disposition}`, rej.reason || '')
    needsHuman.push({ id: f.root, severity: f.severity, title: f.title, location: f.location, rationale: f.rationale || '',
                      seenBy: seenBy(cat, f), disposition: rej.disposition, reason: rej.reason || '' })
    n++
  }
  // A fix that regressed the project gate is escalated too (disposition gate-regression); the
  // edit stays in place for the human to judge, but the loop stops re-fixing that finding.
  const g = fixResult.gate
  if (g && g.regressed) {
    if (!(g.blamed || []).length) {
      // Regressed but the fixer could not say which edit did it: the human still has to see it,
      // and it must still block ready, so it is a HIGH entry on its own.
      const key = `gate:${g.detail || 'unattributed'}`
      if (!escalated.has(key)) {
        escalated.add(key)
        needsHuman.push({ id: key, severity: 'HIGH', title: 'Project gate regressed after this fix pass (unattributed)',
                          location: GATES.join(' ; '), rationale: '', seenBy: 'gate', disposition: 'gate-regression',
                          reason: g.detail || 'fix regressed the project gate' })
        n++
      }
    }
    for (const b of g.blamed || []) {
      const f = ordered[Number(b.index) - 1]
      if (!f) continue
      if (escalated.has(f.root)) continue
      escalated.add(f.root)
      const reason = b.detail || g.detail || 'fix regressed the project gate'
      setStatus(f.root, 'gate-regression', reason)
      needsHuman.push({ id: f.root, severity: f.severity, title: f.title, location: f.location, rationale: f.rationale || '',
                        seenBy: seenBy(cat, f), disposition: 'gate-regression', reason })
      n++
    }
  }
  return n
}

phase('Review')
const history = []
const survival = new Map()    // root id -> consecutive rounds the blocker chain has persisted
const escalated = new Set()   // root ids already moved to needsHuman (don't re-fix or re-escalate)
const needsHuman = []         // findings the fixer can't resolve -> returned for human judgement
let round = 1, cleared = null
let fixRounds = 0             // fix passes actually run (the loop may exit before fixing)
let fixerDownRounds = 0       // fix passes where the fixer agent died (nothing applied)
let gateRan = true            // false if any fix pass could not run the project gates (tool missing)
let lastAll = []              // final round's union findings, returned for history logging
let lastCat = null            // final round's categorization, used to attribute engine provenance

// MAX_ROUNDS bounds the number of FIX passes. Every fix pass is followed by a review, so the
// loop runs up to MAX_ROUNDS + 1 reviews: the last one is a verification-only pass whose
// findings are what the result reports — never a pre-fix snapshot.
const isVerifyOnly = () => round > MAX_ROUNDS

while (round <= MAX_ROUNDS + 1) {
  const r = await reviewRound(round)
  const cat = categorize(r, round)
  lastAll = cat.all
  lastCat = cat
  // Ledger upkeep: new roots get an entry; linked ones refresh title/location; mark this round's.
  for (const e of ledger.values()) e.lastRound = false
  for (const f of cat.all) {
    if (!ledger.has(f.root)) ledger.set(f.root, { id: f.root, severity: f.severity, title: f.title, location: f.location,
                                                  status: isBlocker(f.severity) ? 'open' : 'open (LOW)', reason: '', escalated: false })
    const e = ledger.get(f.root); e.lastRound = true; e.title = f.title; e.location = f.location; e.severity = worseSeverity(e.severity, f.severity)
  }
  const linked = cat.all.filter(isLinked).length
  const enginesOk = r.claudeOk && r.codexOk
  // The verdict field is informational only: "blocker" is defined in code as MEDIUM+, and an
  // engine's own PASS/FAIL is never consulted for clearing. Log a mismatch so it is visible.
  for (const [name, res] of [['claude', r.claude], ['codex', r.codex]])
    if (res.verdict === 'FAIL' && !res.findings.some(f => isBlocker(f.severity)))
      log(`${name}:${round} said FAIL but reported no MEDIUM+ finding — verdict ignored, blockers rule`)
  const down = [!r.claudeOk && 'claude', !r.codexOk && 'codex'].filter(Boolean)

  // Track persistence of each blocker NOT already escalated. A blocker still
  // present after STALE consecutive rounds is one the fixer can't resolve.
  const live = cat.blockers.filter(f => !escalated.has(f.root))
  const seenNow = new Set(live.map(f => f.root))
  for (const k of [...survival.keys()]) if (!seenNow.has(k)) survival.delete(k)  // fixed -> reset
  for (const f of live) survival.set(f.root, (survival.get(f.root) || 0) + 1)

  const stale = live.filter(f => survival.get(f.root) >= STALE)
  const fresh = live.filter(f => survival.get(f.root) < STALE)
  for (const f of stale) {
    escalated.add(f.root)
    const reason = fixRounds > 0
      ? `survived ${STALE} consecutive review rounds despite fixes`
      : `survived ${STALE} consecutive review rounds (no fix pass ran — see history.fixerDown)`
    setStatus(f.root, 'stale', reason)
    needsHuman.push({ id: f.root, severity: f.severity, title: f.title, location: f.location,
                      rationale: f.rationale || '', seenBy: seenBy(cat, f), disposition: 'stale', reason })
  }
  // Next round links against THIS round's findings.
  prior = new Map(cat.all.map(f => [f.rid, { root: f.root, keyOf: keyOf(f) }]))
  priorByKey = new Map(cat.all.map(f => [keyOf(f), f.root]))

  log(`Round ${round} REVIEW_RESULT(union): ${fmtCounts(cat.all)} | ` +
      `blockers=${cat.blockers.length} (both ${cat.both.length}, ` +
      `claude-only ${cat.onlyClaude.length}, codex-only ${cat.onlyCodex.length}) | ` +
      `fresh=${fresh.length} linked=${linked} escalated=${escalated.size}` +
      (down.length ? ` | ⚠️ ENGINE DOWN: ${down.join('+')} — NOT a clean review` : ''))
  history.push({ round, counts: fmtCounts(cat.all), blockers: cat.blockers.length,
                 // intersection = findings BOTH engines reported (by key). ~0 is normal with independent
                 // engines and means every blocker is single-engine; surfaced so the consumer can weigh it.
                 intersection: cat.both.length, claudeOnly: cat.onlyClaude.length, codexOnly: cat.onlyCodex.length,
                 fresh: fresh.length, linked, escalated: escalated.size, degraded: down.length > 0,
                 enginesDown: down })   // degraded ⇒ this round was single-engine; the either-engine rule had nothing to union

  // Clear only when both engines ran and NO blockers remain (verdict strings are not consulted).
  if (enginesOk && cat.blockers.length === 0) { cleared = cat; break }

  // If nothing fresh is left to auto-fix (only human-judgement blockers remain),
  // stop looping and escalate rather than burning rounds re-finding the same items.
  if (fresh.length === 0) break

  // Fix budget exhausted: this review was the verification pass; its findings stand as-is.
  if (isVerifyOnly()) break

  phase('Fix')
  const freshRoots = new Set(fresh.map(f => f.root))
  const blockerOrdered = [...cat.both, ...cat.onlyClaude, ...cat.onlyCodex]
    .filter(f => isBlocker(f.severity) && freshRoots.has(f.root))
    .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity])  // CRITICAL first
  const fixResult = await runFix(blockerOrdered, cat, `fix:round${round}`)
  if (fixResult.down) { history[history.length - 1].fixerDown = true; fixerDownRounds++ } else fixRounds++
  const v = validateFixReport(fixResult, blockerOrdered.length, `fix:round${round}`)
  if (v.mismatch) history[history.length - 1].fixerReportMismatch = true
  fixResult.suspect = v.suspect
  const rejectedN = escalateRejected(fixResult, blockerOrdered, cat)
  const gate = fixResult.gate || { ran: false, regressed: false }
  history[history.length - 1].gate = gate
  if (GATES.length && !fixResult.down) gateRan = gateRan && gate.ran
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
  return { ready: false, enginesClean: false, change: CHANGE, rounds: history.length, fixRounds, reason, needsHuman, history,
            gateRan: GATES.length ? gateRan : null,
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
  history[history.length - 1].lowGate = lowGate
  if (GATES.length && !lowResult.down) gateRan = gateRan && lowGate.ran
  if (lowGate.regressed) escalateRejected({ rejected: [], gate: lowGate }, lows, cleared)
  log(`LOW pass: applied=${lowsFixed} rejected=${lowRejected}` +
      (lowGate.regressed ? ` | ⚠️ GATE REGRESSED: ${lowGate.detail || ''}` : ''))
}

// enginesClean: both engines MEDIUM-clean on the last review. ready additionally requires that no
// MEDIUM+ item is waiting on the human (needsHuman) — an escalated blocker is still a blocker.
const openHuman = needsHuman.filter(h => isBlocker(h.severity))
const ready = openHuman.length === 0
return { ready, enginesClean: true, change: CHANGE, rounds: history.length, fixRounds, lowsFixed, needsHuman, history,
         gateRan: GATES.length ? gateRan : null,
         ...(ready ? {} : { reason: `engines are clean but ${openHuman.length} MEDIUM+ blocker(s) are escalated to the human (see needsHuman)` }),
         intersection: intersectionSummary(),
         findings: lastAll.map(f => ({ ...f, engine: lastCat ? seenBy(lastCat, f) : '' })) }
