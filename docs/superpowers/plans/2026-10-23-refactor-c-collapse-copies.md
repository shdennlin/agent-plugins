# Reviewer Refactor — Batch C (Collapse Copies) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One source for each prompt the reviewer plugin runs: the result angle brief lives in a template, agents are dispatched by type, `skills/*/SKILL.md` are Codex pointer stubs, the spec-dual workflow carries the command's name, and the superproject fixture carries no project paths.

**Architecture:** `templates/result-angle-prompt.md` holds the angle brief with `{placeholders}`; `agents/result-fix-orchestrator.md` fills it and dispatches `subagent_type: "reviewer:result-reviewer"`, whose agent file keeps identity, tools and the one-paragraph "you receive a filled brief" body; the Codex companion `skills/result/result-reviewer.md` points at the same template for its analysis/report steps. Fixers are dispatched by type too. Every `SKILL.md` shrinks to frontmatter + a pointer to `commands/<name>.md` + a Codex capability line. Contracts are pinned in `tests/commands.test.cjs` (string-level: which file holds which sentence) and verified once live through the recall harness (one sonnet run, one angle) so the typed dispatch and the MCP tool are proven to work together.

**Tech Stack:** markdown prompts, node:test, the existing recall harness (`tests/recall/run.mjs`).

**Spec:** `~/.claude/prompt-builder/reviewer-refactor.md` section "C. Collapse copies" (settled). Supporting evidence: `audit-layering.md` items 2–5, 12; `audit-ux.md` items 4, 8, 11.

## Global Constraints

- No version bump (1.20.0 lands in batch E). Commit convention `<type>(reviewer): <desc>`.
- Suites green after every task: `node --test plugins/reviewer/tests/*.test.cjs plugins/reviewer/tests/recall/*.test.cjs`, `node plugins/reviewer/tests/two-engine.harness.mjs`, `bash plugins/reviewer/tests/*.test.sh`, `claude plugin validate ./plugins/reviewer`.
- The live check in Task 1 spends LLM tokens (one sonnet run); every other step is offline.
- The three result angles' `focus` text in `templates/review-angles.yaml` stays where it is (it is per-angle data, not a copy).

## Review Focus

1. The typed sub-agent cannot call `mcp__plugin_reviewer_review__report_review` (tool list or MCP inheritance): merged.json `via` would show the fallback. Task 1's live check pins it; its Ruling branch deletes the agent files instead.
2. A Codex user following the shrunk `skills/result/SKILL.md`: must still reach the companion methodology and the template without a Claude Code tool. Pinned by the SKILL.md contract test in Task 3.
3. The Workflow tool registering by file name vs `meta.name`: both renamed in Task 4; harness pins the file, commands.test pins no stale string.
4. The fixture's 194 paths after anonymization still exercise the merge: 4 prefixes, unique paths, same extensions. Pinned in Task 5.
5. `composition` angle in the orchestrator's dispatch table after the template move: the spec orchestrator is untouched by this batch (its prompt is not a copy). Noted, no test.

---

### Task 1: Angle brief template + typed dispatch, proven live

**Files:**
- Create: `plugins/reviewer/templates/result-angle-prompt.md`
- Modify: `plugins/reviewer/agents/result-fix-orchestrator.md:82-157` (dispatch block → fill template, typed), `:241-250` (fixer dispatch typed)
- Modify: `plugins/reviewer/agents/result-reviewer.md` (body → brief-receiver; keep frontmatter/tools), `plugins/reviewer/agents/spec-orchestrator.md:187-195` (fixer typed `reviewer:spec-fixer`)
- Modify: `plugins/reviewer/skills/result/result-reviewer.md:62-111` (Steps 4–5c → "follow the template")
- Test: `plugins/reviewer/tests/commands.test.cjs`

**Interfaces:**
- Produces: template placeholders, exact names: `{angle_label}`, `{angle_focus}`, `{angle_key}`, `{spec_summary}`, `{run_dir}`, `{size_class}`, `{working_directory}`, `{file_list}`. Orchestrator sentence: "Read `{plugin_root}/templates/result-angle-prompt.md`, replace every `{placeholder}`, and pass the result as the prompt." Codex companion sentence: "Read `<physical>/../../templates/result-angle-prompt.md`; it is your analysis and report methodology; fill the placeholders from Step 3's setup output; since `report_review` does not exist here, write the identical JSON to `<run_dir>/single.json`."

- [ ] **Step 1: Write the failing contract tests**

