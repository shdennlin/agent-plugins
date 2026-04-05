---
name: git-workflow:merge
description: "Merge git branches with auto-generated Conventional Commits messages. Use when merging branches, finishing feature work, or creating merge commits."
---

# Git Merge

Merge branches with auto-generated Conventional Commits messages.

## Usage

```
$merge                              # Merge current branch into develop/main
$merge feature/auth                 # Merge specific source branch
$merge develop main                 # Merge develop into main
$merge -i "#123" -s auth-flow       # With issue and spec references
$merge --yes                        # Skip confirmation
$merge --all                        # Merge across all sub-repos
```

## Options

| Flag | Description |
|------|-------------|
| `-i, --issue <id>` | Issue ID for commit message |
| `-s, --spec <name>` | Spec name for commit message |
| `--all` | Merge across all git repos in subdirectories |
| `-y, --yes` | Skip confirmation prompt |

## Process

1. Detect source and target branches
2. Dispatch the merge agent using the prompt template in `merge.md` (in this skill directory)
3. Generate Conventional Commits message from commit history
4. Execute merge via git plumbing (checkout-free, worktree-safe)

## Agent Dispatch

Use the companion `merge.md` in this directory as the agent prompt. Provide it with:
- Source and target branches
- Issue and spec references (if any)
- Flags (--all, --yes)
- The current working directory
