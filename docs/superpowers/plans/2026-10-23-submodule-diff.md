# Submodule-aware Result Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Running `/reviewer:result` from a git superproject reviews the code inside changed submodules, not the submodule pointers; and when `-c <engine>` adds nothing, the history log comes from the merge script's `merged.json`, not from an LLM re-typing it.

**Architecture:** `scripts/setup-result-review.sh` gains one step after it computes the superproject's changed paths: every path that is a gitlink (mode `160000`) is expanded into that submodule's own diff, with file paths prefixed `<sub>/` and patch headers written by git's `--src-prefix=a/<sub>/ --dst-prefix=b/<sub>/`, so `manifest.json` and `diff.patch` look exactly like what the orchestrator improvised by hand on 2026-10-23 (run `20261023T114141Z-d470`, which becomes a fixture). Nothing downstream changes: the MCP tool validates against the prefixed manifest, the merge script parses `+++ b/<sub>/…` headers as before. `commands/result.md` Step 3d is rewired so a skipped or empty second engine logs by re-running the merge script with logging on.

**Tech Stack:** bash + jq (setup script), `node --test` + bash tests, markdown prompts.

**Spec:** No written spec; agreed in conversation on 2026-10-23 after measuring the OneLegion run (ledger-quality facts: superproject diff = 5 gitlinks / 10 lines; the model-built manifest had 194 files, 148,535 lines; `history.jsonl` rows carried line-number locations re-typed by the LLM). The "Design summary" below is the authority.

## Design summary