```js
const SHARED = {
  batching: 'read it in slices of 10–15 files',
  neverSkip: 'Do NOT skip files as "unrelated to the spec"',
  submodule: 'belongs to that sub-repository',
  patternRule: 'smallest literal substring that identifies the construct',
}
test('the angle brief lives only in templates/result-angle-prompt.md', () => {
  const tpl = read('templates/result-angle-prompt.md')
  for (const s of Object.values(SHARED)) assert.ok(tpl.includes(s), `template lacks: ${s}`)
  for (const f of ['agents/result-fix-orchestrator.md', 'agents/result-reviewer.md', 'skills/result/result-reviewer.md'])
    for (const [k, s] of Object.entries(SHARED)) assert.ok(!read(f).includes(s), `${f} still carries the ${k} sentence`)
  for (const p of ['{angle_label}', '{angle_focus}', '{angle_key}', '{spec_summary}', '{run_dir}', '{size_class}', '{working_directory}', '{file_list}']) assert.ok(tpl.includes(p), `template lacks ${p}`)
})
test('orchestrators dispatch plugin agents by type', () => {
  assert.match(read('agents/result-fix-orchestrator.md'), /subagent_type: "reviewer:result-reviewer"/)
  assert.match(read('agents/result-fix-orchestrator.md'), /subagent_type: "reviewer:result-fixer"/)
  assert.match(read('agents/spec-orchestrator.md'), /subagent_type: "reviewer:spec-fixer"/)
  assert.match(read('agents/result-fix-orchestrator.md'), /templates\/result-angle-prompt\.md/)
  assert.match(read('skills/result/result-reviewer.md'), /templates\/result-angle-prompt\.md/)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/reviewer/tests/commands.test.cjs`
Expected: both fail (`Cannot find`/`template lacks`, no `subagent_type: "reviewer:result-reviewer"`).

- [ ] **Step 3: Move the brief**

Cut `agents/result-fix-orchestrator.md:88-156` (from "You are a senior engineer…" to the Working Directory line) into the template verbatim, renaming `{angle label}`→`{angle_label}`, `{angle focus text}`→`{angle_focus}`, `{angle key}`→`{angle_key}`, `{spec summary from Step 0}`→`{spec_summary}`, `{files, one path per line}`→`{file_list}`. The orchestrator's dispatch block becomes `Agent tool: subagent_type: "reviewer:result-reviewer", description: "Result review — {angle_label}", prompt: <filled template>` plus the Interfaces sentence. `agents/result-reviewer.md` frontmatter `tools:` keeps Read, Glob, Grep, Bash and replaces the exact MCP name with the documented server wildcard `mcp__plugin_reviewer_review__*` (docs: an allowlist with no MCP entry removes MCP tools; the wildcard form is the documented one, the exact-name form is not shown). Body: keep "# Result Reviewer Agent", Input Parameters, Constraints, Log Findings; replace "## Behavior" with one paragraph: "The orchestrator sends you a filled brief (angle, spec summary, run dir, file list, working directory). Follow the brief exactly; your last action is the `report_review` call it describes." Remove the Behavior bullets that duplicate the template. Companion Steps 4–5c → the Codex sentence from Interfaces (keep Step 5d merge/log and the report sections). Fixer blocks get `subagent_type`.

- [ ] **Step 4: Run to verify they pass; whole suite**

Run: `node --test plugins/reviewer/tests/*.test.cjs && claude plugin validate ./plugins/reviewer`
Expected: PASS.

- [ ] **Step 5: Live check (one sonnet run, one angle)**

Run: `node plugins/reviewer/tests/recall/run.mjs --runs 1 --model sonnet --angles coverage --plugin-dir ./plugins/reviewer --out /tmp/c-live --keep`
Expected: the run's merged.json has `via.coverage === "report_review"` and `complete: true` (print `jq '{complete, via}' <run>/merged.json`). If `via` is the direct-write fallback or the tool errors with "not available": **Ruling branch** — delete `agents/result-reviewer.md` and `agents/result-fixer.md`, dispatch untyped with the filled template, keep `reviewer:spec-fixer` typed only if the workflow already proves it (it does, `workflow.js:411`), ledger it, and adjust the second test to assert the template path instead of the type.

- [ ] **Step 6: Commit**

```bash
git add plugins/reviewer/templates/result-angle-prompt.md plugins/reviewer/agents plugins/reviewer/skills/result/result-reviewer.md plugins/reviewer/tests/commands.test.cjs
git commit -m "refactor(reviewer): one angle brief template; result and spec orchestrators dispatch plugin agents by type"
```

---

### Task 2: Codex capability table in `.codex/INSTALL.md`

**Files:**
- Modify: `plugins/reviewer/.codex/INSTALL.md` (after "## Codex differences")
- Test: `plugins/reviewer/tests/commands.test.cjs`

- [ ] **Step 1: Failing test**

```js
test('INSTALL.md states per-command Codex support', () => {
  const t = read('.codex/INSTALL.md')
  for (const row of ['| `init` |', '| `result` |', '| `spec` |', '| `spec-dual` |']) assert.ok(t.includes(row), `INSTALL lacks ${row}`)
  assert.match(t, /spec-dual.*Workflow tool/)
})
```

- [ ] **Step 2: Run** → fails. **Step 3:** add the table: `init` ✓ (rules file fallback), `result` ✓ without `-c`, `report_review` replaced by `single.json`, `spec` ✓ single orchestrator prompt, no parallel angles, `spec-dual` ✗ needs Claude Code's Workflow tool and `codex:codex-rescue`. **Step 4: Run** → passes. **Step 5: Commit** `docs(reviewer): Codex capability table`.

