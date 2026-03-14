---
name: digest:digest
description: "Summarize AI-generated branches, PRs, diffs, and design docs into icon-rich structured cards. Use when the user asks to explain, summarize, or digest changes."
---

# Digest

Summarize AI-generated changes into structured, icon-rich cards that developers, reviewers, and stakeholders can quickly understand.

## Usage

```
$digest                              # current branch vs main
$digest feat/new-auth                # specific branch
$digest #42                          # PR number
$digest docs/plans/auth.md           # design doc
$digest --detail                     # detailed output
$digest --simple                     # plain-language output
$digest -s -d                        # both: plain + technical detail
```

## Options

| Flag | Description |
|------|-------------|
| `-d, --detail` | Detailed output with file breakdown and audience sections |
| `-s, --simple` | Plain, non-technical language (easy to understand for everyone) |

Flags can be combined. `--simple --detail` gives both a plain-language summary and technical detail in one output.

## Process

1. Detect input type (PR, branch, design doc, or current branch)
2. Dispatch the digest agent using the prompt template in `digest-agent.md` (in this skill directory)
3. Analyze changes and produce a structured card
4. Report the structured card back to the user

## Agent Dispatch

Use the companion `digest-agent.md` in this directory as the agent prompt. Provide it with:
- Input type and target
- Detail mode flag
- Simple mode flag

The agent uses `$PROJECT_ROOT` (set by the init hook) or falls back to `git rev-parse --show-toplevel`.
