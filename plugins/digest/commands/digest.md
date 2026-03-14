---
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Task
  - AskUserQuestion
description: Summarize a branch, PR, diff, or design doc into an icon-rich structured card
argument-hint: "[target] [--detail/-d] [--simple/-s] [--help/-h]"
---

# Digest Command

Produce a concise, icon-rich summary of AI-generated changes so developers, reviewers, and stakeholders can quickly understand what changed and why.

## Arguments

Parse the following from `$ARGUMENTS`:

- `[target]` — A branch name, PR number (`#42`), file path, or omit for current branch
- `--detail` or `-d` — Produce detailed output with file-level breakdown and audience sections
- `--simple` or `-s` — Use plain, non-technical language (easy to understand for everyone)
- `--help` or `-h` — Show usage information and exit

Flags can be combined: `--simple --detail` produces detailed output written in plain language.

## Instructions

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
1. **help**: if `--help` or `-h` is present, show usage info below and stop. Do NOT delegate to the agent.
2. **target**: the positional argument (branch, `#<number>`, file path, or empty)
3. **detail**: whether `--detail` or `-d` flag is present
4. **simple**: whether `--simple` or `-s` flag is present

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /digest:digest [target] [options]

Summarize branches, PRs, diffs, or design docs into structured cards.

Positional arguments:
  target                Branch name, PR number (#42), file path, or omit for current branch

Options:
  -d, --detail          Detailed output with file breakdown and audience sections
  -s, --simple          Plain, non-technical language (easy to understand for everyone)
  -h, --help            Show this help message

Flags can be combined:
  /digest:digest -s -d            # detailed output in plain language

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
  /digest:digest --detail              # detailed output
  /digest:digest feat/auth -d          # branch with detail
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
    Detail mode: <true | false>
    Simple mode: <true | false>
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

# Detailed output for current branch
/digest:digest --detail

# Simple, plain-language summary
/digest:digest --simple

# Detailed + simple combined
/digest:digest feat/auth -s -d
```
