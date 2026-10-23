#!/usr/bin/env bash
# Deterministic prep for a structured result review: compute the diff strategy, create the
# run directory (manifest.json + diff.patch) and print one JSON object on stdout.
# Exit codes: 0 ok, 1 usage error or jq missing, 2 environment problem (not a git repo,
# detached HEAD under --auto-detect, empty diff).
# A branch strategy (<base>...HEAD) diffs the merge base against the WORKING TREE, so a fix
# loop's uncommitted edits are reviewed; the manifest records that merge base as diff_base.
set -euo pipefail

usage() {
  cat <<'EOF2'
Usage: setup-result-review.sh --working-dir <abs> (--base <branch> | --auto-detect)
       setup-result-review.sh --normalize <path>

Prints {run_id, run_dir, diff_strategy, files, file_count, line_count, size_class}.
For <base>...HEAD the diff runs from merge-base(<base>, HEAD) to the working tree (staged and
unstaged edits included); manifest.json adds diff_base, the merge-base sha.
Writes <run_dir>/manifest.json and <run_dir>/diff.patch, where run_dir is
<working-dir>/openspec/reviews/runs/<run_id> if openspec/ exists, otherwise
<working-dir>/.claude/reviewer/runs/<run_id>. The runs root gets a .gitignore ("*").
EOF2
}

# Path normalization contract (mirrors mcp/schema.cjs normalizePath, same order):
# collapse '/', {a => b} -> b, collapse '/', whole-path 'a => b' -> b,
# strip leading './' repeatedly, strip trailing '/', strip one leading '/'.
normalize_path() {
  printf '%s\n' "$1" | sed -E \
    -e 's#/+#/#g' \
    -e 's#\{[^{}]*=> ?([^{}]*)\}#\1#g' \
    -e 's#/+#/#g' \
    -e 's#^.* => ##' \
    -e ':a' -e 's#^\./##' -e 'ta' \
    -e 's#/$##' \
    -e 's#^/##'
}

die2() { echo "setup-result-review: $*" >&2; exit 2; }

WD="" BASE="" AUTO=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --working-dir) WD="${2:-}"; shift 2 ;;
    --base)        BASE="${2:-}"; shift 2 ;;
    --auto-detect) AUTO=1; shift ;;
    --normalize)   [[ $# -ge 2 ]] || { echo "setup-result-review: --normalize needs a path" >&2; exit 1; }
                   normalize_path "$2"; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "setup-result-review: unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

[[ -n "$WD" ]] || { echo "setup-result-review: --working-dir is required" >&2; exit 1; }
if [[ -n "$BASE" && "$AUTO" == 1 ]] || [[ -z "$BASE" && "$AUTO" == 0 ]]; then
  echo "setup-result-review: exactly one of --base or --auto-detect is required" >&2; exit 1
fi
command -v jq >/dev/null 2>&1 || { echo "setup-result-review: jq is required but not installed" >&2; exit 1; }

[[ -d "$WD" ]] || die2 "working directory does not exist: $WD"
# User config must not change the patch shape: merge-findings.cjs reads `+++ b/<path>` headers.
g() { git -C "$WD" -c core.quotePath=false -c diff.noprefix=false -c diff.mnemonicPrefix=false "$@"; }
gd() { g diff --no-ext-diff --no-color "$@"; }
g rev-parse --git-dir >/dev/null 2>&1 || die2 "not a git repository: $WD"
TOP="$(g rev-parse --show-toplevel)"

# Strategy: WORKTREE, or <base>...HEAD (display string; the diff itself runs from the merge base).
BASE_REF=""
if [[ -n "$BASE" ]]; then
  BASE_REF="$BASE"
else
  BRANCH="$(g symbolic-ref --short -q HEAD || true)"
  [[ -n "$BRANCH" ]] || die2 "detached HEAD: cannot auto-detect a diff strategy (use --base)"
  case "$BRANCH" in
    main|develop) STRATEGY="WORKTREE" ;;
    *) if g rev-parse --verify -q develop >/dev/null 2>&1; then BASE_REF="develop"; else BASE_REF="main"; fi ;;
  esac
fi
DIFF_BASE=""
if [[ -n "$BASE_REF" ]]; then
  STRATEGY="$BASE_REF...HEAD"
  DIFF_BASE="$(g merge-base "$BASE_REF" HEAD 2>/dev/null)" || die2 "no merge base between $BASE_REF and HEAD"
