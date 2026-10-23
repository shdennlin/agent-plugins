#!/usr/bin/env bash
# Test for scripts/setup-spec-review.sh: spec file discovery, manifest, run dir root, error codes.
#   bash plugins/reviewer/tests/setup-spec-review.test.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../scripts/setup-spec-review.sh"
command -v jq >/dev/null 2>&1 || { echo "skip: jq not installed"; exit 0; }
fail() { echo "ASSERT FAIL: $*" >&2; exit 1; }
[[ -f "$SCRIPT" ]] || fail "script not found: $SCRIPT"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git -C "$TMP" init -q -b main; TMP="$(git -C "$TMP" rev-parse --show-toplevel)"
mkdir -p "$TMP/openspec/changes/add-x/specs/b" "$TMP/openspec/changes/add-x/specs/a" "$TMP/openspec/changes/add-x/mockups"
printf '# p\n' >"$TMP/openspec/changes/add-x/proposal.md"
printf '# d\n' >"$TMP/openspec/changes/add-x/design.md"
printf '# a\n' >"$TMP/openspec/changes/add-x/specs/a/spec.md"
printf '# b\n' >"$TMP/openspec/changes/add-x/specs/b/spec.md"
printf '<html>' >"$TMP/openspec/changes/add-x/mockups/x.html"

# 1. a directory: every .md under it, nested, sorted; non-md files ignored
out="$("$SCRIPT" --working-dir "$TMP" openspec/changes/add-x)" || fail "dir run failed"
files="$(jq -r '.files|join(",")' <<<"$out")"
[[ "$files" == "openspec/changes/add-x/design.md,openspec/changes/add-x/proposal.md,openspec/changes/add-x/specs/a/spec.md,openspec/changes/add-x/specs/b/spec.md" ]] || fail "files (got $files)"
[[ "$(jq -r .mode <<<"$out")" == "spec" ]] || fail "mode spec"
[[ "$(jq -r .file_count <<<"$out")" == "4" ]] || fail "file_count 4"
run="$(jq -r .run_dir <<<"$out")"
[[ "$run" == "$TMP/openspec/reviews/runs/"* ]] || fail "run dir under openspec/reviews/runs (got $run)"
[[ -f "$run/manifest.json" ]] || fail "manifest written"
[[ ! -e "$run/diff.patch" ]] || fail "no diff.patch in spec mode"
[[ "$(jq -r .mode "$run/manifest.json")" == "spec" ]] || fail "manifest.mode"
[[ "$(jq -r .working_directory "$run/manifest.json")" == "$TMP" ]] || fail "manifest.working_directory"
[[ "$(jq -r '.spec_paths|join(",")' "$run/manifest.json")" == "openspec/changes/add-x" ]] || fail "manifest.spec_paths as given"
[[ "$(jq -r '.files|length' "$run/manifest.json")" == "4" ]] || fail "manifest.files"
[[ -n "$(jq -r .created "$run/manifest.json")" ]] || fail "manifest.created"
[[ "$(jq -r .run_id "$run/manifest.json")" == "$(basename "$run")" ]] || fail "run_id = basename"
[[ -f "$TMP/openspec/reviews/runs/.gitignore" ]] || fail "runs .gitignore"

# 2. a single file, absolute path → one relative entry
out2="$("$SCRIPT" --working-dir "$TMP" "$TMP/openspec/changes/add-x/design.md")" || fail "file run failed"
[[ "$(jq -r '.files|join(",")' <<<"$out2")" == "openspec/changes/add-x/design.md" ]] || fail "single file (got $(jq -c .files <<<"$out2"))"

# 3. two paths, duplicates collapse
out3="$("$SCRIPT" --working-dir "$TMP" openspec/changes/add-x/design.md openspec/changes/add-x)" || fail "two paths failed"
[[ "$(jq -r '.file_count' <<<"$out3")" == "4" ]] || fail "duplicates collapse (got $(jq -c .files <<<"$out3"))"

# 4. a missing path → exit 2 naming it
set +e; err="$("$SCRIPT" --working-dir "$TMP" openspec/changes/nope 2>&1 >/dev/null)"; rc=$?; set -e
[[ "$rc" == "2" ]] || fail "missing path exit 2 (got $rc)"
[[ "$err" == *"openspec/changes/nope"* ]] || fail "missing path named (got: $err)"

# 5. no path → usage error 1; portable repo → .claude/reviewer/runs
set +e; "$SCRIPT" --working-dir "$TMP" >/dev/null 2>&1; rc=$?; set -e
[[ "$rc" == "1" ]] || fail "no path exit 1 (got $rc)"
P="$(mktemp -d)"; git -C "$P" init -q -b main; P="$(git -C "$P" rev-parse --show-toplevel)"; printf '# s\n' >"$P/spec.md"
out5="$("$SCRIPT" --working-dir "$P" spec.md)" || fail "portable run failed"
[[ "$(jq -r .run_dir <<<"$out5")" == "$P/.claude/reviewer/runs/"* ]] || fail "portable root"
rm -rf "$P"
echo "ok: setup-spec-review (dir discovery, single file, dedupe, missing path, usage, portable root)"
