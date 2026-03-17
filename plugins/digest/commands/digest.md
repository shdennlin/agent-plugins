---
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Task
  - AskUserQuestion
description: Summarize a branch, PR, diff, or design doc into a structured digest with file breakdown and key concepts
argument-hint: "[target] [--simple/-s] [--report/-r] [--export] [--help/-h]"
---

# Digest Command

Produce a structured summary of AI-generated changes so developers, reviewers, and stakeholders can quickly understand what changed and why.

## Arguments

Parse the following from `$ARGUMENTS`:

- `[target]` — A branch name, PR number (`#42`), file path, or omit for current branch
- `--simple` or `-s` — Use plain, non-technical language (easy to understand for everyone)
- `--report` or `-r` — Full report with architecture impact, design decisions, risks, and recommendations
- `--export` — Export report as markdown file with Mermaid diagrams (requires `-r`)
- `--help` or `-h` — Show usage information and exit

Flags can be combined: `--report --export` writes a full markdown report with Mermaid diagrams to a file.

## Instructions

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
1. **help**: if `--help` or `-h` is present, show usage info below and stop. Do NOT delegate to the agent.
2. **target**: the positional argument (branch, `#<number>`, file path, or empty)
3. **simple**: whether `--simple` or `-s` flag is present
4. **report**: whether `--report` or `-r` flag is present
5. **export**: whether `--export` flag is present (only valid with `--report`)

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /digest:digest [target] [options]

Summarize branches, PRs, diffs, or design docs into structured digests.

Positional arguments:
  target                Branch name, PR number (#42), file path, or omit for current branch

Options:
  -s, --simple          Plain, non-technical language (easy to understand for everyone)
  -r, --report          Full report with architecture, design decisions, risks, recommendations
  --export              Export report as markdown with Mermaid diagrams (requires -r)
  -h, --help            Show this help message

Output modes:
  (default)             Card + file breakdown + code walkthrough + key concepts (~1 min read)
  -r                    Full report with architecture, design, risks, questions (~5 min read)

Input detection:
  #<number>             PR number (uses gh pr view)
  <branch-name>         Branch diff against base
  <file-path>           Design doc summary
  (empty)               Current branch vs auto-detected base

Examples:
  /digest:digest                       # current branch vs main
  /digest:digest feat/new-auth         # specific branch
  /digest:digest #42                   # PR number
  /digest:digest docs/plans/auth.md    # design doc
  /digest:digest --simple              # plain-language output
  /digest:digest -r                    # full report in terminal
  /digest:digest -r --export           # full report as markdown file
```

### Step 2: Detect Input Type

Determine the input type from `target`:
- Starts with `#` followed by digits → **PR** (e.g., `#42`)
- Matches a file path that exists on disk → **Design doc**
- Non-empty string → **Branch name**
- Empty / not provided → **Current branch**

### Step 3: Delegate to Agent

Launch the `digest-agent` agent:

```
Task tool:
- subagent_type: "digest:digest-agent"
- description: "Digest and summarize changes"
- prompt: |
    Produce a digest summary for the following input.

    Input type: <PR | Branch | Design doc | Current branch>
    Target: <target value or "current branch">
    Simple mode: <true | false>
    Report mode: <true | false>
    Export mode: <true | false>
```

Report the agent's output back to the user.

## Examples

```bash
# Summarize current branch
/digest:digest

# Summarize a feature branch
/digest:digest feat/new-auth

# Summarize a PR
/digest:digest #42

# Summarize a design doc
/digest:digest docs/plans/auth.md

# Simple, plain-language summary
/digest:digest --simple

# Full report in terminal
/digest:digest -r

# Full report exported as markdown with Mermaid diagrams
/digest:digest -r --export
```
