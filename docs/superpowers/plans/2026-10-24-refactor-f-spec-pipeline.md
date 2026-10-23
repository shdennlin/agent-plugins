# Reviewer Refactor — Batch F (Spec on the Structured Pipeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/reviewer:spec` reports through the same schema-enforced tool and deterministic merge as `/reviewer:result`, the spec-dual workflow reuses the merge's fold, and history rows gain `outcome` and structured `locations` (schema v3) with the migration extended; released as 1.21.0 on `feat/spec-pipeline`.

**Architecture:** A new `scripts/setup-spec-review.sh` writes a run dir (`manifest.json` with `mode: "spec"`, `files` = the spec files under the given paths, `run_id`, `working_directory`; no `diff.patch`). `mcp/schema.cjs` gains a spec report shape (same `files`/`issues`/`verdict`, `pattern` optional, `coverage` absent) selected by `manifest.mode`; `report-review.cjs` reads the mode from the manifest. `merge-findings.cjs` runs unchanged on spec runs (no patch → no sweep) and logs `--source spec`. `agents/spec-orchestrator.md` dispatches `reviewer:spec-reviewer` with a template brief (`templates/spec-angle-prompt.md`), then runs the merge and renders `merged.json`, exactly like the result orchestrator. The workflow imports `normKey`/`foldByPattern` through its args (Workflow scripts cannot `require`), so the command passes the fold as data: `args.foldKeys` computed by a small script? No: the workflow keeps its own `keyOf` but the command post-processes `history[].findings` with `node scripts/fold-findings.cjs` before logging. History v3: `outcome ∈ {open, fixed, escalated, dismissed, residual, unknown}` and `locations: [{path, line?, endLine?, symbol?, section?, raw?}]`; `log-findings.cjs` parses string locations into the structured form; `migrate-history.cjs` gains v2→v3.

**Tech Stack:** bash + jq, node:test, markdown prompts, the recall harness is not involved (spec has no seeded fixture; a small `tests/spec-run` fixture is added).

**Spec:** `~/.claude/prompt-builder/reviewer-refactor.md` section "F. spec onto the structured pipeline (1.21.0)". Evidence: `audit-layering.md` item 6, `audit-data.md` items 3, 7.

## Global Constraints

- Branch `feat/spec-pipeline` from main after 1.20.0 is merged; version `1.21.0` in both manifests in the last task.
- `log-findings.sh` wrapper removed in this batch (one release after B); every prompt names `log-findings.cjs`.
- No fixture or test may touch the user's projects; history migration v2→v3 is delivered as a command, never run.
- Existing suites stay green after every task; `tests/two-engine.harness.mjs` must keep 24 scenarios passing.

## Review Focus

1. A spec path that is a directory with nested `specs/<cap>/spec.md` files: the manifest lists every `.md` under it (not just top level), deterministic order. Pinned in Task 1.
2. A spec report whose issue `location` is `design.md §3` or `tasks.md:12`: accepted; parsed into `{path, section}` / `{path, line}` in history. Pinned in Tasks 1 and 5.
3. Spec-dual's union findings after `fold-findings.cjs`: two engines' different wordings of one defect at one location fold, `engines` lists both. Pinned in Task 4.
4. A v2 history file migrated to v3: `outcome: unknown`, `locations` parsed; a v3 file re-run: already-v3 count, nothing rewritten. Pinned in Task 6.
5. The result orchestrator sets `outcome: fixed` only for directives the fixer reported applied, `escalated` for human-escalated ones, `open` otherwise. Pinned in Task 5 by a contract test on the prompt text plus a merge unit test for the `--outcomes` input.

---

### Task 1: `setup-spec-review.sh` + spec mode in the schema and the tool

**Files:**
- Create: `plugins/reviewer/scripts/setup-spec-review.sh`, `plugins/reviewer/tests/setup-spec-review.test.sh`
- Modify: `plugins/reviewer/mcp/schema.cjs` (`validateReport(report, manifestFiles, {mode})`: in spec mode `coverage` must be absent, `pattern` optional, issue `location` may be `<path>`, `<path>:<n>` or `<path> §<section>`), `plugins/reviewer/mcp/report-review.cjs` (passes `manifest.mode`), `plugins/reviewer/tests/schema.test.cjs`, `tests/server.test.cjs`

**Interfaces:**
- Produces: CLI `setup-spec-review.sh --working-dir <dir> <path>...` → stdout `{run_id, run_dir, mode:"spec", files:[...], file_count}`; `manifest.json` adds `mode`, `working_directory`, `created`, `spec_paths` (as given). Run root rule as the result setup (`openspec/reviews/runs` or `.claude/reviewer/runs`), run id via mktemp.

- [ ] Step 1 tests (bash): a dir with `proposal.md`, `design.md`, `specs/a/spec.md`, `specs/b/spec.md`, `mockups/x.html` → files = the four `.md` in sorted order; a single file path → one entry; a missing path → exit 2 naming it. (node) spec-mode validator: `coverage` present → violation; `pattern` absent → fine; location `design.md §3` → fine; file-level `issue_count` rule unchanged.
- [ ] Step 2 RED. Step 3 implement. Step 4 GREEN. Step 5 commit `feat(reviewer): setup-spec-review.sh and spec mode for report_review`.

