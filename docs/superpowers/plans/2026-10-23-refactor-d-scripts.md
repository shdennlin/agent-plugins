# Reviewer Refactor — Batch D (Deterministic Prep into Scripts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three pieces of mechanical work the LLM still does in prompts (rules/history path resolution, init's YAML append, the `-c` engine lookup and base choice) move into scripts with tests; the prompts shrink to calls.

**Architecture:** `read-rules.cjs --paths` becomes the single path oracle; `apply-rules.cjs` does init's delta/append with line-based, comment-preserving edits; `resolve-engine.cjs` turns `-c <token>` plus the review context into the exact Skill invocation from `templates/review-engines.yaml`, with the base taken from the run manifest (written by `setup-result-review.sh`) instead of a second auto-detect in prose. Each script is a pure function plus a CLI; prompts call the CLI and paste its JSON.

**Tech Stack:** node (`node:test`), bash test for CLI exit codes.

**Spec:** `~/.claude/prompt-builder/reviewer-refactor.md` section "D. Deterministic prep into scripts" (settled). Evidence: `audit-layering.md` items 7–9.

## Global Constraints

- No YAML library; the existing line-rule parser in `read-rules.cjs` is reused. `apply-rules.cjs` edits by line so comments and unrelated keys in `openspec/config.yaml` survive byte-for-byte.
- No version bump (batch E). Suites green after each task.
- `commands/result.md` Step 3b keeps its stop condition "HEAD is on the base branch → engine reviews nothing, say so".

## Review Focus

1. `openspec/config.yaml` whose `rules:` section sits between other top-level keys: the append lands inside `rules:` and the following key is untouched. Pinned in Task 2.
2. `rules.yaml` (portable) that is empty or missing: created with all four areas. Pinned in Task 2.
3. A rule in the template that differs from an existing one only by trailing whitespace or quotes: treated as present (normalized exact match), not duplicated. Pinned in Task 2.
4. `-c spectra-review` with `--base` not given: `args` carries no `--base`; with `--base develop`: `--base develop` appended. Pinned in Task 3.
5. `-c high` when `templates/review-engines.yaml` lacks `levels:` for an entry: resolver reports the entry as level-less and rejects the level. Pinned in Task 3.

---

### Task 1: `read-rules.cjs --paths`

**Files:**
- Modify: `plugins/reviewer/scripts/read-rules.cjs` (export `resolvePaths(root) -> {git_root, rules_target, rules_exists, rules_kind: 'openspec'|'portable', history_path}`; CLI flag `--paths`)
- Modify: `plugins/reviewer/commands/init.md:76-80,94-98,113-114`, `plugins/reviewer/skills/init/init-reviewer.md:19-30`, `plugins/reviewer/agents/init-reviewer.md:32-41`, `plugins/reviewer/commands/spec-dual.md:105-108` (prose → "run `node read-rules.cjs --paths` and use its fields")
- Test: `plugins/reviewer/tests/read-rules.test.cjs`, `tests/commands.test.cjs`

- [ ] **Step 1: Failing tests** — temp repo with `openspec/` → `rules_kind: openspec`, `rules_target: <root>/openspec/config.yaml`, `history_path: <root>/openspec/reviews/history.jsonl`; without → portable paths; `rules_exists` false until the file exists; CLI `--paths` prints that JSON. commands.test: the four prompt files contain `read-rules.cjs" --paths` and no longer contain the phrase "if openspec/config.yaml exists" (grep the prose rule in each).
- [ ] **Step 2: Run** → fail. **Step 3: Implement + prompt edits.** **Step 4: Run** → pass. **Step 5: Commit** `refactor(reviewer): read-rules --paths is the one rules/history path oracle`.

---

### Task 2: `apply-rules.cjs` does init's YAML work

**Files:**
- Create: `plugins/reviewer/scripts/apply-rules.cjs`, `plugins/reviewer/tests/apply-rules.test.cjs`, `plugins/reviewer/tests/fixtures/config-with-rules.yaml`, `tests/fixtures/config-no-rules.yaml`
- Modify: `plugins/reviewer/skills/init/init-reviewer.md:40-104` and `plugins/reviewer/agents/init-reviewer.md:42-56` (Steps 3–6 → one call), `plugins/reviewer/commands/init.md` (Step 3 dispatch passes `template_path`; dry-run output comes from the script)
- Test: `tests/commands.test.cjs`

