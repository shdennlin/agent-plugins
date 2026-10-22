# Spec-dual Claude-side Angle Fan-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `/reviewer:spec-dual`, the Claude engine reviews with one `agent()` per spec angle in round 1 and one per angle group in later rounds, with the angle list read from `templates/review-angles.yaml` and the project rules read from `.claude/reviewer/rules.yaml` by the skill and passed through `args`, so both engines review against the same angles and the same harvested rules as `/reviewer:spec`.

**Architecture:** `skills/spec-dual/SKILL.md` reads the `spec:` section of the angles template, decides whether `composition` applies (same judgment the spec-orchestrator uses), and passes `args.angles = [{ key, label, focus }]`. `workflows/two-engine-spec-review.workflow.js` fans the Claude side out (round 1: one agent per angle; rounds ≥ 2: three fixed groups), unions the Claude findings in pure code (same `keyOf`, worse severity wins), and feeds the existing two-engine `categorize()` unchanged. The Codex side, the fixer, the ledger and the return shape stay as they are, plus one new `history` field. With no `args.angles` the script keeps today's single-agent behaviour. The harness maps per-angle labels onto existing per-round stubs by `category`, so current scenarios keep working and new scenarios assert the fan-out.

**Tech Stack:** Workflow script (plain JS evaluated by the Workflow tool, no imports, no fs), `node` harness `tests/two-engine.harness.mjs` (no Claude, no network), markdown skill.

**Spec:** No written spec; agreed in conversation on 2026-10-22 (option C of the cost comparison). The "Design summary" below is the authority.

## Design summary

