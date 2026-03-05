---
allowed-tools:
  - Bash
  - Read
  - Task
  - AskUserQuestion
description: Merge branches with auto-generated Conventional Commits message
argument-hint: "[source] [target] [--issue/-i <id>] [--spec/-s <name>] [--all] [--yes/-y] [--help/-h]"
---

# Git Merge Command

Merge branches with a consolidated Conventional Commits merge message.

## Arguments

Parse the following from `$ARGUMENTS`:

- `[source]` - Optional: source branch to merge (1st positional arg). Defaults to current branch.
- `[target]` - Optional: target branch to merge into (2nd positional arg). Defaults to `develop` if exists, else `main`.
- `--issue` or `-i` - Optional: issue ID to include in commit message (e.g., `#123`, `PROJ-456`)
- `--spec` or `-s` - Optional: spec name to include in commit message
- `--all` - Scan subdirectories for git repos and merge each
- `--yes` or `-y` - Skip confirmation prompt
- `--help` or `-h` - Show usage information and exit

## Instructions

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
1. **help**: if `--help` or `-h` is present, show the usage information below and stop. Do NOT delegate to the agent.
2. **positional args**: collect all arguments that don't start with `--` or `-` (and aren't values for flags). First = source, second = target.
3. **issue**: value after `--issue` or `-i`
4. **spec**: value after `--spec` or `-s`
5. **all**: boolean, true if `--all` present
6. **yes**: boolean, true if `--yes` or `-y` present

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /git-workflow:merge [source] [target] [options]

Merge branches with auto-generated Conventional Commits message.

Positional arguments:
  source              Source branch to merge (default: current branch)
  target              Target branch to merge into (default: develop or main)

Options:
  -i, --issue <id>    Issue ID to reference in commit message (e.g., #123)
  -s, --spec <name>   Spec name to mention in commit message
  --all               Merge across all git repos in subdirectories
  -y, --yes           Skip confirmation prompt
  -h, --help          Show this help message

Examples:
  /git-workflow:merge                              Merge current branch into develop/main
  /git-workflow:merge feature/auth                 Merge feature/auth into develop/main
  /git-workflow:merge develop main                 Merge develop into main
  /git-workflow:merge -i "#123" -s auth-flow       With issue and spec references
  /git-workflow:merge develop main -y              Merge without confirmation
  /git-workflow:merge --all                        Merge across all sub-repos
```

### Step 2: Delegate to Agent

Launch the `merge` agent with all parsed context:

```
Task tool:
- subagent_type: "merge"
- description: "Merge branches with commit message"
- prompt: |
    Merge branches with the following parameters:
    - Source: <source or "auto-detect">
    - Target: <target or "auto-detect">
    - Issue: <issue or "none">
    - Spec: <spec or "none">
    - All repos: <true/false>
    - Auto-confirm: <true/false>
    - Working directory: <current directory>
```

## Examples

```bash
# Merge current branch into develop (or main)
/git-workflow:merge

# Merge specific source branch (target auto-detected)
/git-workflow:merge feature/auth

# Merge develop into main explicitly
/git-workflow:merge develop main

# With issue reference
/git-workflow:merge -i "#123"

# With spec reference
/git-workflow:merge feature/auth -s auth-flow

# Merge with issue and spec, skip confirmation
/git-workflow:merge develop main -i "PROJ-456" -s auth-flow -y

# Multi-repo merge
/git-workflow:merge --all

# Merge specific branch across all repos
/git-workflow:merge feature/v2 --all --yes
```
