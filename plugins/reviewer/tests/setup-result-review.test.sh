#!/usr/bin/env bash
# Test for scripts/setup-result-review.sh: diff strategy, manifest, run dir roots, path
# normalization oracle (fixtures/normalize-cases.json shared with the MCP schema tests).
#
#   bash plugins/reviewer/tests/setup-result-review.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../scripts/setup-result-review.sh"
CASES="$HERE/fixtures/normalize-cases.json"
command -v jq >/dev/null 2>&1 || { echo "skip: jq not installed"; exit 0; }

fail() { echo "ASSERT FAIL: $*" >&2; exit 1; }
[[ -f "$SCRIPT" ]] || fail "script not found: $SCRIPT"

# 0. Normalization oracle (no git repo needed).
n=0
while IFS= read -r row; do
  in="$(jq -r '.[0]' <<<"$row")"; want="$(jq -r '.[1]' <<<"$row")"
  got="$("$SCRIPT" --normalize "$in")"
  [[ "$got" == "$want" ]] || fail "normalize '$in': want '$want' got '$got'"
  n=$((n + 1))
done < <(jq -c '.[]' "$CASES")
[[ "$n" -gt 0 ]] || fail "no normalize cases loaded"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git -C "$TMP" init -q -b main
TMP="$(git -C "$TMP" rev-parse --show-toplevel)"
git -C "$TMP" config user.email t@t; git -C "$TMP" config user.name t
echo "x = 1" >"$TMP/a.py"
git -C "$TMP" add . && git -C "$TMP" commit -qm base
git -C "$TMP" checkout -q -b feat
echo "x = 2" >"$TMP/a.py"; echo "y = 1" >"$TMP/b.py"
git -C "$TMP" add . && git -C "$TMP" commit -qm feat
# Hostile user git config, left on for every case below: the script's own diff calls must
# override it (no prefix stripping, no external diff driver, no color codes).
git -C "$TMP" config diff.noprefix true
git -C "$TMP" config diff.external /usr/bin/true
git -C "$TMP" config color.ui always

# 1. Base-branch strategy.
out="$("$SCRIPT" --working-dir "$TMP" --base main)"
[[ "$(jq -r .diff_strategy <<<"$out")" == "main...HEAD" ]] || fail "diff_strategy"
[[ "$(jq -r '.files|join(",")' <<<"$out")" == "a.py,b.py" ]] || fail "files"
[[ "$(jq -r .file_count <<<"$out")" == "2" ]] || fail "file_count"
[[ "$(jq -r .line_count <<<"$out")" == "3" ]] || fail "line_count"
[[ "$(jq -r .size_class <<<"$out")" == "small" ]] || fail "size_class"
run="$(jq -r .run_dir <<<"$out")"
[[ "$run" == "$TMP/.claude/reviewer/runs/"* ]] || fail "run_dir root"
[[ -f "$run/manifest.json" && -s "$run/diff.patch" ]] || fail "manifest/diff missing"
[[ "$(jq -r .run_id "$run/manifest.json")" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{4}$ ]] || fail "run_id format"
[[ "$(jq -r .working_directory "$run/manifest.json")" == "$TMP" ]] || fail "manifest working_directory"
jq -e '.created|test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$")' "$run/manifest.json" >/dev/null || fail "created format"
jq -e 'has("size_class")|not' "$run/manifest.json" >/dev/null || fail "manifest must not carry size_class"
jq -e '.staged_only==[] and .unstaged_only==[]' "$run/manifest.json" >/dev/null || fail "base strategy staged/unstaged must be empty arrays"
[[ "$(cat "$TMP/.claude/reviewer/runs/.gitignore")" == "*" ]] || fail "runs root must be gitignored (.claude)"
grep -q '^+++ b/a.py$' "$run/diff.patch" || fail "diff.patch must keep b/ prefixes under diff.noprefix: $(head -5 "$run/diff.patch")"
grep -q '^+x = 2$' "$run/diff.patch" || fail "diff.patch must hold the hunk (no external diff, no color)"
! grep -q $'\x1b' "$run/diff.patch" || fail "diff.patch must carry no color escapes"
[[ "$(jq -r .diff_base "$run/manifest.json")" == "$(git -C "$TMP" merge-base main HEAD)" ]] || fail "manifest diff_base must be the merge-base sha"

# 2. openspec root rule.
mkdir "$TMP/openspec"; run2="$("$SCRIPT" --working-dir "$TMP" --base main | jq -r .run_dir)"
[[ "$run2" == "$TMP/openspec/reviews/runs/"* ]] || fail "openspec root"
[[ "$(cat "$TMP/openspec/reviews/runs/.gitignore")" == "*" ]] || fail "runs root must be gitignored"

# 2b. subdirectory working-dir resolves to the git toplevel (openspec/ lives at the root).
mkdir -p "$TMP/sub/dir"
rs="$("$SCRIPT" --working-dir "$TMP/sub/dir" --base main)"
[[ "$(jq -r .run_dir <<<"$rs")" == "$TMP/openspec/reviews/runs/"* ]] || fail "subdir run_dir should use toplevel openspec"
[[ "$(jq -r .working_directory "$(jq -r .run_dir <<<"$rs")/manifest.json")" == "$TMP" ]] || fail "subdir working_directory"
[[ ! -e "$TMP/sub/dir/.claude" ]] || fail "stray .claude under subdir"

