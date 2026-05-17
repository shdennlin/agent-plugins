#!/bin/bash
# Weekly Digest Setup Script
# Parses arguments, resolves project list and output destination, validates writability.
# Outputs resolved config as JSON to stdout for the orchestrating Claude to consume.
#
# Called from plugins/digest/commands/weekly.md as:
#   "${CLAUDE_PLUGIN_ROOT}/scripts/setup-weekly.sh" $ARGUMENTS

set -euo pipefail

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

show_help() {
  cat <<'EOF'
Usage: /digest:weekly [date-range] [options]

Scan git activity across multiple projects and synthesize a themed recall report.

Positional arguments:
  date-range            Time window. Natural language accepted:
                          7                          (past 7 days, default)
                          14                         (past 14 days)
                          last week / this week
                          since friday
                          2026-05-10..2026-05-17
                          may                        (May of current year)

Options:
  --projects <list>     Markdown bullet list of project paths (multi-line).
                        Overrides config file.
  --config <path>       Custom config file (default: ~/.claude/digest-projects.json)
  --author <email>      Filter by author email. Default: your git email. 'all' for everyone.
  --brief               Short summary only, no per-project breakdown
  --detail              Include full chronological commit list
  --write               Save to $WEEKLY_DIGEST_DIR (or ./Weekly/ if unset)
  --out <file>          Save to custom file path
  -h, --help            Show this help message

Environment variables:
  WEEKLY_DIGEST_DIR            Output directory for --write. If unset, falls back to ./Weekly/

Project list resolution order:
  1. --projects bullet list (inline)
  2. --config <path>
  3. ~/.claude/digest-projects.json
  4. Error: no projects specified

Examples:
  /digest:weekly                              # past 7 days, projects from config
  /digest:weekly 14                           # past 14 days
  /digest:weekly last week                    # previous Mon-Sun
  /digest:weekly 2026-05-10..2026-05-17       # explicit range
  /digest:weekly may --brief                  # whole month, short summary
  /digest:weekly 7 --projects
  - /Users/me/project-a
  - /Users/me/project-b                       # inline project list
  /digest:weekly 7 --write                    # past week, save to $WEEKLY_DIGEST_DIR
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

# Defaults
date_range=""
projects_inline=()
config_path=""
author=""
brief="false"
detail="false"
write="false"
out_path=""

# Handle --help / -h up front
for arg in "$@"; do
  case "$arg" in
    -h|--help) show_help; exit 0 ;;
  esac
done

# State-machine parser:
#   positional → accumulate into date_range
#   projects   → accumulate into projects_inline (skip `-` and `*` bullet markers)
#   config     → next token is config_path
#   author     → next token is author
#   out        → next token is out_path
mode="positional"

while [ $# -gt 0 ]; do
  token="$1"
  case "$token" in
    --projects)  mode="projects"; shift; continue ;;
    --config)    mode="config";   shift; continue ;;
    --author)    mode="author";   shift; continue ;;
    --out)       mode="out";      shift; continue ;;
    --brief)     brief="true";  mode="positional"; shift; continue ;;
    --detail)    detail="true"; mode="positional"; shift; continue ;;
    --write)     write="true";  mode="positional"; shift; continue ;;
    --*)
      echo "ERROR: Unknown flag: $token" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac

  case "$mode" in
    positional)
      date_range="${date_range:+$date_range }$token"
      ;;
    projects)
      # Skip bullet markers; otherwise treat as path
      if [ "$token" != "-" ] && [ "$token" != "*" ]; then
        projects_inline+=("$token")
      fi
      ;;
    config)
      config_path="$token"
      mode="positional"
      ;;
    author)
      author="$token"
      mode="positional"
      ;;
    out)
      out_path="$token"
      mode="positional"
      ;;
  esac
  shift
done

# Apply defaults
date_range="${date_range:-7 days}"
if [ -z "$author" ]; then
  author=$(git config user.email 2>/dev/null || true)
fi
[ -z "$author" ] && author="all"

# ---------------------------------------------------------------------------
# Resolve project list
# ---------------------------------------------------------------------------

expand_tilde() {
  local p="$1"
  printf '%s' "${p/#\~/$HOME}"
}

json_escape() {
  # Escape backslashes and double quotes for JSON string literals
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

projects_json=""

if [ ${#projects_inline[@]} -gt 0 ]; then
  parts=()
  for p in "${projects_inline[@]}"; do
    p_expanded=$(expand_tilde "$p")
    name=$(basename "$p_expanded")
    parts+=("{\"path\":\"$(json_escape "$p_expanded")\",\"name\":\"$(json_escape "$name")\"}")
  done
  projects_json="[$(IFS=,; echo "${parts[*]}")]"
else
  config_file="${config_path:-$HOME/.claude/digest-projects.json}"
  if [ -f "$config_file" ]; then
    if ! command -v jq >/dev/null 2>&1; then
      echo "ERROR: jq is required to parse $config_file. Install with: brew install jq" >&2
      exit 1
    fi
    if ! projects_json=$(jq -c '.projects' "$config_file" 2>/dev/null); then
      echo "ERROR: Failed to parse $config_file as JSON" >&2
      exit 1
    fi
    if [ "$projects_json" = "null" ] || [ -z "$projects_json" ]; then
      echo "ERROR: $config_file is missing a '.projects' array" >&2
      exit 1
    fi
  else
    cat >&2 <<EOF
ERROR: No projects specified.

Either pass --projects with a markdown list:

  /digest:weekly 7 --projects
  - /path/to/repo-a
  - /path/to/repo-b

Or create ~/.claude/digest-projects.json:

  {
    "projects": [
      { "path": "/path/to/repo-a", "name": "repo-a" },
      { "path": "/path/to/repo-b" }
    ]
  }
EOF
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Resolve output destination (fail fast if --write or --out)
# ---------------------------------------------------------------------------

target_dir=""
if [ "$write" = "true" ] || [ -n "$out_path" ]; then
  if [ -n "$out_path" ]; then
    out_path=$(expand_tilde "$out_path")
    target_dir=$(dirname "$out_path")
  elif [ -n "${WEEKLY_DIGEST_DIR:-}" ]; then
    target_dir=$(expand_tilde "$WEEKLY_DIGEST_DIR")
  else
    target_dir="./Weekly"
  fi

  if ! mkdir -p "$target_dir" 2>/dev/null; then
    echo "ERROR: Cannot create directory: $target_dir" >&2
    exit 1
  fi

  if [ ! -w "$target_dir" ]; then
    echo "ERROR: Directory not writable: $target_dir" >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Emit resolved config as JSON
# ---------------------------------------------------------------------------

cat <<EOF
{
  "date_range": "$(json_escape "$date_range")",
  "projects": $projects_json,
  "author": "$(json_escape "$author")",
  "brief": $brief,
  "detail": $detail,
  "write": $write,
  "out_path": "$(json_escape "$out_path")",
  "target_dir": "$(json_escape "$target_dir")"
}
EOF
