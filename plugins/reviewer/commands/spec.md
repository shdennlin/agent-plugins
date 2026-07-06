---
allowed-tools:
  - Read
  - Task
  - AskUserQuestion
description: Review a spec/proposal/design before implementation to catch gaps, risks, and ambiguities
argument-hint: "[path...] [--fix] [--no-explore] [--angles list] [-n N] [--help/-h]"
---

# Spec Review Command

Review feature specifications, proposals, designs, or task lists before implementation starts.

Multi-angle parallel review is the default — every invocation fans out across all
built-in angles (scope, completeness, tasks, platform, and composition when the
orchestrator judges multiple independent spec units are in scope). Use `--angles`
to narrow that set; use `--fix` to also run an iterative review → fix loop.

## Arguments

Parse the following from `$ARGUMENTS`:

- `[path...]` — One or more file or folder paths to review (positional args)
- `--fix` — After each review round, run an iterative fix loop. The orchestrator auto-fixes issues that don't need design judgment and escalates the rest to you (brainstorming-style) instead of using rigid severity rules
- `--angles <list>` — Comma-separated list of angles to run (default: all built-in angles). Standalone flag; works with or without `--fix`
- `-n <N>` or `--max-iterations <N>` — Maximum review-fix rounds, default 3 (only meaningful with `--fix`)
- `--no-explore` — Skip codebase exploration step (go straight to review)
- `--help` or `-h` — Show usage information and exit

## Instructions

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
1. **help**: if `--help` or `-h` is present, show the usage information below and stop. Do NOT delegate to the agent.
2. **paths**: collect all positional arguments (not flags or flag values)
3. **fix_enabled**: true if `--fix` is present
4. **no_explore**: true if `--no-explore` is present
5. **angles**: value after `--angles` (comma-separated string), or "default" if not provided
6. **max_iterations**: integer value after `-n` or `--max-iterations`, default 3

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /reviewer:spec [path...] [options]

Review specs, proposals, or designs before implementation.

Every invocation runs multi-angle parallel review by default.

Positional arguments:
  path...                       One or more files or folders to review

Options:
  -h, --help                    Show this help message
  --no-explore                  Skip codebase exploration step
  --angles <list>               Comma-separated angles to run (default: all)
                                Available: scope, completeness, tasks, platform,
                                          design, consistency, composition
                                (composition auto-runs when the orchestrator judges
                                multiple independent spec units are in scope)

Fix mode options:
  --fix                         After each review, run an iterative fix loop.
                                The orchestrator auto-fixes issues that don't need
                                design judgment and escalates the rest to you.
  -n, --max-iterations <N>      Maximum review-fix rounds (default: 3)

Examples:
  /reviewer:spec docs/plans/auth-flow/              # all angles, review only
  /reviewer:spec proposal.md spec.md tasks.md
  /reviewer:spec                                    # asks which files to review

  # Iterative review + fix (default: 3 rounds)
  /reviewer:spec docs/plan/ --fix

  # Narrow to specific angles (review only)
  /reviewer:spec docs/plan/ --angles "scope,tasks"

  # Narrow angles + fix loop
  /reviewer:spec docs/plan/ --fix --angles "scope,tasks"

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

### Step 4: Delegate to Orchestrator

First, read the review angles template:
```
Read tool: ${CLAUDE_PLUGIN_ROOT}/templates/review-angles.yaml
```

Then launch the `spec-orchestrator` agent:

```
Task tool:
- subagent_type: "reviewer:spec-orchestrator"
- description: <"Iterative spec review with fix loop" if fix_enabled, else "Multi-angle spec review">
- prompt: |
    Review the following spec files.

    ## Parameters
    - paths: <list each path>
    - fix_enabled: <true if --fix is set, false otherwise>
    - max_iterations: <N, default 3>
    - angles: <value from --angles flag, or "default">
    - working_directory: <current directory>
    - log_script_path: <absolute path to ${CLAUDE_PLUGIN_ROOT}/scripts/log-findings.sh>

    ## Codebase Context (from code-explorer)
    <CODEBASE_CONTEXT, or "No codebase context available." if empty>

    ## Review Angle Templates (spec section)
    <paste the spec section content from review-angles.yaml>
```

Report the agent's findings back to the user.

## Examples

```bash
# Multi-angle review (default behavior)
/reviewer:spec docs/plans/auth-flow/

# Review specific files
/reviewer:spec proposal.md spec.md tasks.md

# Interactive (asks which files)
/reviewer:spec

# Iterative review + fix
/reviewer:spec docs/plan/ --fix

# Narrow angles
/reviewer:spec docs/plan/ --angles "scope,tasks"

# Fix loop, narrow angles, 5 rounds max
/reviewer:spec docs/plan/ --fix --angles "scope,tasks" -n 5

# Skip codebase exploration (review spec in isolation)
/reviewer:spec docs/plan/ --no-explore
```
