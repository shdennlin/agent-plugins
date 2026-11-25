#!/usr/bin/env bash
# Regression test for scripts/classify-target.sh: argument parsing, target classification
# (path > #N > branch > symbol > question), slug, base-branch detection and gh availability.
# Raw argument text goes in on stdin; one JSON object comes out. No Claude, no network.
#
#   bash plugins/digest/tests/classify-target.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../scripts/classify-target.sh"
command -v jq >/dev/null 2>&1 || { echo "skip: jq not installed"; exit 0; }
unset PROJECT_ROOT

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
REPO="$TMP/repo"
mkdir -p "$REPO"
cd "$REPO"

fail() { echo "ASSERT FAIL: $*" >&2; exit 1; }

g() { git -c user.name=t -c user.email=t@t -c commit.gpgsign=false "$@"; }

# run <raw-args>: sets OUT (stdout), RC (exit code); stderr goes to $TMP/err
run() { OUT="$(printf '%s' "$1" | "$SCRIPT" 2>"$TMP/err")" && RC=0 || RC=$?; }

# field <jq-filter> -> value from the last OUT
field() { printf '%s' "$OUT" | jq -r "$1"; }

# expect <raw-args> <kind> <target> [slug]
expect() {
  run "$1"
  [[ "$RC" == "0" ]] || fail "'$1' exited $RC: $(cat "$TMP/err")"
  [[ "$(field .kind)" == "$2" ]] || fail "'$1' kind: want $2, got $(field .kind)"
  [[ "$(field .target)" == "$3" ]] || fail "'$1' target: want '$3', got '$(field .target)'"
  if [[ $# -ge 4 ]]; then
    [[ "$(field .slug)" == "$4" ]] || fail "'$1' slug: want $4, got $(field .slug)"
  fi
}

# --- fixture repo ----------------------------------------------------------
g init -q -b main
mkdir -p docs src
echo plan >docs/plan.md
echo code >src/a.txt
g add -A
g commit -q -m "init"
g branch feat/auth
g branch src
g tag v1
g update-ref refs/remotes/origin/x HEAD
SHORT="$(git rev-parse --short HEAD)"

# 1. Classification order: path > #N > branch (heads, remotes) > symbol > question.
expect '#42'                       pr       '#42'          pr-42
expect 'feat/auth'                 branch   'feat/auth'    feat-auth
expect 'main'                      branch   'main'         main
expect 'origin/x'                  branch   'origin/x'     origin-x
expect 'handleRetry'               symbol   'handleRetry'  handle-retry
expect 'HEAD'                      symbol   'HEAD'         head
expect 'v1'                        symbol   'v1'           v1
expect "$SHORT"                    symbol   "$SHORT"
expect 'src'                       file     'src'          src
expect 'docs/plan.md'              file     'docs/plan.md' plan
expect 'why does the queue retry?' question 'why does the queue retry?' why-does-the-queue-retry
# A question with no ASCII word still needs a usable file slug.
expect '為什麼重試' question '為什麼重試' topic
# A token may start with a digit and still be a symbol (short hashes often do).
expect '1a2b3c4' symbol '1a2b3c4' 1a2b3c4

# 2. Resolved line: kind + target, and how to force another reading.
run 'main'
case "$(field .resolved_line)" in
  "解析為:branch main"*"--as"*) ;;
  *) fail "resolved_line for main: $(field .resolved_line)" ;;
esac

# 3. --as forces a reading; an impossible forced reading is rejected with exit 2.
run '--as symbol main'
[[ "$RC" == "0" && "$(field .kind)" == "symbol" && "$(field .forced)" == "symbol" ]] \
  || fail "--as symbol main: rc=$RC $OUT"
run '--as branch handleRetry'
[[ "$RC" == "2" ]] || fail "--as branch handleRetry should exit 2, got $RC"
[[ -s "$TMP/err" ]] || fail "--as branch handleRetry should explain itself on stderr"

# 4. Flags: audience (quoted), html, teach; teach+html is mutually exclusive.
run '-f "new teammate" docs/plan.md'
[[ "$(field .audience)" == "new teammate" && "$(field .kind)" == "file" ]] || fail "quoted audience: $OUT"
run 'docs/plan.md'
[[ "$(field .audience)" == "developer" && "$(field .teach)" == "false" && "$(field .html)" == "false" ]] \
  || fail "defaults: $OUT"
run '--html feat/auth'
[[ "$(field .html)" == "true" && "$(field .target)" == "feat/auth" ]] || fail "--html: $OUT"
run '--teach handleRetry'
[[ "$(field .teach)" == "true" ]] || fail "--teach: $OUT"
run '--teach --html'
[[ "$RC" == "2" ]] || fail "--teach --html should exit 2, got $RC"

# 5. An unmatched quote is taken literally instead of failing.
run '-f "oops docs/plan.md'
[[ "$RC" == "0" && "$(field .audience)" == *oops* ]] || fail "unmatched quote: rc=$RC $OUT"

