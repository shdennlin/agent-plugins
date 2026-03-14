---
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Task
  - AskUserQuestion
description: Generate release notes from a commit range with developer and user-facing formats
argument-hint: "[from] [to] [--dev] [--user] [--write] [--out <file>] [--help/-h]"
---

# Release Command

Generate structured release notes from a range of commits, with developer-facing changelogs and user-facing narratives.

## Arguments

Parse the following from `$ARGUMENTS`:

- `[from]` — Start tag/ref (optional, defaults to latest tag)
- `[to]` — End tag/ref (optional, defaults to HEAD)
- `--dev` — Developer-facing changelog grouped by commit type
- `--user` — User-facing plain language narrative
- No flag — Both sections
- `--write` — Append output to CHANGELOG.md
- `--out <file>` — Write output to a custom file path
- `--help` or `-h` — Show usage information and exit

## Instructions

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
1. **help**: if `--help` or `-h` is present, show usage info below and stop. Do NOT delegate to the agent.
2. **from**: first positional argument (tag or ref, or empty)
3. **to**: second positional argument (tag or ref, or empty)
4. **dev**: whether `--dev` flag is present
5. **user**: whether `--user` flag is present
6. **write**: whether `--write` flag is present
7. **out**: the file path following `--out`, if present

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /digest:release [from] [to] [options]

Generate release notes from a commit range.

Positional arguments:
  from                  Start tag/ref (default: latest tag)
  to                    End tag/ref (default: HEAD)

Options:
  --dev                 Developer-facing changelog grouped by type
  --user                User-facing plain language narrative
  --write               Append to CHANGELOG.md
  --out <file>          Write to custom file path
  -h, --help            Show this help message

Tag range detection:
  (no args)             Latest tag → HEAD
  <from>                <from> → HEAD
  <from> <to>           <from> → <to>

Examples:
  /digest:release                         # latest tag to HEAD, both formats
  /digest:release v1.0.0                  # v1.0.0 to HEAD
  /digest:release v1.0.0 v2.0.0          # between two tags
  /digest:release --dev                   # developer changelog only
  /digest:release --user                  # user narrative only
  /digest:release --write                 # append to CHANGELOG.md
  /digest:release --out docs/release.md   # write to custom file
  /digest:release v1.0.0 --dev --write    # dev changelog, append to CHANGELOG.md
```

### Step 2: Delegate to Agent

Launch the `release-agent` agent:

```
Task tool:
- subagent_type: "digest:release-agent"
- description: "Generate release notes from commit range"
- prompt: |
    Generate release notes for the following range.

    From: <from value or "latest tag">
    To: <to value or "HEAD">
    Format: <dev | user | both>
    Write to CHANGELOG: <true | false>
    Output file: <file path or "none">
```

Report the agent's output back to the user.

## Examples

```bash
# Release notes from latest tag to HEAD
/digest:release

# Between two tags
/digest:release v1.0.0 v2.0.0

# Developer changelog only
/digest:release --dev

# User narrative, written to file
/digest:release --user --out docs/release.md

# Full release notes appended to CHANGELOG.md
/digest:release --write
```
