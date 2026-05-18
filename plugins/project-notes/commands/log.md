---
allowed-tools:
  - Bash(${CLAUDE_PLUGIN_ROOT}/scripts/setup-log.sh:*)
  - Task
description: Log this session as a 6-field entry at the top of your project notes journal
argument-hint: "[project-name] [-y/--yes] [--adhoc] [--help/-h]"
---

# Log Session Command

Capture this session as a structured entry in `$PROJECT_NOTES_DIR/<project>.md` using a 6-field daily-template format. The entry is inserted at the **top** of `## Sessions` (newest first) and the file's `updated:` frontmatter is bumped to today.

## MANDATORY FIRST STEP — DO NOT SKIP

You MUST execute this Bash command BEFORE doing anything else. The setup script parses arguments, validates `$PROJECT_NOTES_DIR`, seeds `_template.md` on first use, lists existing project files, and returns a JSON config for the agent.

```
"${CLAUDE_PLUGIN_ROOT}/scripts/setup-log.sh" $ARGUMENTS
```

**If the script exits non-zero**, report its stderr output to the user verbatim and stop. Do NOT proceed to dispatch the agent.

**If `--help` or `-h` was in arguments**, the script prints help to stdout and exits 0. Show that output to the user and stop.

## After setup succeeds

The script's stdout is a JSON object like:

```json
{
  "project_name": "Photo Plan",
  "yes": false,
  "adhoc": false,
  "project_notes_dir": "/Users/me/Documents/project-notes",
  "template_path": "/Users/me/Documents/project-notes/_template.md",
  "template_seeded": false,
  "adhoc_pattern": "Adhoc {YYYY}-{MM}.md",
  "title_case": "1",
  "existing_projects": [
    {"name": "Photo Plan", "path": "/Users/me/Documents/project-notes/Photo Plan.md"}
  ],
  "today": "2026-05-18",
  "weekday": "Mon"
}
```

Dispatch the `log-agent` with these resolved values:

```
Task tool:
- subagent_type: "project-notes:log-agent"
- description: "Log this session to project notes"
- prompt: |
    Log the current session as a structured 6-field journal entry.

    Config (from setup-log.sh):
    <paste the JSON output from setup-log.sh here>

    Session context summary (for the agent to draft the entry):
    <2-3 sentences capturing this session — main thread, key decisions,
     surprises, anything notable>

    Notes:
    - PROJECT_NOTES_DIR is already validated; _template.md is already
      seeded if it was missing
    - existing_projects is the canonical list for auto-detection /
      fuzzy match; you don't need to glob the directory yourself
    - today and weekday are pre-computed
```

Report the agent's confirmation back to the user (which file was updated, how many ⭐ items flagged for distillation).