# 6. Shell metacharacters in a question are data, never executed.
run "why a;b \$(touch \"$TMP/pwned\") fail?"
[[ "$RC" == "0" && "$(field .kind)" == "question" ]] || fail "metachar question: rc=$RC $OUT"
[[ ! -e "$TMP/pwned" ]] || fail "argument text was executed by a shell"

# 7. Help: text on stdout, exit 0, no JSON.
run '-h'
[[ "$RC" == "0" && "$OUT" == *Usage:* ]] || fail "-h: rc=$RC"
printf '%s' "$OUT" | jq -e . >/dev/null 2>&1 && fail "-h printed JSON"

# 8. Empty target on the base branch: nothing to diff.
run ''
[[ "$RC" == "0" && "$(field .kind)" == "empty" && "$(field .branch)" == "main" \
  && "$(field .base)" == "main" && "$(field .on_base)" == "true" \
  && "$(field .diff_empty)" == "true" && "$(field .resolved_line)" == "" ]] \
  || fail "empty on main: $OUT"

# 9. gh_ok: missing gh, logged-out gh, logged-in gh.
BIN="$TMP/bin"; mkdir -p "$BIN"
for t in git jq tr sed basename cat; do ln -s "$(command -v "$t")" "$BIN/$t"; done
OUT="$(printf '%s' '#42' | env PATH="$BIN" "$SCRIPT" 2>"$TMP/err")" || fail "no-gh run failed: $(cat "$TMP/err")"
[[ "$(field .gh_ok)" == "false" ]] || fail "gh missing should give gh_ok=false: $OUT"
printf '#!/bin/sh\n[ "$1 $2" = "auth token" ] && exit "${FAKE_GH_AUTH:-0}"\nexit 0\n' >"$BIN/gh"
chmod +x "$BIN/gh"
OUT="$(printf '%s' '#42' | env PATH="$BIN" FAKE_GH_AUTH=1 "$SCRIPT" 2>"$TMP/err")" || fail "logged-out run failed"
[[ "$(field .gh_ok)" == "false" ]] || fail "logged-out gh should give gh_ok=false: $OUT"
OUT="$(printf '%s' '#42' | env PATH="$BIN" FAKE_GH_AUTH=0 "$SCRIPT" 2>"$TMP/err")" || fail "logged-in run failed"
[[ "$(field .gh_ok)" == "true" ]] || fail "logged-in gh should give gh_ok=true: $OUT"

# 10. Empty target on a feature branch with commits: there is a diff to explain.
g checkout -q feat/auth
echo more >>docs/plan.md
g commit -q -am "more"
run ''
[[ "$(field .branch)" == "feat/auth" && "$(field .on_base)" == "false" \
  && "$(field .diff_empty)" == "false" ]] || fail "empty on feat/auth: $OUT"

# 11. Base detection: develop beats main.
g branch develop main
run ''
[[ "$(field .base)" == "develop" ]] || fail "base should be develop: $OUT"

# 11b. A stale develop loses to main: pick the base nearer to HEAD (fewer commits ahead).
g checkout -q main
echo main2 >main2.txt
g add -A
g commit -q -m "main moves on"
g checkout -q feat/auth
g merge -q --no-edit main
run ''
[[ "$(field .base)" == "main" ]] || fail "stale develop should lose to main: $OUT"
g checkout -q main
run ''
[[ "$(field .base)" == "main" && "$(field .on_base)" == "true" ]] \
  || fail "on main with a stale develop should still be on_base: $OUT"

# 12. No develop and no main: no base, and the empty diff is reported as empty.
g checkout -q main
g branch -D -q develop
g branch -m main trunk
run ''
[[ "$(field .base)" == "" && "$(field .on_base)" == "false" && "$(field .diff_empty)" == "true" ]] \
  || fail "no base: $OUT"

# 13. Detached HEAD: no current branch name.
g checkout -q --detach
run ''
[[ "$RC" == "0" && "$(field .branch)" == "" ]] || fail "detached: rc=$RC $OUT"

# --- final-review regressions ----------------------------------------------
mk() { rm -rf "$1"; mkdir -p "$1"; git -C "$1" init -q -b "$2"; }
gc() { echo "$2" >"$1/$2.txt"; git -C "$1" add -A; git -C "$1" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q -m "$2"; }

# 14. For a branch target, base and the diff come from the TARGET, not from HEAD.
R2="$TMP/r2"; mk "$R2" main
gc "$R2" c1
git -C "$R2" branch develop
git -C "$R2" checkout -q develop; gc "$R2" d1; gc "$R2" d2; gc "$R2" d3
git -C "$R2" checkout -q -b feat/y; gc "$R2" y1
git -C "$R2" checkout -q main
cd "$R2"
run 'feat/y'
[[ "$(field .kind)" == "branch" && "$(field .base)" == "develop" && "$(field .diff_empty)" == "false" ]] \
  || fail "feat/y forked from develop must use base develop: $OUT"
