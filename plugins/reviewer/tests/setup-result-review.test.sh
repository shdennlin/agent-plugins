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
[[ "$(jq -r .run_id "$run/manifest.json")" =~ ^[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9]{6}$ ]] || fail "run_id format"
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

# 8. Superproject with submodules: changed gitlinks are expanded into prefixed files and patches.
S="$(mktemp -d)"
mkrepo() { # $1 dir, $2 "develop" to also create develop
  mkdir -p "$1" && git -C "$1" init -q -b main && git -C "$1" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  [[ "${2:-}" == "develop" ]] && git -C "$1" branch -q develop
  return 0
}
gc() { git -C "$1" -c user.email=t@t -c user.name=t -c protocol.file.allow=always "${@:2}"; }
# libA: has develop; feature branch changes two files, one adds a line containing int(x)
mkrepo "$S/libA" develop
mkdir -p "$S/libA/src" && printf 'a\n' >"$S/libA/src/a.py" && printf 'b\n' >"$S/libA/src/b.py"
gc "$S/libA" add -A && gc "$S/libA" commit -q -m base && gc "$S/libA" branch -f develop
gc "$S/libA" switch -q -c feat && printf 'a\ny = int(x)\n' >"$S/libA/src/a.py" && printf 'b\nc\n' >"$S/libA/src/b.py" && gc "$S/libA" commit -q -am "feat"
# libB: pointer will stay unchanged; worktree made dirty
mkrepo "$S/libB"; printf 'x\n' >"$S/libB/x.txt" && gc "$S/libB" add -A && gc "$S/libB" commit -q -m base
# libB2: NO develop branch; feature commit on main-based branch
mkrepo "$S/libB2"; printf 'm\n' >"$S/libB2/m.txt" && gc "$S/libB2" add -A && gc "$S/libB2" commit -q -m base
gc "$S/libB2" switch -q -c feat && printf 'm\nn\n' >"$S/libB2/m.txt" && gc "$S/libB2" commit -q -am "feat"
# libC: added as a new submodule on the feature branch
mkrepo "$S/libC"; printf 'new\n' >"$S/libC/c.txt" && gc "$S/libC" add -A && gc "$S/libC" commit -q -m base
# super: develop with libA (at base), libB, libB2 (at base) + openspec/
mkrepo "$S/super" develop; mkdir -p "$S/super/openspec"; printf 'o\n' >"$S/super/openspec/README.md"
gc "$S/super" submodule add -q "$S/libA" libA && gc "$S/super" submodule add -q "$S/libB" libB && gc "$S/super" submodule add -q "$S/libB2" libB2
# `submodule add` clones the source's current HEAD (feat); pin the base pointers to the pre-feature commits
gc "$S/super/libA" checkout -q "$(git -C "$S/libA" rev-parse develop)" && gc "$S/super/libB2" checkout -q "$(git -C "$S/libB2" rev-parse main)"
gc "$S/super" add -A && gc "$S/super" commit -q -m "base with submodules" && gc "$S/super" branch -f develop
# feature: bump libA to feat, bump libB2 to feat, add libC, add a plain file that shares libA's prefix, dirty libB
gc "$S/super" switch -q -c feat
gc "$S/super/libA" fetch -q origin && gc "$S/super/libA" checkout -q "$(git -C "$S/libA" rev-parse feat)"
gc "$S/super/libB2" fetch -q origin && gc "$S/super/libB2" checkout -q "$(git -C "$S/libB2" rev-parse feat)"
gc "$S/super" submodule add -q "$S/libC" libC
# a submodule whose path holds sed/regex metacharacters: the "<sub>/" prefix must be treated as data
gc "$S/super" submodule add -q "$S/libC" 'lib|d.x'
mkdir -p "$S/super/libA-docs" && printf 'd\n' >"$S/super/libA-docs/readme.md"
gc "$S/super" add -A && gc "$S/super" commit -q -m "feat: bump libA, libB2; add libC"
printf 'dirty\n' >>"$S/super/libB/x.txt"
out="$("$SCRIPT" --working-dir "$S/super" --base develop 2>"$S/err.txt")" || fail "superproject setup failed: $(cat "$S/err.txt")"; run="$(jq -r .run_dir <<<"$out")"; files="$(jq -r '.files|join(",")' <<<"$out")"
[[ ",$files," == *",libA/src/a.py,"* && ",$files," == *",libA/src/b.py,"* ]] || fail "libA expanded into prefixed files (got $files)"
[[ ",$files," != *",libA,"* && ",$files," != *",libB2,"* && ",$files," != *",libC,"* ]] || fail "gitlink entries removed from files (got $files)"
[[ ",$files," == *",libC/c.txt,"* ]] || fail "added submodule expanded from the empty tree"
[[ ",$files," == *",lib|d.x/c.txt,"* ]] || fail "submodule path with sed metacharacters prefixed verbatim (got $files)"
grep -q '^+++ b/lib|d.x/c.txt$' "$run/diff.patch" || fail "prefixed header for the metacharacter submodule"
[[ ",$files," == *",libB2/m.txt,"* ]] || fail "sub without the base branch still expanded"
[[ ",$files," == *",libB/x.txt,"* ]] || fail "unchanged-pointer but dirty submodule expanded (uncommitted edits are review input)"
[[ "$(jq -r '.submodules[]|select(.path=="libB")|.strategy' "$run/manifest.json")" == "recorded-pointer" ]] || fail "dirty libB uses the recorded pointer"
[[ ",$files," == *",libA-docs/readme.md,"* ]] || fail "plain file sharing a submodule name prefix listed as-is"
grep -q '^+++ b/libA/src/a.py$' "$run/diff.patch" || fail "prefixed +++ header for libA"
grep -q '^diff --git a/libC/c.txt b/libC/c.txt$' "$run/diff.patch" || fail "prefixed diff header for the added submodule"
grep -q '^+y = int(x)$' "$run/diff.patch" || fail "sub-repo added line present in diff.patch"
[[ "$(jq -r '.submodules|length' "$run/manifest.json")" == "5" ]] || fail "five submodules recorded (got $(jq -c .submodules "$run/manifest.json"))"
[[ "$(jq -r '.submodules[]|select(.path=="libA")|.strategy' "$run/manifest.json")" == "merge-base(develop,HEAD)" ]] || fail "libA strategy"
[[ "$(jq -r '.submodules[]|select(.path=="libB2")|.strategy' "$run/manifest.json")" == "recorded-pointer" ]] || fail "libB2 falls back to the recorded pointer"
[[ "$(jq -r '.submodules[]|select(.path=="libC")|.strategy' "$run/manifest.json")" == "empty-tree" ]] || fail "libC strategy"
[[ "$(jq -r '.submodules[]|select(.path=="libA")|.base' "$run/manifest.json")" == "$(git -C "$S/libA" rev-parse develop)" ]] || fail "libA base is its develop merge-base"
[[ "$(jq -r '.submodules[]|.path' "$run/manifest.json" | grep -c 'libA-docs')" == "0" ]] || fail "libA-docs is not a submodule"
[[ -z "$(cat "$S/err.txt")" ]] || fail "no stderr notes expected (got: $(cat "$S/err.txt"))"
(( $(jq -r .line_count <<<"$out") >= 4 )) || fail "line_count counts sub-repo lines (got $(jq -r .line_count <<<"$out"))"
[[ "$(jq -r .file_count <<<"$out")" == "$(jq -r '.files|length' <<<"$out")" ]] || fail "file_count matches expanded files"
# no-op guarantee: a plain repo (libA itself, on feat vs develop) records submodules: []
plain="$("$SCRIPT" --working-dir "$S/libA" --base develop)"
[[ "$(jq -r '.submodules|length' "$(jq -r .run_dir <<<"$plain")/manifest.json")" == "0" ]] || fail "plain repo: submodules []"
[[ "$(jq -r '.files|join(",")' <<<"$plain")" == "src/a.py,src/b.py" ]] || fail "plain repo files unchanged by the expansion code"
rm -rf "$S"

