# Fable-Workflow Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the reviewer plugin (model inheritance, contract rules, findings→rules feedback loop, checkpoint convention) and add a portable `discuss` framing plugin, so Opus-driven sessions approximate Fable-level review/framing behavior.

**Architecture:** All changes follow the repo's layer convention — deterministic prep in `scripts/*.sh`, LLM judgment in `agents/*.md`, orchestration in `commands|skills/*.md`. The findings→rules loop persists review findings as append-only JSONL (via a script), then `reviewer:init --from-history` clusters recurring findings into rules with user confirmation. The new `discuss` plugin distills `spectra-discuss` into a CLI-free skill.

**Tech Stack:** Markdown skill/agent prompts, bash + jq, Claude Code Workflow JS, JSON plugin manifests.

## Global Constraints

- Commit convention: `<type>(<plugin-name>): <description>` — types: feat, fix, refactor, docs, chore.
- Dual registration: `plugins/{name}/.claude-plugin/plugin.json` version MUST equal its entry in `.claude-plugin/marketplace.json`. Reviewer goes `1.7.1` → `1.8.0`; new `discuss` plugin starts at `0.1.0`. Bump happens in Task 9 (one place), not per-task.
- No test framework exists in this repo. "Test" steps are executable verifications: run the script with sample input and assert output with `cat`/`grep`, or `grep` the edited markdown for the inserted anchor text.
- Repo root: `/Users/shdennlin/m/project/agent-plugins`. All paths below are relative to it.
- Never remove existing rules, prompt sections, or frontmatter fields — all edits are additive unless the step explicitly shows a replacement.

---

### Task 1: Judgment agents inherit the session model (P0-1)

**Files:**
- Modify: `plugins/reviewer/agents/spec-orchestrator.md` (frontmatter line 4)
- Modify: `plugins/reviewer/agents/result-fix-orchestrator.md` (frontmatter)
- Modify: `plugins/reviewer/agents/result-reviewer.md` (frontmatter)
- Modify: `plugins/reviewer/agents/spec-fixer.md` (frontmatter)
- Modify: `plugins/reviewer/agents/result-fixer.md` (frontmatter)
- Modify: `plugins/reviewer/workflows/two-engine-spec-review.workflow.js:36` and `:154-157`

**Interfaces:**
- Produces: all five judgment agents run on the session's model (`model: inherit`); the dual-engine workflow's fix agent inherits the main-loop model unless `args.fixModel` overrides.
- Does NOT touch: `plugins/reviewer/agents/init-reviewer.md` (stays `model: haiku` — template injection is mechanical).

- [ ] **Step 1: Flip the five frontmatter pins**

In each of the five agent files listed above, change the frontmatter line:

```yaml
model: sonnet
```

to:

```yaml
model: inherit
```

(Each file has exactly one `model:` line, inside the `---` frontmatter block at the top.)

- [ ] **Step 2: Verify no `model: sonnet` remains and haiku is untouched**

Run: `grep -rn "^model:" plugins/reviewer/agents/`
Expected output — five `inherit`, one `haiku`:

```
plugins/reviewer/agents/init-reviewer.md:4:model: haiku
plugins/reviewer/agents/result-fix-orchestrator.md:...:model: inherit
plugins/reviewer/agents/result-fixer.md:...:model: inherit
plugins/reviewer/agents/result-reviewer.md:...:model: inherit
plugins/reviewer/agents/spec-fixer.md:...:model: inherit
plugins/reviewer/agents/spec-orchestrator.md:...:model: inherit
```

- [ ] **Step 3: Make the workflow's fix model inherit by default**

In `plugins/reviewer/workflows/two-engine-spec-review.workflow.js`, replace:

```js
const FIX_MODEL = (typeof A.fixModel === 'string' && A.fixModel.trim()) ? A.fixModel.trim() : 'opus'
```

with:

```js
// Default: inherit the main-loop/session model (omit the model option entirely).
// A run can still pin a specific model via args.fixModel.
const FIX_MODEL = (typeof A.fixModel === 'string' && A.fixModel.trim()) ? A.fixModel.trim() : ''
```

And replace the `runFix` function:

```js
async function runFix(findings, cat, label) {
  await agent(batchFixPrompt(findings, cat),
    { label, phase: 'Fix', agentType: 'reviewer:spec-fixer', model: FIX_MODEL })
}
```

with:

```js
async function runFix(findings, cat, label) {
  await agent(batchFixPrompt(findings, cat),
    { label, phase: 'Fix', agentType: 'reviewer:spec-fixer',
      ...(FIX_MODEL ? { model: FIX_MODEL } : {}) })
}
```

Also update the stale comment above `FIX_MODEL` (lines 33-35): change `Default to Opus;` to `Default: inherit the session model;`.

- [ ] **Step 4: Verify the workflow edit**

