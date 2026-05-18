#!/bin/bash
# Project Notes Log Setup Script
# Parses arguments, validates $PROJECT_NOTES_DIR, seeds vault _template.md on first use,
# lists existing project files. Outputs resolved config as JSON to stdout.
#
# Called from plugins/project-notes/commands/log.md as:
#   "${CLAUDE_PLUGIN_ROOT}/scripts/setup-log.sh" $ARGUMENTS

set -euo pipefail

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

show_help() {
  cat <<'EOF'
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
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

# Defaults
project_name=""
yes_flag="false"
adhoc_flag="false"

# Handle --help / -h up front
for arg in "$@"; do
  case "$arg" in
    -h|--help) show_help; exit 0 ;;
  esac
done

# Positional + flag parser
positional=()
while [ $# -gt 0 ]; do
  token="$1"
  case "$token" in
    -y|--yes)    yes_flag="true";   shift; continue ;;
    --adhoc)     adhoc_flag="true"; shift; continue ;;
    --*|-*)
      echo "ERROR: Unknown flag: $token" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
    *)
      positional+=("$token")
      shift
      ;;
  esac
done

# First positional = project_name (may contain spaces if quoted)
if [ "${#positional[@]}" -gt 0 ]; then
  project_name="${positional[0]}"
fi

# ---------------------------------------------------------------------------
# Validate environment
# ---------------------------------------------------------------------------

if [ -z "${PROJECT_NOTES_DIR:-}" ]; then
  cat >&2 <<'EOF'
ERROR: PROJECT_NOTES_DIR not set.

Add to your shell rc (~/.zshrc, ~/.bashrc):
  export PROJECT_NOTES_DIR="$HOME/Documents/project-notes"

Then restart your shell or run: source ~/.zshrc
EOF
  exit 1
fi

if [ ! -d "$PROJECT_NOTES_DIR" ]; then
  echo "ERROR: PROJECT_NOTES_DIR does not exist: $PROJECT_NOTES_DIR" >&2
  echo "Create it with: mkdir -p \"$PROJECT_NOTES_DIR\"" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Seed vault _template.md on first use
# ---------------------------------------------------------------------------

template_path="$PROJECT_NOTES_DIR/_template.md"
template_seeded="false"

if [ ! -f "$template_path" ]; then
  if [ -n "${PROJECT_NOTES_TEMPLATE:-}" ] && [ -f "$PROJECT_NOTES_TEMPLATE" ]; then
    cp "$PROJECT_NOTES_TEMPLATE" "$template_path"
  elif [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/templates/project-template.md" ]; then
    cp "$CLAUDE_PLUGIN_ROOT/templates/project-template.md" "$template_path"
  else
    echo "ERROR: No template source found. Set PROJECT_NOTES_TEMPLATE or ensure plugin templates are accessible." >&2
    exit 1
  fi
  template_seeded="true"
fi

# ---------------------------------------------------------------------------
# Defaults for optional env overrides
# ---------------------------------------------------------------------------

# Use a temp var because ${VAR:-default} parameter expansion treats `}` in the
# default string as the closing delimiter, mangling patterns like `{YYYY}-{MM}`.
default_adhoc_pattern='Adhoc {YYYY}-{MM}.md'
adhoc_pattern="${PROJECT_NOTES_ADHOC_PATTERN:-$default_adhoc_pattern}"
title_case="${PROJECT_NOTES_TITLE_CASE:-1}"

# ---------------------------------------------------------------------------
# List existing project files (exclude _template.md, _archive/, _harvest/)
# ---------------------------------------------------------------------------

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

existing_files=()
# Use find to avoid glob no-match issues; restrict to top level (-maxdepth 1)
while IFS= read -r f; do
  base=$(basename "$f")
  case "$base" in
    _template.md) continue ;;
  esac
  existing_files+=("$f")
done < <(find "$PROJECT_NOTES_DIR" -maxdepth 1 -type f -name '*.md' 2>/dev/null | LC_ALL=C sort)

existing_json="[]"
if [ "${#existing_files[@]}" -gt 0 ]; then
  parts=()
  for f in "${existing_files[@]}"; do
    name=$(basename "$f" .md)
    parts+=("{\"name\":\"$(json_escape "$name")\",\"path\":\"$(json_escape "$f")\"}")
  done
  existing_json="[$(IFS=,; echo "${parts[*]}")]"
fi

# ---------------------------------------------------------------------------
# Today + weekday
# ---------------------------------------------------------------------------

today=$(date +%Y-%m-%d)
weekday=$(date +%a)

# ---------------------------------------------------------------------------
# Emit resolved config as JSON
# ---------------------------------------------------------------------------

cat <<EOF
{
  "project_name": "$(json_escape "$project_name")",
  "yes": $yes_flag,
  "adhoc": $adhoc_flag,
  "project_notes_dir": "$(json_escape "$PROJECT_NOTES_DIR")",
  "template_path": "$(json_escape "$template_path")",
  "template_seeded": $template_seeded,
  "adhoc_pattern": "$(json_escape "$adhoc_pattern")",
  "title_case": "$(json_escape "$title_case")",
  "existing_projects": $existing_json,
  "today": "$today",
  "weekday": "$weekday"
}
EOF
