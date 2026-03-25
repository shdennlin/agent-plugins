---
allowed-tools:
  - Read
  - Task
  - AskUserQuestion
description: Review a spec/proposal/design before implementation to catch gaps, risks, and ambiguities
argument-hint: "[path...] [--fix] [--fix-all] [--no-explore] [--no-parallel] [--parallel angles] [-n N] [--help/-h]"
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
- `--no-explore` — Skip codebase exploration step (go straight to review)
- `--help` or `-h` — Show usage information and exit

## Instructions

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
1. **help**: if `--help` or `-h` is present, show the usage information below and stop. Do NOT delegate to the agent.
2. **paths**: collect all positional arguments (not flags or flag values)
3. **fix**: true if `--fix` is present, or if `--fix-all` is present
4. **fix_all**: true if `--fix-all` is present
5. **no_explore**: true if `--no-explore` is present
6. **no_parallel**: true if `--no-parallel` is present
7. **angles**: value after `--parallel` (comma-separated string), or "default" if not provided
8. **max_iterations**: integer value after `-n` or `--max-iterations`, default 3

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /reviewer:spec [path...] [options]

Review specs, proposals, or designs before implementation.

Positional arguments:
  path...                       One or more files or folders to review

Options:
  -h, --help                    Show this help message
  --no-explore                  Skip codebase exploration step

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

  # Skip codebase exploration
  /reviewer:spec docs/plan/ --no-explore
```

### Step 2: Resolve Paths

- If paths were provided: use them directly
- If no paths provided: use AskUserQuestion to ask "Which spec files or folder should I review?"

### Step 3: Explore Codebase

**If `no_explore` is NOT set** (default):

Dispatch the built-in code-explorer agent to scan the codebase for context relevant to the spec:

```
Task tool:
- subagent_type: "feature-dev:code-explorer"
- description: "Explore codebase for spec context"
- prompt: |
    Scan the codebase for context relevant to the following spec files.

    ## Spec files/folders to scan for
    <list each path>

    ## Working directory
    <current directory>

    Read the spec files first to extract key terms (file paths, module names,
    function/class names, API endpoints, config keys), then scan the codebase.

    Produce a concise context summary (200-500 lines max) with:
    - **Relevant Files**: files/dirs related to the spec with 1-line descriptions
    - **Architecture Patterns**: naming conventions, module organization, key patterns
    - **Existing Interfaces**: function signatures, types, API contracts the spec must align with
    - **Dependencies**: external libs or internal modules in the spec area

    Stay focused and efficient — breadth over depth. Do NOT analyze or judge the spec,
    only report codebase facts.
```

Capture the code-explorer output as `CODEBASE_CONTEXT`.

**If `no_explore` IS set:** skip this step and set `CODEBASE_CONTEXT` to empty.

### Step 4: Route and Delegate

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

    ## Codebase Context (from code-explorer)
    <CODEBASE_CONTEXT, or "No codebase context available." if empty>
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

    ## Codebase Context (from code-explorer)
    <CODEBASE_CONTEXT, or "No codebase context available." if empty>

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

# Skip codebase exploration (review spec in isolation)
/reviewer:spec docs/plan/ --no-explore
```