**Interfaces:**
- Produces: CLI `apply-rules.cjs --template <yaml> --target <file> --kind <openspec|portable> [--dry-run]`; stdout JSON `{added: {proposal: [..], specs: [..], design: [..], tasks: [..]}, skipped: N, written: bool, target}`; exit 1 with stderr when the template has no rules or the target is unreadable. Module export `applyRules({templateText, targetText, kind}) -> {text, added, skipped}` (pure). Rule match: trimmed, quotes stripped (reuse `unquote` from read-rules).

- [ ] **Step 1: Failing tests** (pure function): openspec target with `rules:` between `name:` and `tasks:` keys → new rules appended inside `rules:` under the right area, every other line byte-identical; openspec target without `rules:` → section appended at EOF; portable missing/empty → four areas written; duplicate detection on `- "T"  # c` vs `T`; dry-run writes nothing; CLI prints the JSON.
- [ ] **Step 2: Run** → fail. **Step 3: Implement** (line scanner: find `rules:` block by indentation, find each area list, insert after its last item; indentation copied from the existing list or 2/4 spaces when creating). **Step 4: Run** → pass. **Step 5: Prompts:** init-reviewer keeps Step 1–2 (template, target via `--paths`) and `--from-history` clustering; Steps 3–6 become "run apply-rules.cjs; print its `added` per area as the preview (dry-run) or confirmation". **Step 6: Commit** `refactor(reviewer): apply-rules.cjs owns the rules append; init agent keeps only judgment`.

---

### Task 3: `resolve-engine.cjs` for `-c`

**Files:**
- Create: `plugins/reviewer/scripts/resolve-engine.cjs`, `plugins/reviewer/tests/resolve-engine.test.cjs`
- Modify: `plugins/reviewer/templates/review-engines.yaml` (`code-review` gains `levels: [low, medium, high, xhigh, max]`; `spectra-review` gains `base_arg: " --base <base>"` and `scope: self`; `_default` gains `scope: base`), `plugins/reviewer/commands/result.md` Step 1 item 8 (level words come from the resolver) and Step 3b items 1–2 (→ one call), `plugins/reviewer/tests/review-engines.test.sh` (new fields)
- Test: `tests/commands.test.cjs`

**Interfaces:**
- Produces: CLI `resolve-engine.cjs --token <level|skill> --spec <path>... [--base <ref>] [--manifest <run_dir>/manifest.json]`; stdout JSON `{engine, level|null, skill, args, never_pass, findings_from, severity_map, notes, scope, base: {name, given: bool}, change_name}`; `base.name` = `--base` if given, else `manifest.diff_strategy`'s `<name>...HEAD` prefix, else null (WORKTREE); `args` has every placeholder resolved and `base_arg` appended only when `base.given`; exit 1 + stderr for an unknown level, a level on a level-less entry, or a missing manifest when no `--base`.

- [ ] **Step 1: Failing tests** — `--token medium` → engine code-review, args `medium develop --max-findings all` with manifest strategy `develop...HEAD`; `--token spectra-review --spec openspec/changes/x/` → args `x`, no `--base`; with `--base develop` → `x --base develop`; `--token high` on an entry without levels (temp yaml) → exit 1; unknown skill → `_default` with `skill: <token>`; `WORKTREE` manifest + code-review → `base.name null`, args keep `<base>` unresolved? No: resolver substitutes `HEAD` and sets `scope_note: "working tree vs HEAD"`.
- [ ] **Step 2: Run** → fail. **Step 3: Implement** (reads the yaml with the same line-rule parser pattern; nested maps `severity_map` parsed as `key: value` lines). **Step 4: Run** + `bash tests/review-engines.test.sh` → pass. **Step 5: Prompt edits:** result.md Step 1 item 8 → "`node resolve-engine.cjs --token <token> …`; exit 1 → print stderr and stop"; Step 3b items 1–2 → "use the resolver's `skill` and `args`"; the duplicated auto-detect sentence removed. commands.test: result.md no longer contains `git rev-parse --verify develop`. **Step 6: Commit** `refactor(reviewer): resolve-engine.cjs owns the -c lookup and base; levels live in the YAML`.

- [ ] **Step 7: Full suite** → all green.
