---
allowed-tools:
  - Read
  - Task
  - AskUserQuestion
  - Skill
  - Bash
description: Review implementation against a spec using git diffs to catch mismatches, missing work, and bugs; optionally add the built-in /code-review as a second, spec-blind engine
argument-hint: "[path...] [--base/-b <branch>] [--angles <list>] [--with-code-review/-c <level>] [--fix [all]] [-n N] [--help/-h]"
---

# Result Review Command

Review implementation against a spec by analyzing git diffs and cross-referencing with spec requirements.

## Arguments

Parse the following from `$ARGUMENTS`:

- `[path...]` — One or more spec file or folder paths (positional args)
- `--base` or `-b` — Branch to compare against (e.g., `develop`, `main`). Uses `<base>...HEAD`
- `--angles <list>` — Narrow the review to these angles (comma-separated). Default: all three built-in angles (coverage, robustness, correctness), one reviewer each in parallel, merged into one report. One angle gives a single-reviewer run.
- `--with-code-review <level>` or `-c <level>` — After the spec review, also run the built-in `/code-review` skill on the same `<base>...HEAD` diff as a second engine and merge its findings. `<level>` is REQUIRED and must be one of `low`, `medium`, `high`, `xhigh`, `max` (`medium` recommended; `low` has a one-tool-call budget and cannot read a large diff). Not available with `--fix` in this version.
- `--fix [all]` — Iterative review → fix loop. Plain `--fix` auto-fixes medium/low and asks before critical/high; `--fix all` auto-fixes every severity.
- `-n <N>` or `--max-iterations <N>` — Maximum iteration rounds, default 3 (requires `--fix`)

Every run is multi-angle (same as `/reviewer:spec`). Removed flags, each stops with a migration line: `--parallel` (1.12.0, now the default; use `--angles` to narrow), `--fix-all` (1.12.0, now `--fix all`), `--no-parallel` (1.11.0, use `--angles coverage`).
- `--help` or `-h` — Show usage information and exit

## Instructions

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
1. **help**: if `--help` or `-h` is present, show the usage information below and stop. Do NOT delegate to the agent.
2. **paths**: collect all positional arguments (not flags or flag values)
3. **base**: value after `--base` or `-b` (if provided)
4. **fix**: true if `--fix` is present
5. **fix_all**: true if the token right after `--fix` is exactly `all` (consume it); any other token after `--fix` is not consumed
6. **angles**: value after `--angles` (comma-separated string), or "default" if not provided
7. **max_iterations**: integer value after `-n` or `--max-iterations`, default 3
8. **code_review_level**: the token after `--with-code-review` or `-c`. If the flag is present, the token MUST be exactly one of `low`, `medium`, `high`, `xhigh`, `max`. If it is missing or anything else (including another flag), print the line below and stop — do NOT guess a level and do NOT delegate. `/code-review` silently reuses the last level the user typed when none is given, so an implicit level would make this command's behaviour depend on the user's previous manual run.
   ```
   --with-code-review needs a level: low | medium | high | xhigh | max  (medium recommended)
   ```
   If both `--with-code-review`/`-c` and `--fix` are present, print `--with-code-review is not supported together with --fix yet; run them separately` and stop.
9. **removed flags** — print the line and stop:
   - `--parallel` → `--parallel was removed in 1.12.0: every run is multi-angle now; use --angles <list> to narrow`
   - `--fix-all` → `--fix-all was removed in 1.12.0: use --fix all`
   - `--no-parallel` → `--no-parallel was removed in 1.11.0: use --angles coverage for a single reviewer`

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /reviewer:result [path...] [options]

Review implementation against a spec using git diffs.

Positional arguments:
  path...                       Spec files or folders to review against

Options:
  -b, --base <branch>           Compare <branch>...HEAD (default: auto-detect)
  --angles <list>               Narrow to these angles (comma-separated). Default: all of
                                coverage, robustness, correctness — one reviewer each, in
                                parallel, merged. One angle = one reviewer.
  -c, --with-code-review <lvl>  Also run the built-in /code-review on the same diff as a
                                second, spec-blind engine and merge its findings.
                                lvl: low | medium | high | xhigh | max (required; medium
                                recommended). Never passes --fix/--comment; not with --fix.
                                Sets --max-findings all, which /code-review remembers
                                until you pass --max-findings default.
  -h, --help                    Show this help message

