---
allowed-tools:
  - Read
  - Task
  - AskUserQuestion
  - Skill
  - Bash
description: Review implementation against a spec using git diffs to catch mismatches, missing work, and bugs; optionally add a second engine (the built-in /code-review or any review skill) and merge its findings
argument-hint: "[path...] [--base/-b <branch>] [--angles <list>] [-c <level|skill-name>] [--fix [all]] [-n N] [--help/-h]"
---

# Result Review Command

Review implementation against a spec by analyzing git diffs and cross-referencing with spec requirements.

## Arguments

Parse the following from `$ARGUMENTS`:

- `[path...]` — One or more spec file or folder paths (positional args)
- `--base` or `-b` — Branch to compare against (e.g., `develop`, `main`). Uses `<base>...HEAD`, i.e. merge base to working tree (uncommitted edits included)
- `--angles <list>` — Narrow the review to these angles (comma-separated). Default: all three built-in angles (coverage, robustness, correctness), one reviewer each in parallel, merged into one report. One angle gives a single-reviewer run.
- `-c <engine>` or `--with-code-review <engine>` — After the spec review, also run a second, spec-blind engine on the same diff and merge its findings. `<engine>` is REQUIRED and is either:
  - a level `low | medium | high | xhigh | max` → the built-in `/code-review` at that level (`medium` recommended; `low` has a one-tool-call budget and cannot read a large diff), or
  - a skill name (e.g. `spectra-review`) → that review skill, invoked through the Skill tool.
  How each engine is invoked and how its labels map to severities comes from `templates/review-engines.yaml`; the merge step never looks at the engine's name. Not available with `--fix` in this version.
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
6. **angles**: value after `--angles` (comma-separated string), or "default" if not provided. Validate it: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-angles.cjs" --section result --angles <value>`; on exit 1 print its stderr line and stop; pass the `angles` array it prints to the orchestrator as `angles` (joined with commas)
7. **max_iterations**: integer value after `-n` or `--max-iterations`, default 3
8. **engine**: the token after `-c` or `--with-code-review`. Keep the raw token for Step 3b; do not classify it yourself (the level words and the engine entries live in `templates/review-engines.yaml`, read by `scripts/resolve-engine.cjs`). If the token is missing or looks like a flag, print the line below and stop — do NOT guess and do NOT delegate. `/code-review` silently reuses the last level the user typed when none is given, so an implicit level would make this command depend on the user's previous manual run.
   ```
   -c needs an engine: a /code-review level (low | medium | high | xhigh | max; medium recommended) or a review skill name (e.g. spectra-review)
   ```
   If both `-c` and `--fix` are present, print `-c is not supported together with --fix yet; run them separately` and stop.
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
  -c, --with-code-review <eng>  Also run a second, spec-blind engine on the same diff and
                                merge its findings (required value; not with --fix):
                                  low|medium|high|xhigh|max  built-in /code-review at that
                                                             level (medium recommended)
                                  <skill-name>               any review skill, e.g.
                                                             spectra-review in Spectra repos
                                Engines are defined in templates/review-engines.yaml.
                                Never passes --fix/--comment to the engine.
  -h, --help                    Show this help message

Diff strategy:
  With --base:                  git diff $(git merge-base <base> HEAD)  (shown as <base>...HEAD;
                                committed + staged + unstaged changes)
  Without --base:               Auto-detect base branch, or use git diff + git diff --cached
                                (-c always needs a branch base; see below)
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

  # Same, with Spectra's own code review as the engine (coverage left to /spectra-verify)
  /reviewer:result openspec/changes/my-change/ --angles robustness,correctness -c spectra-review

  # Iterative review + auto-fix (default: 3 rounds, all angles)
  /reviewer:result docs/plan/ --fix

  # With base branch, one angle, max 5 rounds
  /reviewer:result docs/plan/ --fix --base main --angles coverage -n 5

  # Fix every severity without asking
  /reviewer:result docs/plan/ --fix all --angles robustness,coverage
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
    - plugin_root: <absolute path of ${CLAUDE_PLUGIN_ROOT}>
    - log_script_path: <absolute path to ${CLAUDE_PLUGIN_ROOT}/scripts/log-findings.sh>

    ## Review Angle Templates (result section)
    <paste the result section content from review-angles.yaml>
```

Wait for the orchestrator's own final report (merged report, Handoff, log line). Its per-angle sub-agents may surface their individual reports first; do NOT merge those yourself or report before the orchestrator returns — its merge script (`merge-findings.cjs`) deduplicates the angle reports, and findings are logged once, after the orchestrator's loop ends (or, with `-c`, once by Step 3d).

When `-c` is set, pass `log_script_path` as `none`; the orchestrator then runs the merge with `--no-log` and Step 3d logs the two-engine merge once. Keep the orchestrator's full report; Step 3c merges into it.

**If `-c` is set, continue with Steps 3b–3d after the orchestrator returns.**

#### Step 3b: Run the second engine

The second engine is a spec-blind review whose recipe this plugin does not control. It is invoked ONLY to review; it never fixes or posts. Everything engine-specific is data:

1. Resolve the engine with the script (Bash), from the git root:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-engine.cjs" --token "<token from Step 1>" --spec <spec paths…> [--base <branch, only if --base was given>] --manifest "<run_dir>/manifest.json"
   ```
   `<run_dir>` is the `Run dir:` line of the orchestrator's report. On exit 1 print its stderr line and stop (an unknown level, a level on a level-less engine, or a level-required engine without one). It prints `{ engine, level, skill, args, never_pass, findings_from, severity_map, notes, scope, scope_note, base: { name, given }, change_name }` with every placeholder in `args` already resolved from `templates/review-engines.yaml` and the base the spec review diffed against (`base.name`; `null` when the spec review used the working tree).
