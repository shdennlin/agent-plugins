---
allowed-tools:
  - Read
  - Task
  - AskUserQuestion
description: Review a spec/proposal/design before implementation to catch gaps, risks, and ambiguities
argument-hint: "[path...] [--help/-h]"
---

# Spec Review Command

Review feature specifications, proposals, designs, or task lists before implementation starts.

## Arguments

Parse the following from `$ARGUMENTS`:

- `[path...]` — One or more file or folder paths to review (positional args)
- `--help` or `-h` — Show usage information and exit

## Instructions

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
1. **help**: if `--help` or `-h` is present, show the usage information below and stop. Do NOT delegate to the agent.
2. **paths**: collect all arguments that don't start with `--` or `-`

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /reviewer:spec [path...] [options]

Review specs, proposals, or designs before implementation.

Positional arguments:
  path...               One or more files or folders to review

Options:
  -h, --help            Show this help message

Examples:
  /reviewer:spec docs/plans/auth-flow/
  /reviewer:spec proposal.md spec.md tasks.md
  /reviewer:spec                                  # asks which files to review
```

### Step 2: Resolve Paths

- If paths were provided: use them directly
- If no paths provided: use AskUserQuestion to ask "Which spec files or folder should I review?"

### Step 3: Delegate to Agent

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

Report the agent's findings back to the user.

## Examples

```bash
# Review a spec folder
/reviewer:spec docs/plans/auth-flow/

# Review specific files
/reviewer:spec proposal.md spec.md tasks.md

# Interactive (asks which files)
/reviewer:spec
```
