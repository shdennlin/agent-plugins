# Reviewer Batch G (Verify Stage + Four Small Fixes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every merged finding passes an independent verification agent before it reaches the report (refuted → dropped and logged `dismissed`, unverifiable → one severity level down and flagged), the recall harness proves verification costs no recall, and four small gaps close: rule-derived findings fold across angles, escalated history rows can be settled, spec-dual findings carry a parseable `location` and a `pattern`, and `/reviewer:spec` gets its own seeded harness; released as 1.22.0 on `feat/verify-stage`.

**Architecture:** The merge gives every issue a stable `id` (`F1…Fn`, worst-first). A new MCP tool `verify_review` (same server, same hand-rolled schema checker) accepts one verifier agent's verdicts for a batch of ids and writes `<run_dir>/verify/<batch>.json`; `merge-findings.cjs <run_dir> --apply-verify` folds those files into `merged.json` (`issues[].verified`, `refuted[]`, recomputed `counts`/`verdict`) and logs refuted issues with `outcome: dismissed`. Both orchestrators gain a Step 3b between merge and triage: batches of ≤8 issues go to typed `reviewer:verifier` agents with a template brief (`templates/verify-prompt.md`) that must open each cited location and return `confirmed | refuted | unverified` with one line of evidence; then `--apply-verify` runs and the report is rendered from the verified `merged.json`. The four small fixes are independent of the Verify stage and each other.

**Tech Stack:** node (`node:test`), bash, markdown prompts, the recall harness (LLM: 6 sonnet runs for result, 3 for the new spec harness).

**Spec:** this plan's **Requirements** section below (settled in conversation on 2026-10-24; there is no separate spec file). Evidence: the batch-E/F ledgers, the OneLegion run `20261024T084324Z` (12 fixed / 12 escalated, same rule reported twice by two angles), the F review's gap list, Anthropic Code Review's Find → Verify → Rank → Post pipeline.

## Requirements (settled; do not revisit)

1. **Verify stage.** After the merge, an agent that did not write the finding tries to disprove it against the actual files. Three outcomes per finding: `confirmed` (unchanged), `refuted` (removed from `issues`, kept in `refuted[]` with the evidence, logged with `outcome: dismissed`), `unverified` (the verifier could not confirm it in the cited location: severity drops one level, `LOW` stays `LOW`, flagged `verified: "unverified"`). The verdict and counts are recomputed after verification. Verification never adds findings.
2. **Verification is measured, not assumed.** The recall harness reports hits before and after verification per run; a seed hit that verification refutes is a `false_refutation` and fails the expectation `false_refutation = 0`. `extra` is reported before and after.
3. **Rule-derived findings fold.** A finding that reports a project-rule violation sets `pattern` to the rule's first eight words verbatim, in all three briefs (spec, result, spec-dual Codex/Claude prompts), so angles reporting the same rule fold in the merge and in fold-findings.
4. **Escalated rows can be settled.** `scripts/settle-findings.cjs` lists and rewrites the `outcome` of history rows in place (`escalated → fixed | dismissed | residual`), by run id or change plus a title match, with `--dry-run`; nothing else in the row changes.
5. **spec-dual locations are parseable.** The workflow's FINDINGS schema constrains `location` to `<file>`, `<file>:<line>`, `<file>:<line>-<line>`, `<file>:<symbol>` or `<file> §<section>` (one file per finding) and adds optional `pattern`; both engine prompts state the format and ask for `pattern`.
6. **Spec has a seeded harness.** `tests/spec-recall/` mirrors `tests/recall/`: a fixture change under `openspec/changes/demo/` with seeded spec defects, `seeds.json`, a scorer, a headless runner for `/reviewer:spec`, and a baseline of 3 sonnet runs ledgered.
7. Version `1.22.0` in both manifests in the last task; branch `feat/verify-stage` from main `b40a416`; `--no-ff` merge after approval.

## Global Constraints

