#!/usr/bin/env bash
# Append review findings (JSON array on stdin) to the project's review history JSONL.
# Deterministic persistence for the findings->rules harvest loop (reviewer:init --from-history).
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: echo '<findings JSON array>' | log-findings.sh --change <name> --source <spec|result|spec-dual> [--round <N>]

Each array element may contain: severity, title, location, category, engine (strings).
Target file: <git-root>/openspec/reviews/history.jsonl if openspec/ exists,
otherwise <git-root>/.claude/reviewer/history.jsonl.
EOF
}

CHANGE="" SOURCE="" ROUND=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --change) CHANGE="${2:-}"; shift 2 ;;
    --source) SOURCE="${2:-}"; shift 2 ;;
    --round)  ROUND="${2:-}";  shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "log-findings: unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

[[ -n "$CHANGE" && -n "$SOURCE" ]] || { echo "log-findings: --change and --source are required" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "log-findings: jq is required but not installed" >&2; exit 1; }

INPUT="$(cat)"
[[ -n "$INPUT" ]] || { echo "log-findings: empty stdin, nothing to log" >&2; exit 1; }
jq -e 'type=="array"' <<<"$INPUT" >/dev/null 2>&1 || { echo "log-findings: stdin is not a JSON array" >&2; exit 1; }
COUNT="$(jq 'length' <<<"$INPUT")"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
if [[ -d "$ROOT/openspec" ]]; then
  OUT="$ROOT/openspec/reviews/history.jsonl"
else
  OUT="$ROOT/.claude/reviewer/history.jsonl"
fi
mkdir -p "$(dirname "$OUT")"

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
jq -c --arg ts "$TS" --arg change "$CHANGE" --arg source "$SOURCE" --arg round "$ROUND" '
  .[] | {
    ts: $ts, change: $change, source: $source, round: $round,
    severity: (.severity // ""), title: (.title // ""),
    location: (.location // ""), category: (.category // ""),
    engine: (.engine // "")
  }' <<<"$INPUT" >>"$OUT"

echo "logged $COUNT finding(s) to ${OUT#"$ROOT"/}"