fi

sorted_lines() { LC_ALL=C sort -u; }
norm_lines() { local l; while IFS= read -r l; do [[ -n "$l" ]] && normalize_path "$l"; done; return 0; }

STAGED_ONLY="" UNSTAGED_ONLY=""
if [[ "$STRATEGY" == "WORKTREE" ]]; then
  UNSTAGED="$(gd --name-only | norm_lines | sorted_lines)"
  STAGED="$(gd --cached --name-only | norm_lines | sorted_lines)"
  FILES="$(printf '%s\n%s\n' "$UNSTAGED" "$STAGED" | grep -v '^$' | sorted_lines || true)"
  STAGED_ONLY="$(LC_ALL=C comm -23 <(printf '%s\n' "$STAGED") <(printf '%s\n' "$UNSTAGED") | grep -v '^$' || true)"
  UNSTAGED_ONLY="$(LC_ALL=C comm -13 <(printf '%s\n' "$STAGED") <(printf '%s\n' "$UNSTAGED") | grep -v '^$' || true)"
  PATCH="$(gd; gd --cached)"
  STAT="$(gd --shortstat; gd --cached --shortstat)"
else
  # Two-dot from the merge base to the working tree: committed + staged + unstaged changes.
  FILES="$(gd --name-only "$DIFF_BASE" | norm_lines | sorted_lines)"
  PATCH="$(gd "$DIFF_BASE")"
  STAT="$(gd --shortstat "$DIFF_BASE")"
fi
[[ -n "$FILES" ]] || die2 "empty diff for $STRATEGY: nothing to review"
[[ -n "$PATCH" ]] || die2 "empty diff for $STRATEGY: git listed changed files but produced no patch"

INS="$({ grep -oE '[0-9]+ insertion' <<<"$STAT" || true; } | awk '{s+=$1} END{print s+0}')"
DEL="$({ grep -oE '[0-9]+ deletion' <<<"$STAT" || true; } | awk '{s+=$1} END{print s+0}')"

