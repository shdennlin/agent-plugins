#!/bin/bash
# Explainer Checker
# Checks a generated HTML explainer against the template's rules (hard constraints, the avoid list,
# the content floor) and prints one JSON object. Exit 0 when clean, 1 when there are violations,
# 2 for a usage error, 3 when python3 is missing.
#
# Called by whoever writes an explainer, right after writing it, as:
#   "${CLAUDE_PLUGIN_ROOT}/scripts/check-explainer.sh" <file.html> --numstat <changed.tsv> --ref <target>   # a change
#   "${CLAUDE_PLUGIN_ROOT}/scripts/check-explainer.sh" <file.html> --kind state              # a state question
#
# --numstat takes `git diff --numstat` format: added <TAB> removed <TAB> path, one changed file per line.
# The parsing lives in check_explainer.py (python3, standard library only); this script is the interface.

set -euo pipefail

show_help() {
  cat <<'EOF'
Usage: check-explainer.sh <file.html> [--kind change|state] [--numstat <file>] [--ref <ref>]

Check a generated HTML explainer and print a JSON report:
  {"ok": bool, "kind": "...", "violations": [{"id", "group", "count", "message"}], "info": {...}}

Arguments:
  <file.html>           The explainer to check
  --kind change|state   change (default): a pull request, branch or current branch; needs --numstat
                        state: a file, symbol or question
  --numstat <file>      The changed files in `git diff --numstat` format (change only)
  --ref <ref>           The branch the page explains (HEAD for the current branch, refs/pull/N/head for a PR).
                        file:line anchors and commit hashes are checked against it, not the working tree, so a
                        branch that is not checked out is judged fairly. If the ref is not available locally
                        those checks are skipped with a warning.
  -h, --help            Show this help message

Exit codes: 0 clean, 1 violations found, 2 usage error, 3 python3 not installed.
EOF
}

die() { echo "ERROR: $*" >&2; exit 2; }

file=""
kind="change"
numstat=""
ref=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help) show_help; exit 0 ;;
    --kind)
      [ "$#" -ge 2 ] || die "--kind needs a value (change or state)"
      kind="$2"; shift 2 ;;
    --numstat)
      [ "$#" -ge 2 ] || die "--numstat needs a file"
      numstat="$2"; shift 2 ;;
    --ref)
      [ "$#" -ge 2 ] || die "--ref needs a branch, tag or commit"
      ref="$2"; shift 2 ;;
    -*) die "unknown option: $1" ;;
    *)
      [ -z "$file" ] || die "only one file can be checked at a time"
      file="$1"; shift ;;
  esac
done

[ -n "$file" ] || die "no file given (see --help)"
[ -f "$file" ] || die "file not found: $file"
case "$kind" in change|state) ;; *) die "--kind must be change or state, not '$kind'" ;; esac
if [ "$kind" = "change" ]; then
  [ -n "$numstat" ] || die "a change explainer needs --numstat <file> (git diff --numstat format)"
  [ -f "$numstat" ] || die "numstat file not found: $numstat"
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required to check an explainer. Install it (for example: brew install python), or skip the check and say so in the report." >&2
  exit 3
fi

exec python3 -I "${BASH_SOURCE[0]%/*}/check_explainer.py" "$file" "$kind" "$numstat" "$ref"