Diff strategy:
  With --base:                  git diff <base>...HEAD
  Without --base:               Auto-detect base branch, or use git diff + git diff --cached
                                (--with-code-review always needs a branch base; see below)
  Large diffs are read in full, in batches — no file is skipped as "unrelated".

Fix mode options:
  --fix [all]                   Iterative review → fix loop; "all" also auto-fixes
                                critical/high instead of asking
  -n, --max-iterations <N>      Maximum rounds (default: 3)

Examples:
  /reviewer:result docs/plans/auth-flow/              # multi-angle review, no fixing
  /reviewer:result spec.md tasks.md --base develop
  /reviewer:result docs/plan/ -b main --angles robustness,correctness
  /reviewer:result docs/plan/ --angles coverage       # single reviewer, cheapest
  /reviewer:result                                    # asks which spec to review

  # Spec review + built-in /code-review as a second engine, merged into one report
  /reviewer:result openspec/changes/my-change/ --base develop -c medium

  # Iterative review + auto-fix (default: 3 rounds, all angles)
  /reviewer:result docs/plan/ --fix

  # With base branch, one angle, max 5 rounds
  /reviewer:result docs/plan/ --fix --base main --angles coverage -n 5

  # Fix every severity without asking
  /reviewer:result docs/plan/ --fix all --angles security,coverage
```

### Step 2: Resolve Paths

- If paths were provided: use them directly
- If no paths provided: use AskUserQuestion to ask "Which spec files or folder should I review the implementation against?"

### Step 3: Route and Delegate

Both routes go through `result-fix-orchestrator`, which spawns one `result-reviewer` sub-agent per angle and merges:

| `--fix` | Route |
|---|---|
| no | `fix: false` — one multi-angle round, merged report, Handoff, log; no fixing |
| yes | `fix: true` — review → fix loop |

First, read the review angles template:
```
Read tool: ${CLAUDE_PLUGIN_ROOT}/templates/review-angles.yaml
```

**If `--fix` is NOT set** (default — review only):

Launch the orchestrator in review-only mode:

```
Task tool:
- subagent_type: "reviewer:result-fix-orchestrator"
- description: "Multi-angle result review"
- prompt: |
    Review implementation against spec — review only, do not fix.

    ## Parameters
    - spec_paths: <list each path>
    - working_directory: <current directory>
    - base_branch: <base branch or "auto-detect">
    - fix: false
    - max_iterations: 1
    - angles: <value from --angles, or "default">
    - fix_all: false
    - log_script_path: <absolute path to ${CLAUDE_PLUGIN_ROOT}/scripts/log-findings.sh>

    ## Review Angle Templates (result section)
    <paste the result section content from review-angles.yaml>
