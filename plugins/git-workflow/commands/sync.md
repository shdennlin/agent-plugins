---
allowed-tools:
  - Bash
  - Read
  - Task
  - AskUserQuestion
description: Pull superproject and sync all submodules to latest tracking branches
argument-hint: "[--help/-h]"
---

# Git Sync Command

Pull superproject and sync all submodules to their latest tracking branches.

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
Usage: /git-workflow:sync [options]

Pull superproject and sync all submodules to latest tracking branches.
Only works in superprojects with submodules.

Options:
  -h, --help            Show this help message

Examples:
  /git-workflow:sync                                Sync all submodules
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

Launch the `sync-agent` agent:

```
Task tool:
- subagent_type: "sync-agent"
- description: "Sync submodules to latest"
- prompt: |
    Sync the superproject and all submodules to their latest upstream state.
    - Working directory: <current directory>
```

## Examples

```bash
# Sync all submodules to latest
/git-workflow:sync
```