---

### Task 3: SKILL.md files become pointer stubs; CLAUDE.md names the real entry point

**Files:**
- Modify: `plugins/reviewer/skills/{init,result,spec,spec-dual}/SKILL.md`, `/Users/shdennlin/m/project/agent-plugins/CLAUDE.md:17`, `plugins/reviewer/README.md` (one sentence in the architecture paragraph)
- Test: `plugins/reviewer/tests/commands.test.cjs`

**Interfaces:**
- Produces: each SKILL.md = frontmatter (name, description unchanged) + body ≤ 15 non-blank lines containing: "Claude Code runs `commands/<name>.md`; this file is the Codex entry.", a Codex capability line matching INSTALL.md, and for result: "Under Codex follow `result-reviewer.md` in this directory." for init: "follow `init-reviewer.md`"; for spec: "run the steps of `../../commands/spec.md` with `../../agents/spec-orchestrator.md` as the reviewer prompt"; for spec-dual: "not available under Codex (needs the Workflow tool); use `$spec`."

- [ ] **Step 1: Failing test**

```js
test('SKILL.md files are pointer stubs, not flag copies', () => {
  for (const n of ['init', 'result', 'spec', 'spec-dual']) {
    const t = read(`skills/${n}/SKILL.md`).replace(/^---[\s\S]*?---\n/, '')
    const lines = t.split('\n').filter((l) => l.trim())
    assert.ok(lines.length <= 15, `${n}/SKILL.md body has ${lines.length} lines`)
    assert.ok(t.includes(`commands/${n}.md`), `${n}/SKILL.md does not point at commands/${n}.md`)
    assert.ok(!/^\s*--[a-z]/m.test(t), `${n}/SKILL.md restates flags`)
  }
})
```

- [ ] **Step 2: Run** → fails on line counts. **Step 3:** rewrite the four files per Interfaces; CLAUDE.md line 17 → "**Skills** (`skills/{name}/SKILL.md` + companion `.md`) — Codex entry points. In Claude Code the slash command is `commands/{name}.md`; a SKILL.md is a pointer stub plus the Codex companion prompt, never a second copy of the flags." README: same sentence, shorter. **Step 4: Run** → passes. **Step 5: Commit** `refactor(reviewer): SKILL.md files are Codex pointer stubs; commands/*.md named as the entry point`.

---

### Task 4: Workflow named `spec-dual`

**Files:**
- Rename: `plugins/reviewer/workflows/two-engine-spec-review.workflow.js` → `plugins/reviewer/workflows/spec-dual.workflow.js` (git mv); `meta.name: 'spec-dual'`; error prefixes `two-engine-spec-review:` → `spec-dual:`
- Modify: `plugins/reviewer/commands/spec-dual.md:119`, `plugins/reviewer/skills/spec-dual/SKILL.md` (if the stub still names it), `plugins/reviewer/tests/two-engine.harness.mjs:12`, README mentions
- Test: `plugins/reviewer/tests/commands.test.cjs`

- [ ] **Step 1: Failing test**

```js
test('the spec-dual workflow carries the command name', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'workflows', 'spec-dual.workflow.js')))
  assert.match(read('workflows/spec-dual.workflow.js'), /name: 'spec-dual'/)
  for (const f of ['commands/spec-dual.md', 'skills/spec-dual/SKILL.md', 'README.md']) assert.ok(!read(f).includes('two-engine-spec-review'), `${f} still names two-engine-spec-review`)
})
```

- [ ] **Step 2: Run** → fails. **Step 3:** git mv + sed; harness path; `name: "reviewer:spec-dual"` in the command's Workflow call. **Step 4:** `node plugins/reviewer/tests/two-engine.harness.mjs && node --test plugins/reviewer/tests/commands.test.cjs` → 24 ok, PASS. **Step 5: Commit** `refactor(reviewer): spec-dual workflow file and name match the command`.

---

### Task 5: Fixture anonymized

**Files:**
- Modify: `plugins/reviewer/tests/fixtures/submodule-manifest.json`
- Test: `plugins/reviewer/tests/merge-findings.test.cjs` (the existing fixture test's prefix assertion changes to `['sub-a','sub-b','sub-c','sub-d']`)

- [ ] **Step 1:** Change the assertion to the new prefixes; run → fails. **Step 2:** rewrite the fixture with a one-off node script: prefixes mapped in sorted order to `sub-a..sub-d`; every remaining path → `<prefix>/f<NNN><ext>` (NNN = 3-digit index within the prefix, ext = original extension or none); `working_directory` → `/srv/superproject`, `run_dir` → `/srv/superproject/openspec/reviews/runs/20261023T114141Z-d470`, `diff_strategy` unchanged, counts unchanged; add a test assertion that no path contains `/src/` or `onelegion`. **Step 3:** run → passes (194 files, unique). **Step 4: Commit** `test(reviewer): anonymize the superproject manifest fixture`.

- [ ] **Step 5: Full suite** (Global Constraints command) → all green.
