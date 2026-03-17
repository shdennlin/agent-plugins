---
name: digest:digest
description: "Summarize AI-generated branches, PRs, diffs, and design docs into structured digests with file breakdown, code walkthrough, and key concepts. Supports simple mode (-s) for plain language, report mode (-r) for full analysis with architecture impact, design decisions, risks, and recommendations, and export mode (--export) for markdown with Mermaid diagrams. Use when the user asks to explain, summarize, digest, or understand changes."
---

# Digest

Summarize AI-generated changes into structured digests that developers, reviewers, and stakeholders can quickly understand.

## Usage

```
$digest                              # current branch vs main
$digest feat/new-auth                # specific branch
$digest #42                          # PR number
$digest docs/plans/auth.md           # design doc
$digest --simple                     # plain-language output
$digest --report                     # full report (~5 min read)
$digest -r --export                  # export as markdown with Mermaid
```

## Options

| Flag | Description |
|------|-------------|
| `-s, --simple` | Plain, non-technical language |
| `-r, --report` | Full report: architecture, design decisions, risks, recommendations |
| `--export` | Export report as markdown with Mermaid diagrams (requires `-r`) |

Output modes: default (~1min) → `-r` (~5min)

## Process

1. Detect input type (PR, branch, design doc, or current branch)
2. Dispatch the digest agent using the prompt template in `digest-agent.md` (in this skill directory)
3. Analyze changes and produce structured output based on mode
4. Report the output back to the user (or write to file if `--export`)

## Agent Dispatch

Use the companion `digest-agent.md` in this directory as the agent prompt. Provide it with:
- Input type and target
- Simple mode flag
- Report mode flag
- Export mode flag

The agent uses `$PROJECT_ROOT` (set by the init hook) or falls back to `git rev-parse --show-toplevel`.
