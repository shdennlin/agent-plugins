---
allowed-tools:
  - Bash(${CLAUDE_PLUGIN_ROOT}/scripts/setup-harvest.sh:*)
  - Task
description: Review ⭐ items from recent project notes, group by theme, and draft permanent-note candidates
argument-hint: "[--since DURATION] [--theme KEYWORD] [--draft] [--help/-h]"
---

# Harvest Command

Find `⭐` items across your project notes from the last N days, group them by emerging theme, and produce permanent-note draft candidates. Designed for the weekly distillation ritual.

## MANDATORY FIRST STEP — DO NOT SKIP

You MUST execute this Bash command BEFORE doing anything else. The setup script parses arguments, validates `$PROJECT_NOTES_DIR`, resolves the `--since` window into a cutoff date, lists source markdown files, and prepares `_harvest/` if `--draft`.

```
"${CLAUDE_PLUGIN_ROOT}/scripts/setup-harvest.sh" $ARGUMENTS
```

**If the script exits non-zero**, report its stderr output to the user verbatim and stop. Do NOT proceed to dispatch the agent.

**If `--help` or `-h` was in arguments**, the script prints help to stdout and exits 0. Show that output to the user and stop.

## After setup succeeds

The script's stdout is a JSON object like:

```json
{
  "since": "7d",
  "cutoff_date": "2026-05-11",
  "theme": "",
  "draft": false,
  "project_notes_dir": "/Users/me/Documents/project-notes",
  "source_files": [
    "/Users/me/Documents/project-notes/Photo Plan.md",
    "/Users/me/Documents/project-notes/Adhoc 2026-05.md"
  ],
  "harvest_dir": "/Users/me/Documents/project-notes/_harvest",
  "today": "2026-05-18"
}
```

Dispatch the `harvest-agent` with these resolved values:

```
Task tool:
- subagent_type: "project-notes:harvest-agent"
- description: "Harvest ⭐ items into theme-grouped distillation candidates"
- prompt: |
    Harvest ⭐ items for distillation.

    Config (from setup-harvest.sh):
    <paste the JSON output from setup-harvest.sh here>

    Notes:
    - cutoff_date is already resolved from --since; filter entries with
      date headings >= cutoff_date
    - source_files is the canonical list; do not glob the directory
      yourself
    - harvest_dir is pre-created and validated as writable when draft=true
```

Report the agent's output back to the user.
