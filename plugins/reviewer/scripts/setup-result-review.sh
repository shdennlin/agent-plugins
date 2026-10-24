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
gd() { g diff --no-ext-diff --no-color --ignore-submodules=none "$@"; }
g rev-parse --git-dir >/dev/null 2>&1 || die2 "not a git repository: $WD"
TOP="$(g rev-parse --show-toplevel)"

# Strategy: WORKTREE, or <base>...HEAD (display string; the diff itself runs from the merge base).
# A base name resolves to the local branch, else to origin/<name>. Auto-detect order: the branch
# origin/HEAD points at, then develop, main, master; on that branch itself the strategy is WORKTREE.
resolve_ref() {
  if g rev-parse --verify -q "$1" >/dev/null 2>&1; then echo "$1"
  elif g rev-parse --verify -q "origin/$1" >/dev/null 2>&1; then echo "origin/$1"
  else return 1; fi
}
default_base() {
  local head cand
  head="$(g symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null | sed 's|^refs/remotes/origin/||' || true)"
  for cand in $head develop main master; do
    [[ -n "$cand" ]] || continue
    if resolve_ref "$cand" >/dev/null; then echo "$cand"; return 0; fi
  done
  return 1
}
BASE_NAME="" BASE_REF=""
if [[ -n "$BASE" ]]; then
  BASE_NAME="$BASE"
  BASE_REF="$(resolve_ref "$BASE")" || die2 "base ref '$BASE' does not exist"
else
  BRANCH="$(g symbolic-ref --short -q HEAD || true)"
  [[ -n "$BRANCH" ]] || die2 "detached HEAD: cannot auto-detect a diff strategy (use --base)"
  BASE_NAME="$(default_base)" || die2 "cannot auto-detect a base branch (none of origin/HEAD, develop, main, master exist; use --base)"
  # On the detected default or on any integration branch (develop/main/master) the review is the
  # working tree: a gitflow repo on develop with origin/HEAD=main must not diff every unreleased commit.
  case "$BRANCH" in
    "$BASE_NAME"|develop|main|master) STRATEGY="WORKTREE"; BASE_NAME="" ;;
    *) BASE_REF="$(resolve_ref "$BASE_NAME")" ;;
  esac
fi
DIFF_BASE=""
if [[ -n "$BASE_REF" ]]; then
  STRATEGY="$BASE_NAME...HEAD"
  DIFF_BASE="$(g merge-base "$BASE_REF" HEAD 2>/dev/null)" || die2 "no merge base between $BASE_NAME and HEAD"
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
# them unchanged. One level only. Range, always two-dot to the sub's working tree:
#   empty-tree       the path was not a submodule at the diff base (added, or a directory converted)
#   merge-base(b,H)  the sub has the base branch (locally or as origin/<b>) and the merge base is not
#                    the sub's HEAD itself (a pointer bumped to the tip of its base branch would
#                    otherwise diff to nothing)
#   recorded-pointer otherwise: the pointer the superproject recorded at the diff base (HEAD under
#                    WORKTREE), which also covers uncommitted edits inside a sub whose pointer did not move
EMPTY_TREE="4b825dc642cb6eb9a060e54bf8d69288fbee4904"
SUBS_JSON="[]"
SKIPPED_JSON="[]"
NOTES_JSON="[]"
skip_sub() { echo "setup-result-review: submodule $1: $2, skipped" >&2; SKIPPED_JSON="$(jq -c --arg p "$1" --arg r "$2" '. + [{path:$p, reason:$r}]' <<<"$SKIPPED_JSON")"; }
note_sub() { echo "setup-result-review: submodule $1: $2" >&2; NOTES_JSON="$(jq -c --arg p "$1" --arg r "$2" '. + [{path:$p, note:$r}]' <<<"$NOTES_JSON")"; }
PTR_TREE="HEAD"; [[ -n "$DIFF_BASE" ]] && PTR_TREE="$DIFF_BASE"
# gitlinks of the current index, collected once (no per-path pathspec: a plain file named like a glob must not match)
GITLINKS="$(g ls-files -s -z | tr '\0' '\n' | awk -F'\t' '$1 ~ /^160000 /{print $2}')"
is_gitlink() { grep -qxF -- "$1" <<<"$GITLINKS"; }
# mode and object of a path in the base tree ("" when absent); ls-tree takes paths literally
base_entry() { g ls-tree "$PTR_TREE" -- "$1" 2>/dev/null | awk -F'\t' -v want="$1" '$2==want{print $1; exit}'; }
EXPANDED=""
while IFS= read -r p; do
  [[ -n "$p" ]] || continue
  entry="$(base_entry "$p")"; old_mode="${entry%% *}"
  old_ptr=""; [[ "$old_mode" == "160000" ]] && old_ptr="$(awk '{print $3}' <<<"$entry")"
  if ! is_gitlink "$p"; then
    if [[ -n "$old_ptr" ]]; then note_sub "$p" "removed in this change"; continue; fi
    EXPANDED+="$p"$'\n'; continue
  fi
  if [[ ! -e "$TOP/$p/.git" ]]; then skip_sub "$p" "not checked out"; continue; fi
  gs() { git -C "$TOP/$p" -c core.quotePath=false -c diff.noprefix=false -c diff.mnemonicPrefix=false "$@"; }
  gsd() { gs diff --no-ext-diff --no-color "$@"; }
  new_ptr="$(gs rev-parse HEAD 2>/dev/null || true)"
  if [[ -z "$old_ptr" ]]; then
    sub_base="$EMPTY_TREE"; sub_strategy="empty-tree"
  else
    sub_base="$old_ptr"; sub_strategy="recorded-pointer"
    if [[ "$old_ptr" != "$new_ptr" && -n "$BASE_REF" ]]; then
      sub_ref=""
      if gs rev-parse --verify -q "$BASE_NAME" >/dev/null 2>&1; then sub_ref="$BASE_NAME"
      elif gs rev-parse --verify -q "origin/$BASE_NAME" >/dev/null 2>&1; then sub_ref="origin/$BASE_NAME"; fi
      if [[ -n "$sub_ref" ]]; then
        mb="$(gs merge-base "$sub_ref" HEAD 2>/dev/null || true)"
        if [[ -n "$mb" && "$mb" != "$new_ptr" ]]; then sub_base="$mb"; sub_strategy="merge-base($BASE_NAME,HEAD)"; fi
      fi
    fi
    gs cat-file -e "$sub_base^{commit}" 2>/dev/null \
      || die2 "submodule $p: base commit $sub_base is not in its clone (shallow or stale checkout): fetch it or use --base"
  fi
  if [[ -n "$(gs submodule status 2>/dev/null)" ]]; then note_sub "$p" "nested submodules not expanded"; fi
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
[[ -n "$FILES" ]] || die2 "empty diff for $STRATEGY: every changed path is a submodule with nothing to review (see notes above)"

