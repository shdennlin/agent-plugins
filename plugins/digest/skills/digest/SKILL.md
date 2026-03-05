---
name: digest:digest
description: "Summarize AI-generated branches, PRs, diffs, and design docs into icon-rich structured cards, or generate release notes from commit ranges. Use when the user asks to explain, summarize, digest changes, or create release notes."
---

# Digest

Summarize AI-generated changes into structured, icon-rich cards that developers, reviewers, and stakeholders can quickly understand. Generate release notes from commit ranges.

## Usage

```
/digest:digest                       # current branch vs main
/digest:digest feat/new-auth         # specific branch
/digest:digest #42                   # PR number
/digest:digest docs/plans/auth.md    # design doc
/digest:digest --detail              # detailed output

/digest:release                      # release notes from latest tag to HEAD
/digest:release v1.0.0 v2.0.0       # between two tags
/digest:release --dev                # developer changelog only
/digest:release --user --write       # user narrative, append to CHANGELOG.md
```

## Process

### Digest
1. Detect input type (PR, branch, design doc, or current branch)
2. Dispatch the digest-agent to analyze and summarize
3. Report the structured card back to the user

### Release
1. Resolve tag range from arguments
2. Dispatch the release-agent to gather and classify commits
3. Report developer changelog, user narrative, or both

## Agent Dispatch

- **digest-agent**: Use for change summaries. Provide input type, target, detail mode, and working directory.
- **release-agent**: Use for release notes. Provide from/to refs, format, write options, and working directory.
