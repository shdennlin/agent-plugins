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
description: Log this session as a 6-field entry at the top of your project notes journal
argument-hint: "[project-name] [-y/--yes] [--adhoc] [--help/-h]"
---

# Log Session Command

Capture this session as a structured entry in `$PROJECT_NOTES_DIR/<project>.md` using a 6-field daily-template format. The entry is inserted at the **top** of `## Sessions` (newest first) and the file's `updated:` frontmatter is bumped to today.

## Arguments

Parse the following from `$ARGUMENTS`:

- `[project-name]` — Explicit project name (skips git/cwd auto-detection)
- `-y` or `--yes` — Auto-confirm: show draft then write without asking
- `--adhoc` — Force log to current month's `Adhoc YYYY-MM.md` regardless of detection
- `--help` or `-h` — Show usage information and exit

## Instructions

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
1. **help**: if `--help` or `-h` is present, show usage info below and stop. Do NOT delegate.
2. **project-name**: the positional argument (or empty for auto-detect)
3. **yes**: whether `-y` or `--yes` flag is present
4. **adhoc**: whether `--adhoc` flag is present

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /project-notes:log [project-name] [options]

Capture this session as a 6-field entry inserted at the top of your project notes journal.
Fields: Focus / Decisions / Snags / Touched / Re-learn / Next.

Positional arguments:
  project-name          Explicit project file name (skips auto-detection)

Options:
  -y, --yes             Auto-confirm: show draft, write without asking
  --adhoc               Log to current month's Adhoc YYYY-MM.md
  -h, --help            Show this help message

Setup (one-time):
  Set PROJECT_NOTES_DIR in your shell rc:
    export PROJECT_NOTES_DIR="/path/to/your/project-notes"

  Optional overrides:
    PROJECT_NOTES_TEMPLATE       Default: $PROJECT_NOTES_DIR/_template.md
                                 (auto-seeded from plugin on first use)
    PROJECT_NOTES_ADHOC_PATTERN  Default: "Adhoc {YYYY}-{MM}.md"
    PROJECT_NOTES_TITLE_CASE     Default: 1 (set 0 to keep raw filename)

Examples:
  /project-notes:log                       # auto-detect from git/cwd
  /project-notes:log "Photo Plan"          # explicit project name
  /project-notes:log "Photo Plan" -y       # explicit + auto-confirm
  /project-notes:log --adhoc               # short task → adhoc month file
  /project-notes:log --adhoc -y            # adhoc + skip confirm

Behavior:
  - Inserts at TOP of ## Sessions (newest first)
  - Skips empty fields entirely (no "(none)" placeholders)
  - Auto-seeds vault _template.md on first use
```

### Step 2: Validate Environment

Run a Bash command to check `$PROJECT_NOTES_DIR`:

```bash
if [ -z "$PROJECT_NOTES_DIR" ]; then
  echo "ERROR: PROJECT_NOTES_DIR not set."
  echo ""
  echo "Add to your shell rc (~/.zshrc, ~/.bashrc):"
  echo '  export PROJECT_NOTES_DIR="$HOME/Documents/project-notes"'
  echo ""
  echo "Then restart your shell or run: source ~/.zshrc"
  exit 1
fi

if [ ! -d "$PROJECT_NOTES_DIR" ]; then
  echo "ERROR: PROJECT_NOTES_DIR does not exist: $PROJECT_NOTES_DIR"
  echo "Create it with: mkdir -p \"$PROJECT_NOTES_DIR\""
  exit 1
fi

echo "PROJECT_NOTES_DIR=$PROJECT_NOTES_DIR"
ls "$PROJECT_NOTES_DIR/"*.md 2>/dev/null | head -20
```

If the env is unset or directory missing, report the error to the user and stop. Do NOT delegate.

### Step 3: Delegate to Agent

Launch the `log-agent`:

```
Task tool:
- subagent_type: "project-notes:log-agent"
- description: "Log this session to project notes"
- prompt: |
    Log the current session as a journal entry.

    Args:
      project-name: <explicit name from args, or empty for auto-detect>
      yes: <true | false>
      adhoc: <true | false>

    PROJECT_NOTES_DIR: <value>
    PROJECT_NOTES_TEMPLATE: <value or empty for default>
    PROJECT_NOTES_ADHOC_PATTERN: <value or "Adhoc {YYYY}-{MM}.md">
    PROJECT_NOTES_TITLE_CASE: <value or "1">
    CLAUDE_PLUGIN_ROOT: <plugin root path>

    Session context summary (for the agent to draft the entry):
    <2-3 sentences capturing this session — main thread, key decisions,
     surprises, anything notable>
```

Report the agent's confirmation back to the user (which file was updated, how many ⭐ items flagged for distillation).

## Examples

```bash
# Auto-detect project from git repo / cwd
/project-notes:log

# Explicit project (skips detection)
/project-notes:log "Photo Organization"

# Explicit + auto-confirm (no ask)
/project-notes:log "Photo Organization" -y

# Short task → log to monthly adhoc file
/project-notes:log --adhoc

# Adhoc + auto-confirm
/project-notes:log --adhoc -y

# Show help
/project-notes:log --help
```
