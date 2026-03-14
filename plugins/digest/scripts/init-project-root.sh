#!/bin/bash
set -euo pipefail

# Detect the git project root and export it as PROJECT_ROOT
# so digest commands/agents can run git commands from the correct directory.

if [ -z "${CLAUDE_ENV_FILE:-}" ]; then
  exit 0
fi

project_root=$(git rev-parse --show-toplevel 2>/dev/null || echo "")

if [ -n "$project_root" ]; then
  echo "export PROJECT_ROOT=\"$project_root\"" >> "$CLAUDE_ENV_FILE"
  echo "cd \"$project_root\"" >> "$CLAUDE_ENV_FILE"
  echo "Digest plugin: project root set to $project_root"
else
  echo "Digest plugin: not in a git repository, skipping project root detection" >&2
fi
