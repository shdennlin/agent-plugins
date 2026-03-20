---
allowed-tools:
  - Read
  - Task
  - AskUserQuestion
description: Review a spec/proposal/design before implementation to catch gaps, risks, and ambiguities
argument-hint: "[path...] [--fix] [--fix-all] [--no-parallel] [--parallel angles] [-n N] [--help/-h]"
---

# Spec Review Command

Review feature specifications, proposals, designs, or task lists before implementation starts.

## Arguments

Parse the following from `$ARGUMENTS`:

- `[path...]` — One or more file or folder paths to review (positional args)
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
3. **fix**: true if `--fix` is present, or if `--fix-all` is present
4. **fix_all**: true if `--fix-all` is present
5. **no_parallel**: true if `--no-parallel` is present
6. **angles**: value after `--parallel` (comma-separated string), or "default" if not provided
7. **max_iterations**: integer value after `-n` or `--max-iterations`, default 3

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /reviewer:spec [path...] [options]

Review specs, proposals, or designs before implementation.

Positional arguments:
  path...                       One or more files or folders to review

Options:
  -h, --help                    Show this help message

Fix mode options:
  --fix                         Enable iterative review → fix loop
  --fix-all                     Auto-fix all severities (implies --fix)
  --no-parallel                 Use single-agent review instead of multi-angle parallel
  --parallel <angles>           Custom review angles (comma-separated)
                                Default angles: scope, completeness, tasks
  -n, --max-iterations <N>      Maximum rounds (default: 3)

Examples:
  /reviewer:spec docs/plans/auth-flow/
  /reviewer:spec proposal.md spec.md tasks.md
  /reviewer:spec                                    # asks which files to review

  # Iterative review + auto-fix (default: 3 rounds, parallel multi-angle)
  /reviewer:spec docs/plan/ --fix

  # Single-agent review + fix, max 5 rounds
  /reviewer:spec docs/plan/ --fix --no-parallel -n 5

  # Fix all severities (implies --fix)
  /reviewer:spec docs/plan/ --fix-all

  # Custom angles, fix all severities
  /reviewer:spec docs/plan/ --fix-all --parallel "scope,tasks"
```

### Step 2: Resolve Paths

- If paths were provided: use them directly
- If no paths provided: use AskUserQuestion to ask "Which spec files or folder should I review?"

### Step 3: Route and Delegate

**If `--fix` is NOT set** (default — backward compatible):

Launch the `spec-reviewer` agent:

```
Task tool:
- subagent_type: "reviewer:spec-reviewer"
- description: "Review spec for gaps and risks"
- prompt: |
    Review the following spec files for implementation readiness.

    Files/folders to review:
    <list each path>

    Working directory: <current directory>
```

**If `--fix` IS set:**

First, read the review angles template:
```
Read tool: ${CLAUDE_PLUGIN_ROOT}/templates/review-angles.yaml
```

Then launch the `spec-fix-orchestrator` agent:

```
Task tool:
- subagent_type: "reviewer:spec-fix-orchestrator"
- description: "Iterative spec review with auto-fix"
- prompt: |
    Review and fix the following spec files iteratively.

    ## Parameters
    - paths: <list each path>
    - max_iterations: <N, default 3>
    - parallel: <true if --no-parallel is NOT set, false otherwise>
    - angles: <value from --parallel flag, or "default">
    - fix_all: <true if --fix-all is set, false otherwise>
    - working_directory: <current directory>

    ## Review Angle Templates (spec section)
    <paste the spec section content from review-angles.yaml>
```

Report the agent's findings back to the user.

## Examples

```bash
# Review a spec folder (single pass, same as before)
/reviewer:spec docs/plans/auth-flow/

# Review specific files
/reviewer:spec proposal.md spec.md tasks.md

# Interactive (asks which files)
/reviewer:spec

# Iterative review + auto-fix
/reviewer:spec docs/plan/ --fix

# Custom: 5 rounds, no parallel, fix everything
/reviewer:spec docs/plan/ --fix-all --no-parallel -n 5
```