# 3. auto-detect on feature branch picks main (no develop).
[[ "$("$SCRIPT" --working-dir "$TMP" --auto-detect | jq -r .diff_strategy)" == "main...HEAD" ]] || fail "auto-detect"

# 3b. base strategy sees the working tree (the fixer never commits): uncommitted edit + staged new file.
echo "x = 3" >"$TMP/a.py"
echo "d = 1" >"$TMP/d.py"; git -C "$TMP" add d.py
wt="$("$SCRIPT" --working-dir "$TMP" --base main)"
[[ "$(jq -r .diff_strategy <<<"$wt")" == "main...HEAD" ]] || fail "working-tree base: diff_strategy display"
[[ "$(jq -r '.files|join(",")' <<<"$wt")" == "a.py,b.py,d.py" ]] || fail "working-tree base files: $(jq -c .files <<<"$wt")"
wp="$(jq -r .run_dir <<<"$wt")/diff.patch"
grep -q '^+x = 3$' "$wp" || fail "uncommitted edit missing from diff.patch"
grep -q '^+++ b/d.py$' "$wp" || fail "staged new file missing from diff.patch"
git -C "$TMP" reset -q --hard

# 4. large size class by file count.
git -C "$TMP" checkout -q -b big
for i in $(seq 1 20); do echo "$i" >"$TMP/f$i.txt"; done
git -C "$TMP" add f*.txt && git -C "$TMP" commit -qm big
[[ "$("$SCRIPT" --working-dir "$TMP" --base main | jq -r .size_class)" == "large" ]] || fail "large by file_count"
git -C "$TMP" checkout -q feat

# 5. WORKTREE on main: staged_only / unstaged_only.
git -C "$TMP" checkout -q main
echo "s" >>"$TMP/a.py"; git -C "$TMP" add a.py
echo "u" >>"$TMP/a.py"            # a.py: both staged and unstaged
echo "c" >"$TMP/c.py"; git -C "$TMP" add c.py            # staged only
echo "z" >>"$TMP/a.py"
w="$("$SCRIPT" --working-dir "$TMP" --auto-detect)"
[[ "$(jq -r .diff_strategy <<<"$w")" == "WORKTREE" ]] || fail "WORKTREE strategy"
[[ "$(jq -r '.files|join(",")' <<<"$w")" == "a.py,c.py" ]] || fail "WORKTREE files"
wm="$(jq -r .run_dir <<<"$w")/manifest.json"
[[ "$(jq -c .staged_only "$wm")" == '["c.py"]' ]] || fail "staged_only: $(jq -c .staged_only "$wm")"
[[ "$(jq -c .unstaged_only "$wm")" == '[]' ]] || fail "unstaged_only: $(jq -c .unstaged_only "$wm")"
git -C "$TMP" reset -q --hard
git -C "$TMP" clean -qfd -e openspec -e .claude
# 5b. comm must be locale-independent: mixed-case / punctuated names under a UTF-8 locale.
echo 1 >"$TMP/B.py"; echo 1 >"$TMP/a-b.py"; echo 1 >"$TMP/a.py"
git -C "$TMP" add B.py a-b.py a.py && git -C "$TMP" commit -qm names
for f in B.py a-b.py a.py; do echo 2 >>"$TMP/$f"; done
git -C "$TMP" add B.py a-b.py
echo 3 >>"$TMP/a.py"                      # a.py unstaged only
echo 4 >>"$TMP/a-b.py"                    # a-b.py both
(
  unset LC_ALL; export LANG=en_US.UTF-8
  l="$("$SCRIPT" --working-dir "$TMP" --auto-detect)"
  lm="$(jq -r .run_dir <<<"$l")/manifest.json"
  [[ "$(jq -c .staged_only "$lm")" == '["B.py"]' ]] || fail "locale staged_only: $(jq -c .staged_only "$lm")"
  [[ "$(jq -c .unstaged_only "$lm")" == '["a.py"]' ]] || fail "locale unstaged_only: $(jq -c .unstaged_only "$lm")"
)
git -C "$TMP" reset -q --hard HEAD~1
git -C "$TMP" clean -qfd -e openspec -e .claude
# 6. empty diff exits 2.
"$SCRIPT" --working-dir "$TMP" --auto-detect >/dev/null 2>&1 && fail "empty diff should exit 2"
rc=0; "$SCRIPT" --working-dir "$TMP" --auto-detect >/dev/null 2>&1 || rc=$?
[[ "$rc" == 2 ]] || fail "empty diff exit code $rc"

# 7. detached HEAD under auto-detect exits 2; not a git repo exits 2; usage error exits 1.
git -C "$TMP" checkout -q --detach
rc=0; "$SCRIPT" --working-dir "$TMP" --auto-detect >/dev/null 2>&1 || rc=$?
[[ "$rc" == 2 ]] || fail "detached should exit 2, got $rc"
NG="$(mktemp -d)"; rc=0; "$SCRIPT" --working-dir "$NG" --base main >/dev/null 2>&1 || rc=$?; rmdir "$NG"
[[ "$rc" == 2 ]] || fail "non-git exit code $rc"
rc=0; "$SCRIPT" --bogus >/dev/null 2>&1 || rc=$?
[[ "$rc" == 1 ]] || fail "usage error exit code $rc"

echo "ok: setup-result-review strategy, manifest, hostile git config, merge-base working tree, run roots, gitignore, size_class, WORKTREE staged/unstaged, exit codes, $n normalize cases"
