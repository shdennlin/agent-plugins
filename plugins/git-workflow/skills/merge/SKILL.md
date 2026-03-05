---
name: merge
description: This skill should be used when the user asks to "merge this branch", "merge into develop", "merge into main", "ready to merge", "merge feature branch", or mentions merging branches with commit messages.
---

# Git Merge Skill

When the user expresses intent to merge branches, use the `/git-workflow:merge` command.

## Quick Reference

| Intent | Command |
|--------|---------|
| Merge current branch | `/git-workflow:merge` |
| Merge specific source | `/git-workflow:merge feature/auth` |
| Merge source into target | `/git-workflow:merge develop main` |
| With issue reference | `/git-workflow:merge -i "#123"` |
| With spec name | `/git-workflow:merge -s auth-flow` |
| Skip confirmation | `/git-workflow:merge -y` |
| All sub-repos | `/git-workflow:merge --all` |

## When to Suggest

Suggest this command when the user:
- Says "merge this branch", "merge into develop/main"
- Says "ready to merge", "done with this branch"
- Asks to create a merge commit with a good message
- Wants to merge across multiple repositories