# 8b. Submodule edge cases found in review: bump-to-tip, directory→submodule, ignore config, glob names,
#     removed submodule, WORKTREE with a dirty sub, shallow clone lacking the base pointer.
S="$(mktemp -d)"
mkrepo "$S/subE" develop; printf 'e\n' >"$S/subE/e.txt"; gc "$S/subE" add -A; gc "$S/subE" commit -q -m base; gc "$S/subE" branch -f develop
mkrepo "$S/subH"; printf 'h\n' >"$S/subH/h.txt"; gc "$S/subH" add -A; gc "$S/subH" commit -q -m base
mkrepo "$S/subF"; printf 'f2\n' >"$S/subF/f.txt"; gc "$S/subF" add -A; gc "$S/subF" commit -q -m base
mkrepo "$S/super" develop
gc "$S/super" submodule add -q "$S/subE" subE && gc "$S/super" submodule add -q "$S/subH" subH
mkdir -p "$S/super/subF" && printf 'f1\n' >"$S/super/subF/f.txt"   # plain directory at the base
gc "$S/super" add -A && gc "$S/super" commit -q -m base && gc "$S/super" branch -f develop
# subE: develop itself advances (the sub's PR merged), super bumps the pointer to that tip
old_e="$(git -C "$S/subE" rev-parse HEAD)"
printf 'e\nmerged = int(x)\n' >"$S/subE/e.txt"; gc "$S/subE" commit -q -am "merged to develop"; gc "$S/subE" branch -f develop
gc "$S/super" switch -q -c feat
gc "$S/super/subE" fetch -q origin && gc "$S/super/subE" checkout -q "$(git -C "$S/subE" rev-parse develop)"
# subF: the directory becomes a submodule; subH: removed; sub[A-Z]: a plain file whose name is a glob matching subE
gc "$S/super" rm -q -r subF && rm -rf "$S/super/subF" && gc "$S/super" submodule add -q "$S/subF" subF
gc "$S/super" rm -q subH && rm -rf "$S/super/subH"
printf 'glob\n' >"$S/super/sub[A-Z]"
# ignore config in .gitmodules must not switch the feature off
gc "$S/super" config -f .gitmodules submodule.subE.ignore all
gc "$S/super" add -A && gc "$S/super" commit -q -m "feat: bump subE to tip, dir→submodule, remove subH"
out="$("$SCRIPT" --working-dir "$S/super" --base develop 2>"$S/err.txt")" || fail "8b setup failed: $(cat "$S/err.txt")"
run="$(jq -r .run_dir <<<"$out")"; files="$(jq -r '.files|join(",")' <<<"$out")"
[[ ",$files," == *",subE/e.txt,"* ]] || fail "bump-to-tip: sub diffed from the recorded pointer, not from an empty merge-base (got $files)"
[[ "$(jq -r '.submodules[]|select(.path=="subE")|.base' "$run/manifest.json")" == "$old_e" ]] || fail "bump-to-tip base is the old pointer"
[[ "$(jq -r '.submodules[]|select(.path=="subE")|.strategy' "$run/manifest.json")" == "recorded-pointer" ]] || fail "bump-to-tip strategy"
grep -q '^+merged = int(x)$' "$run/diff.patch" || fail "bump-to-tip hunk present"
[[ ",$files," == *",subF/f.txt,"* ]] || fail "directory converted to a submodule expands from the empty tree (got $files)"
[[ "$(jq -r '.submodules[]|select(.path=="subF")|.strategy' "$run/manifest.json")" == "empty-tree" ]] || fail "dir→submodule strategy"
[[ ",$files," == *",sub[A-Z],"* ]] || fail "a plain file named like a glob is kept (got $files)"
[[ ",$files," != *",subH,"* ]] || fail "removed submodule dropped from files"
grep -q "submodule subH: removed in this change, skipped" "$S/err.txt" || fail "removed submodule noted (got: $(cat "$S/err.txt"))"
[[ "$(jq -r '.submodules|length' "$run/manifest.json")" == "2" ]] || fail "subE + subF recorded (got $(jq -c .submodules "$run/manifest.json"))"
# user-level ignore config must not switch the feature off either
out2="$(git -C "$S/super" config diff.ignoreSubmodules all; "$SCRIPT" --working-dir "$S/super" --base develop 2>/dev/null)" || fail "ignoreSubmodules=all run failed"
[[ "$(jq -r '.files|join(",")' <<<"$out2")" == *"subE/e.txt"* ]] || fail "diff.ignoreSubmodules=all in repo config is overridden"
git -C "$S/super" config --unset diff.ignoreSubmodules
# WORKTREE: on develop with uncommitted edits inside a sub whose pointer is unchanged → reviewed from the recorded pointer
rm -rf "$S/super/subF"   # the sub checkout from feat would block the switch
gc "$S/super" switch -q develop || fail "switch to develop failed"
gc "$S/super" submodule update -q --init
printf 'e\ndirty = size - 1\n' >"$S/super/subE/e.txt"
out3="$("$SCRIPT" --working-dir "$S/super" --auto-detect 2>"$S/err3.txt")" || fail "WORKTREE dirty-sub run failed: $(cat "$S/err3.txt")"
[[ "$(jq -r .diff_strategy <<<"$out3")" == "WORKTREE" ]] || fail "WORKTREE strategy"
[[ "$(jq -r '.files|join(",")' <<<"$out3")" == "subE/e.txt" ]] || fail "WORKTREE: dirty sub's edits are the review input (got $(jq -r '.files|join(",")' <<<"$out3"))"
grep -q '^+dirty = size - 1$' "$(jq -r .run_dir <<<"$out3")/diff.patch" || fail "WORKTREE dirty hunk present"
# shallow sub clone lacking the recorded pointer: exit 2 with a message naming the sub
gc "$S/super" switch -q feat
rm -rf "$S/super/subE" && git clone -q --depth 1 "file://$S/subE" "$S/super/subE" 2>/dev/null
rc=0; "$SCRIPT" --working-dir "$S/super" --base develop >/dev/null 2>"$S/err4.txt" || rc=$?
[[ "$rc" == 2 ]] || fail "shallow sub: exit 2 expected, got $rc ($(cat "$S/err4.txt"))"
grep -q "submodule subE: base commit $old_e is not in its clone" "$S/err4.txt" || fail "shallow sub: message names the sub and commit (got: $(cat "$S/err4.txt"))"
rm -rf "$S"

