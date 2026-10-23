# Reviewer Refactor — Batch B (history v2, minimal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every row in `history.jsonl` is written by one validated script with one engine vocabulary, an integer round, a normalized change id, and the fields the findings→rules loop needs (`pattern`, `run_id`, `engines`, `v: 2`); old rows migrate with a dry-run-able script that is never run on the user's project by this work.

**Architecture:** `scripts/log-findings.cjs` replaces `log-findings.sh` (same CLI, same stdin) and validates every row against a `HISTORY_ROW` schema added to `mcp/schema.cjs` (shared `checkShape`). Writers (`merge-findings.cjs`, `commands/result.md` Step 3c/3d, `agents/spec-orchestrator.md`, `commands/spec-dual.md` Step 6 + the workflow's result) are changed to emit the v2 fields. `scripts/migrate-history.cjs` rewrites v1 rows in place behind `--dry-run`. Readers (`commands/init.md`) are told the new fields exist; clustering logic stays LLM for now (batch F may automate it on `fid`).

**Tech Stack:** node (`node:test`), the plugin's existing hand-rolled schema checker, bash test for the CLI.

**Spec:** `~/.claude/prompt-builder/reviewer-refactor.md` section "B. history v2 (minimal)" (settled; `outcome` and structured `locations` are F). Evidence and measured distributions: `audit-data.md`.

## Global Constraints

- `log-findings.sh` keeps working for one release as a thin wrapper (`exec node "$(dirname "$0")/log-findings.cjs" "$@"`) so the installed 1.19.0 prompts that name it do not break mid-upgrade; it is removed in batch F.
- NEVER run `migrate-history.cjs` against `/Users/shdennlin/workspace/onelegion`; tests use temp copies only.
- Engine vocabulary (closed): `claude`, `codex`, `code-review`, `spectra-review`, or `other:<skill>`; empty string rejected.
- No version bump (batch E). Suites green after each task (see batch A plan).

## Review Focus

1. A v1 writer still on disk (installed plugin mid-upgrade) posting `engine: ""`: the wrapper forwards to the .cjs, which rejects the row and prints the reason; the review continues ("findings not logged"). Pinned in Task 2.
2. `--round` given as `"2"` by an LLM: accepted and stored as integer 2; `"two"` rejected. Pinned in Task 2.
3. `--change "openspec/changes/x/"` and `"./openspec/changes/x"`: both stored as `openspec/changes/x`. Pinned in Task 2.
4. Migration of a row with `engine: "both"` on a result row: `engine: claude`, `engines: ["claude", "<second>"]` only when `--second-engine <name>` is given; otherwise `engines: ["claude"]` and a stderr note counting such rows. Pinned in Task 5.
5. spec-dual rows for rounds 1..N when the workflow reports `history[]` but a round's union was empty: no rows, no error. Pinned in Task 4 (harness scenario).

---

### Task 1: HISTORY_ROW schema in `mcp/schema.cjs`

**Files:**
- Modify: `plugins/reviewer/mcp/schema.cjs` (export `HISTORY_ROW`, `ENGINES`, `validateHistoryRow(row) -> string[]`, `normalizeChange(s) -> string`)
- Test: `plugins/reviewer/tests/schema.test.cjs`

**Interfaces:**
- Produces: `HISTORY_ROW` = `{v:2, ts, change, source∈{spec,spec-dual,result}, round:int≥1, run_id:string|null, engine∈ENGINES-or-/^other:[a-z0-9:_-]+$/, engines:string[]≥1, severity∈SEVERITIES, category:minLength1, title:minLength1, location:minLength1, locations:string[], pattern:string|null}`, `additionalProperties:false`. `normalizeChange`: trim, strip leading `./`, collapse `//`, strip trailing `/`.

- [ ] **Step 1: Failing tests** — `validateHistoryRow(goodRow())` is `[]`; `engine: ''` → `/engine: must be one of/`; `engine: 'claude-result'` rejected; `engine: 'other:my-skill'` accepted; `round: '1'` → `/round: must be integer/`; `engines: []` rejected; `normalizeChange('./openspec/changes/x/')` → `openspec/changes/x`.
- [ ] **Step 2: Run** → fail (not exported). **Step 3: Implement**; `checkShape` gains `integer` type support (`Number.isInteger`) and `minItems`. **Step 4: Run** → pass. **Step 5: Commit** `feat(reviewer): history row schema v2`.

---

### Task 2: `scripts/log-findings.cjs` with validation; `.sh` becomes a wrapper

**Files:**
- Create: `plugins/reviewer/scripts/log-findings.cjs`
- Modify: `plugins/reviewer/scripts/log-findings.sh` (wrapper), `plugins/reviewer/tests/log-findings.test.sh` (expectations below), `plugins/reviewer/scripts/merge-findings.cjs:310,364` (logScript default → `.cjs`; `engine: 'claude'`, `engines: ['claude']`, `pattern`, `run_id: manifest.run_id`, `v: 2`)
- Test: `plugins/reviewer/tests/log-findings.test.cjs` (new), `tests/merge-findings.test.cjs:236` (engine assertion → `claude`)

**Interfaces:**
- Produces: CLI `log-findings.cjs --change <id> --source <spec|result|spec-dual> --round <N> [--run-id <id>]`, stdin JSON array of partial rows; each row is completed (`v:2`, `ts`, normalized `change`, `source`, integer `round`, `run_id` from `--run-id` or row or null, `engines` defaults to `[engine]`, `locations` defaults to `[location]`, `pattern` defaults to null) then validated; invalid rows are listed on stderr as `log-findings: row N rejected: <violation>` and nothing is appended if any row is invalid (all-or-nothing); exit 1. Target file rule unchanged. stdout `logged N finding(s) to <relative path>`.

- [ ] **Step 1: Failing tests** — node test: three good rows appended with `v:2`, `round` number 1, `change` normalized from `./x/`; `--round two` → exit 1 `/round/`; row with `engine: ''` → exit 1, file unchanged (`all-or-nothing`); `--run-id r9` lands on every row; `.sh` wrapper forwards (spawn the .sh with the same input → same output). Keep `tests/log-findings.test.sh`'s existing cases, updating the engine value it feeds to `claude` and the round assertion to a number.
- [ ] **Step 2: Run** → fail. **Step 3: Implement** (no jq dependency; append with `fs.appendFileSync`). **Step 4: Run** both test files → pass; `merge-findings.test.cjs` engine assertion updated to `claude`. **Step 5: Commit** `feat(reviewer): log-findings.cjs validates and completes v2 rows; .sh is a wrapper`.

---

### Task 3: Result writers emit v2

**Files:**
- Modify: `plugins/reviewer/commands/result.md:198` (engine tag `claude` not `claude-result`; agreement → `engines: [claude, <engine key>]` instead of `both`), `:217-222` (hand-built rows carry `engines`, `run_id` from the Run dir line, `pattern` when present), `plugins/reviewer/agents/result-fix-orchestrator.md` (no change expected; verify it does not name engine), `plugins/reviewer/README.md` (engine vocabulary sentence), `plugins/reviewer/templates/review-engines.yaml` (comment only if it mentions `both`)
- Test: `plugins/reviewer/tests/commands.test.cjs`

- [ ] **Step 1: Failing test** — no file under commands/, agents/, skills/, README.md contains `claude-result` or `engine: both`; `commands/result.md` Step 3c mentions `engines`.
- [ ] **Step 2: Run** → fail. **Step 3: Edit.** **Step 4: Run** → pass. **Step 5: Commit** `refactor(reviewer): result route tags engine claude and agreement as engines[]`.

---

### Task 4: spec and spec-dual writers emit v2; spec-dual logs every round

**Files:**
- Modify: `plugins/reviewer/agents/spec-orchestrator.md:236-256` (rows carry `engine: claude`, `locations: [location]`, `pattern: null`), `plugins/reviewer/commands/spec-dual.md:160-185` (log each entry of the workflow's `history[]` rounds: one call per round with `--round <n>` and that round's union findings; engine per row = `seenBy` mapped: `claude`→`claude`, `codex`→`codex`, `both`→`engine: claude, engines: ['claude','codex']`), `plugins/reviewer/workflows/two-engine-spec-review.workflow.js:554,616,645` (history rows gain `findings: cat.all` (title/location/severity/category/seenBy); final `findings` rows gain `engines` next to `engine`)
- Test: `plugins/reviewer/tests/two-engine.harness.mjs` (scenario `fanout` asserts `history[0].findings.length > 0`; a new scenario `emptyround` asserts a round with empty union has `findings: []`), `tests/commands.test.cjs` (spec-dual.md names `history[` and `--round <n>`)

- [ ] **Step 1: Failing tests.** **Step 2: Run** → fail. **Step 3: Implement.** **Step 4:** harness 25 ok + commands test pass. **Step 5: Commit** `feat(reviewer): spec-dual logs every round's union with engine/engines; spec rows carry v2 fields`.

---

### Task 5: `scripts/migrate-history.cjs --dry-run`

**Files:**
- Create: `plugins/reviewer/scripts/migrate-history.cjs`, `plugins/reviewer/tests/migrate-history.test.cjs`, `plugins/reviewer/tests/fixtures/history-v1.jsonl` (12 synthetic rows covering: engine '' spec, '' result, claude-result, both, claude, codex, spectra-review; round string; change with trailing slash and `./`; locations absent/present; a row already v2)
- Modify: `plugins/reviewer/README.md` (one paragraph: how to migrate, the exact command, dry-run first)

**Interfaces:**
- Produces: CLI `migrate-history.cjs <file> [--dry-run] [--second-engine <name>]`; prints a summary `rows: N, migrated: N, already-v2: N, engine '' → claude: N, claude-result → claude: N, both → engines: N (second engine: <name|unknown>), round→int: N, change normalized: N`; without `--dry-run` writes `<file>.v1.bak` then rewrites `<file>`; every output row passes `validateHistoryRow`; rows that still fail (unknown severity, empty title) are kept verbatim and counted as `unmigratable: N` with their line numbers on stderr; exit 1 if any.

- [ ] **Step 1: Failing tests** — dry-run leaves the file byte-identical and prints the summary; real run writes the backup and all rows validate; `both` without `--second-engine` → `engines: ['claude']` + stderr count; with `--second-engine spectra-review` → `['claude','spectra-review']`; a `.v1.bak` already present → exit 1 refuse (never overwrite a backup).
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. **Step 5: Commit** `feat(reviewer): migrate-history.cjs rewrites v1 rows to v2 behind --dry-run`.

- [ ] **Step 6: Deliver, do not run.** Print for the user: `node plugins/reviewer/scripts/migrate-history.cjs /Users/shdennlin/workspace/onelegion/openspec/reviews/history.jsonl --dry-run --second-engine spectra-review` and the real command, with the note that the 10 `both` rows date from 16–19 Oct when the second engine was spectra-review.

- [ ] **Step 7: Full suite** → all green.
