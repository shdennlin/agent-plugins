---
name: git-workflow:sync
description: "Pull superproject and sync all submodules to latest tracking branches. Use when updating submodules, syncing repos, or pulling latest changes."
---

# Git Sync

Pull superproject and sync all submodules to their latest tracking branches.

## Usage

```
$sync                                # Sync all submodules to latest
```

## Process

1. Validate submodules exist (error if none)
2. Dispatch the sync agent using the prompt template in `sync-agent.md` (in this skill directory)
3. Check for dirty working tree, pull superproject, sync submodules
4. Display results table with branch, status, and new commit count

## Agent Dispatch

Use the companion `sync-agent.md` in this directory as the agent prompt. Provide it with:
- The current working directory
