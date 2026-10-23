#!/usr/bin/env bash
# Deterministic prep for /reviewer:spec: resolve the spec files under the given paths, create a
# run directory (manifest.json, no diff.patch) and print one JSON object on stdout.
#
# Exit codes: 0 ok, 1 usage error or jq missing, 2 environment problem (not a git repo, a path
# that does not exist, runs directory unusable).
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: setup-spec-review.sh --working-dir <abs> <path>...

Each <path> (relative to the working directory or absolute) is a spec file or a directory;
a directory contributes every .md file under it, recursively. The manifest lists the files
relative to the repository root, sorted, without duplicates.

Writes <run_dir>/manifest.json where run_dir is
<working-dir>/openspec/reviews/runs/<run_id> if openspec/ exists, otherwise
<working-dir>/.claude/reviewer/runs/<run_id>. The runs root gets a .gitignore ("*").

Output (stdout, one line): {"run_id","run_dir","mode":"spec","files":[...],"file_count"}
USAGE
}
die2() { echo "setup-spec-review: $*" >&2; exit 2; }

WD=""; PATHS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --working-dir) WD="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    --*) echo "setup-spec-review: unknown argument: $1" >&2; usage >&2; exit 1 ;;
    *) PATHS+=("$1"); shift ;;
  esac
done
[[ -n "$WD" ]] || { echo "setup-spec-review: --working-dir is required" >&2; exit 1; }
[[ ${#PATHS[@]} -gt 0 ]] || { echo "setup-spec-review: at least one spec path is required" >&2; usage >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "setup-spec-review: jq is required but not installed" >&2; exit 1; }
[[ -d "$WD" ]] || die2 "working directory does not exist: $WD"
git -C "$WD" rev-parse --git-dir >/dev/null 2>&1 || die2 "not a git repository: $WD"
TOP="$(git -C "$WD" rev-parse --show-toplevel)"
REAL_TOP="$(cd "$TOP" && pwd -P)"

# Resolve every path to repo-relative spec files.
FILES=""
for p in "${PATHS[@]}"; do
  if [[ "$p" == /* ]]; then abs="$p"; else abs="$WD/$p"; fi
  [[ -e "$abs" ]] || die2 "spec path does not exist: $p"
  real="$(cd "$(dirname "$abs")" && pwd -P)/$(basename "$abs")"
  [[ "$real" == "$REAL_TOP/"* ]] || die2 "spec path is outside the repository: $p"
  if [[ -d "$abs" ]]; then
    found="$(find "$real" -type f -name '*.md' | sed "s|^$REAL_TOP/||")"
    [[ -n "$found" ]] || die2 "no .md files under: $p"
    FILES+="$found"$'\n'
  else
    FILES+="${real#"$REAL_TOP/"}"$'\n'
  fi
done
FILES="$(printf '%s' "$FILES" | LC_ALL=C sort -u)"
FILE_COUNT="$(printf '%s\n' "$FILES" | grep -c . || true)"

if [[ -d "$TOP/openspec" ]]; then ROOT="$TOP/openspec/reviews/runs"; else ROOT="$TOP/.claude/reviewer/runs"; fi
mkdir -p "$ROOT"
REAL_ROOT="$(cd "$ROOT" 2>/dev/null && pwd -P)" || die2 "cannot enter the runs directory $ROOT"
[[ "$REAL_ROOT" == "$REAL_TOP/"* ]] || die2 "runs directory resolves outside the repository ($ROOT -> $REAL_ROOT)"
[[ -L "$ROOT" ]] && die2 "runs directory resolves outside the repository: $ROOT is a symlink"
# Retention: same rule as setup-result-review.sh — keep the newest KEEP_RUNS run directories.
KEEP_RUNS="${REVIEWER_KEEP_RUNS:-10}"
[[ "$KEEP_RUNS" =~ ^[0-9]+$ ]] || KEEP_RUNS=10
find -P "$REAL_ROOT" -mindepth 1 -maxdepth 1 -type d -name '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z-*' \
  | LC_ALL=C sort | awk -v k="$KEEP_RUNS" '{a[NR]=$0} END{for(i=1;i<=NR-k;i++) print a[i]}' \
  | while IFS= read -r old; do [[ "$old" == "$REAL_ROOT/"* && ! -L "$old" ]] && rm -rf "$old"; done
[[ -f "$ROOT/.gitignore" ]] || printf '*\n' >"$ROOT/.gitignore"

RUN_DIR="$(mktemp -d "$ROOT/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")" || die2 "cannot create a run directory under $ROOT"
RUN_ID="$(basename "$RUN_DIR")"

lines_json() { printf '%s\n' "$1" | jq -R -s 'split("\n") | map(select(length>0))'; }
FILES_JSON="$(lines_json "$FILES")"
SPEC_PATHS_JSON="$(printf '%s\n' "${PATHS[@]}" | jq -R -s 'split("\n") | map(select(length>0))')"

BASEOBJ="$(jq -n --arg run_id "$RUN_ID" --arg run_dir "$RUN_DIR" --argjson files "$FILES_JSON" --argjson fc "$FILE_COUNT" \
  '{run_id:$run_id, run_dir:$run_dir, mode:"spec", files:$files, file_count:$fc}')"
jq --arg created "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg wd "$TOP" --argjson sp "$SPEC_PATHS_JSON" \
   '. + {created:$created, working_directory:$wd, spec_paths:$sp}' <<<"$BASEOBJ" >"$RUN_DIR/manifest.json"
jq -c . <<<"$BASEOBJ"
