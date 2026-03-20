---
allowed-tools:
  - Read
  - Task
  - AskUserQuestion
description: Review implementation against a spec using git diffs to catch mismatches, missing work, and bugs
argument-hint: "[path...] [--base/-b <branch>] [--fix] [--fix-all] [--no-parallel] [--parallel angles] [-n N] [--help/-h]"
---

# Result Review Command

Review implementation against a spec by analyzing git diffs and cross-referencing with spec requirements.

## Arguments

Parse the following from `$ARGUMENTS`:

- `[path...]` — One or more spec file or folder paths (positional args)
- `--base` or `-b` — Branch to compare against (e.g., `develop`, `main`). Uses `<base>...HEAD`
- `--fix` — Enable iterative review → fix loop with parallel multi-angle review
- `--fix-all` — Auto-fix all severities including critical/high (implies `--fix`)
- `--no-parallel` — Disable parallel multi-angle review (requires `--fix`)
- `--parallel <angles>` — Custom review angles, comma-separated (requires `--fix`)
- `-n <N>` or `--max-iterations <N>` — Maximum iteration rounds, default 3 (requires `--fix`)
- `--help` or `-h` — Show usage information and exit

## Instructions

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
1. **help**: if `--help` or `-h` is present, show the usage information below and stop. Do NOT delegate to the agent.
2. **paths**: collect all positional arguments (not flags or flag values)
3. **base**: value after `--base` or `-b` (if provided)
4. **fix**: true if `--fix` is present, or if `--fix-all` is present
5. **fix_all**: true if `--fix-all` is present
6. **no_parallel**: true if `--no-parallel` is present
7. **angles**: value after `--parallel` (comma-separated string), or "default" if not provided
8. **max_iterations**: integer value after `-n` or `--max-iterations`, default 3

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /reviewer:result [path...] [options]

Review implementation against a spec using git diffs.

Positional arguments:
  path...                       Spec files or folders to review against

Options:
  -b, --base <branch>           Compare <branch>...HEAD (default: auto-detect)
  -h, --help                    Show this help message

Diff strategy:
  With --base:                  git diff <base>...HEAD
  Without --base:               Auto-detect base branch, or use git diff + git diff --cached

Fix mode options:
  --fix                         Enable iterative review → fix loop
  --fix-all                     Auto-fix all severities (implies --fix)
  --no-parallel                 Use single-agent review instead of multi-angle parallel
  --parallel <angles>           Custom review angles (comma-separated)
                                Default angles: coverage, robustness, correctness
  -n, --max-iterations <N>      Maximum rounds (default: 3)

Examples:
  /reviewer:result docs/plans/auth-flow/
  /reviewer:result spec.md tasks.md --base develop
  /reviewer:result docs/plan/ -b main
  /reviewer:result                                    # asks which spec to review

  # Iterative review + auto-fix (default: 3 rounds, parallel multi-angle)
  /reviewer:result docs/plan/ --fix

  # With base branch, single-agent, max 5 rounds
  /reviewer:result docs/plan/ --fix --base main --no-parallel -n 5

  # Fix all severities (implies --fix)
  /reviewer:result docs/plan/ --fix-all

  # Custom angles, fix all severities
  /reviewer:result docs/plan/ --fix-all --parallel "security,coverage"
```

### Step 2: Resolve Paths

- If paths were provided: use them directly
- If no paths provided: use AskUserQuestion to ask "Which spec files or folder should I review the implementation against?"

### Step 3: Route and Delegate

**If `--fix` is NOT set** (default — backward compatible):

Launch the `result-reviewer` agent:

```
Task tool:
- subagent_type: "reviewer:result-reviewer"
- description: "Review implementation against spec"
- prompt: |
    Review the implementation against the following spec files.

    Spec files/folders:
    <list each path>

    Diff strategy:
    - Base branch: <base branch or "auto-detect">

    Working directory: <current directory>
```

**If `--fix` IS set:**

First, read the review angles template:
```
Read tool: ${CLAUDE_PLUGIN_ROOT}/templates/review-angles.yaml
```

Then launch the `result-fix-orchestrator` agent:

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
    - max_iterations: <N, default 3>
    - parallel: <true if --no-parallel is NOT set, false otherwise>
    - angles: <value from --parallel flag, or "default">
    - fix_all: <true if --fix-all is set, false otherwise>

    ## Review Angle Templates (result section)
    <paste the result section content from review-angles.yaml>
```

Report the agent's findings back to the user.

## Examples

```bash
# Review implementation against spec (single pass, same as before)
/reviewer:result docs/plans/auth-flow/

# Compare against specific branch
/reviewer:result docs/plans/auth-flow/ --base develop

# Review specific spec files
/reviewer:result spec.md tasks.md -b main

# Interactive (asks which spec)
/reviewer:result

# Iterative review + auto-fix
/reviewer:result docs/plan/ --fix

# With base branch, custom angles, fix all
/reviewer:result docs/plan/ --fix-all -b main --parallel "security,coverage" -n 5
```
