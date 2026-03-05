---
allowed-tools:
  - Bash
  - Read
  - Task
description: Show per-submodule git status with staged/unstaged/untracked counts
argument-hint: "[--help/-h]"
---

# Git Status Command

Show per-submodule status with staged, unstaged, and untracked file counts.

## Arguments

Parse the following from `$ARGUMENTS`:

- `--help` or `-h` - Show usage information and exit

## Instructions

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
1. **help**: if `--help` or `-h` is present, show the usage information below and stop. Do NOT delegate to the agent.

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /git-workflow:status [options]

Show per-submodule git status with staged/unstaged/untracked counts.
Only works in superprojects with submodules.

Options:
  -h, --help            Show this help message

Examples:
  /git-workflow:status                              Show all submodule statuses
```

### Step 2: Validate Submodules Exist

```bash
git submodule status 2>/dev/null
```

If output is empty or the command fails, display this error and stop — do NOT delegate:

```
Error: No submodules found in the current repository.
This command only works in superprojects with submodules.
```

### Step 3: Delegate to Agent

Launch the `status-agent` agent:

```
Task tool:
- subagent_type: "status-agent"
- description: "Show submodule status table"
- prompt: |
    Show the git status of all submodules in the superproject.
    - Working directory: <current directory>
```

## Examples

```bash
# Show status of all submodules
/git-workflow:status
```