- `args.angles`: array of `{ key: string, label: string, focus: string }`, in template order. Absent, non-array or empty → legacy path: one Claude agent per round, label `claude:<round>`, prompt unchanged.
- Round 1 labels: `claude:<key>:1`, one agent per angle, all in the same `parallel([...])` as the Codex agent.
- Rounds ≥ 2 labels: `claude:<group>:<round>` where `<group>` is the group's keys joined with `+`. Fixed grouping by key: G1 = `scope`, `design`; G2 = `completeness`, `consistency`, `composition`; G3 = `tasks`, `platform`. Any key not in the table joins G3. A group with no present keys is skipped (never an empty agent).
- Per-angle prompt = the current `reviewPrompt` with `Cover these angles: …` replaced by `## Your review angle: <label>\n<focus>\nReview ONLY through this angle.` and `category` fixed to the angle key (`cross-cutting` for `composition`). Group prompt lists each angle's label and focus in turn and allows any of the group's keys as category. Context and ledger blocks unchanged.
- Claude-side union (new, pure code, before `categorize`): concatenate every live Claude agent's findings; collapse equal `keyOf` keeping the worse severity and the first non-empty `priorId`; log each collapse as `claude:<round>: "<title>" at <location> reported by <n> angles — collapsed`. A finding with no `category` gets the agent's angle key (first key for a group).
- Liveness: each Claude agent passes through `liveness()` separately. `claudeOk` = every Claude agent ok. A dead or placeholder-only angle is listed in `enginesDown` as `claude:<label-middle>` (e.g. `claude:scope`), the round is `degraded`, and `cleared` cannot be set that round; the live angles' findings still enter the union.
- `history` rows gain `claudeAgents: string[]` = the Claude labels used that round (legacy path: `['claude:<round>']`).
- `templates/review-angles.yaml` is not modified. The skill reads it with the Read tool at dispatch time; the workflow never reads files.
- Category ↔ key mapping (shared by the workflow's `unionClaude` and the harness split rule): category equals the angle key, except `cross-cutting` ↔ key `composition`. A finding whose category matches no key is treated like an uncategorized one.
- Group names use table order for known keys; unknown keys are appended in `args.angles` order.
- The Codex prompt's `Cover these angles: …` sentence is built from the `args.angles` labels when they are present (legacy path keeps the constant), so the template is the single source of truth for both engines.
- Harness: `globalThis.args.angles` defaults to the six spec angles (keys only matter: `scope, completeness, tasks, platform, design, consistency`); `agent()` resolves a label `claude:<x>:<round>` by first looking for that exact key in the scenario, else splitting the scenario's `claude:<round>` stub by `category` using the mapping above (a finding goes to the angle/group whose keys contain its mapped category; findings without a category or with an unknown one go to the first Claude label of that round; `null` stub → every angle null). Scenarios can set `__angles: null` to exercise the legacy path. Existing scenario STUBS stay as they are; existing ASSERTIONS that name `claude:<round>` labels are rewritten with two helpers, `claudeCalls(round)` (every call whose label matches `claude:*:<round>` or `claude:<round>`) and `hasClaudeRound(round)`.
- `args.projectRules`: object `{ proposal?: string[], specs?: string[], design?: string[], tasks?: string[] }` (the skill parses `.claude/reviewer/rules.yaml` into JSON; the workflow never parses YAML). Absent, non-object or empty → no rules section anywhere. Area mapping (same as `agents/spec-orchestrator.md:73-75`): `scope→proposal`, `completeness→specs`, `design→design`, `tasks→tasks`; `platform`, `consistency`, `composition` and unknown keys map to no area. A rules section is rendered only when the mapped area has at least one rule: `## Project Rules (additional criteria — treat violations as findings)` followed by one `- ` line per rule. A group prompt carries the union of its keys' areas (each area once); the Codex prompt and the legacy single-agent prompt carry every non-empty area, each under its own `### <area>` heading.
- Version bump to `1.16.0` in both manifests, last task.

## Global Constraints

- The workflow script has no `require`, no `import`, no filesystem; everything it needs arrives in `args`.
- Codex side, fixer prompt, dispositions, ledger, `STALE`, `GATES`, return keys `{ ready, enginesClean, reason?, change, rounds, fixRounds, lowsFixed?, needsHuman, intersection, gateRan, history, findings }` are unchanged.
- Every existing harness scenario must still pass with no edits to its stubs (assertions may be rewritten to the label helpers), and the harness exits 1 on any failure: `node plugins/reviewer/tests/two-engine.harness.mjs`.
- Commit convention `<type>(reviewer): <description>`.
- Version `1.16.0` in `plugins/reviewer/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, same commit.

## Review Focus

1. `args.angles` arrives as a JSON string inside a JSON string (cmux hands `args` as a string, see memory): after the existing `JSON.parse` of `args`, `A.angles` must be an array of objects; a string there is treated as absent with a `log()` line, never a crash. Test pinned in Task 2 (`noangles` scenario plus a `badangles` variant).
2. One angle agent returns `null` in round 1 while the others report: the round is degraded, `cleared` is not set even with zero blockers, and the live findings are still fixed. Test pinned in Task 2 (`angledown`).
3. Two angles report the same `location::title` with different severities: one finding, worse severity, one `rid`, one collapse log line. Test pinned in Task 2 (`anglecollapse`).
4. Round 2 after a fix: the group labels appear (`claude:scope+design:2`, `claude:completeness+consistency:2`, `claude:tasks+platform:2`), never per-angle labels, and the ledger block reaches every group prompt. Test pinned in Task 2 (`fanout`).
5. `composition` present: seven agents in round 1 and it rides in G2 in round 2; a key the table does not know lands in G3. Test pinned in Task 2 (`composition`).
6. `args.projectRules` arrives as a YAML string or an array instead of an object: ignored with one `log()` line, no crash, no rules section. Test pinned in Task 3 (`badrules`).

---

### Task 1: Harness support for per-angle labels and the failing `fanout` scenario

**Files:**
- Modify: `plugins/reviewer/tests/two-engine.harness.mjs:168-200` (args, `agent()` stub) and the scenarios/assertions blocks
- Test: the harness itself (`node plugins/reviewer/tests/two-engine.harness.mjs fanout` must FAIL before Task 2 and PASS after)

**Interfaces:**
- Produces: `globalThis.args.angles` default = `SPEC_ANGLES` (six `{key,label,focus}` objects with one-line focus texts); label resolution rule for `claude:<x>:<round>` as in the Design summary; scenario option `angles: null` (legacy) honoured via `S.__angles` (a reserved key read by the harness, not a stub label); `calls[]` keeps `{ label, prompt }`.

- [ ] **Step 1: Add the angle fixture and label resolution to the harness**

Add `const SPEC_ANGLES = [...]` (keys `scope, completeness, tasks, platform, design, consistency`, labels copied from the template, focus one line each). Set `globalThis.args = { change, maxRounds, angles: ('__angles' in S) ? (S.__angles === null ? undefined : S.__angles) : SPEC_ANGLES }` (so a scenario can pass `null` for the legacy path, a string for the malformed case, or its own array). In `agent()`: if `opts.label` is in `S`, use it; else if it matches `/^claude:([^:]+):(\d+)$/`, derive the stub from `S['claude:' + round]`: `null` → `null`; otherwise `{ ...stub, findings: stub.findings.filter(f => keysOf(x).includes(f.category) || (!f.category && isFirstLabel)) }` where `keysOf(x)` splits `x` on `+` and `isFirstLabel` is true for the first Claude label requested in that round (track per round). `checkShape` must accept the derived label (regex already matches `claude:`).

- [ ] **Step 1b: Rewrite the five existing assertions that name old labels**

`grep -n "claude:" ` over the assertions block finds five lines (currently harness :211, :213, :283, :296, :319): `!labels.includes('claude:3')` ×2 → `!hasClaudeRound(3)`; `labels.includes('claude:3') && labels.includes('codex:3')` → `hasClaudeRound(3) && labels.includes('codex:3')`; `calls.find(c => c.label === 'claude:2')` ×2 → `claudeCalls(2)[0]` (the prompt checked there is the ledger block, which every Claude agent of the round carries). Add the two helpers above the assertions. Stubs untouched.

- [ ] **Step 2: Write the `fanout` scenario and its assertions**

```js
fanout: {
  'claude:1': { verdict: 'FAIL', findings: [
    F('C1','HIGH','Goal unmeasurable','proposal.md:4',{ category: 'scope' }),
    F('C2','MEDIUM','No rollback section','design.md:30',{ category: 'design' }),
    F('C3','LOW','Task 7 lacks done criteria','tasks.md:40',{ category: 'tasks' }) ] },
  'codex:1':  { verdict: 'PASS', findings: [] },
  'fix:round1': { applied: [{ index: 1 }, { index: 2 }], rejected: [] },
  'claude:2': { verdict: 'PASS', findings: [] },
  'codex:2':  { verdict: 'PASS', findings: [] },
},
```
Assertions: `labels` contains `claude:scope:1`, `claude:design:1`, `claude:tasks:1`, `claude:completeness:1`, `claude:platform:1`, `claude:consistency:1` and `codex:1`; round 2 labels are exactly `claude:scope+design:2`, `claude:completeness+consistency:2`, `claude:tasks+platform:2` plus `codex:2`; no `claude:1` / `claude:2` label was called; the `claude:scope:1` prompt contains `Your review angle: Scope` and does not contain `completeness`; `result.history[0].claudeAgents.length === 6`; `result.history[1].claudeAgents.length === 3`; `result.rounds === 2`; the round fixer receives blockers only (MEDIUM+; the loop builds `fresh` from `cat.blockers`), so the `fix:round1` prompt lists exactly 2 items and `fix-low` is called once afterwards with the LOW; the `codex:1` prompt contains `Cover these angles:` followed by the template labels (`Scope & Boundaries`, …) and not the old hardcoded sentence.

- [ ] **Step 3: Run the scenario to verify it fails**

Run: `node plugins/reviewer/tests/two-engine.harness.mjs fanout`
Expected: FAIL on the first label assertion (old script calls `claude:1`)

- [ ] **Step 4: Run each existing scenario alone to verify the assertion rewrite did not break it**

Run: `for s in delivery drift reject reraise reraisecodex fixerledger <every other scenario name>; do node plugins/reviewer/tests/two-engine.harness.mjs $s >/dev/null && echo "$s ok" || echo "$s FAIL"; done`
Expected: every existing scenario `ok` (on the old workflow the helpers resolve `claude:<round>` labels, so the rewrite is behaviour-preserving); the suite as a whole exits 1 only because of `fanout`.

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/tests/two-engine.harness.mjs
git commit -m "test(reviewer): harness resolves per-angle Claude labels; add failing fanout scenario"
```

---

### Task 2: Workflow fan-out, grouping, Claude-side union, liveness

**Files:**
- Modify: `plugins/reviewer/workflows/two-engine-spec-review.workflow.js:27-36` (inputs), `:114-120` (ANGLES), `:160-171` (reviewPrompt), `:202-218` (reviewRound), the main loop rows that build `history` (`:450-460`) and `enginesDown`
- Test: `plugins/reviewer/tests/two-engine.harness.mjs` (scenarios `fanout`, `angledown`, `anglecollapse`, `noangles`, `badangles`, `composition`)

**Interfaces:**
- Consumes: Task 1's label resolution and `SPEC_ANGLES`.
- Produces (script-internal, named so the harness and later tasks can refer to them): `const ANGLE_LIST = normalizeAngles(A.angles)` → `[]` on legacy; `const GROUPS = [['scope','design'], ['completeness','consistency','composition'], ['tasks','platform']]`; `groupsFor(angles) -> {name, angles}[]` (name = keys joined by `+`, unknown keys appended to the last group, empty groups dropped); `anglePrompt(angles: Angle[], engine) -> string`; `reviewRound(round)` returns `{ claude, codex, claudeOk, codexOk, claudeAgents: string[], claudeDown: string[] }`; `unionClaude(results: {label, res, ok}[], round) -> { findings, ok, down }`.

- [ ] **Step 1: Add the remaining failing scenarios to the harness**

```js
// one angle dead in round 1: degraded, not cleared, live findings still fixed
angledown: { 'claude:scope:1': null, 'claude:1': { verdict:'FAIL', findings:[F('C1','MEDIUM','Missing error path','spec.md:9',{category:'completeness'})] },
  'codex:1': { verdict:'PASS', findings:[] }, 'fix:round1': { applied:[{index:1}], rejected:[] },
  'claude:2': { verdict:'PASS', findings:[] }, 'codex:2': { verdict:'PASS', findings:[] } },
// same key from two angles: one finding, worse severity
anglecollapse: { 'claude:scope:1': { verdict:'FAIL', findings:[F('S1','LOW','Ambiguous owner','proposal.md:2',{category:'scope'})] },
  'claude:design:1': { verdict:'FAIL', findings:[F('D1','HIGH','Ambiguous owner','proposal.md:2',{category:'design'})] },
  'claude:1': { verdict:'PASS', findings:[] }, 'codex:1': { verdict:'PASS', findings:[] },
  'fix:round1': { applied:[{index:1}], rejected:[] }, 'claude:2': { verdict:'PASS', findings:[] }, 'codex:2': { verdict:'PASS', findings:[] } },
// legacy: no angles → single agent, old labels
noangles: { __angles: null, 'claude:1': { verdict:'PASS', findings:[] }, 'codex:1': { verdict:'PASS', findings:[] } },
// angles arrives as a string → treated as absent, one log line, no crash
badangles: { __angles: 'not-json', 'claude:1': { verdict:'PASS', findings:[] }, 'codex:1': { verdict:'PASS', findings:[] } },
// composition present + an unknown key
composition: { __angles: [...SPEC_ANGLES, {key:'composition',label:'Cross-Cutting Composition',focus:'x'}, {key:'mystery',label:'Mystery',focus:'y'}],
  'claude:1': { verdict:'FAIL', findings:[F('C1','MEDIUM','Unit A assumes Linux','design.md:1',{category:'cross-cutting'})] }, 'codex:1': { verdict:'PASS', findings:[] },
  'fix:round1': { applied:[{index:1}], rejected:[] }, 'claude:2': { verdict:'PASS', findings:[] }, 'codex:2': { verdict:'PASS', findings:[] } },
```
Assertions: `angledown` → `history[0].degraded === true`, `history[0].enginesDown` includes `claude:scope`, `fix:round1` was called with 1 item, `result.ready === true` only after round 2. `anglecollapse` → `history[0].fresh === 1`, the fixer prompt shows `[HIGH] Ambiguous owner` once, a log line matches `/reported by 2 angles — collapsed/`. `noangles` → labels are exactly `claude:1 codex:1`, `history[0].claudeAgents` deep-equals `['claude:1']`. `badangles` → same labels as `noangles` and a log line matches `/angles ignored/`. `composition` → round-1 Claude labels count 8 (six + composition + mystery), round 2 labels include `claude:completeness+consistency+composition:2` and `claude:tasks+platform+mystery:2`; the `cross-cutting` finding reaches the fixer. For `badangles` the harness sets `args.angles = 'not-json'` verbatim (string), so `__angles` may be any non-null, non-array value.

- [ ] **Step 2: Run the harness to verify the new scenarios fail**

Run: `node plugins/reviewer/tests/two-engine.harness.mjs`
Expected: `fanout`, `angledown`, `anglecollapse`, `composition` fail; `noangles` and `badangles` may pass or fail (legacy path exists but `claudeAgents` does not yet)

- [ ] **Step 3: Implement inputs, grouping and prompts in the workflow**

`normalizeAngles(v)`: returns `[]` unless `Array.isArray(v)`; keeps entries with string `key`; `label` defaults to `key`, `focus` to `''`; when `v` is non-array and not `undefined`/`null`, `log('two-engine-spec-review: args.angles ignored (expected an array of {key,label,focus})')`. `GROUPS` and `groupsFor` as in Interfaces. `anglePrompt(angles, engine)`: same text as `reviewPrompt` minus the `Cover these angles` sentence, plus for one angle `## Your review angle: ${label}\n${focus}\nReview ONLY through this angle. Set category to "${cat}".` and for several `## Your review angles\n### ${label}\n${focus}` per angle, `Set category to one of: ${cats}.`, where `cat` = `cross-cutting` for key `composition`, else the key. `reviewPrompt(engine)` stays for the Codex side and the legacy path, but its `Cover these angles:` sentence is built as `ANGLE_LIST.length ? ANGLE_LIST.map(a => a.label).join(', ') : ANGLES` so the Codex engine sees the template's labels too.

- [ ] **Step 4: Implement `reviewRound` fan-out and `unionClaude`**

In `reviewRound(round)`: build `claudeJobs` = legacy `[{ label: 'claude:'+round, prompt: reviewPrompt('Claude') }]` when `ANGLE_LIST` is empty; else round 1 → one job per angle (`claude:<key>:1`), round ≥ 2 → one per `groupsFor(ANGLE_LIST)` entry (`claude:<name>:<round>`). Run `parallel([...claudeJobs.map(j => () => agent(j.prompt, { label: j.label, phase: 'Review', schema: FINDINGS })), codexThunk])`. Pass each Claude result through `liveness(res, label)`; `unionClaude` concatenates live findings, assigns a missing or unknown `category` from the job's first key (`cross-cutting` for `composition`), collapses by `keyOf` (worse severity, first non-empty `priorId`, one log line per collapse with the angle count), and returns `{ findings, ok: every job ok, down: labels of dead jobs mapped to 'claude:<middle>' (legacy: 'claude') }`. Return `{ claude: { verdict: any FAIL ? 'FAIL' : 'PASS', findings }, codex, claudeOk, codexOk, claudeAgents: claudeJobs.map(j => j.label), claudeDown }`.

- [ ] **Step 5: Thread the new fields into the main loop**

Where the loop computes `down` (`:425`): use `[...r.claudeDown, !r.codexOk && 'codex'].filter(Boolean)`. Add `claudeAgents: r.claudeAgents` to the `history.push({...})` row. Leave `degraded`, `enginesOk`, `cleared` logic untouched (they read `claudeOk`).

- [ ] **Step 6: Run the whole harness**

Run: `node plugins/reviewer/tests/two-engine.harness.mjs`
Expected: every scenario `ok`, exit 0 (existing scenarios untouched)

- [ ] **Step 7: Commit**

```bash
git add plugins/reviewer/workflows/two-engine-spec-review.workflow.js plugins/reviewer/tests/two-engine.harness.mjs
git commit -m "feat(reviewer): spec-dual fans the Claude engine out per angle (round 1) and per group (later rounds)"
```

---

### Task 3: Project rules reach every angle prompt

**Files:**
- Modify: `plugins/reviewer/workflows/two-engine-spec-review.workflow.js` (inputs block; `anglePrompt`; `reviewPrompt`)
- Test: `plugins/reviewer/tests/two-engine.harness.mjs` (scenarios `rules`, `badrules`)

**Interfaces:**
- Consumes: `ANGLE_LIST`, `anglePrompt`, `reviewPrompt` from Task 2; harness `__angles` convention from Task 1.
- Produces: `const RULES = normalizeRules(A.projectRules)` → `{ proposal: [], specs: [], design: [], tasks: [] }` with only string entries kept; `const RULE_AREA = { scope: 'proposal', completeness: 'specs', design: 'design', tasks: 'tasks' }`; `rulesBlock(areas: string[]) -> string` (empty string when no listed area has rules); harness scenario key `__rules` (same convention as `__angles`: absent → a default fixture with one rule per area, `null` → undefined, any other value verbatim).

- [ ] **Step 1: Write the failing scenarios**

```js
rules: {
  'claude:1': { verdict:'FAIL', findings:[F('C1','MEDIUM','No non-goals','proposal.md:1',{category:'scope'})] },
  'codex:1': { verdict:'PASS', findings:[] }, 'fix:round1': { applied:[{index:1}], rejected:[] },
  'claude:2': { verdict:'PASS', findings:[] }, 'codex:2': { verdict:'PASS', findings:[] },
},
badrules: { __rules: 'proposal:\n  - not parsed', 'claude:1': { verdict:'PASS', findings:[] }, 'codex:1': { verdict:'PASS', findings:[] } },
```
Default `__rules` fixture: `{ proposal: ['RULE-PROPOSAL'], specs: ['RULE-SPECS'], design: ['RULE-DESIGN'], tasks: ['RULE-TASKS'] }`.
Assertions for `rules`: the `claude:scope:1` prompt contains `## Project Rules` and `RULE-PROPOSAL` and not `RULE-SPECS`; `claude:platform:1` and `claude:consistency:1` prompts contain no `## Project Rules`; `claude:scope+design:2` contains `RULE-PROPOSAL` and `RULE-DESIGN` and not `RULE-TASKS`; `claude:completeness+consistency:2` contains `RULE-SPECS` only; `codex:1` contains all four rule strings under `### proposal`, `### specs`, `### design`, `### tasks`. Assertions for `badrules`: labels are `claude:scope:1 … codex:1` as usual, no prompt contains `## Project Rules`, a log line matches `/projectRules ignored/`.
Also extend `noangles` (legacy path) with the default rules fixture and assert its single `claude:1` prompt contains all four rule strings.

- [ ] **Step 2: Run the two scenarios to verify they fail**

Run: `node plugins/reviewer/tests/two-engine.harness.mjs rules; node plugins/reviewer/tests/two-engine.harness.mjs badrules`
Expected: `rules` fails on the first `## Project Rules` assertion; `badrules` fails on the log-line assertion

- [ ] **Step 3: Implement `normalizeRules`, `RULE_AREA`, `rulesBlock`, and thread them into the prompts**

`normalizeRules(v)`: object (not array, not null) → pick the four known keys, keep arrays filtered to non-empty strings; anything else that is not `undefined`/`null` → `log('two-engine-spec-review: args.projectRules ignored (expected an object of string arrays keyed by proposal/specs/design/tasks)')` and return the empty shape. `rulesBlock(areas)`: for each area in the given order with rules, emit the heading and `- ` lines as the Design summary states; a single-area block omits the `### <area>` heading, multi-area blocks include it. `anglePrompt(angles, …)` appends `rulesBlock(unique(angles.map(a => RULE_AREA[a.key]).filter(Boolean)))` right after the angle section; `reviewPrompt(engine)` (Codex and legacy) appends `rulesBlock(['proposal','specs','design','tasks'])` before the context block.

- [ ] **Step 4: Run the whole harness**

Run: `node plugins/reviewer/tests/two-engine.harness.mjs`
Expected: every scenario `ok`, exit 0

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/workflows/two-engine-spec-review.workflow.js plugins/reviewer/tests/two-engine.harness.mjs
git commit -m "feat(reviewer): spec-dual injects harvested project rules into every angle prompt and the Codex prompt"
```

---

### Task 4: Skill reads the angle template and project rules, docs, version

**Files:**
- Modify: `plugins/reviewer/skills/spec-dual/SKILL.md:56-100` (new Step 3b, Step 4 args, Step 5 return)
- Modify: `plugins/reviewer/README.md` (spec-dual section), `plugins/reviewer/.codex/INSTALL.md` only if it describes spec-dual args (check; otherwise untouched)
- Modify: `plugins/reviewer/.claude-plugin/plugin.json:3`, `.claude-plugin/marketplace.json` reviewer entry (`1.16.0`)

**Interfaces:**
- Consumes: `args.angles` shape from the Design summary; `templates/review-angles.yaml` `spec:` keys `scope, completeness, tasks, platform, design, consistency, composition` with `label:` and `focus:` fields.

- [ ] **Step 1: Add Step 3b to SKILL.md**

"### Step 3b: Load the review angles. Read `${CLAUDE_PLUGIN_ROOT}/templates/review-angles.yaml`. From its `spec:` section take `scope`, `completeness`, `tasks`, `platform`, `design`, `consistency` in that order, each as `{ key, label, focus }` with `focus` as the full text of the block. Add `composition` only when the review scope holds multiple independent spec units" followed by the composition-judgment paragraph copied verbatim from `agents/spec-orchestrator.md` (the "Composition judgment" paragraph). "If the file cannot be read, pass no `angles` (the Workflow then runs one Claude reviewer per round) and say so in one line."

- [ ] **Step 1b: Add Step 3c to SKILL.md**

"### Step 3c: Load project rules. Read `.claude/reviewer/rules.yaml` at the git root if it exists (harvested by `reviewer:init`). It is a flat YAML map of `proposal`, `specs`, `design`, `tasks` to lists of quoted strings; convert it to a JSON object with those four keys (array of strings each; omit keys that are absent) and pass it as `args.projectRules`. If the file is missing or unreadable, omit `projectRules`." Keep the wording parallel to `commands/spec.md` Step 4.

- [ ] **Step 2: Update Step 4 and Step 5**

Step 4 `args` gains `angles: <the array from Step 3b, or omitted>` and `projectRules: <the object from Step 3c, or omitted>`. Step 5: document `history[].claudeAgents` (the Claude labels used that round: six or seven in round 1, three groups afterwards; `['claude:N']` on the legacy path) and that `enginesDown` may name a single angle (`claude:scope`).

- [ ] **Step 3: README and version**

README spec-dual paragraph: one sentence that the Claude engine now runs one reviewer per angle in round 1 and three grouped reviewers in later rounds, with the angle list taken from `templates/review-angles.yaml` and the harvested rules from `.claude/reviewer/rules.yaml` injected per angle (and into the Codex prompt), so editing the template or harvesting rules changes `/reviewer:spec` and `/reviewer:spec-dual` together. Set `"version": "1.16.0"` in both manifests.

- [ ] **Step 4: Verify**

Run:
```bash
node plugins/reviewer/tests/two-engine.harness.mjs && claude plugin validate ./plugins/reviewer && grep -n '"version"' plugins/reviewer/.claude-plugin/plugin.json && grep -n -A3 '"name": "reviewer"' .claude-plugin/marketplace.json | grep version
```
Expected: harness exit 0; validation passes with only the pre-existing notices; both greps show `1.16.0`.

- [ ] **Step 5: Live run**

In a repo with an `openspec/changes/<name>/` folder (or three spec files) and a `.claude/reviewer/rules.yaml` holding at least one `proposal` rule, run `claude --plugin-dir ./plugins/reviewer` then `/reviewer:spec-dual <change> -n 1`. Expected: the Workflow view shows six (or seven) `claude:<key>:1` agents beside `codex:1`, then three `claude:<group>:2` agents; the report's `history[0].claudeAgents` has 6–7 entries; the `claude:scope:1` agent's prompt (visible in the Workflow view) contains the `## Project Rules` section with that rule.

- [ ] **Step 6: Commit**

```bash
git add plugins/reviewer/skills/spec-dual/SKILL.md plugins/reviewer/README.md plugins/reviewer/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "feat(reviewer): spec-dual reads review angles from the template and passes them to the workflow (1.16.0)"
```