Run: `grep -n "FIX_MODEL" plugins/reviewer/workflows/two-engine-spec-review.workflow.js`
Expected: the declaration line ends with `: ''` and `runFix` contains `...(FIX_MODEL ? { model: FIX_MODEL } : {})`. Also run `node --check` is NOT possible (ESM + injected globals); instead visually confirm balanced braces in the two edited regions.

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/agents plugins/reviewer/workflows
git commit -m "feat(reviewer): judgment agents inherit session model instead of pinning sonnet"
```

---

### Task 2: Contract rules — risks / rollout-rollback / verification mapping (P0-2)

**Files:**
- Modify: `plugins/reviewer/templates/reviewer-rules.yaml`
- Modify: `plugins/reviewer/templates/review-angles.yaml`

**Interfaces:**
- Produces: three new authoring rules (injected by `reviewer:init`) and mirrored review checks (used by spec-orchestrator angles). Authoring requirements and review criteria stay symmetric — anything `init` demands, an angle verifies.

- [ ] **Step 1: Add three rules to `reviewer-rules.yaml`**

Append to the `proposal:` list (after the "Identify the target user..." line):

```yaml
  - "List the main risks — each with its blast radius and a concrete mitigation or explicit acceptance"
  - "Ground every Impact path in the actual repo — verify each Modified/Removed path exists before writing it, and explore related source files before claiming design coupling or integration points"
```

Append to the `design:` list (after the "Include a data flow..." line):

```yaml
  - "Define rollout and rollback strategy for any change affecting runtime behavior — how it ships, how it reverts, and what signals trigger a rollback"
```

Append to the `tasks:` list (after the "Each task should be completable independently..." line):

```yaml
  - "Map every acceptance criterion to an executable verification — a named test, a CLI invocation, or a manual assertion with expected output"
```

- [ ] **Step 2: Mirror the checks in `review-angles.yaml`**

In the `spec:` → `scope:` angle, extend the `focus:` block's `Review for:` sentence — change:

```
      Review for: problem statement clarity, measurable goals, non-goals section,
      scope boundaries (in vs out), target user identification, and ambiguous
      boundaries.
```

to:

```
      Review for: problem statement clarity, measurable goals, non-goals section,
      scope boundaries (in vs out), target user identification, ambiguous
      boundaries, and a risks list where each risk names its blast radius and a
      mitigation (or explicit acceptance).
```

In the `spec:` → `design:` angle, extend the `Review for:` list — change the ending:

```
      ownership and concurrency model, idempotency / retry semantics, and API
      surface coherence. Flag missing or hand-wavy "how it works" sections.
```

to:

```
      ownership and concurrency model, idempotency / retry semantics, API
      surface coherence, and rollout/rollback strategy for runtime-affecting
      changes (how it ships, how it reverts, what triggers a rollback).
      Flag missing or hand-wavy "how it works" sections.
```

In the `spec:` → `tasks:` angle, extend the `Review for:` sentence — change:

```
      Review for: every spec requirement mapping to at least one task, clear
      and verifiable done criteria, tasks for error/edge cases (not just happy
      path), test tasks, dependency ordering, and independent completability.
```

to:

```
      Review for: every spec requirement mapping to at least one task, clear
      and verifiable done criteria, every acceptance criterion mapping to an
      executable verification (named test, CLI invocation, or manual assertion
      with expected output), tasks for error/edge cases (not just happy path),
      test tasks, dependency ordering, and independent completability.
