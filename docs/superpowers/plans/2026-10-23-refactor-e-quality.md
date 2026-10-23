# Reviewer Refactor — Batch E (Review Quality) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The merge joins the same construct across files and angles (construct-head sweep, normalized fold key), the recall harness can tell (more seeds, severity rate), run dirs stop growing without bound, skipped submodules are visible in `merged.json`; then the branch becomes 1.20.0 with a measured before/after.

**Architecture:** `merge-findings.cjs` gains `constructHead(pattern)` and `normKey(pattern)` (pure, exported, unit-tested) used by the sweep and the fold; `setup-result-review.sh` prunes `runs/` to the newest 10 and records `skipped_submodules`; `merge` sets `complete:false` when that list is non-empty. The harness gets three seeds and an `expectedSeverity` metric. Measurement: 3 sonnet runs before Task 1 (baseline on this branch) and after Task 2.

**Tech Stack:** node (`node:test`), bash, the recall harness (LLM: 6 sonnet runs total).

**Spec:** `~/.claude/prompt-builder/reviewer-refactor.md` section "E. Review quality" (settled). Evidence: `audit-robustness.md` items 1–3, 9, 11, 12; `audit-data.md` item 8.

## Global Constraints

- Version bump to `1.20.0` in both manifests in Task 6's commit, nothing earlier.
- Fold never joins across files on containment alone (same-file only); the head sweep is capped at 5 files.
- Baseline and after-measurement use the same model (sonnet), 3 runs each, the same seeds file state (baseline runs BEFORE Task 4 adds seeds; the after-run reports both the 4-seed and 7-seed figures).

## Review Focus

1. Pattern `get(` or `len(`: head sweep skipped (over the 5-file cap or on the keyword/identifier blocklist); no location spray. Pinned in Task 1.
2. Patterns differing only in whitespace or quote style (`items[start:start+size-1]` vs `items[start:start + size - 1]`): fold into one. Pinned in Task 2.
3. Same-file containment (`int(s)` vs `int(`) folds; cross-file containment does not. Pinned in Task 2.
4. `runs/` with 12 dirs plus a stray file: prune removes the 2 oldest dirs by name, never the file or the `.gitignore`. Pinned in Task 5.
5. Nested submodule or not-checked-out submodule: `manifest.skipped_submodules` non-empty and `merged.complete === false` with a `not_reviewed` entry naming the path. Pinned in Task 5.

---

### Task 0: Baseline on this branch

- [ ] Run: `node plugins/reviewer/tests/recall/run.mjs --runs 3 --model sonnet --plugin-dir ./plugins/reviewer --out /tmp/recall-e-before`
- [ ] Paste `summary.json`'s per-seed table and merged-issues-per-run into the ledger as `E baseline`.

---

### Task 1: Construct-head sweep

**Files:**
- Modify: `plugins/reviewer/scripts/merge-findings.cjs` (export `constructHead`, sweep second pass)
- Test: `plugins/reviewer/tests/merge-findings.test.cjs`

**Interfaces:**
- Produces: `constructHead(pattern) -> string|null`: strips a leading `return `/`await `/assignment target (`x = `, `x := `), then if the remainder contains `identifier(` returns `identifier(`; else if it matches an operator form keep as is; returns null for a bare identifier or a keyword (`self`, `None`, `if`, `for`, `return`, `true`, `false`, `null`, `nil`, `this`) or anything shorter than 3 chars. Sweep: after the exact-key pass, for the head (when it differs from the key) collect files whose added lines contain the head, word-bounded on the left; if that set has more than 5 files, add none; else add them. Locations added by the head pass are marked in `issue.swept_by_head: [files]` (report-only).

- [ ] **Step 1: Failing tests** — `constructHead('return int(s)') === 'int('`; `('x = int(raw)') === 'int('`; `('int(') === 'int('`; `('self') === null`; `('size - 1') === 'size - 1'`; sweep: pattern `return int(s)` in a.py + `+y = int(raw)` in b.py → locations include b.py; pattern `get(` over a 6-file patch each containing `get(` → no added locations; `print(` vs `sprint(` left-boundary → not matched.
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. **Step 5: Commit** `feat(reviewer): sweep by construct head, capped at 5 files`.

---

### Task 2: Normalized fold key + same-file containment

**Files:**
- Modify: `plugins/reviewer/scripts/merge-findings.cjs` (`normKey(pattern)`; `foldByPattern` groups by `normKey`; after grouping, same-file issues whose normKeys contain one another fold too)
- Test: `plugins/reviewer/tests/merge-findings.test.cjs`

**Interfaces:**
- Produces: `normKey(p)`: trim, collapse whitespace to none around operators and brackets (`a + b`→`a+b`, `[ x ]`→`[x]`), unify quotes to `"`, drop leading `return `/`await `/assignment target, then `constructHead`-style argument stripping only when the pattern is a single call (`int(raw)`→`int(`); min length 3 else null. Containment rule: two issues with the same `pathPart(location)` whose normKeys are non-null and one is a substring of the other fold (survivor by the existing byWorst rule).