### Task 2: Spec angle brief template + typed `reviewer:spec-reviewer`

**Files:**
- Create: `plugins/reviewer/templates/spec-angle-prompt.md` (from `agents/spec-orchestrator.md:60-112`, placeholders `{angle_label} {angle_focus} {angle_key} {run_dir} {file_list} {working_directory} {codebase_context} {project_rules}`; Report section = `report_review` call with `angle`, `files` (every manifest path → clean|issues), `issues` with `location` as `<file> §<section>` or `<file>:<line>`, `verdict`), `plugins/reviewer/agents/spec-reviewer.md` (tools Read, Glob, Grep, Bash, `mcp__plugin_reviewer_review__*`; internal, brief-receiver)
- Modify: `agents/spec-orchestrator.md` (Step 1b: run setup; Step 2: fill template, `subagent_type: "reviewer:spec-reviewer"`; Step 3: `node merge-findings.cjs <run_dir> --change … --round N --expect <keys> --no-log`, render A–D from `merged.json`; Log Findings: re-run the merge without `--no-log` on the final round, `--log-script` = log-findings.cjs), `commands/spec.md` (passes `plugin_root`, `log_script_path` → `.cjs`), `tests/commands.test.cjs`
- [ ] Contract tests: template holds the SHARED sentences of the spec brief once; orchestrator has `subagent_type: "reviewer:spec-reviewer"` and `merge-findings.cjs`; no `Deduplicate — if two issues have the same topic` prose left. Live check: `claude -p "/reviewer-dev:spec <fixture dir>"` with the renamed copy → `merged.json` with `via` all `report_review`.
- [ ] Commit `refactor(reviewer): spec review reports through report_review and merges with merge-findings`.

### Task 3: Composition angle and fix loop on `merged.json`

- Modify: `agents/spec-orchestrator.md` Steps 4–7 (verdict from `merged.verdict`/`complete`; triage reads `merged.issues`; directives carry `locations`), `agents/spec-fixer.md` (reports per-directive `applied: true|false` list in a fixed format `APPLIED: <n>, SKIPPED: <n> <reason>`)
- [ ] Contract tests + harness-free unit test for a `parseFixerReport(text)` helper added to `scripts/merge-findings.cjs` (exported) used by both orchestrators' prompts (they paste its JSON).
- [ ] Commit `refactor(reviewer): spec fix loop runs on merged.json; fixer reports applied directives`.

### Task 4: `fold-findings.cjs` for the spec-dual union

- Create: `plugins/reviewer/scripts/fold-findings.cjs` (stdin: array of `{title, location, severity, category, engine, engines}`; stdout: folded array using `normKey` on `pattern` when present, else a title-similarity key = location + first 4 significant title words; `engines` unioned; `folded` count), `tests/fold-findings.test.cjs`
- Modify: `commands/spec-dual.md` Step 6 (pipe each round's `history[n].findings` through fold-findings before log-findings), `workflows/spec-dual.workflow.js` (findings carry `pattern` when the reviewer gives one; FINDINGS schema adds optional `pattern`), `tests/two-engine.harness.mjs` (one scenario asserts `pattern` passes through)
- [ ] Commit `feat(reviewer): spec-dual rounds fold through fold-findings.cjs before logging`.

### Task 5: History v3 — `outcome` and structured `locations`

- Modify: `mcp/schema.cjs` (`HISTORY_ROW` v3: `v: 3`, `outcome` enum, `locations: [{path, line?, endLine?, symbol?, section?, raw?}]` minItems 1), `scripts/log-findings.cjs` (parse `path:line`, `path:line-end`, `path:symbol`, `path §section`, `path` into objects; unparseable → `{path: <whole string>, raw}`; `outcome` default `unknown`; `--outcomes <json>` maps title+location → outcome), `scripts/merge-findings.cjs` (`--outcomes <file>` written by the orchestrators from the fixer report), both orchestrators' Log Findings steps, `commands/result.md` 3d, `commands/spec-dual.md` Step 6 (`escalated` for needsHuman, `residual` for the last round's open items), README, `tests/log-findings.test.cjs`, `tests/schema.test.cjs`
- [ ] Commit `feat(reviewer): history v3 — outcome and structured locations`.

### Task 6: `migrate-history.cjs` v2→v3; remove `log-findings.sh`; 1.21.0

- Modify: `scripts/migrate-history.cjs` (detect `v: 2` rows → v3: parse locations, `outcome: unknown`; summary gains `v2→v3: N`), `tests/migrate-history.test.cjs`, `tests/fixtures/history-v1.jsonl` (+2 v2 rows), delete `scripts/log-findings.sh` and update every prompt/README mention (`grep -rn log-findings.sh` empty outside tests), `plugins/reviewer/.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` → `1.21.0`
- [ ] Deliver (do not run): `node plugins/reviewer/scripts/migrate-history.cjs <onelegion>/openspec/reviews/history.jsonl --dry-run` (the OneLegion file will be v2 by then only if the user ran B's migration; the script handles v1, v2 and mixed files in one pass).
- [ ] Full suite + validate; commit `chore(reviewer): 1.21.0`.