```

- [ ] **Step 3: Verify**

Run: `grep -c "blast radius" plugins/reviewer/templates/*.yaml`
Expected: `reviewer-rules.yaml:1` and `review-angles.yaml:1`.
Run: `grep -c "Ground every Impact path" plugins/reviewer/templates/reviewer-rules.yaml`
Expected: `1`. (No review-angles mirror needed — the angle sub-agent prompt already cross-references spec claims against codebase context and flags misalignments as `codebase` findings; this rule closes the authoring side of that existing check.)
Run: `grep -c "rollback" plugins/reviewer/templates/*.yaml`
Expected: `reviewer-rules.yaml:1` and `review-angles.yaml:1` (or higher if worded twice in the angle — must be ≥1 in each file).

- [ ] **Step 4: Commit**

```bash
git add plugins/reviewer/templates
git commit -m "feat(reviewer): require risks, rollout/rollback, and verification mapping in authoring rules and review angles"
```

---

### Task 3: `scripts/log-findings.sh` — findings persistence (P1, script layer)

**Files:**
- Create: `plugins/reviewer/scripts/log-findings.sh` (mode 755)

**Interfaces:**
- Consumes: a JSON array of finding objects on **stdin** — each object may contain `severity`, `title`, `location`, `category`, `engine` (all optional strings). Flags: `--change <name>` (required), `--source <spec|result|spec-dual>` (required), `--round <N>` (optional).
- Produces: appends one JSON line per finding to `<git-root>/openspec/reviews/history.jsonl` when `openspec/` exists at git root, else `<git-root>/.claude/reviewer/history.jsonl`. Prints `logged <N> finding(s) to <relative path>`. Exit 0 on success, non-zero with a message on bad usage or missing jq. Later tasks (4, 5, 6) depend on this exact contract.

- [ ] **Step 1: Write the script**

Create `plugins/reviewer/scripts/log-findings.sh`:

```bash
#!/usr/bin/env bash
# Append review findings (JSON array on stdin) to the project's review history JSONL.
# Deterministic persistence for the findings->rules harvest loop (reviewer:init --from-history).
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: echo '<findings JSON array>' | log-findings.sh --change <name> --source <spec|result|spec-dual> [--round <N>]

Each array element may contain: severity, title, location, category, engine (strings).
Target file: <git-root>/openspec/reviews/history.jsonl if openspec/ exists,
otherwise <git-root>/.claude/reviewer/history.jsonl.
EOF
}

CHANGE="" SOURCE="" ROUND=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --change) CHANGE="${2:-}"; shift 2 ;;
    --source) SOURCE="${2:-}"; shift 2 ;;
    --round)  ROUND="${2:-}";  shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "log-findings: unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

[[ -n "$CHANGE" && -n "$SOURCE" ]] || { echo "log-findings: --change and --source are required" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "log-findings: jq is required but not installed" >&2; exit 1; }

INPUT="$(cat)"
[[ -n "$INPUT" ]] || { echo "log-findings: empty stdin, nothing to log" >&2; exit 1; }
COUNT="$(jq 'length' <<<"$INPUT")" || { echo "log-findings: stdin is not a JSON array" >&2; exit 1; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
if [[ -d "$ROOT/openspec" ]]; then
  OUT="$ROOT/openspec/reviews/history.jsonl"
else
  OUT="$ROOT/.claude/reviewer/history.jsonl"
fi
mkdir -p "$(dirname "$OUT")"

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
jq -c --arg ts "$TS" --arg change "$CHANGE" --arg source "$SOURCE" --arg round "$ROUND" '
  .[] | {
    ts: $ts, change: $change, source: $source, round: $round,
    severity: (.severity // ""), title: (.title // ""),
    location: (.location // ""), category: (.category // ""),
    engine: (.engine // "")
  }' <<<"$INPUT" >>"$OUT"

echo "logged $COUNT finding(s) to ${OUT#"$ROOT"/}"
```

Then: `chmod +x plugins/reviewer/scripts/log-findings.sh`

- [ ] **Step 2: Test the openspec-repo path (fallback branch first — this repo has no openspec/)**

Run from the repo root:

```bash
echo '[{"severity":"HIGH","title":"missing rollback","location":"design.md","category":"design"},{"severity":"MEDIUM","title":"vague done criteria","location":"tasks.md","category":"tasks"}]' \
  | plugins/reviewer/scripts/log-findings.sh --change test-change --source spec --round 1
```

Expected stdout: `logged 2 finding(s) to .claude/reviewer/history.jsonl`

Run: `cat .claude/reviewer/history.jsonl | jq -c '{change,source,severity}'`
Expected:

```
{"change":"test-change","source":"spec","severity":"HIGH"}
{"change":"test-change","source":"spec","severity":"MEDIUM"}
```

- [ ] **Step 3: Test the openspec branch in a temp dir**

```bash
T="$(mktemp -d)"; git -C "$T" init -q; mkdir "$T/openspec"
( cd "$T" && echo '[{"severity":"LOW","title":"x","location":"y"}]' \
  | /Users/shdennlin/m/project/agent-plugins/plugins/reviewer/scripts/log-findings.sh --change c2 --source result )
test -f "$T/openspec/reviews/history.jsonl" && echo OK
rm -rf "$T"
```

Expected: `logged 1 finding(s) to openspec/reviews/history.jsonl` then `OK`.

- [ ] **Step 4: Test error paths**

```bash
echo '[]' | plugins/reviewer/scripts/log-findings.sh --source spec 2>&1; echo "exit=$?"
echo 'not-json' | plugins/reviewer/scripts/log-findings.sh --change c --source spec 2>&1; echo "exit=$?"
```

Expected: first prints `log-findings: --change and --source are required`, `exit=1`; second prints `log-findings: stdin is not a JSON array`, `exit=1`.

- [ ] **Step 5: Clean up the local test artifact and commit**

```bash
rm -f .claude/reviewer/history.jsonl
git add plugins/reviewer/scripts/log-findings.sh
git commit -m "feat(reviewer): add log-findings.sh for append-only review findings history"
```

---

### Task 4: spec-dual logs its findings (P1 wiring, workflow + skill)

**Files:**
- Modify: `plugins/reviewer/workflows/two-engine-spec-review.workflow.js` (return values)
- Modify: `plugins/reviewer/skills/spec-dual/SKILL.md` (new Step 6)
- Modify: `plugins/reviewer/commands/spec-dual.md` (same new step — commands mirror skills in this plugin; read the file first and append the equivalent step to its process section)

**Interfaces:**
- Consumes: `log-findings.sh` contract from Task 3.
- Produces: the Workflow result gains a `findings` array (final-round union, objects with `severity`/`title`/`location`); SKILL.md instructs the main agent to pipe it to the script after reporting. Workflow scripts have no filesystem access, so logging MUST happen in the main session after the Workflow returns.

- [ ] **Step 1: Return the final union from the workflow**

In `two-engine-spec-review.workflow.js`:

After the line `let round = 1, cleared = null` add:

```js
let lastAll = []              // final round's union findings, returned for history logging
```

In the while loop, immediately after `const cat = categorize(r)` add:

```js
lastAll = cat.all
```

Change the not-ready return:

```js
  return { ready: false, change: CHANGE, rounds: round - 1, reason, needsHuman, history }
```

to:

```js
  return { ready: false, change: CHANGE, rounds: round - 1, reason, needsHuman, history, findings: lastAll }
```

Change the final return:

```js
return { ready: true, change: CHANGE, rounds: round, lowsFixed: lows.length, needsHuman: [], history }
```

to:

```js
return { ready: true, change: CHANGE, rounds: round, lowsFixed: lows.length, needsHuman: [], history, findings: lastAll }
```

- [ ] **Step 2: Add Step 6 to `skills/spec-dual/SKILL.md`**

Append after the existing "### Step 5: Report and resolve escalations" section:

```markdown
### Step 6: Log findings history (best-effort)

Persist the final round's findings for the rules-harvest loop (`/reviewer:init --from-history`).
The Workflow result includes `findings` (final-round union). If it is non-empty, pipe it as a
JSON array to the logging script:

```bash
echo '<findings as JSON array>' | "${CLAUDE_PLUGIN_ROOT}/scripts/log-findings.sh" \
  --change "<change>" --source spec-dual --round <rounds>
```

The script auto-detects the target file (`openspec/reviews/history.jsonl` in Spectra repos,
`.claude/reviewer/history.jsonl` otherwise). Logging is best-effort: if the script fails
(e.g., jq missing), mention it in one line and continue — a logging failure MUST NOT fail
or repeat the review.
```

- [ ] **Step 3: Mirror in `commands/spec-dual.md`**

Read `plugins/reviewer/commands/spec-dual.md`; append the same "Log findings history (best-effort)" step (verbatim content from Step 2) after its final report/escalation step, renumbering to fit that file's step sequence.

- [ ] **Step 4: Verify**

Run: `grep -n "lastAll" plugins/reviewer/workflows/two-engine-spec-review.workflow.js`
Expected: 4 matches (declaration, assignment, two returns).
Run: `grep -ln "log-findings.sh" plugins/reviewer/skills/spec-dual/SKILL.md plugins/reviewer/commands/spec-dual.md`
Expected: both files listed.

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/workflows plugins/reviewer/skills/spec-dual plugins/reviewer/commands/spec-dual.md
git commit -m "feat(reviewer): spec-dual persists final findings to review history"
```

---

### Task 5: spec/result orchestrators log their findings (P1 wiring, agent layer)

**Files:**
- Modify: `plugins/reviewer/agents/spec-orchestrator.md` (tools list + new section + input param)
- Modify: `plugins/reviewer/agents/result-fix-orchestrator.md` (same pattern)
- Modify: `plugins/reviewer/skills/spec/SKILL.md` (pass script path)
- Modify: `plugins/reviewer/skills/result/SKILL.md` (pass script path)
- Modify: `plugins/reviewer/commands/spec.md`, `plugins/reviewer/commands/result.md` (pass script path in their Task dispatch blocks)

**Interfaces:**
- Consumes: `log-findings.sh` contract (Task 3). Agents cannot resolve `${CLAUDE_PLUGIN_ROOT}` — the dispatching skill/command MUST resolve it and pass the absolute script path as a `log_script_path` parameter.
- Produces: every `/reviewer:spec` and `/reviewer:result` run appends its final merged findings to the history JSONL.

- [ ] **Step 1: Give spec-orchestrator Bash and the new parameter**

In `plugins/reviewer/agents/spec-orchestrator.md` frontmatter, add `- Bash` to the `tools:` list (after `- AskUserQuestion`).

In its "## Input Parameters" section, add:

```markdown
- **log_script_path**: absolute path to the findings-logging script (optional; skip logging if absent)
```

- [ ] **Step 2: Add the logging section to spec-orchestrator**

Append at the end of `spec-orchestrator.md`, after the "## Final Output" section and before "## Constraints":

```markdown
## Log Findings (after Final Output)

If `log_script_path` was provided, persist the FINAL round's merged, deduplicated issues
(best-effort). Convert them to a JSON array — one object per issue with keys
`severity` (upper-case), `title`, `location` (file or artifact name), `category` — then run:

```bash
printf '%s' '<the JSON array>' | "<log_script_path>" --change "<first review path>" --source spec --round <final round number>
```

If the command fails or `log_script_path` is missing, add one line to your output
("findings not logged: <reason>") and continue — logging failure MUST NOT change
your verdict or output format.
```

Also add one line to "## Constraints": `- Logging is best-effort — never retry it more than once, never let it affect the verdict`.

- [ ] **Step 3: Same pattern for result-fix-orchestrator**

Read `plugins/reviewer/agents/result-fix-orchestrator.md`. Apply the identical three edits, adjusted for its structure:
1. Add `- Bash` to `tools:` if not already present.
2. Add the `log_script_path` input parameter line to its input-parameters section.
3. Append the same "## Log Findings (after Final Output)" section (verbatim from Step 2, but with `--source result`) before its constraints section, plus the same constraints line.

- [ ] **Step 4: Dispatchers pass the script path**

In `plugins/reviewer/skills/spec/SKILL.md`, in the "## Agent Dispatch" section, extend the parameter list sentence — change:

```
Always dispatch `reviewer:spec-orchestrator` with parameters (paths, fix_enabled, max_iterations, angles, codebase_context, review-angles template content).
```

to:

```
Always dispatch `reviewer:spec-orchestrator` with parameters (paths, fix_enabled, max_iterations, angles, codebase_context, review-angles template content, log_script_path — resolve `${CLAUDE_PLUGIN_ROOT}/scripts/log-findings.sh` to an absolute path).
```

In `plugins/reviewer/skills/result/SKILL.md`, "## Agent Dispatch" — change:

```
With `--fix`: dispatch `reviewer:result-fix-orchestrator` with parameters (spec_paths, working_directory, base_branch, max_iterations, parallel, angles, fix_all, review-angles template content).
```

to:

```
With `--fix`: dispatch `reviewer:result-fix-orchestrator` with parameters (spec_paths, working_directory, base_branch, max_iterations, parallel, angles, fix_all, review-angles template content, log_script_path — resolve `${CLAUDE_PLUGIN_ROOT}/scripts/log-findings.sh` to an absolute path).
```

Read `plugins/reviewer/commands/spec.md` and `plugins/reviewer/commands/result.md`; add the same `log_script_path` parameter to their Task-dispatch prompt blocks (each has a prompt template listing parameters — add one line: `- log_script_path: <absolute path to ${CLAUDE_PLUGIN_ROOT}/scripts/log-findings.sh>`).

- [ ] **Step 5: Verify**

Run: `grep -rln "log_script_path" plugins/reviewer/`
Expected: 6 files — `agents/spec-orchestrator.md`, `agents/result-fix-orchestrator.md`, `skills/spec/SKILL.md`, `skills/result/SKILL.md`, `commands/spec.md`, `commands/result.md`.

- [ ] **Step 6: Commit**

```bash
git add plugins/reviewer/agents plugins/reviewer/skills plugins/reviewer/commands
git commit -m "feat(reviewer): spec and result orchestrators log final findings to review history"
```

---

### Task 6: `reviewer:init --from-history` + portable rules fallback (P1 harvest)

**Files:**
- Modify: `plugins/reviewer/commands/init.md` (flag parsing, help text, from-history flow)
- Modify: `plugins/reviewer/skills/init/SKILL.md` (mirror usage/process)
- Modify: `plugins/reviewer/agents/init-reviewer.md` (portable fallback target)

**Interfaces:**
- Consumes: history JSONL written by Tasks 4/5 (`ts, change, source, round, severity, title, location, category, engine` per line).
- Produces: `--from-history` mode — clustering happens in the MAIN conversation (needs judgment + AskUserQuestion; init-reviewer is haiku and keeps doing only mechanical injection). Confirmed rules are handed to init-reviewer as the "template". init-reviewer gains a fallback: no `openspec/config.yaml` → write `.claude/reviewer/rules.yaml` (same artifact-keyed YAML shape as `reviewer-rules.yaml`).

- [ ] **Step 1: Extend `commands/init.md` argument parsing and help**

In "### Step 1: Parse Arguments", add:

```markdown
3. **from_history**: if `--from-history` is present, set from_history = true
```

In the help block, add under Options:

```
  --from-history        Harvest recurring review findings into candidate rules
```

and under Examples:

```
  /reviewer:init --from-history      # cluster review history into new rules
```

and under "What it does", append:

```
  With --from-history, reads the review findings history (openspec/reviews/history.jsonl
  or .claude/reviewer/history.jsonl), clusters findings that recur across 2+ changes into
  candidate rules, asks you to confirm each, and injects only the confirmed ones.
```

- [ ] **Step 2: Add the from-history flow to `commands/init.md`**

Insert a new section between "### Step 2: Read the Rules Template" and "### Step 3: Delegate to Agent":

```markdown
### Step 2b: From-History Mode (only when --from-history)

When from_history is true, do NOT use the static template. Instead:

1. **Locate history**: at the git root, read `openspec/reviews/history.jsonl` if it exists,
   else `.claude/reviewer/history.jsonl`. If neither exists, tell the user
   "No review history found — run /reviewer:spec, /reviewer:result, or /reviewer:spec-dual first"
   and STOP.
2. **Cluster**: parse the JSONL lines. Group findings that describe the same recurring problem
   (same `category` plus overlapping title keywords — use judgment, not exact match).
3. **Filter**: keep only groups whose findings span **2 or more distinct `change` values** —
   a finding seen in one change is an incident; seen across changes it is systemic.
4. **Draft rules**: for each kept group, write ONE imperative one-line rule in the style of
   the reviewer rules template, and assign it to an artifact key by category:
   scope → `proposal`, completeness/spec → `specs`, design → `design`, tasks → `tasks`
   (default `specs` when unclear).
5. **Confirm**: present all candidates with AskUserQuestion (multiSelect: true), each option
   showing the drafted rule and how many changes it recurred in. Only user-selected rules
   proceed. If the user selects none, report "no rules confirmed" and STOP.
6. **Build the template**: format the confirmed rules as a YAML fragment keyed by artifact
   (same shape as reviewer-rules.yaml) and pass THAT as the template content in Step 3.
```

- [ ] **Step 3: Mirror in `skills/init/SKILL.md`**

Update the Usage block to:

```
$init
$init --dry-run
$init --from-history
```

Append to the Process list:

```markdown
6. With `--from-history`: skip the static template — read the review findings history
   (`openspec/reviews/history.jsonl`, else `.claude/reviewer/history.jsonl`), cluster
   findings recurring across ≥2 changes into candidate rules, confirm each with the user
   (AskUserQuestion, multiSelect), and pass only confirmed rules to the agent as the template.
   Clustering and confirmation happen in the main conversation, NOT in the agent.
```

- [ ] **Step 4: Portable fallback in `agents/init-reviewer.md`**

In the "## Behavior" list, replace:

```markdown
- Verify `openspec/config.yaml` exists; if not, report error and stop
```

with:

```markdown
- Determine the target file: `openspec/config.yaml` if it exists at the git root;
  otherwise `.claude/reviewer/rules.yaml` (create it, including parent directory, with the
  same artifact-keyed YAML shape: top-level keys `proposal`, `specs`, `design`, `tasks`,
  each a list of quoted rule strings)
```

And in "## Constraints", replace:

```markdown
- If config.yaml has syntax errors, report and stop — do not attempt to fix
```

with:

```markdown
- If the target file has syntax errors, report and stop — do not attempt to fix
- When writing the portable fallback (`.claude/reviewer/rules.yaml`), the same append-only,
  dedup-by-exact-match rules apply
```

- [ ] **Step 5: Verify**

Run: `grep -rln "from-history\|from_history" plugins/reviewer/commands/init.md plugins/reviewer/skills/init/SKILL.md`
Expected: both files.
Run: `grep -n "rules.yaml" plugins/reviewer/agents/init-reviewer.md`
Expected: at least 2 matches (behavior + constraints).

- [ ] **Step 6: Commit**

```bash
git add plugins/reviewer/commands/init.md plugins/reviewer/skills/init plugins/reviewer/agents/init-reviewer.md
git commit -m "feat(reviewer): init --from-history harvests recurring findings into rules, with portable non-openspec fallback"
```

---

### Task 7: Review angles consume portable project rules (P1, non-Spectra parity)

**Files:**
- Modify: `plugins/reviewer/agents/spec-orchestrator.md` (input param + sub-agent prompt)
- Modify: `plugins/reviewer/skills/spec/SKILL.md` (read + pass the file)
- Modify: `plugins/reviewer/commands/spec.md` (same)

**Interfaces:**
- Consumes: `.claude/reviewer/rules.yaml` written by Task 6's fallback (artifact-keyed rule lists).
- Produces: in non-Spectra repos, harvested rules feed back into review — angle sub-agents receive the rules matching their artifact area as additional criteria. (Spectra repos don't need this path: rules in `openspec/config.yaml` are already injected into generated artifacts.)

- [ ] **Step 1: New orchestrator input parameter**

In `plugins/reviewer/agents/spec-orchestrator.md` "## Input Parameters", add:

```markdown
- **project_rules**: content of the project's `.claude/reviewer/rules.yaml` (optional, may be empty) — artifact-keyed lists of extra review criteria
```

- [ ] **Step 2: Inject into the angle sub-agent prompt**

In Step 2's Agent prompt template, after the `## Your Review Angle: {angle label}` /
`{angle focus text}` lines, add:

```
    ## Project Rules (additional criteria — treat violations as findings)
    {rules from project_rules matching this angle's artifact area: scope→proposal,
    completeness→specs, design→design, tasks→tasks; omit this section entirely
    when project_rules is empty or has no matching key}
```

- [ ] **Step 3: Dispatchers read and pass the file**

In `plugins/reviewer/skills/spec/SKILL.md` "## Process", change step 2-3 area: after
"2. Explore the codebase..." insert:

```markdown
3. Read `.claude/reviewer/rules.yaml` at the git root if it exists (harvested project rules); pass its content as `project_rules` (empty if absent)
```

and renumber the following steps. Extend the "## Agent Dispatch" parameter list (already edited in Task 5) to also include `project_rules`.

In `plugins/reviewer/commands/spec.md`, add the same read step and a `- project_rules: <content of .claude/reviewer/rules.yaml at git root, or empty>` line to its Task-dispatch prompt block.

- [ ] **Step 4: Verify**

Run: `grep -rln "project_rules" plugins/reviewer/`
Expected: `agents/spec-orchestrator.md`, `skills/spec/SKILL.md`, `commands/spec.md`.

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/agents/spec-orchestrator.md plugins/reviewer/skills/spec plugins/reviewer/commands/spec.md
git commit -m "feat(reviewer): spec review consumes harvested project rules in non-openspec repos"
```

---

### Task 8: Checkpoint convention (P2a)

**Files:**
- Modify: `plugins/reviewer/templates/reviewer-rules.yaml` (one tasks rule)
- Modify: `plugins/reviewer/templates/review-angles.yaml` (mirror in tasks angle)
- Modify: `plugins/reviewer/README.md` (document the convention)

**Interfaces:**
- Produces: generated `tasks.md` for large changes contains explicit checkpoint tasks, so `spectra-apply` executes mid-implementation reviews naturally — no new machinery. The tasks review angle enforces their presence.

- [ ] **Step 1: Add the checkpoint rule to `reviewer-rules.yaml` tasks list**

Append:

```yaml
  - "For changes with more than 10 tasks, insert a checkpoint task after each milestone or coherent task group: run /reviewer:result <change-dir> --base <branch> on the partial diff and resolve CRITICAL findings before continuing"
```

- [ ] **Step 2: Mirror in `review-angles.yaml` tasks angle**

In `spec:` → `tasks:` → `focus:`, append a sentence at the end of the block:

```
      For changes with more than 10 tasks, verify checkpoint tasks exist after
      each milestone (a task that runs a partial-diff result review and gates
      on CRITICAL findings before continuing).
```

- [ ] **Step 3: Document in `plugins/reviewer/README.md`**

Read the README; add a section (near the result-review documentation) titled
`## Checkpoint reviews for long implementations`:

```markdown
## Checkpoint reviews for long implementations

`/reviewer:result` already reviews partial diffs via `--base`. For long changes, don't wait
until the end: after each milestone (or ~5 tasks), run

```
/reviewer:result <change-dir> --base <branch>
```

and clear CRITICAL findings before continuing. In Spectra repos, `/reviewer:init` injects a
tasks rule so generated `tasks.md` includes these checkpoint tasks automatically for changes
with more than 10 tasks — `spectra-apply` then executes the checkpoints as ordinary tasks.
```

- [ ] **Step 4: Verify**

Run: `grep -c "checkpoint" plugins/reviewer/templates/reviewer-rules.yaml plugins/reviewer/templates/review-angles.yaml plugins/reviewer/README.md`
Expected: ≥1 in each file.

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/templates plugins/reviewer/README.md
git commit -m "feat(reviewer): checkpoint-review convention for long implementations"
```

---

### Task 9: `discuss` plugin — portable framing skill (P2b) + registration + version bumps

**Files:**
- Create: `plugins/discuss/.claude-plugin/plugin.json`
- Create: `plugins/discuss/skills/discuss/SKILL.md`
- Create: `plugins/discuss/README.md`
- Create: `plugins/discuss/.codex/INSTALL.md`
- Modify: `.claude-plugin/marketplace.json` (register discuss 0.1.0; bump reviewer to 1.8.0)
- Modify: `plugins/reviewer/.claude-plugin/plugin.json` (version 1.8.0)
- Modify: `README.md` (root catalog row)

**Interfaces:**
- Produces: `/discuss:discuss <topic>` — a CLI-free framing discussion that converges on a Decision/Rationale, usable in any repo. In Spectra repos, users keep using `spectra-discuss` (skill-routing rule); this fills the gap everywhere else.

- [ ] **Step 1: Plugin manifest**

Create `plugins/discuss/.claude-plugin/plugin.json`:

```json
{
  "name": "discuss",
  "version": "0.1.0",
  "description": "Portable framing discussions — assumptions-first design conversations that converge on an explicit decision. No external CLI dependency.",
  "author": {
    "name": "shdennlin"
  },
  "keywords": ["framing", "design", "discussion", "decision", "convergence", "brainstorming"]
}
```

- [ ] **Step 2: The skill**

Create `plugins/discuss/skills/discuss/SKILL.md`:

````markdown
---
name: discuss
description: "Frame a feature, bug, or design question before building: scout the codebase, surface assumptions or interview, compare options, and converge on an explicit decision. Use when an idea needs sharpening before a spec or plan exists. Read-only — never implements."
---

# Discuss — Portable Framing

Have a focused, converging discussion about a topic. Thinking, not implementing: you may
read files and search code, but NEVER write code or create files during this skill. If the
user asks to implement, tell them to end the discussion first.

**Input**: the argument is the topic — a design question, a problem statement, a vague idea.
If empty, ask what to discuss.

## Step 1: Scout

Extract 2-5 keywords from the topic. Grep/Glob for related **source** files (not docs/tests).
Read up to 5 of the most relevant. Spend seconds, not minutes.

## Step 2: Pick a mode and announce it

- **3+ related source files found → Assumptions mode.** You have enough context to form
  opinions; list them and let the user correct.
- **Fewer → Interview mode.** Ask questions one at a time.

Announce the choice: "Found `a.ts`, `b.ts`, `c.rs` — listing my assumptions." or
"Didn't find much related code — I'll interview."

### Assumptions mode

Present 3-5 assumptions. Each MUST include:

1. **Approach**: what you'd do and why
2. **Evidence**: file path(s) that informed it
3. **If wrong**: the concrete consequence

Then ask exactly: **"Which of these are wrong?"** If all fine → converge. If corrected →
one focused follow-up per correction, then converge.

### Interview mode

- ONE question per message. Skip anything already answered.
- Prefer multiple choice with concrete options over open-ended.
- When exploring approaches, present 2-3 options with a trade-off table and a
  recommendation — never a menu without an opinion.

## Step 3: Discussion discipline (both modes)

- **Ground in reality** — cite actual files, not theory.
- **Challenge assumptions** — the user's and yours. Apply YAGNI; ask "do we need this?"
- **No empty validation** — never "great question" / "that could work"; state why or why not.
- **Push for specifics** — "make it more modular" is not an answer; ask what gets split,
  into what, at what cost.
- **Be direct** — lead with your recommendation and the reason.
- **Respect pace** — if the user pushes to move on, flag the single most important
  unresolved question in one sentence, then converge. One nudge maximum.

## Step 4: Converge

Every discussion ends with an explicit conclusion:

```
## Conclusion

**Decision**: <what was decided>
**Rationale**: <the key trade-off that drove it>
**Risks accepted**: <what could bite, or "none surfaced">
**Next step**: <recommended follow-up>
```

The conclusion is one of: a design decision, a direction consensus, a next-step
recommendation, or an explicit deferral naming what's missing.

Before capturing a behavioral decision, confirm with a concrete example
("so inputs 0.9/0.3/0.7 come back ordered 0.9, 0.7, 0.3 — right?").

**Next step** should point at the workflow that fits the repo:
- Spectra repo (`openspec/` at git root): suggest `/spectra-propose` (and note
  `spectra-discuss` for future discussions there).
- Otherwise: suggest a spec/plan (e.g., superpowers writing-plans) or, for small tasks,
  direct implementation — followed by `/reviewer:spec` on whatever spec results.

Present the conclusion in conversation. Do NOT write it to a file unless the user
explicitly asks.

## Guardrails

- Never implement, never create/edit files.
- Never end without a conclusion — if the user drops off, summarize where things stand
  and what's unresolved.
- One question at a time; one nudge maximum on pacing.
- Prefer the simplest option that works.
````

- [ ] **Step 3: Plugin README**

Create `plugins/discuss/README.md`:

```markdown
# discuss

Portable framing discussions — assumptions-first design conversations that converge on an
explicit decision. A CLI-free distillation of the `spectra-discuss` workflow for repos that
don't use Spectra.

## Usage

```
/discuss:discuss should search support fuzzy matching?
/discuss:discuss the auth module is getting unwieldy
```

The skill scouts the codebase, then either lists assumptions (enough related code found) or
interviews you one question at a time, compares 2-3 concrete options with a recommendation,
and always ends with an explicit `Decision / Rationale / Risks / Next step` conclusion.

Read-only by design: it never writes code or files.

## When NOT to use

In Spectra repos (`openspec/` exists), prefer `spectra-discuss` — it integrates with
artifact tracking and shared vocabulary.
```

- [ ] **Step 4: Codex install note**

Read one existing example first (`plugins/reviewer/.codex/INSTALL.md`) and follow its format.
Create `plugins/discuss/.codex/INSTALL.md` with the equivalent minimal content for this
plugin (one skill, no scripts, no hooks).

- [ ] **Step 5: Register in marketplace + bump reviewer**

In `.claude-plugin/marketplace.json`: read the file, then (a) add a `discuss` entry to the
plugins array following the exact shape of existing entries, with `"source": "./plugins/discuss"`,
the description from Step 1, `"version": "0.1.0"`; (b) change the reviewer entry's
`"version": "1.7.1"` to `"version": "1.8.0"`.

In `plugins/reviewer/.claude-plugin/plugin.json`: change `"version": "1.7.1"` to `"version": "1.8.0"`.

- [ ] **Step 6: Root README catalog**

Read the root `README.md` plugin catalog and add a `discuss` row/section matching the
existing format (name, one-line description, key commands).

- [ ] **Step 7: Verify registration consistency**

```bash
grep -n '"version"' plugins/discuss/.claude-plugin/plugin.json plugins/reviewer/.claude-plugin/plugin.json
grep -n '"version"' .claude-plugin/marketplace.json
python3 -c "import json; json.load(open('.claude-plugin/marketplace.json')); json.load(open('plugins/discuss/.claude-plugin/plugin.json')); print('JSON OK')"
```

Expected: discuss `0.1.0` and reviewer `1.8.0` in BOTH their plugin.json and marketplace.json; `JSON OK`.

- [ ] **Step 8: Smoke-test plugin loading**

Run: `claude --debug --plugin-dir ./plugins/discuss --print "exit" 2>&1 | grep -i "discuss\|error" | head -5`
Expected: the plugin loads without manifest errors (no `error` lines mentioning discuss). If the CLI invocation is unavailable in this environment, skip with a note.

- [ ] **Step 9: Commit**

```bash
git add plugins/discuss .claude-plugin/marketplace.json plugins/reviewer/.claude-plugin/plugin.json README.md
git commit -m "feat(discuss): portable framing skill plugin; bump reviewer to 1.8.0"
```

---

## Final Verification (after all tasks)

- [ ] `grep -rn "^model:" plugins/reviewer/agents/` → five `inherit`, one `haiku`
- [ ] `grep -rln "log_script_path" plugins/reviewer/ | wc -l` → 6 (+1 if spec SKILL/commands overlap counted once each)
- [ ] `.claude-plugin/marketplace.json` parses and versions match both plugin.json files
- [ ] `git log --oneline -9` shows one conventional commit per task
- [ ] Run `/reviewer:spec docs/superpowers/plans/2026-07-06-fable-workflow-upgrades.md` is NOT applicable (plan is done); instead spot-check one live flow: `echo '[{"severity":"LOW","title":"t","location":"l"}]' | plugins/reviewer/scripts/log-findings.sh --change smoke --source spec` then `rm -f .claude/reviewer/history.jsonl`
