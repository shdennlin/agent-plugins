---
allowed-tools:
  - Read
  - Task
  - AskUserQuestion
description: Review implementation against a spec using git diffs to catch mismatches, missing work, and bugs
argument-hint: "[path...] [--base/-b <branch>] [--help/-h]"
---

# Result Review Command

Review implementation against a spec by analyzing git diffs and cross-referencing with spec requirements.

## Arguments

Parse the following from `$ARGUMENTS`:

- `[path...]` — One or more spec file or folder paths (positional args)
- `--base` or `-b` — Branch to compare against (e.g., `develop`, `main`). Uses `<base>...HEAD`
- `--help` or `-h` — Show usage information and exit

## Instructions

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
1. **help**: if `--help` or `-h` is present, show the usage information below and stop. Do NOT delegate to the agent.
2. **paths**: collect all positional arguments (not flags or flag values)
3. **base**: value after `--base` or `-b` (if provided)

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /reviewer:result [path...] [options]

Review implementation against a spec using git diffs.

Positional arguments:
  path...               Spec files or folders to review against

Options:
  -b, --base <branch>   Compare <branch>...HEAD (default: auto-detect)
  -h, --help            Show this help message

Diff strategy:
  With --base:          git diff <base>...HEAD
  Without --base:       Auto-detect base branch, or use git diff + git diff --cached

Examples:
  /reviewer:result docs/plans/auth-flow/
  /reviewer:result spec.md tasks.md --base develop
  /reviewer:result docs/plan/ -b main
  /reviewer:result                                  # asks which spec to review
```

### Step 2: Resolve Paths

- If paths were provided: use them directly
- If no paths provided: use AskUserQuestion to ask "Which spec files or folder should I review the implementation against?"

### Step 3: Delegate to Agent

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

Report the agent's findings back to the user.

## Examples

```bash
# Review implementation against spec (auto-detect base branch)
/reviewer:result docs/plans/auth-flow/

# Compare against specific branch
/reviewer:result docs/plans/auth-flow/ --base develop

# Review specific spec files
/reviewer:result spec.md tasks.md -b main

# Interactive (asks which spec)
/reviewer:result
```