```

Wait for the orchestrator's own final report (merged report, Handoff, log line). Its per-angle sub-agents may surface their individual reports first; do NOT merge those yourself or report before the orchestrator returns — the orchestrator is the one that deduplicates and logs.

When `--with-code-review` is set, OMIT the `log_script_path` line from the prompt (the orchestrator then prints "findings not logged") — Step 3d logs the merged set once, so the spec review must not log its half separately. Keep the orchestrator's full report; Step 3c merges into it.

**If `--with-code-review` is set, continue with Steps 3b–3d after the orchestrator returns.**

#### Step 3b: Run the second engine (`/code-review`)

The built-in `/code-review` skill is a spec-blind bug hunt with a recipe this plugin does not control. It is invoked ONLY to review; it never fixes or posts.

1. Resolve the review base. `/code-review` must be given the base branch as its target: with no target it diffs against the upstream or the repo's default branch (often `main`, not the PR base) and on a large diff silently narrows to the last few commits — verified 2026-10-13 on Claude Code 2.1.296. Passing the base branch name makes it run `git diff <base>...HEAD`, the same diff the spec review used.
   - If `--base` was given: `target = <base>`.
   - Otherwise auto-detect exactly as the agent does: `git rev-parse --verify develop` → `develop`, else `main`. If HEAD is on that branch itself (no commits beyond it), stop with `--with-code-review needs a branch with commits beyond <base>; pass --base`.
2. Invoke the skill through the Skill tool, passing the level EXPLICITLY every time:
   ```
   Skill tool:
   - skill: "code-review"
   - args: "<level> <target> --max-findings all"
   ```
   Never add `--fix` or `--comment`. `--fix` would edit the working tree outside this command's fix loop; `--comment` posts to GitHub.
3. Capture its findings: the list it reports through `ReportFindings` (or its final findings list/JSON when that tool is absent). Each has `file`, `line`, `summary`, `failure_scenario`, and usually `verdict` (`CONFIRMED` or `PLAUSIBLE`). Note what the skill says about scope (e.g. "tests excluded", "single pass") — carry it into the report.
4. **If the skill is unavailable, denied, or fails** (no `code-review` skill in this session — e.g. Codex — or the Skill call errors): print one line `code-review engine skipped: <reason>` and continue with Steps 3c–3d using the spec findings alone, all tagged `engine: claude-result`, so they are still reported and logged. The second verdict line then reads `/code-review: skipped (<reason>)`.
5. Side effect to know about: `--max-findings all` is sticky in `/code-review` — it stays in force for the user's own later `/code-review` runs until they pass `--max-findings default`. Mention this in one line at the end of the report.

#### Step 3c: Merge the two engines' findings

This is LLM judgment; do it here, not in a script.

1. **Severity for code-review findings** (it reports none): `CONFIRMED` → `medium`, `PLAUSIBLE` → `low`. Raise to `high` or `critical` only when the `failure_scenario` names data loss, a security bypass, or a startup crash on a documented configuration. Never lower.
2. **Engine tag.** Mark each finding `engine: claude-result` (spec review) or `engine: code-review`. Two findings are the SAME issue only when they point at the same file and the same root cause (line numbers may differ); merge those into one entry tagged `engine: both`, keep the worse severity, and keep both descriptions. Expect the intersection to be near zero — the two engines ask different questions, and a finding only one engine saw is still signal.
3. **Conflicts are findings.** If the spec review ticked a requirement as implemented and `/code-review` flags that same behaviour as a bug (e.g. an allowlist exemption the spec mandates), do NOT drop either side. Emit one entry tagged `engine: both`, `category: spec-conflict`, severity = code-review's, stating that the spec sanctions the behaviour and the code review calls it unsafe. That entry is the most valuable output of running two engines; it needs a human decision, not a fixer.
4. **Report.** Reproduce the agent's sections A–C unchanged. Replace section D with the merged list, worst severity first, each entry showing its engine tag. Replace the Verdict with two lines:
   ```
   Spec review: PASS | FAIL (N critical, N high)
   /code-review <level>: N findings (N critical, N high, N medium, N low) — <scope note from Step 3b.3>
   ```
   Keep the spec verdict's PASS/FAIL rule unchanged (critical/high only) so existing readers are not surprised, but a reader must see both lines together. Rebuild the Handoff directives from the merged list.

#### Step 3d: Log the merged findings (best-effort)

Convert the merged list to a JSON array — one object per entry with `severity` (upper-case), `title`, `location`, `category`, `engine` — and run, from the git root:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/log-findings.sh" --change "<change dir or primary spec path, relative to the git root>" --source result --round 1 <<'FINDINGS_JSON'
<the JSON array>
FINDINGS_JSON
```

If it fails, add one line "findings not logged: <reason>" and continue; logging must not change the report.

**If `--fix` IS set:**

Launch the `result-fix-orchestrator` agent in fix mode:

```
Task tool:
- subagent_type: "reviewer:result-fix-orchestrator"
- description: "Iterative result review with auto-fix"
- prompt: |
    Review implementation against spec and fix issues iteratively.

    ## Parameters
    - spec_paths: <list each path>
    - working_directory: <current directory>
    - base_branch: <base branch or "auto-detect">
    - fix: true
    - max_iterations: <N, default 3>
    - angles: <value from --angles, or "default">
    - fix_all: <true if "--fix all", false otherwise>
    - log_script_path: <absolute path to ${CLAUDE_PLUGIN_ROOT}/scripts/log-findings.sh>

    ## Review Angle Templates (result section)
    <paste the result section content from review-angles.yaml>
```

Report the agent's findings back to the user.

## Examples

```bash
# Review implementation against spec (multi-angle, no fixing)
/reviewer:result docs/plans/auth-flow/

# Compare against specific branch
/reviewer:result docs/plans/auth-flow/ --base develop

# Review specific spec files, one angle only
/reviewer:result spec.md tasks.md -b main --angles coverage

# Interactive (asks which spec)
/reviewer:result

# Iterative review + auto-fix
/reviewer:result docs/plan/ --fix

# With base branch, custom angles, fix every severity, max 5 rounds
/reviewer:result docs/plan/ --fix all -b main --angles security,coverage -n 5

# Spec review + /code-review (medium) as a second engine, one merged report and one log entry
/reviewer:result openspec/changes/my-change/ --base develop -c medium
```
