---
name: git-workflow:status
description: "Show per-submodule git status with staged/unstaged/untracked counts and commit-readiness indicator. Use when checking submodule state or preparing to commit."
---

# Git Status

Show per-submodule status with staged, unstaged, and untracked file counts.

## Usage

```
$status                              # Show all submodule statuses
```

## Process

1. Validate submodules exist (error if none)
2. Dispatch the status agent using the prompt template in `status-agent.md` (in this skill directory)
3. Gather per-submodule file counts
4. Display status table with commit-readiness indicator

## Agent Dispatch

Use the companion `status-agent.md` in this directory as the agent prompt. Provide it with:
- The current working directory