- **Detection**: after `FILES` is computed, each path `p` whose index entry at the superproject's `HEAD` is mode `160000` (`git ls-files -s -- p`) is a submodule. Nested submodules inside a submodule are not expanded (one level; a note line goes to stderr).
- **Sub-repo diff range**: base strategy → `SUB_BASE = git -C <sub> merge-base <BASE_REF> HEAD` when `<BASE_REF>` exists in the sub-repo; otherwise the pointer the superproject's `DIFF_BASE` commit records for that path (`git rev-parse <DIFF_BASE>:<p>`). `WORKTREE` strategy → the pointer the superproject's `HEAD` records. When the merge base is the sub's own HEAD (a pointer bumped to the tip of its base branch) the recorded pointer is used instead, otherwise the review would be empty. A path that was not a submodule at the base (added, or a directory converted) diffs from the empty tree (`4b825dc642cb6eb9a060e54bf8d69288fbee4904`). A gitlink removed at HEAD is skipped with a stderr note. A submodule whose pointer did not move but whose worktree is dirty is expanded from the recorded pointer (uncommitted edits are review input, like the superproject's own). A base commit missing from the sub's clone (shallow) exits 2 naming the sub. The diff is always two-dot to the sub-repo's working tree (committed + staged + unstaged inside the sub), matching the superproject's own rule.
- **Output shape**: sub-repo files replace the gitlink entry in `files`, each as `<p>/<path>` after `normalize_path`; the patch for the sub-repo is `git -C <sub> diff --no-ext-diff --no-color --src-prefix=a/<p>/ --dst-prefix=b/<p>/ <SUB_BASE>` appended to `PATCH`; `--shortstat` from the sub-repo adds to `LINE_COUNT`; `FILE_COUNT` counts the expanded list. `manifest.json` gains `submodules: [{ path, base, strategy }]` where `strategy` is `merge-base(<BASE_REF>,HEAD)` / `recorded-pointer` / `empty-tree`. `diff_strategy` stays the superproject's string. The run dir stays under the superproject (`openspec/reviews/runs/` or `.claude/reviewer/runs/`).
- **No-op guarantee**: a repo without submodules produces byte-identical output to today (the expansion loop finds nothing).
- **Sub-agent context reads**: `git show HEAD:<path>` no longer works for `<sub>/…` paths from the superproject; the orchestrator and methodology prompts say: for a path that starts with a submodule listed in `manifest.submodules`, run git inside that directory with the remainder of the path.
- **`-c` logging rule** (`commands/result.md` Step 3d): if the second engine was skipped, unavailable, errored, or returned 0 findings, do not build the JSON by hand: re-run `node "${CLAUDE_PLUGIN_ROOT}/scripts/merge-findings.cjs" <run_dir> --change <id> --round 1 --expect <angles>` without `--no-log` (the orchestrator's run used `--no-log`), and repeat its `logged N finding(s)` line. Only when the engine produced ≥ 1 finding is the merged list built and logged by hand as today. For that the orchestrator's merged report must print the `run_dir` and the `--expect` angle list it used; Step 3 of `agents/result-fix-orchestrator.md` adds one line `Run dir: <run_dir> (angles: <keys>)` under the report heading, and the methodology mirrors it.
- Version `1.19.0` in both manifests.

## Global Constraints

- bash + jq only in `setup-result-review.sh`; `merge-findings.cjs` and `mcp/*` unchanged in behaviour (a fixture test may be added, no code change).
- All tests run without Claude or network: `bash plugins/reviewer/tests/setup-result-review.test.sh`, `node --test plugins/reviewer/tests/merge-findings.test.cjs`.
- The user-config hardening stays: every git diff goes through `gd()` or an equivalent that passes `-c core.quotePath=false -c diff.noprefix=false -c diff.mnemonicPrefix=false --no-ext-diff --no-color`.
- Commit convention `<type>(reviewer): <description>`; versions `1.19.0` in `plugins/reviewer/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` in the same commit.
- The real-run manifest copied as a fixture contains OneLegion file paths; the repo is public (`github.com/shdennlin/agent-plugins`). The plan commits it as-is because the user asked for it; the handoff message flags the choice.

## Review Focus

1. A submodule whose pointer did not change in the superproject but whose working tree is dirty: expanded from the recorded pointer, so the edits are reviewed (re-ruled at final review; the original plan said "not listed"). Test pinned in Task 1 and section 8b.
2. The sub-repo does not have the base branch (`--base develop` but the sub only has `main`): falls back to the recorded pointer, `strategy: recorded-pointer`. Test pinned in Task 1.
3. A submodule added in this change (no pointer at the base): every file appears as added, `strategy: empty-tree`. Test pinned in Task 1.
4. A path inside a submodule that collides with a superproject path prefix (`central/` directory and `central` submodule cannot coexist; but `central-docs/` next to `central`): prefixing uses `<p>/` with the slash, so `central-docs/x` is never mistaken for a sub-repo file. Test pinned in Task 1.
5. The merge script's sweep across sub-repos: an issue in `central/a.py` with pattern `int(` must sweep into `core-api/b.go` when that file's added lines contain it, using the prefixed `+++ b/core-api/b.go` header. Test pinned in Task 2.

---

### Task 1: Submodule expansion in `setup-result-review.sh`

**Files:**
- Modify: `plugins/reviewer/scripts/setup-result-review.sh:94-135` (after `FILES`/`PATCH`/`STAT` are computed, before `FILE_COUNT`; manifest gains `submodules`)
- Test: `plugins/reviewer/tests/setup-result-review.test.sh` (new section 6: superproject with two submodules)

**Interfaces:**
- Produces: manifest key `submodules: [{ path, base, strategy }]` (empty array when none); `files` entries `<sub>/<path>`; `diff.patch` headers `diff --git a/<sub>/<path> b/<sub>/<path>` and `+++ b/<sub>/<path>`; stderr notes prefixed `setup-result-review: submodule <p>: …` for skipped/dirty/nested cases.

- [ ] **Step 1: Write the failing test section**

Build in the temp dir: two bare-ish local repos `libA` (branches `main`, `develop`, feature branch with 2 changed files, one with an added line containing `int(x)`) and `libB` (only `main`); a superproject `super` with `openspec/` dir, `git submodule add` both, commit on `develop`; then on `super` branch `feat`: bump `libA`'s pointer to its feature commit (commit in super), add a third submodule `libC` (new), and leave `libB`'s pointer unchanged but make `libB`'s worktree dirty; also add a plain superproject file `libA-docs/readme.md` (a prefix collision with the `libA` submodule name). Assertions (plus: `libA-docs/readme.md` appears in `files` as-is, and `.submodules[].path` does not contain `libA-docs`):
```bash
out="$("$SCRIPT" --working-dir "$TMP/super" --base develop)"; run="$(jq -r .run_dir <<<"$out")"
[[ "$(jq -r '.files|join(",")' <<<"$out")" == *"libA/src/a.py"* && "$(jq -r '.files|join(",")' <<<"$out")" != *",libA,"* ]] || fail "libA expanded, gitlink entry gone"
[[ "$(jq -r '.files|join(",")' <<<"$out")" == *"libC/"* ]] || fail "added submodule expanded from the empty tree"
[[ "$(jq -r '.files|join(",")' <<<"$out")" != *"libB/"* ]] || fail "unchanged-pointer submodule not expanded"
grep -q '^+++ b/libA/src/a.py$' "$run/diff.patch" || fail "prefixed patch header"
[[ "$(jq -r '.submodules|length' "$run/manifest.json")" == "2" ]] || fail "two submodules recorded"
[[ "$(jq -r '.submodules[]|select(.path=="libA")|.strategy' "$run/manifest.json")" == "merge-base(develop,HEAD)" ]] || fail "libA strategy"
[[ "$(jq -r '.submodules[]|select(.path=="libC")|.strategy' "$run/manifest.json")" == "empty-tree" ]] || fail "libC strategy"
"$SCRIPT" --working-dir "$TMP/super" --base develop 2>&1 >/dev/null | grep -q "submodule libB: pointer unchanged, dirty worktree ignored" || fail "dirty libB noted on stderr"
# fallback: a sub without the base branch
# (libB2: like libA but only `main`; bump its pointer in super) → strategy recorded-pointer
# no-op: a plain repo manifest has submodules: []
[[ "$(jq -r '.submodules|length' "$PLAIN_RUN/manifest.json")" == "0" ]] || fail "plain repo: submodules []"
# line_count includes sub-repo insertions
(( $(jq -r .line_count <<<"$out") > 0 )) || fail "line_count counts sub-repo lines"
```
Keep the existing sections 1–5 untouched.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash plugins/reviewer/tests/setup-result-review.test.sh`
Expected: `ASSERT FAIL: libA expanded, gitlink entry gone` (today the files list holds the bare `libA` gitlink)

- [ ] **Step 3: Implement the expansion**

After `[[ -n "$PATCH" ]] || die2 …`: loop over `FILES`; for each `p` where `g ls-files -s -- "$p" | awk '{print $1}'` is `160000` and `[[ -d "$TOP/$p/.git" || -f "$TOP/$p/.git" ]]`: pick `SUB_BASE`/`SUB_STRATEGY` per the Design summary (`gs() { git -C "$TOP/$p" -c core.quotePath=false -c diff.noprefix=false -c diff.mnemonicPrefix=false "$@"; }`), collect `gs diff --no-ext-diff --no-color --name-only "$SUB_BASE" | norm_lines | sed "s|^|$p/|"`, append `gs diff --no-ext-diff --no-color --src-prefix="a/$p/" --dst-prefix="b/$p/" "$SUB_BASE"` to `PATCH`, add the sub's `--shortstat` to `INS`/`DEL`, remove `p` from `FILES`, record `{path,base,strategy}`. A gitlink whose pointer is unchanged does not appear in `FILES` (git omits it); after the loop, for every path from `g submodule status` (non-recursive) that is NOT in the original `FILES` and whose worktree is dirty (`gs status --porcelain` non-empty), print the stderr note `submodule <p>: pointer unchanged, dirty worktree ignored`. Nested submodules: `gs submodule status` non-empty → stderr note `submodule <p>: nested submodules not expanded`. Write `submodules` into the manifest via `jq --argjson subs`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash plugins/reviewer/tests/setup-result-review.test.sh`
Expected: `ok: setup-result-review … submodules` (extend the final ok line)

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/scripts/setup-result-review.sh plugins/reviewer/tests/setup-result-review.test.sh
git commit -m "feat(reviewer): setup-result-review expands changed submodules into prefixed files and patches"
```

---

### Task 2: Fixture from the real run and the cross-sub-repo sweep test

**Files:**
- Create: `plugins/reviewer/tests/fixtures/submodule-manifest.json` (the 2026-10-23 `20261023T114141Z-d470` manifest, verbatim)
- Test: `plugins/reviewer/tests/merge-findings.test.cjs` (two tests)

**Interfaces:**
- Consumes: manifest shape from Task 1 (`files` prefixed, `submodules[]`), `merge(manifest, reports, diffPatch)`.

- [ ] **Step 1: Copy the fixture and write the failing tests**

Copy `/Users/shdennlin/workspace/onelegion/openspec/reviews/runs/20261023T114141Z-d470/manifest.json` to the fixture path (no edits).
```js
test('real superproject manifest: every file is prefixed by one of four sub-repos; merge accepts it with no reports', () => {
  const man = require('./fixtures/submodule-manifest.json')
  const subs = new Set(man.files.map(f => f.split('/')[0]))
  assert.deepEqual([...subs].sort(), ['api-contract', 'central', 'core-api', 'frontend'])
  assert.equal(man.files.length, 194)
  const m = merge(man, [], '', { expect: ['coverage'] })
  assert.equal(m.complete, false); assert.equal(m.files.length, 194)
  assert.ok(m.files.every(f => f.verdict === 'not_reviewed'))
})
test('sweep crosses sub-repos through prefixed +++ headers', () => {
  const man = { run_id: 'x', files: ['central/a.py', 'core-api/b.go'], working_directory: '/tmp/x' }
  const patch = ['diff --git a/central/a.py b/central/a.py', '--- a/central/a.py', '+++ b/central/a.py', '@@ -0,0 +1 @@', '+x = int(raw)',
                 'diff --git a/core-api/b.go b/core-api/b.go', '--- a/core-api/b.go', '+++ b/core-api/b.go', '@@ -0,0 +1 @@', '+y := int(raw)'].join('\n')
  const rep = { angle: 'correctness', via: 'report_review', verdict: 'FAIL', files: [{ path: 'central/a.py', verdict: 'issues', issue_count: 1 }, { path: 'core-api/b.go', verdict: 'clean', issue_count: 0 }],
    issues: [{ severity: 'HIGH', title: 'unchecked cast', location: 'central/a.py:f', category: 'c', pattern: 'int(', expected: 'e', actual: 'a', impact: 'i', recommendation: 'r' }] }
  const m = merge(man, [rep], patch)
  assert.deepEqual(m.issues[0].locations, ['central/a.py:f', 'core-api/b.go'])
})
```

- [ ] **Step 2: Run the tests to verify the first fails**

Run: `node --test plugins/reviewer/tests/merge-findings.test.cjs`
Expected: the fixture test fails with `Cannot find module './fixtures/submodule-manifest.json'`; the sweep test passes already (it pins Review Focus 5 against regressions; note that in the commit message)

- [ ] **Step 3: Add the fixture file**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/reviewer/tests/merge-findings.test.cjs`
Expected: PASS, previous count + 2

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/tests/fixtures/submodule-manifest.json plugins/reviewer/tests/merge-findings.test.cjs
git commit -m "test(reviewer): pin the superproject manifest shape and cross-sub-repo sweep"
```

---

### Task 3: Prompts (context reads, run_dir line, `-c` logging), docs, version

**Files:**
- Modify: `plugins/reviewer/agents/result-fix-orchestrator.md` (sub-agent "Analyze the Diff" paragraph; Step 3 report heading; nothing else)
- Modify: `plugins/reviewer/skills/result/result-reviewer.md` (same two spots)
- Modify: `plugins/reviewer/commands/result.md:207-215` (Step 3d)
- Modify: `plugins/reviewer/README.md` (structured-pipeline paragraph: one sentence on submodules; `-c` paragraph: one sentence on logging)
- Modify: `plugins/reviewer/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (`1.19.0`)

**Interfaces:**
- Consumes: `manifest.submodules[]` (Task 1); merge CLI `--expect`, `--no-log` (existing).

- [ ] **Step 1: Context reads inside submodules**

In both prompts, after the sentence about opening context with `git show HEAD:<path>`, add: "If `manifest.json` lists `submodules`, a path that starts with one of their `path` values belongs to that sub-repository: run the git command inside `<working_directory>/<path>` with the rest of the file path (`git -C <working_directory>/central show HEAD:src/x.py`)."

- [ ] **Step 2: `Run dir:` line**

Orchestrator Step 3 compiled report: right under `## Merged Review Report — Round {N}` add `Run dir: {run_dir} (angles: {angle keys})`. Methodology section A gets the same line.

- [ ] **Step 3: Rewrite Step 3d of `commands/result.md`**

"#### Step 3d: Log the merged findings (best-effort). If Step 3b ended with `<engine> engine skipped` or the engine returned 0 findings, log from the merge script, not by hand: read `Run dir:` from the orchestrator's report and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/merge-findings.cjs" <run_dir> --change "<change dir or primary spec path, relative to the git root>" --round 1 --expect <angles from the Run dir line>` (no `--no-log`); repeat its `logged N finding(s)` or `findings not logged` line. Otherwise (the engine produced findings) convert the merged list to a JSON array as before and run `log-findings.sh`." Keep the rest of the current wording.

- [ ] **Step 4: README and version**

Pipeline paragraph: "In a git superproject the setup script expands every changed submodule into its own diff (paths prefixed `<sub>/`), so a review run from the superproject sees the code, not the pointers." `-c` paragraph: "when the second engine is skipped or empty, the log comes from `merged.json`." Bump both manifests to `1.19.0`.

- [ ] **Step 5: Verify**

Run:
```bash
node --test plugins/reviewer/tests/*.test.cjs plugins/reviewer/tests/recall/*.test.cjs && node plugins/reviewer/tests/two-engine.harness.mjs && bash plugins/reviewer/tests/setup-result-review.test.sh && bash plugins/reviewer/tests/log-findings.test.sh && bash plugins/reviewer/tests/review-engines.test.sh && claude plugin validate ./plugins/reviewer \
&& grep -c "Run dir:" plugins/reviewer/agents/result-fix-orchestrator.md plugins/reviewer/skills/result/result-reviewer.md && grep -c "git -C" plugins/reviewer/agents/result-fix-orchestrator.md plugins/reviewer/skills/result/result-reviewer.md && grep -n '"version"' plugins/reviewer/.claude-plugin/plugin.json
```
Expected: all green; each grep ≥ 1 per file; version `1.19.0`.

- [ ] **Step 6: Live check on OneLegion (setup only, no LLM)**

Run: `bash plugins/reviewer/scripts/setup-result-review.sh --working-dir /Users/shdennlin/workspace/onelegion --base develop | jq '{file_count, line_count, size_class, subs: .files | map(split("/")[0]) | unique}'`
Expected: `file_count` 194 (± files changed since 2026-10-23), `subs` = `["api-contract","central","core-api","frontend"]`, no bare gitlink names; then `rm -rf` the run dir it created. Paste the output into the commit body.

- [ ] **Step 7: Commit**

```bash
git add plugins/reviewer/agents/result-fix-orchestrator.md plugins/reviewer/skills/result/result-reviewer.md plugins/reviewer/commands/result.md plugins/reviewer/README.md plugins/reviewer/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "feat(reviewer): submodule-aware context reads, run_dir line, and script-based logging when the second engine is empty (1.19.0)"
```