- Every suite green after every task: `node --test plugins/reviewer/tests/*.test.cjs plugins/reviewer/tests/recall/*.test.cjs plugins/reviewer/tests/spec-recall/*.test.cjs`; `node plugins/reviewer/tests/two-engine.harness.mjs`; `bash plugins/reviewer/tests/*.test.sh`; `claude plugin validate ./plugins/reviewer`.
- Verification is review-time only: no verifier ever edits a file, runs the setup or merge scripts, or logs findings.
- `verify/` is a subdirectory of the run dir, so `loadReports` never sees its files as angle reports; `report_review` refuses `verify` as an angle name.
- Never run anything against `/Users/shdennlin/workspace/onelegion`; harness fixtures are scratch repos only.
- Headless checks use the renamed scratchpad copy `reviewer-dev` (the installed plugin shadows `--plugin-dir`).
- Do not add `--block-at`, rename `-n`, or lowercase severities.

## Review Focus

1. A verifier that returns a verdict for an id the merge does not know, or no verdict for an id it was given: unknown ids are rejected by the tool; missing ids stay `unverified`-flagged with `verified: "not_checked"` and the report says so. Pinned in Task 1.
2. A seed hit refuted by verification (false refutation): the harness prints it by name and the run's expectation fails. Pinned in Task 3.
3. Two angles reporting the same project rule with different wording: one merged issue after Task 4, with both angles listed. Pinned in Task 4.
4. `settle-findings.cjs` on a row whose outcome is already `fixed`, or a title matching two rows: the former is left alone and counted, the latter is refused unless `--all-matching`. Pinned in Task 5.
5. A spec-dual finding whose `location` names two files (`a.md + b.md`) or has no file: rejected by the schema regex; the prompt tells the engine to pick the primary file and name the others in `rationale`. Pinned in Task 6.

---

### Task 1: Stable issue ids, `verify_review` tool, `--apply-verify` in the merge

**Files:**
- Modify: `plugins/reviewer/scripts/merge-findings.cjs` (issue `id`; `--apply-verify`; `verify/` ignored by `loadReports`; refuted rows logged `dismissed`), `plugins/reviewer/mcp/schema.cjs` (`VERIFY_SCHEMA`, `validateVerify(report, mergedIds)`), `plugins/reviewer/mcp/server.cjs` (second tool), `plugins/reviewer/mcp/report-review.cjs` (`verify` reserved as an angle)
- Create: `plugins/reviewer/mcp/verify-review.cjs`
- Test: `plugins/reviewer/tests/merge-findings.test.cjs`, `tests/schema.test.cjs`, `tests/server.test.cjs`

**Interfaces:**
- Produces: `merged.issues[i].id = "F<n>"` (1-based, assigned after the worst-first sort, before verification). Tool `verify_review` args `{run_dir, batch: string /^[a-z0-9_-]+$/, verdicts: [{id, status: confirmed|refuted|unverified, evidence: string minLength 1}]}`; validates against `merged.json`'s ids (unknown id → violation `verdicts[i].id: F9 not in merged.json`), writes `<run_dir>/verify/<batch>.json` with `via: verify_review`, `reported_at`. CLI `node merge-findings.cjs <run_dir> --apply-verify [--log-script … --change … --round … --outcomes …]`: reads `merged.json` + `verify/*.json`; per issue: `verified: "confirmed" | "refuted" | "unverified" | "not_checked"`, `evidence`; refuted issues move to `refuted[]`; unverified drop one severity level (`LOW` stays); `counts`, `verdict` recomputed; `verification: {checked, confirmed, refuted, unverified, not_checked}` added; rewrites `merged.json` (keeps `merged.pre-verify.json`); when logging, refuted rows get `outcome: dismissed` and the rest follow `--outcomes` / `open`. Without any `verify/*.json` the command is a no-op that prints `verification: none`.