FILE_COUNT="$(grep -c '' <<<"$FILES")"
LINE_COUNT=$((INS + DEL))
SIZE="small"
if (( FILE_COUNT >= 20 || LINE_COUNT >= 500 )); then SIZE="large"; fi

if [[ -d "$TOP/openspec" ]]; then ROOT="$TOP/openspec/reviews/runs"; else ROOT="$TOP/.claude/reviewer/runs"; fi
mkdir -p "$ROOT"
# The runs root must be a real directory inside the repository: pruning deletes under it, so a
# symlinked runs/ (or a symlinked parent) pointing elsewhere is refused outright.
REAL_TOP="$(cd "$TOP" && pwd -P)"
REAL_ROOT="$(cd "$ROOT" 2>/dev/null && pwd -P)" || die2 "cannot enter the runs directory $ROOT"
[[ "$REAL_ROOT" == "$REAL_TOP/"* ]] || die2 "runs directory resolves outside the repository ($ROOT -> $REAL_ROOT)"
[[ -L "$ROOT" ]] && die2 "runs directory resolves outside the repository: $ROOT is a symlink"
# Retention: keep the newest KEEP_RUNS run directories (by name = timestamp); files, symlinks and
# anything not named like a run are never touched (find does not follow symlinks; -type d excludes them).
KEEP_RUNS="${REVIEWER_KEEP_RUNS:-10}"
[[ "$KEEP_RUNS" =~ ^[0-9]+$ ]] || KEEP_RUNS=10
find -P "$REAL_ROOT" -mindepth 1 -maxdepth 1 -type d -name '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z-*' \
  | LC_ALL=C sort | awk -v k="$KEEP_RUNS" '{a[NR]=$0} END{for(i=1;i<=NR-k;i++) print a[i]}' \
  | while IFS= read -r old; do [[ "$old" == "$REAL_ROOT/"* && ! -L "$old" ]] && rm -rf "$old"; done
[[ -f "$ROOT/.gitignore" ]] || printf '*\n' >"$ROOT/.gitignore"

# mktemp guarantees a fresh directory even when two runs start in the same second
RUN_DIR="$(mktemp -d "$ROOT/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")" || die2 "cannot create a run directory under $ROOT"
RUN_ID="$(basename "$RUN_DIR")"
printf '%s\n' "$PATCH" >"$RUN_DIR/diff.patch"

lines_json() { printf '%s\n' "$1" | jq -R -s 'split("\n") | map(select(length>0))'; }
FILES_JSON="$(lines_json "$FILES")"

BASEOBJ="$(jq -n --arg run_id "$RUN_ID" --arg run_dir "$RUN_DIR" --arg s "$STRATEGY" --arg bn "$BASE_NAME" --arg br "$BASE_REF" \
  --argjson files "$FILES_JSON" --argjson fc "$FILE_COUNT" --argjson lc "$LINE_COUNT" \
  '{run_id:$run_id, run_dir:$run_dir, diff_strategy:$s, base_name:$bn, base_ref:$br, files:$files, file_count:$fc, line_count:$lc}')"

jq --arg created "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg wd "$TOP" \
   --argjson so "$(lines_json "$STAGED_ONLY")" --argjson uo "$(lines_json "$UNSTAGED_ONLY")" \
   --arg db "$DIFF_BASE" --argjson subs "$SUBS_JSON" --argjson skipped "$SKIPPED_JSON" --argjson notes "$NOTES_JSON" \
   '. + {created:$created, working_directory:$wd, staged_only:$so, unstaged_only:$uo, submodules:$subs, skipped_submodules:$skipped, notes:$notes}
    + (if $db == "" then {} else {diff_base:$db} end)' \
   <<<"$BASEOBJ" >"$RUN_DIR/manifest.json"

jq -c --arg size "$SIZE" '. + {size_class:$size}' <<<"$BASEOBJ"