# --- Submodules: a changed gitlink is replaced by that sub-repository's own diff, paths prefixed
# "<sub>/" and patch headers written by git (--src-prefix/--dst-prefix), so merge-findings.cjs reads
# them unchanged. One level only. Range: merge-base(<base>, HEAD) of the sub when it has that branch,
# else the pointer the superproject recorded at the diff base (HEAD under WORKTREE); a submodule
# added in this change diffs from the empty tree. Always two-dot to the sub's working tree.
EMPTY_TREE="4b825dc642cb6eb9a060e54bf8d69288fbee4904"
SUBS_JSON="[]"
PTR_TREE="HEAD"; [[ -n "$DIFF_BASE" ]] && PTR_TREE="$DIFF_BASE"
EXPANDED=""
while IFS= read -r p; do
  [[ -n "$p" ]] || continue
  mode="$(g ls-files -s -- "$p" 2>/dev/null | awk 'NR==1{print $1}')"
  if [[ "$mode" != "160000" ]]; then EXPANDED+="$p"$'\n'; continue; fi
  if [[ ! -e "$TOP/$p/.git" ]]; then echo "setup-result-review: submodule $p: not checked out, skipped" >&2; continue; fi
  gs() { git -C "$TOP/$p" -c core.quotePath=false -c diff.noprefix=false -c diff.mnemonicPrefix=false "$@"; }
  gsd() { gs diff --no-ext-diff --no-color "$@"; }
  old_ptr="$(g rev-parse -q --verify "$PTR_TREE:$p" 2>/dev/null || true)"
  new_ptr="$(gs rev-parse HEAD 2>/dev/null || true)"
  if [[ -n "$old_ptr" && "$old_ptr" == "$new_ptr" ]]; then
    # pointer unchanged: the superproject lists it only because the sub's worktree is dirty
    if [[ -n "$(gs status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
      echo "setup-result-review: submodule $p: pointer unchanged, dirty worktree ignored" >&2
    fi
    continue
  fi
  if [[ -z "$old_ptr" ]]; then
    sub_base="$EMPTY_TREE"; sub_strategy="empty-tree"
  elif [[ -n "$BASE_REF" ]] && { gs rev-parse --verify -q "$BASE_REF" >/dev/null 2>&1 || gs rev-parse --verify -q "origin/$BASE_REF" >/dev/null 2>&1; }; then
    # the sub may carry the base only as a remote-tracking branch (a fresh submodule clone)
    sub_ref="$BASE_REF"; gs rev-parse --verify -q "$BASE_REF" >/dev/null 2>&1 || sub_ref="origin/$BASE_REF"
    sub_base="$(gs merge-base "$sub_ref" HEAD 2>/dev/null || true)"; sub_strategy="merge-base($BASE_REF,HEAD)"
    [[ -n "$sub_base" ]] || { sub_base="$old_ptr"; sub_strategy="recorded-pointer"; }
  else
    sub_base="$old_ptr"; sub_strategy="recorded-pointer"
  fi
  if [[ -n "$(gs submodule status 2>/dev/null)" ]]; then echo "setup-result-review: submodule $p: nested submodules not expanded" >&2; fi
  # prefix as data, never inside a sed/awk program: the path is attacker-controlled repo content
  sub_files="$(gsd --name-only "$sub_base" | norm_lines | while IFS= read -r l; do printf '%s/%s\n' "$p" "$l"; done)"
  [[ -n "$sub_files" ]] && EXPANDED+="$sub_files"$'\n'
  PATCH+=$'\n'"$(gsd --src-prefix="a/$p/" --dst-prefix="b/$p/" "$sub_base")"
  sub_stat="$(gsd --shortstat "$sub_base")"
  INS=$((INS + $({ grep -oE '[0-9]+ insertion' <<<"$sub_stat" || true; } | awk '{s+=$1} END{print s+0}')))
  DEL=$((DEL + $({ grep -oE '[0-9]+ deletion' <<<"$sub_stat" || true; } | awk '{s+=$1} END{print s+0}')))
  SUBS_JSON="$(jq -c --arg path "$p" --arg base "$sub_base" --arg st "$sub_strategy" '. + [{path:$path, base:$base, strategy:$st}]' <<<"$SUBS_JSON")"
done <<<"$FILES"
FILES="$(printf '%s' "$EXPANDED" | grep -v '^$' | sorted_lines || true)"
[[ -n "$FILES" ]] || die2 "empty diff for $STRATEGY: only unchanged submodule pointers"

FILE_COUNT="$(grep -c '' <<<"$FILES")"
LINE_COUNT=$((INS + DEL))
SIZE="small"
if (( FILE_COUNT >= 20 || LINE_COUNT >= 500 )); then SIZE="large"; fi

if [[ -d "$TOP/openspec" ]]; then ROOT="$TOP/openspec/reviews/runs"; else ROOT="$TOP/.claude/reviewer/runs"; fi
mkdir -p "$ROOT"
[[ -f "$ROOT/.gitignore" ]] || printf '*\n' >"$ROOT/.gitignore"

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(od -An -N2 -tx1 /dev/urandom | tr -d ' \n')"
RUN_DIR="$ROOT/$RUN_ID"
mkdir -p "$RUN_DIR"
printf '%s\n' "$PATCH" >"$RUN_DIR/diff.patch"

lines_json() { printf '%s\n' "$1" | jq -R -s 'split("\n") | map(select(length>0))'; }
FILES_JSON="$(lines_json "$FILES")"

BASEOBJ="$(jq -n --arg run_id "$RUN_ID" --arg run_dir "$RUN_DIR" --arg s "$STRATEGY" \
  --argjson files "$FILES_JSON" --argjson fc "$FILE_COUNT" --argjson lc "$LINE_COUNT" \
  '{run_id:$run_id, run_dir:$run_dir, diff_strategy:$s, files:$files, file_count:$fc, line_count:$lc}')"

jq --arg created "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg wd "$TOP" \
   --argjson so "$(lines_json "$STAGED_ONLY")" --argjson uo "$(lines_json "$UNSTAGED_ONLY")" \
   --arg db "$DIFF_BASE" --argjson subs "$SUBS_JSON" \
   '. + {created:$created, working_directory:$wd, staged_only:$so, unstaged_only:$uo, submodules:$subs}
    + (if $db == "" then {} else {diff_base:$db} end)' \
   <<<"$BASEOBJ" >"$RUN_DIR/manifest.json"

jq -c --arg size "$SIZE" '. + {size_class:$size}' <<<"$BASEOBJ"
