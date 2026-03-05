---
allowed-tools:
  - Bash
  - Read
  - Task
  - AskUserQuestion
description: Commit staged changes with auto-generated Conventional Commits message
argument-hint: "[--spec/-s <name>] [--issue/-i <id>] [--dry-run] [--help/-h]"
---

# Git Commit Command

Commit staged changes with auto-generated Conventional Commits messages. Works in single repos and superprojects with submodules.

## Arguments

Parse the following from `$ARGUMENTS`:

- `--spec` or `-s` - Optional: spec name to include in commit message
- `--issue` or `-i` - Optional: issue ID to include in commit message (e.g., `#123`, `PROJ-456`)
- `--dry-run` - Optional: show planned commits without executing
- `--help` or `-h` - Show usage information and exit

## Instructions

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
1. **help**: if `--help` or `-h` is present, show the usage information below and stop. Do NOT delegate to the agent.
2. **spec**: value after `--spec` or `-s`
3. **issue**: value after `--issue` or `-i`
4. **dry-run**: boolean, true if `--dry-run` present

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /git-workflow:commit [options]

Commit staged changes with auto-generated Conventional Commits message.
Works in single repos and superprojects with submodules.

Options:
  -s, --spec <name>     Spec name to mention in commit message
  -i, --issue <id>      Issue ID to reference in commit message (e.g., #123)
  --dry-run             Show planned commits without executing
  -h, --help            Show this help message

Examples:
  /git-workflow:commit                              Commit staged changes
  /git-workflow:commit -s auth-flow                 With spec reference
  /git-workflow:commit -i "PROJ-123"                With issue reference
  /git-workflow:commit -s auth-flow -i "#123"       With both references
  /git-workflow:commit --dry-run                    Preview without committing
```

### Step 2: Detect Mode

Determine if this is a single repo or superproject:

```bash
git submodule status 2>/dev/null
```

- If output is non-empty → superproject mode
- If output is empty or command fails → single repo mode

### Step 3: Delegate to Agent

Launch the `commit-agent` agent with all parsed context:

```
Task tool:
- subagent_type: "commit-agent"
- description: "Commit staged changes with message"
- prompt: |
    Commit staged changes with the following parameters:
    - Mode: <single/superproject>
    - Spec: <spec or "none">
    - Issue: <issue or "none">
    - Dry-run: <true/false>
    - Working directory: <current directory>
```

## Examples

```bash
# Commit staged changes in current repo
/git-workflow:commit

# With spec and issue references
/git-workflow:commit -s auth-flow -i "PROJ-123"

# Preview commits without executing
/git-workflow:commit --dry-run

# Commit across submodules with spec
/git-workflow:commit -s auth-flow
```