git checkout -q -b feat/z
run 'main'
[[ "$(field .kind)" == "branch" && "$(field .on_base)" == "true" && "$(field .diff_empty)" == "true" ]] \
  || fail "target equal to its base must report on_base and an empty diff: $OUT"

# 15. A branch target in a repo with neither develop nor main has no base.
R3="$TMP/r3"; mk "$R3" master
gc "$R3" c1
git -C "$R3" branch feat/x
cd "$R3"
run 'feat/x'
[[ "$(field .kind)" == "branch" && "$(field .base)" == "" && "$(field .diff_empty)" == "true" ]] \
  || fail "branch target without a base: $OUT"
cd "$REPO"

# 16. An apostrophe inside an unquoted question is literal and does not swallow later flags.
run "why doesn't the queue retry -f manager"
[[ "$RC" == "0" && "$(field .kind)" == "question" && "$(field .audience)" == "manager" \
  && "$(field .target)" == "why doesn't the queue retry" ]] || fail "apostrophe: $OUT"
# ...while a quote at the start of a token still groups, so a quoted question may contain flags.
run '"what does grep -e do"'
[[ "$RC" == "0" && "$(field .kind)" == "question" && "$(field .target)" == "what does grep -e do" ]] \
  || fail "quoted question with a flag inside: rc=$RC $OUT"

# 17. Removed 2.x flags fail loudly with the migration hint instead of becoming question text.
run 'feat/auth -e html'
[[ "$RC" == "2" ]] || fail "-e should exit 2, got $RC"
grep -q -- '--html' "$TMP/err" || fail "-e error should point to --html: $(cat "$TMP/err")"
run '--export'
[[ "$RC" == "2" ]] || fail "--export should exit 2, got $RC"

# 18. --as branch accepts any commit-ish (tag, short hash, HEAD~1) but still rejects nonsense.
run '--as branch v1'
[[ "$RC" == "0" && "$(field .kind)" == "branch" && "$(field .target)" == "v1" ]] || fail "--as branch v1: rc=$RC $OUT"
run '--as branch nosuchref'
[[ "$RC" == "2" ]] || fail "--as branch nosuchref should exit 2, got $RC"

# 19. HTML is the default for every target; --print asks for the answer in chat instead.
run 'feat/auth'
[[ "$(field .print)" == "false" ]] || fail "print defaults to false: $OUT"
run '--print feat/auth'
[[ "$RC" == "0" && "$(field .print)" == "true" && "$(field .html)" == "false" && "$(field .target)" == "feat/auth" ]] \
  || fail "--print: rc=$RC $OUT"
run '--html feat/auth'
[[ "$(field .html)" == "true" && "$(field .print)" == "false" ]] || fail "--html stays an accepted explicit default: $OUT"
run '--print --html'
[[ "$RC" == "2" ]] || fail "--print --html should exit 2, got $RC"
run '--print --teach'
[[ "$RC" == "2" ]] || fail "--print --teach should exit 2, got $RC"
run '-h'
[[ "$OUT" == *--print* ]] || fail "help must list --print"

# 20. Every flag has a short form that behaves exactly like the long one.
run '-t handleRetry'
[[ "$RC" == "0" && "$(field .teach)" == "true" && "$(field .target)" == "handleRetry" ]] || fail "-t: rc=$RC $OUT"
run '-p feat/auth'
[[ "$RC" == "0" && "$(field .print)" == "true" && "$(field .target)" == "feat/auth" ]] || fail "-p: rc=$RC $OUT"
run '-H feat/auth'
[[ "$RC" == "0" && "$(field .html)" == "true" && "$(field .target)" == "feat/auth" ]] || fail "-H: rc=$RC $OUT"
run '-a symbol main'
[[ "$RC" == "0" && "$(field .kind)" == "symbol" && "$(field .forced)" == "symbol" ]] || fail "-a: rc=$RC $OUT"
run '-a branch handleRetry'
[[ "$RC" == "2" ]] || fail "-a branch handleRetry should exit 2 like --as, got $RC"
run '-t -p'
[[ "$RC" == "2" ]] || fail "-t -p should exit 2, got $RC"
run '-p -H'
[[ "$RC" == "2" ]] || fail "-p -H should exit 2, got $RC"
run '-f manager -p #42'
[[ "$RC" == "0" && "$(field .audience)" == "manager" && "$(field .print)" == "true" && "$(field .kind)" == "pr" ]] \
  || fail "-f with -p: rc=$RC $OUT"
run '-h'
for s in '-t, --teach' '-p, --print' '-H, --html' '-a, --as'; do
  [[ "$OUT" == *"$s"* ]] || fail "help must list '$s'"
done

echo "ok: classify-target"
