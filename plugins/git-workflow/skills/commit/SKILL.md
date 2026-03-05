---
name: git-workflow:commit
description: "Commit staged changes with auto-generated Conventional Commits messages. Use when committing changes, finishing work in submodules, or creating structured commit messages."
---

# Git Commit

Commit staged changes with auto-generated Conventional Commits messages. Works in single repos and superprojects with submodules.

## Usage

```
$commit                              # Commit staged changes
$commit -s auth-flow                 # With spec reference
$commit -i "PROJ-123"               # With issue reference
$commit -s auth-flow -i "#123"      # With both references
$commit --dry-run                   # Preview without committing
```

## Options

| Flag | Description |
|------|-------------|
| `-s, --spec <name>` | Spec name for commit message |
| `-i, --issue <id>` | Issue ID for commit message |
| `--dry-run` | Show planned commits without executing |

## Process

1. Detect mode (single repo vs superproject with submodules)
2. Dispatch the commit agent using the prompt template in `commit-agent.md` (in this skill directory)
3. Analyze staged diffs to generate Conventional Commits message
4. Commit staged changes (or preview with `--dry-run`)

## Agent Dispatch

Use the companion `commit-agent.md` in this directory as the agent prompt. Provide it with:
- Mode (single/superproject)
- Spec and issue references (if any)
- Dry-run flag
- The current working directory
