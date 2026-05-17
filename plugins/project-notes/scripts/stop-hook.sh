#!/bin/bash
# project-notes Stop hook — gentle reminder to log this session.
#
# Fail-open by design: any missing precondition, missing tool, or unexpected
# error → silent exit 0. This hook must never block session exit and must
# never spam users who haven't set up project-notes.

# --- Master switch ---
if [[ "${PROJECT_NOTES_STOP_HOOK:-1}" == "0" ]]; then
  exit 0
fi

# --- Plugin must be set up (silent skip otherwise) ---
if [[ -z "${PROJECT_NOTES_DIR:-}" ]] || [[ ! -d "$PROJECT_NOTES_DIR" ]]; then
  exit 0
fi

# --- Need jq to parse stdin ---
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

HOOK_INPUT=$(cat 2>/dev/null || true)
if [[ -z "$HOOK_INPUT" ]]; then
  exit 0
fi

TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || true)
if [[ -z "$TRANSCRIPT_PATH" ]] || [[ ! -f "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

# --- Must be in a git repo ---
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [[ -z "$PROJECT_ROOT" ]]; then
  exit 0
fi

# --- Detect project name (mirrors commands/log.md detection steps 1-3) ---
BASENAME=$(basename "$PROJECT_ROOT")
TITLE_CASE="${PROJECT_NOTES_TITLE_CASE:-1}"

if [[ "$TITLE_CASE" == "1" ]]; then
  PROJECT_NAME=$(echo "$BASENAME" | awk 'BEGIN { RS="[-_]"; ORS=" " }
    { if (length($0) > 0) print toupper(substr($0,1,1)) tolower(substr($0,2)) }' \
    | sed 's/ *$//')
else
  PROJECT_NAME="$BASENAME"
fi

NOTES_FILE="$PROJECT_NOTES_DIR/${PROJECT_NAME}.md"
if [[ ! -f "$NOTES_FILE" ]]; then
  exit 0
fi

# --- Transcript line count gate ---
MIN_LINES="${PROJECT_NOTES_STOP_MIN_LINES:-30}"
LINE_COUNT=$(wc -l < "$TRANSCRIPT_PATH" 2>/dev/null | tr -d ' ' || echo "0")
if [[ ! "$LINE_COUNT" =~ ^[0-9]+$ ]] || [[ "$LINE_COUNT" -lt "$MIN_LINES" ]]; then
  exit 0
fi

# --- Edit signal gate (≥1 mutating tool call) ---
EDIT_COUNT=$(grep -cE '"name":"(Edit|Write|NotebookEdit|MultiEdit)"' "$TRANSCRIPT_PATH" 2>/dev/null || echo "0")
if [[ ! "$EDIT_COUNT" =~ ^[0-9]+$ ]] || [[ "$EDIT_COUNT" -lt 1 ]]; then
  exit 0
fi

# --- Per-project cooldown ---
COOLDOWN_MIN="${PROJECT_NOTES_STOP_COOLDOWN_MIN:-240}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/project-notes"
mkdir -p "$CACHE_DIR" 2>/dev/null || exit 0

SLUG=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')
if [[ -z "$SLUG" ]]; then
  SLUG="project"
fi
COOLDOWN_FILE="$CACHE_DIR/${SLUG}.reminder"

if [[ -f "$COOLDOWN_FILE" ]] && find "$COOLDOWN_FILE" -mmin -"$COOLDOWN_MIN" 2>/dev/null | grep -q .; then
  exit 0
fi

# --- All gates passed: fire reminder + record timestamp ---
touch "$COOLDOWN_FILE" 2>/dev/null || true
echo "💡 [project-notes] 這次 session 有踩雷 / 反直覺發現嗎？  /project-notes:log"
exit 0