- [ ] **Step 1: Failing tests** — `normKey('items[start:start + size - 1]') === normKey('items[start:start+size-1]')`; `normKey("int('x')") === normKey('int("x")')`; same-file `int(s)` + `int(` → one issue, `folded: 1`; different files `int(` and `int(raw)` with different titles → two issues (no cross-file containment) but the sweep still joins locations; recall harness `score.test.cjs` unchanged.
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. **Step 5: Commit** `feat(reviewer): fold on a normalized pattern key; same-file containment folds`.

- [ ] **Step 6: After-measurement (4 seeds)** — `node plugins/reviewer/tests/recall/run.mjs --runs 3 --model sonnet --plugin-dir ./plugins/reviewer --out /tmp/recall-e-after4`; ledger the table next to the baseline. Expected: crossfile-cast `hit` in ≥2 of 3 runs, recall ≥ 0.9 mean; merged issues per run ≤ baseline. If crossfile stays partial, read the angle JSON in the run dir and ledger whether `pattern` lacked `int(` (prompt problem) or the cap cut it (then raise the cap to 8 as a Ruling and rerun once).

---

### Task 3: Harness — severity rate

**Files:**
- Modify: `plugins/reviewer/tests/recall/seeds.json` (every seed gets `expectedSeverity`: type-none HIGH, boundary-slice MEDIUM, dataflow-stale HIGH, crossfile-cast HIGH), `tests/recall/score.cjs` (`severityRate: {exact, within1, n}` over hit seeds), `tests/recall/run.mjs` (summary prints the rate), `tests/recall/score.test.cjs`

- [ ] **Step 1: Failing test** — a hit seed at the wrong severity counts toward recall, not toward `exact`; one level off counts toward `within1`. **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. **Step 5: Commit** `feat(reviewer): recall harness reports a severity-match rate`.

---

### Task 4: Harness — three more seeds

**Files:**
- Modify: `tests/recall/fixture.cjs` (new files: `src/pricing.py` + `src/cart.py` sharing a renamed-constant bug `TAX_RATE` used as percent in one and fraction in the other; `src/export.py` + `src/api.py` both calling `.split(",")` on a field that may contain quoted commas; `src/legacy_big.py` a 600-line filler module (generated repetitive helper functions) whose last function has an off-by-one `range(1, n)`), `tests/recall/seeds.json` (+3: `crossfile-rate` kind crossfile, `crossfile-split` kind crossfile, `buried-range` kind boundary with `file: src/legacy_big.py`), `tests/recall/fixture.test.cjs`

- [ ] **Step 1: Failing test** — `--dry-run` fixture validation lists 7 seeds; the fixture contains each seed's `pattern` in its `file`. **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. **Step 5: Commit** `test(reviewer): recall seeds for two more cross-file constructs and one buried in a large file`.

- [ ] **Step 6: After-measurement (7 seeds)** — 3 sonnet runs to `/tmp/recall-e-after7`; ledger the per-seed table. `buried-range` is the first attention-dilution number the project has; report it plainly whatever it is.

---

### Task 5: Run-dir retention; skipped submodules are visible

**Files:**
- Modify: `plugins/reviewer/scripts/setup-result-review.sh` (after `mkdir -p "$ROOT"`: keep the 10 newest `*T*Z-*` directories by name, delete older ones; `SKIPPED_JSON` collected at every `skipped`/`not expanded` note → `manifest.skipped_submodules: [{path, reason}]`), `plugins/reviewer/scripts/merge-findings.cjs` (a `not_reviewed` file entry `<path>/ (submodule <reason>)` per skipped submodule; `complete` false), `plugins/reviewer/README.md` (one sentence each)
- Test: `tests/setup-result-review.test.sh` (section 10), `tests/merge-findings.test.cjs`

- [ ] **Step 1: Failing tests** — 12 pre-made run dirs + a stray file + `.gitignore` → after setup, 11 dirs remain (10 kept + the new one), file and `.gitignore` intact; a nested submodule fixture → `skipped_submodules[0].reason` = `nested submodules not expanded`… wait: nested is a note, not a skip; the sub itself IS expanded. Ruling in the plan: `skipped_submodules` lists only not-checked-out and removed; nested goes to `notes[]`. Test both lists. merge: manifest with `skipped_submodules: [{path:'libX', reason:'not checked out'}]` → `files` has `libX/ (submodule not checked out)` with verdict `not_reviewed`, `complete === false`.
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. **Step 5: Commit** `feat(reviewer): runs/ keeps the newest 10; skipped submodules make the review incomplete`.

---

### Task 6: Version 1.20.0

- [ ] Bump `plugins/reviewer/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` to `1.20.0`; README changelog line listing A–E. Full suite + `claude plugin validate`. Commit `chore(reviewer): 1.20.0`.
