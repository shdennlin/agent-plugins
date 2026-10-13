---
name: reviewer:result
description: "Review implementation against a spec using git diffs to catch mismatches, missing work, and bugs. Supports iterative review+fix with --fix flag and parallel multi-angle review. Use after implementing a feature to verify spec coverage."
---

# Result Review

Review implementation against a spec by analyzing git diffs and cross-referencing with spec requirements.

## Usage

Provide spec file paths and optionally a base branch:

```
$result docs/plans/auth-flow/
$result spec.md tasks.md --base develop
$result docs/plan/ -b main
```

Every run is multi-angle (coverage, robustness, correctness — one reviewer each, merged), the same default as `/reviewer:spec`. Narrow with `--angles`:

```
$result docs/plan/ --angles robustness,correctness
$result docs/plan/ --angles coverage          # single reviewer, cheapest
```

Large diffs are read in full, in batches of 10–15 files — no file is skipped as "unrelated to the spec". Removed flags: `--parallel` (1.12.0, now the default), `--fix-all` (1.12.0, now `--fix all`), `--no-parallel` (1.11.0, use `--angles coverage`).

With iterative auto-fix (`--fix all` also auto-fixes critical/high instead of asking):

```
$result docs/plan/ --fix
$result docs/plan/ --fix all --base main -n 5
$result docs/plan/ --fix --angles security,coverage
```

With the built-in `/code-review` as a second engine (Claude Code only; the flag is ignored under Codex, which has no such skill):

```
$result openspec/changes/my-change/ --base develop -c medium
```

`--with-code-review <level>` (short: `-c <level>`) requires an explicit level (`low|medium|high|xhigh|max`; `medium` recommended) and cannot be combined with `--fix`. The spec review runs first, then `/code-review <level> <base> --max-findings all` is invoked on the same `<base>...HEAD` diff (the base branch MUST be passed as the target — without it `/code-review` diffs against the default branch). The two findings lists are merged (code-review `CONFIRMED` → medium, `PLAUSIBLE` → low; same file + same root cause → one entry tagged `engine: both`; a spec-sanctioned behaviour that code-review flags becomes a `spec-conflict` entry for a human), reported with both verdict lines, and logged once with `engine` per finding. Never pass `--fix` or `--comment` to `/code-review`.

If no paths are given, ask which spec files to review against.

## Process

1. Read the spec files provided
2. Dispatch result-fix-orchestrator with `fix: false` (default, review only) or `fix: true` (`--fix`); it spawns one result-reviewer per angle and merges
3. With `--with-code-review`: invoke the `code-review` skill on the same diff if it is available, merge, log once; if it is unavailable or fails, say so in one line and report/log the spec findings alone
4. Report findings back

## Agent Dispatch

Without `--fix`: dispatch `reviewer:result-fix-orchestrator` with `fix: false`, `max_iterations: 1`, angles, the review-angles template content and log_script_path (resolve `${CLAUDE_PLUGIN_ROOT}/scripts/log-findings.sh` to an absolute path; omit it when `--with-code-review` is set, the command logs the merged set); it runs one multi-angle round, merges, hands off, logs, and never fixes.
With `--fix`: the same orchestrator with `fix: true`, max_iterations and fix_all.
The companion `result-reviewer.md` in this directory is the single-reviewer methodology each angle sub-agent follows; on a harness without sub-agent orchestration (Codex), use it directly as the review prompt.

The agent will cd to the git root automatically. Provide it with:
- The list of spec files/folders to review against
- The base branch for diff comparison (or "auto-detect")