# 9. base auto-detect order (origin/HEAD, develop, main, master), missing --base ref, run-dir uniqueness.
R="$(mktemp -d)"
mkrepo "$R/m"; gc "$R/m" branch -m main master; printf 'x\n' >"$R/m/x"; gc "$R/m" add -A; gc "$R/m" commit -q -m base
gc "$R/m" switch -q -c feat; printf 'y\n' >>"$R/m/x"; gc "$R/m" commit -q -am feat
[[ "$("$SCRIPT" --working-dir "$R/m" --auto-detect | jq -r .diff_strategy)" == "master...HEAD" ]] || fail "master repo auto-detects master"
gc "$R/m" switch -q master; printf 'w\n' >>"$R/m/x"
[[ "$("$SCRIPT" --working-dir "$R/m" --auto-detect | jq -r .diff_strategy)" == "WORKTREE" ]] || fail "on master itself → WORKTREE"
# origin/HEAD wins over develop
mkrepo "$R/o"; printf 'o\n' >"$R/o/o"; gc "$R/o" add -A; gc "$R/o" commit -q -m base; gc "$R/o" branch trunk; gc "$R/o" branch develop
git clone -q "$R/o" "$R/c"; git -C "$R/c" remote set-head origin trunk
gc "$R/c" switch -q -c feat; printf 'z\n' >"$R/c/z"; gc "$R/c" add -A; gc "$R/c" commit -q -m z
[[ "$("$SCRIPT" --working-dir "$R/c" --auto-detect | jq -r .diff_strategy)" == "trunk...HEAD" ]] || fail "origin/HEAD → trunk beats develop (got $("$SCRIPT" --working-dir "$R/c" --auto-detect | jq -r .diff_strategy))"
out9="$("$SCRIPT" --working-dir "$R/c" --auto-detect)"
[[ "$(jq -r .base_name <<<"$out9")" == "trunk" ]] || fail "stdout names the base (got $(jq -c . <<<"$out9"))"
[[ "$(jq -r .base_name "$(jq -r .run_dir <<<"$out9")/manifest.json")" == "trunk" ]] || fail "manifest names the base"
# an integration branch that is not the detected default still reviews its working tree (gitflow: on develop, origin/HEAD=trunk)
gc "$R/c" switch -q develop 2>/dev/null || gc "$R/c" switch -q -c develop origin/develop; printf 'd\n' >>"$R/c/o"
out9b="$("$SCRIPT" --working-dir "$R/c" --auto-detect)"
[[ "$(jq -r .diff_strategy <<<"$out9b")" == "WORKTREE" ]] || fail "on develop → WORKTREE even when origin/HEAD is trunk (got $(jq -r .diff_strategy <<<"$out9b"))"
[[ "$(jq -r .base_name <<<"$out9b")" == "" ]] || fail "WORKTREE has an empty base_name"
gc "$R/c" checkout -q -- o; gc "$R/c" switch -q feat
rc=0; "$SCRIPT" --working-dir "$R/c" --base nosuch >/dev/null 2>"$R/e.txt" || rc=$?
[[ "$rc" == 2 ]] || fail "missing --base ref exits 2 (rc=$rc)"
grep -q "base ref 'nosuch' does not exist" "$R/e.txt" || fail "missing --base ref names itself (got: $(cat "$R/e.txt"))"
d1="$("$SCRIPT" --working-dir "$R/c" --base trunk | jq -r .run_dir)"; d2="$("$SCRIPT" --working-dir "$R/c" --base trunk | jq -r .run_dir)"
[[ "$d1" != "$d2" && -d "$d1" && -d "$d2" ]] || fail "two runs get distinct run dirs"
[[ "$(basename "$d1")" =~ ^[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9]{6}$ ]] || fail "run id format (got $(basename "$d1"))"
rm -rf "$R"

echo "ok: setup-result-review strategy, manifest, hostile git config, merge-base working tree, run roots, gitignore, size_class, WORKTREE staged/unstaged, exit codes, submodules, $n normalize cases"