2. If `base.name` is `null` (HEAD is on the base branch itself) and `scope` is `base`, the engine has no range to review: print `<engine> engine skipped: HEAD is on the base branch` and go to Step 3c with the spec findings alone. If `scope` is `self` (spectra-review resolves its own diff through `spectra scope`), say so in the scope note rather than forcing a base on it; `args` already carries `--base` only when the user passed one.
3. Invoke it through the Skill tool:
   ```
   Skill tool:
   - skill: "<skill from the resolver>"
   - args: "<args from the resolver>"
   ```
   Never append any flag listed in `never_pass`, and never add `--fix`, `--comment` or anything that edits files or posts externally, whatever the engine. `--fix` would edit the working tree outside this command's fix loop; `--comment` posts to GitHub.
4. Capture its findings where `findings_from` says they are. Each should have a file (or artifact) reference, a one-sentence summary, a failure scenario when the engine gives one, and the engine's own label (verdict, severity or confidence). Note what the engine says about its scope (tests excluded, single pass, truncated at N, approximated scope) — carry that into the report as the scope note.
5. **If the skill is unavailable, denied, or fails** (not installed in this session — e.g. `/code-review` under Codex, `spectra-review` outside a Spectra repo — or the Skill call errors): print one line `<engine> engine skipped: <reason>` and continue with Steps 3c–3d using the spec findings alone, all tagged `engine: claude`, so they are still reported and logged. The second verdict line then reads `<engine>: skipped (<reason>)`.
6. At the end of the report print each line from the entry's `notes` (side effects the user must know about, e.g. `/code-review` remembering `--max-findings all`).

#### Step 3c: Merge the two engines' findings

This is LLM judgment; do it here, not in a script. Nothing below depends on which engine ran — only on the entry's `severity_map` and the tag `engine`.

1. **Severity for engine findings.** Map the engine's own label through `severity_map` (case-insensitive); an unlabeled finding or an unlisted label becomes `low`. Raise to `high` or `critical` only when the failure scenario names data loss, a security bypass, or a startup crash on a documented configuration. Never lower.
2. **Engine tag.** Mark each finding `engine: claude` (spec review) or `engine: <engine key>` when the key is `code-review` or `spectra-review`, else `engine: other:<engine key>` (any other skill); and `engines: [<that engine>]`. Two findings are the SAME issue only when they point at the same file and the same root cause (line numbers may differ); merge those into one entry with `engine: claude` and `engines: [claude, <engine key>]` (agreement is the list, never a separate engine value), keep the worse severity, and keep both wordings in the rationale.
3. **Conflicts are findings.** If the spec review ticked a requirement as implemented and the engine flags that same behaviour as a bug (e.g. an allowlist exemption the spec mandates), do NOT drop either side. Emit one entry with `engine: claude`, `engines: [claude, <engine key>]`, `category: spec-conflict`, severity = the engine's, stating that the spec sanctions the behaviour and the code review calls it unsafe. That entry is the most valuable output of running two engines; it needs a human decision, not a fixer.
4. **Report.** Reproduce the agent's sections A–C unchanged. Replace section D with the merged list, worst severity first, each entry showing its `engines` list. Replace the Verdict with two lines:
   ```
   Spec review: PASS | FAIL (N critical, N high) | FAIL (review incomplete: <angles>)
   <engine>[ <level>]: N findings (N critical, N high, N medium, N low) — <scope note from Step 3b.4>
   ```
   Keep the spec verdict's PASS/FAIL rule unchanged (critical/high only) so existing readers are not surprised, but a reader must see both lines together. When the orchestrator's verdict is `FAIL (review incomplete: <angles>)` (`complete: false` in `merged.json`), carry it over verbatim; it is never PASS. Rebuild the Handoff directives from the merged list.

#### Step 3d: Log the merged findings (best-effort)

If Step 3b ended with `<engine> engine skipped` or the engine returned 0 findings, log from the merge script, not by hand: read the `Run dir: <run_dir> (angles: <keys>)` line under the orchestrator's report heading and run, from the git root,

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/merge-findings.cjs" <run_dir> --change "<change dir or primary spec path, relative to the git root>" --round 1 --expect "<angle keys from the Run dir line, comma-separated, no spaces>"
```

(no `--no-log`; the orchestrator's own run used `--no-log`). Repeat its `logged N finding(s)` or `findings not logged: …` line and skip the rest of this step — `merged.json` already holds every finding and location, and re-typing them loses function names and drops locations.

Otherwise (the engine produced at least one finding), convert the merged list to a JSON array — one object per entry with `severity` (upper-case), `title`, `location`, `category`, `engine`, `engines`, `locations` (the orchestrator's `locations` list; an engine finding without one gets `[location]`), `pattern` (the orchestrator's, else null) — and run, from the git root, with `--run-id` set to the run id from the `Run dir:` line (its last path segment):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/log-findings.cjs" --change "<change dir or primary spec path, relative to the git root>" --source result --round 1 --run-id "<run id>" <<'FINDINGS_JSON'
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
    - plugin_root: <absolute path of ${CLAUDE_PLUGIN_ROOT}>
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
/reviewer:result docs/plan/ --fix all -b main --angles robustness,coverage -n 5

# Spec review + /code-review (medium) as a second engine, one merged report and one log entry
/reviewer:result openspec/changes/my-change/ --base develop -c medium

# Spec review + Spectra's own code review as the engine (Spectra repos; coverage left to /spectra-verify)
/reviewer:result openspec/changes/my-change/ --angles robustness,correctness -c spectra-review
```
