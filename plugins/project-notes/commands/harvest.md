---
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
  - AskUserQuestion
description: Review ⭐ items from recent project notes, group by theme, and draft permanent-note candidates
argument-hint: "[--since DURATION] [--theme KEYWORD] [--draft] [--help/-h]"
---

# Harvest Command

Find `⭐` items across your project notes from the last N days, group them by emerging theme, and produce permanent-note draft candidates. Designed for the weekly distillation ritual.

## Arguments

Parse the following from `$ARGUMENTS`:

- `--since DURATION` — Time window (default `7d`). Examples: `7d`, `14d`, `1m`, `all`
- `--theme KEYWORD` — Filter to themes containing the keyword (case-insensitive)
- `--draft` — Actually write drafts to `$PROJECT_NOTES_DIR/_harvest/` (default: just list candidates)
- `--help` or `-h` — Show usage and exit

## Instructions

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
1. **help**: if `--help` or `-h`, show usage below and stop
2. **since**: duration string (default `7d`)
3. **theme**: keyword filter (default empty)
4. **draft**: whether `--draft` flag is present

### Help Output

```
Usage: /project-notes:harvest [options]

Find ⭐ items in recent project notes, group by theme, suggest permanent notes.
Designed for the weekly distillation ritual (15-minute review).

Options:
  --since DURATION    Time window: 7d, 14d, 1m, all (default: 7d)
  --theme KEYWORD     Filter to themes matching keyword
  --draft             Write drafts to $PROJECT_NOTES_DIR/_harvest/
                      (default: list-only mode)
  -h, --help          Show this message

What it does:
  1. Reads all *.md in $PROJECT_NOTES_DIR (excludes _archive/, _template.md)
  2. Extracts items prefixed with ⭐
  3. Filters by date heading within --since window
  4. Groups items by emerging theme (semantic clustering)
  5. For each theme: shows source items + suggested vault title + 2-3 sentence framing
  6. (--draft mode) writes draft .md files to _harvest/ for user review

Workflow:
  $ /project-notes:harvest                    # list mode, see what's accumulated
  $ /project-notes:harvest --draft            # generate draft files for review
  $ /project-notes:harvest --since 14d        # broader window
  $ /project-notes:harvest --theme backup     # focus on one emerging theme

After review, manually move drafts from _harvest/ into your permanent vault.
```

### Step 2: Validate Environment

```bash
if [ -z "$PROJECT_NOTES_DIR" ]; then
  echo "ERROR: PROJECT_NOTES_DIR not set."
  exit 1
fi
if [ ! -d "$PROJECT_NOTES_DIR" ]; then
  echo "ERROR: PROJECT_NOTES_DIR does not exist: $PROJECT_NOTES_DIR"
  exit 1
fi
```

### Step 3: Delegate to Agent

Launch the `harvest-agent`:

```
Task tool:
- subagent_type: "project-notes:harvest-agent"
- description: "Harvest ⭐ items into theme-grouped distillation candidates"
- prompt: |
    Harvest ⭐ items for distillation.

    Args:
      since: <e.g. "7d", "14d", "1m", "all">
      theme: <keyword filter or empty>
      draft: <true | false>

    PROJECT_NOTES_DIR: <value>
```

Report the agent's output back to the user.

## Examples

```bash
# Default: list ⭐ items from last 7 days, grouped by theme
/project-notes:harvest

# Wider window
/project-notes:harvest --since 14d

# Focus on a specific theme that emerged
/project-notes:harvest --theme rmlint

# Generate draft files for review (in _harvest/ folder)
/project-notes:harvest --draft

# Combined
/project-notes:harvest --since 1m --theme backup --draft
```