- [ ] **Step 1: Failing tests** — merge: `issues[0].id === 'F1'`, ids unique and sequential; `--apply-verify` with `verify/a.json` `{F1: refuted, F2: unverified(HIGH→MEDIUM), F3: confirmed}` → `issues` lacks F1, `refuted[0].id === 'F1'`, F2 severity MEDIUM and `verified: 'unverified'`, F3 unchanged, `verification.not_checked` counts the rest, `counts` recomputed, `verdict` PASS when the only HIGH was refuted; `LOW` unverified stays `LOW`; `merged.pre-verify.json` exists; a `verify/` dir never appears in `via` or `invalid_reports`; logging after apply-verify writes the refuted row with `outcome: 'dismissed'`. schema: unknown id rejected naming it; status outside the enum rejected; empty evidence rejected. server: `tools/list` has two tools; `verify_review` writes `verify/<batch>.json`; `report_review` refuses angle `verify`.
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. **Step 5: Commit** `feat(reviewer): verify_review tool and merge --apply-verify with stable issue ids`.

---

### Task 2: Verifier brief, typed `reviewer:verifier`, Step 3b in both orchestrators

**Files:**
- Create: `plugins/reviewer/templates/verify-prompt.md` (placeholders `{run_dir} {batch} {working_directory} {mode} {issues_json}`; instructions: for each issue open the cited location (`git show`/Read; in spec mode read the section), decide `confirmed` when the described defect is there, `refuted` when the cited text or code shows it is not (quote the line), `unverified` when the location cannot be found or the claim cannot be checked from the files; one call to `mcp__plugin_reviewer_review__verify_review`; fallback heredoc to `{run_dir}/verify/{batch}.json`; print `batch: … confirmed N refuted N unverified N`), `plugins/reviewer/agents/verifier.md` (tools Read, Glob, Grep, Bash, `mcp__plugin_reviewer_review__*`; internal brief-receiver; never edits)
- Modify: `agents/result-fix-orchestrator.md` and `agents/spec-orchestrator.md` (new **Step 3b: Verify** between Step 3 and Step 4: split `merged.issues` into batches of ≤8 by id order, dispatch `subagent_type: "reviewer:verifier"` in parallel with the filled template, then run `node merge-findings.cjs {run_dir} --apply-verify`; render the report from the verified `merged.json`; section D lists `refuted[]` under "Refuted by verification" with the evidence; Log Findings re-runs include `--apply-verify` so refuted rows log `dismissed`; the skip rule: when `merged.issues` is empty, skip 3b), `commands/result.md` Step 3d (the `-c` route's merge call adds `--apply-verify`), `skills/*/SKILL.md` stubs unchanged, `README.md` (one paragraph: the Verify stage, the three statuses, `--no-verify`?). **Ruling in plan:** no `--no-verify` flag; verification always runs when there are issues (the user can read `refuted[]`).
- Test: `tests/commands.test.cjs` (template placeholders; verifier agent tools and "Not directly invocable"; both orchestrators contain `Step 3b`, `reviewer:verifier`, `--apply-verify`, `Refuted by verification`; README names the three statuses)
- [ ] **Step 1: Failing contract tests.** **Step 2: Run** → fail. **Step 3: Write prompts.** **Step 4: Run** → pass. **Step 5: Live check** with the `reviewer-dev` copy on the scratchpad `live-spec` repo: `claude -p "/reviewer-dev:spec openspec/changes/demo --no-explore --angles scope,completeness"` → run dir has `verify/*.json`, `merged.json.verification.checked === issues + refuted`. Ledger the counts. **Step 6: Commit** `feat(reviewer): verify stage — typed verifier agents refute or confirm every merged finding`.

---

### Task 3: Recall harness measures verification

**Files:**
- Modify: `tests/recall/score.cjs` (`scoreRun(merged, seeds)` also reads `merged.refuted` and `merged.pre-verify.json` when present: `before: {hits, extra}`, `after: {hits, extra}`, `false_refutation: [seedIds]` = seeds hit in pre-verify whose every hitting issue is in `refuted[]`, `refuted: n`), `tests/recall/run.mjs` (per-run columns `extra→`, `refuted`, `falseRef`; summary `false_refutation total` and `mean extra before → after`; exit 1 when any false refutation), `tests/recall/score.test.cjs`
- [ ] **Step 1: Failing test** — a merged fixture with `pre-verify` holding a seed hit that `refuted[]` removed → `false_refutation: ['type-none']`; an `extra` issue refuted → `after.extra` one less, `false_refutation: []`. **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. **Step 5: Measure** `node plugins/reviewer/tests/recall/run.mjs --runs 3 --model sonnet --plugin-dir "$PWD/plugins/reviewer" --out /tmp/recall-g` — expectation: 7-seed recall ≥ 0.86 (unchanged), `false_refutation` 0 in 3/3, `extra` after ≤ before. If a seed is falsely refuted, read `verify/*.json` evidence and ledger whether the verifier misread the location (prompt) or the seed is genuinely ambiguous; rule and rerun once. **Step 6: Commit** `test(reviewer): recall harness reports verification effect and false refutations`.

---

### Task 4: Rule-derived findings carry the rule as `pattern`

**Files:**
- Modify: `templates/spec-angle-prompt.md`, `templates/result-angle-prompt.md` (under **pattern**: "When the issue is a violation of a project rule, `pattern` is the rule's first eight words, verbatim, so every angle that reports the same rule folds into one issue"), `workflows/spec-dual.workflow.js` (the same sentence in the Claude angle prompt builder and the Codex prompt), `scripts/fold-findings.cjs` (no change expected: `normKey` of the eight words already folds)
- Test: `tests/commands.test.cjs` (both templates contain `first eight words`), `tests/merge-findings.test.cjs` (two reports, angles scope and design, titles "Behaviour-changing decisions without alternatives considered" / "Behaviour/scope decisions without a rejected alternative", same `pattern: 'Every architecture decision that changes behaviour (data flow,'` → one issue, `angles: ['design','scope']`, `folded: 1`), `tests/two-engine.harness.mjs` (Claude angle prompt and Codex prompt contain `first eight words`)
- [ ] **Step 1: Failing tests.** **Step 2: Run** → fail. **Step 3: Edit.** **Step 4: Run** → pass. **Step 5: Commit** `refactor(reviewer): rule violations carry the rule text as pattern so angles fold`.

---

### Task 5: `settle-findings.cjs`

**Files:**
- Create: `plugins/reviewer/scripts/settle-findings.cjs`, `plugins/reviewer/tests/settle-findings.test.cjs`
- Modify: `README.md` (one paragraph after the migration one), `commands/init.md` (one sentence: `--from-history` treats `dismissed` rows as refuted/false positives and `escalated` rows as still-open decisions)
- Test: `tests/commands.test.cjs` (init.md mentions `dismissed`)

**Interfaces:**
- Produces: CLI `settle-findings.cjs (--run-id <id> | --change <id>) [--title <substring>] [--list] [--set fixed|dismissed|residual] [--all-matching] [--dry-run]`; `--list` prints matching rows as `<n>. <outcome> <severity> <title> (<location>)`; `--set` rewrites `outcome` of matching rows whose current outcome is `escalated` or `open` (others are counted as `left: N` and untouched) in place (temp file + rename), prints `settled N row(s) → <outcome> (left N)`; two or more rows matching `--title` without `--all-matching` → exit 1 naming them; `--dry-run` prints the same line and writes nothing. Target file from `read-rules.cjs`'s `resolvePaths(cwd).history_path`.

- [ ] **Step 1: Failing tests** — a temp history with 3 rows (escalated, escalated, fixed; two share a title word): `--list --run-id r1` prints 3; `--set fixed --title "owner"` with two matches → exit 1; with `--all-matching` → 2 settled; `--set dismissed --title "unique"` on the already-fixed row → `settled 0 (left 1)`; `--dry-run` leaves the file byte-identical; every rewritten row still passes `validateHistoryRow`; rows not matched are byte-identical.
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. **Step 5: Commit** `feat(reviewer): settle-findings.cjs updates escalated history rows in place`.

---

### Task 6: spec-dual `location` format and `pattern`

**Files:**
- Modify: `workflows/spec-dual.workflow.js` (FINDINGS `location: { type: 'string', pattern: '^[^\\s:§]+(?::\\d+(?:-\\d+)?|:[A-Za-z_][\\w.]*| §.+)?$' }`, `pattern: { type: 'string' }` already present; the Claude angle prompt and the Codex prompt gain: "`location` is ONE file in the form `<file>`, `<file>:<line>`, `<file>:<line>-<line>`, `<file>:<symbol>` or `<file> §<heading>`; name other files in `rationale`; set `pattern` to the shortest literal phrase from the spec that identifies the defect"), `commands/spec-dual.md` (one sentence in Step 6 that rows now parse into structured locations)
- Test: `tests/two-engine.harness.mjs` (the harness evaluates the script source: assert `FINDINGS.properties.location.pattern` exists and that `new RegExp(it)` accepts `design.md §Rollback`, `tasks.md:12`, `tasks.md:3-5`, `spec.md:Requirement_1` and rejects `design.md + tasks.md`, `§Rollback`, `a.md:1,2`; both prompts contain `ONE file`), `tests/commands.test.cjs`
- [ ] **Step 1: Failing tests.** **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. **Step 5: Commit** `feat(reviewer): spec-dual findings carry one parseable location and a pattern`.

---

### Task 7: `tests/spec-recall/` seeded spec harness + baseline

**Files:**
- Create: `plugins/reviewer/tests/spec-recall/fixture.cjs` (`buildFixture(dir) -> {repo, change}`: a git repo with `openspec/config.yaml` holding the decisions rule and two of the stock rules, `openspec/changes/demo/{proposal.md, design.md, tasks.md, specs/export/spec.md, specs/limits/spec.md}`; every seed's `phrase` is a literal substring of its file), `seeds.json` (6 seeds: `scope-no-nongoals` proposal has no Non-goals section; `design-no-alternatives` design §Storage picks SQLite with no alternative; `consistency-contradiction` proposal says "exports CSV only", specs/export says JSON and CSV; `completeness-no-scenario` specs/limits has a requirement with no scenario; `tasks-no-done` tasks.md task 3 "Add tests" with no done criterion; `design-undefined-term` design uses "the budget" never defined; each with `file`, `section` or `line`, `phrase`, `titleHints`, `expectedSeverity`), `score.cjs` (hit when an issue's `location` path is the seed's file AND (its section/line matches OR `pattern`/`title` contains the phrase) AND a titleHint matches; `extra` as in recall), `run.mjs` (same flags as recall; prompt `/reviewer:spec openspec/changes/demo --no-explore`; reads the newest run dir's `merged.json`), `fixture.test.cjs`, `score.test.cjs`
- Modify: `README.md` (one sentence pointing at both harnesses)
- [ ] **Step 1: Failing tests** — fixture builds, contains every seed phrase in its file, `openspec/config.yaml` has the decisions rule; scorer: a hit, a wrong-file miss, an extra. **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. **Step 5: Baseline** `node plugins/reviewer/tests/spec-recall/run.mjs --runs 3 --model sonnet --plugin-dir "$PWD/plugins/reviewer" --out /tmp/spec-recall-g`; ledger the per-seed table, `extra`, `refuted`, `false_refutation`. Report whatever it is; no expectation is set for the first measurement. **Step 6: Commit** `test(reviewer): seeded spec harness with six spec defects and a baseline`.

---

### Task 8: Version 1.22.0

- [ ] Bump `plugins/reviewer/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` to `1.22.0`; README changelog line (Verify stage, rule pattern, settle-findings, spec-dual location format, spec harness with its baseline). Full suite + `claude plugin validate`. Commit `chore(reviewer): 1.22.0`.
