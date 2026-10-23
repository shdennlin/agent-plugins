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

Each angle reports through the `report_review` MCP tool; every file in the diff must carry a verdict or the report is rejected; merge and logging are deterministic (`scripts/merge-findings.cjs`). Removed flags: `--parallel` (1.12.0, now the default), `--fix-all` (1.12.0, now `--fix all`), `--no-parallel` (1.11.0, use `--angles coverage`).

With iterative auto-fix (`--fix all` also auto-fixes critical/high instead of asking):

```
$result docs/plan/ --fix
$result docs/plan/ --fix all --base main -n 5
$result docs/plan/ --fix --angles security,coverage
```

With a second, spec-blind engine merged into the same report:

```
$result openspec/changes/my-change/ --base develop -c medium            # built-in /code-review
$result openspec/changes/my-change/ --angles robustness,correctness -c spectra-review   # any review skill
```

`-c <engine>` (long: `--with-code-review`) requires a value and cannot be combined with `--fix`. A `/code-review` level (`low|medium|high|xhigh|max`; `medium` recommended) selects the built-in `/code-review`; any other token is a review skill name invoked through the Skill tool. Each engine's invocation, findings location and label → severity mapping live in `templates/review-engines.yaml` (`code-review`: CONFIRMED → medium, PLAUSIBLE → low; `spectra-review`: Critical → high, Warning → medium, Suggestion → low; unknown skills use the `_default` table). The merge step never reads the engine's name: same file + same root cause → one entry tagged `engine: both`; a spec-sanctioned behaviour the engine flags becomes a `spec-conflict` entry for a human; the report shows both verdict lines and the merged list is logged once with `engine` per finding. The engine is never given `--fix`, `--comment` or any flag that edits or posts. If the skill is absent (`/code-review` under Codex, `spectra-review` outside a Spectra repo) the report says so in one line and the spec findings stand alone.

Requires `node` and `jq` on PATH (the run setup and merge scripts).

If no paths are given, ask which spec files to review against.

## Process

1. Read the spec files provided
2. Dispatch result-fix-orchestrator with `fix: false` (default, review only) or `fix: true` (`--fix`); it spawns one result-reviewer per angle and merges
3. With `-c`: invoke the selected engine skill on the same diff if it is available, map its labels through `templates/review-engines.yaml`, merge, log once; if it is unavailable or fails, say so in one line and report/log the spec findings alone
4. Report findings back

## Agent Dispatch

Without `--fix`: dispatch `reviewer:result-fix-orchestrator` with `fix: false`, `max_iterations: 1`, angles, the review-angles template content, plugin_root (the absolute path of `${CLAUDE_PLUGIN_ROOT}`, which holds `scripts/setup-result-review.sh` and `scripts/merge-findings.cjs`) and log_script_path (resolve `${CLAUDE_PLUGIN_ROOT}/scripts/log-findings.sh` to an absolute path; pass it as `none` when `-c` is set, the orchestrator then merges with `--no-log` and the command logs the two-engine merge once); it runs one multi-angle round, merges, hands off, logs, and never fixes.
With `--fix`: the same orchestrator with `fix: true`, max_iterations and fix_all.
The companion `result-reviewer.md` in this directory is the single-reviewer methodology each angle sub-agent follows; on a harness without sub-agent orchestration (Codex), use it directly as the review prompt — it resolves the plugin's scripts from its own physical path and writes `<run_dir>/single.json` itself (see `.codex/INSTALL.md`).

The agent will cd to the git root automatically. Provide it with:
- The list of spec files/folders to review against
- The base branch for diff comparison (or "auto-detect")
