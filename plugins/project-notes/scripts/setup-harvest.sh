#!/bin/bash
# Project Notes Harvest Setup Script
# Parses arguments, validates $PROJECT_NOTES_DIR, resolves --since duration to a
# cutoff date, lists source markdown files, prepares _harvest/ if --draft.
# Outputs resolved config as JSON to stdout.
#
# Called from plugins/project-notes/commands/harvest.md as:
#   "${CLAUDE_PLUGIN_ROOT}/scripts/setup-harvest.sh" $ARGUMENTS

set -euo pipefail

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

show_help() {
  cat <<'EOF'
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
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

since="7d"
theme=""
draft="false"

for arg in "$@"; do
  case "$arg" in
    -h|--help) show_help; exit 0 ;;
  esac
done

mode="positional"
while [ $# -gt 0 ]; do
  token="$1"
  case "$token" in
    --since)    mode="since";  shift; continue ;;
    --theme)    mode="theme";  shift; continue ;;
    --draft)    draft="true"; mode="positional"; shift; continue ;;
    --*|-*)
      echo "ERROR: Unknown flag: $token" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac

  case "$mode" in
    since) since="$token"; mode="positional" ;;
    theme) theme="$token"; mode="positional" ;;
    positional)
      echo "ERROR: Unexpected positional argument: $token" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# Validate environment
# ---------------------------------------------------------------------------

if [ -z "${PROJECT_NOTES_DIR:-}" ]; then
  cat >&2 <<'EOF'
ERROR: PROJECT_NOTES_DIR not set.

Add to your shell rc (~/.zshrc, ~/.bashrc):
  export PROJECT_NOTES_DIR="$HOME/Documents/project-notes"
EOF
  exit 1
fi

if [ ! -d "$PROJECT_NOTES_DIR" ]; then
  echo "ERROR: PROJECT_NOTES_DIR does not exist: $PROJECT_NOTES_DIR" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Resolve --since to cutoff date
# ---------------------------------------------------------------------------

today=$(date +%Y-%m-%d)
cutoff_date=""

case "$since" in
  all)
    cutoff_date="1970-01-01"
    ;;
  *d)
    days="${since%d}"
    if ! [[ "$days" =~ ^[0-9]+$ ]]; then
      echo "ERROR: Invalid --since duration: $since (expected Nd, Nm, or 'all')" >&2
      exit 1
    fi
    cutoff_date=$(date -v "-${days}d" +%Y-%m-%d 2>/dev/null || date -d "${days} days ago" +%Y-%m-%d)
    ;;
  *m)
    months="${since%m}"
    if ! [[ "$months" =~ ^[0-9]+$ ]]; then
      echo "ERROR: Invalid --since duration: $since (expected Nd, Nm, or 'all')" >&2
      exit 1
    fi
    days=$((months * 30))
    cutoff_date=$(date -v "-${days}d" +%Y-%m-%d 2>/dev/null || date -d "${days} days ago" +%Y-%m-%d)
    ;;
  *)
    echo "ERROR: Invalid --since: $since. Use Nd (e.g. 7d), Nm (e.g. 1m), or 'all'." >&2
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# Collect source markdown files (top-level only; exclude _template.md and dotfiles)
# ---------------------------------------------------------------------------

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

source_files=()
while IFS= read -r f; do
  base=$(basename "$f")
  case "$base" in
    _template.md) continue ;;
  esac
  source_files+=("$f")
done < <(find "$PROJECT_NOTES_DIR" -maxdepth 1 -type f -name '*.md' 2>/dev/null | LC_ALL=C sort)

source_files_json="[]"
if [ "${#source_files[@]}" -gt 0 ]; then
  parts=()
  for f in "${source_files[@]}"; do
    parts+=("\"$(json_escape "$f")\"")
  done
  source_files_json="[$(IFS=,; echo "${parts[*]}")]"
fi

# ---------------------------------------------------------------------------
# Prepare _harvest/ if --draft
# ---------------------------------------------------------------------------

harvest_dir="$PROJECT_NOTES_DIR/_harvest"
if [ "$draft" = "true" ]; then
  if ! mkdir -p "$harvest_dir" 2>/dev/null; then
    echo "ERROR: Cannot create directory: $harvest_dir" >&2
    exit 1
  fi
  if [ ! -w "$harvest_dir" ]; then
    echo "ERROR: Directory not writable: $harvest_dir" >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Emit resolved config as JSON
# ---------------------------------------------------------------------------

cat <<EOF
{
  "since": "$(json_escape "$since")",
  "cutoff_date": "$cutoff_date",
  "theme": "$(json_escape "$theme")",
  "draft": $draft,
  "project_notes_dir": "$(json_escape "$PROJECT_NOTES_DIR")",
  "source_files": $source_files_json,
  "harvest_dir": "$(json_escape "$harvest_dir")",
  "today": "$today"
}
EOF
