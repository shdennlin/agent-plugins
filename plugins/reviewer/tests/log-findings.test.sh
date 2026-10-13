#!/usr/bin/env bash
# Regression test for scripts/log-findings.sh as used by `/reviewer:result --with-code-review`:
# a merged findings array carrying an `engine` field per finding must be persisted verbatim,
# with one JSONL row per finding, under <git-root>/.claude/reviewer/history.jsonl
# (no openspec/ in the temp repo). No Claude, no network.
#
#   bash plugins/reviewer/tests/log-findings.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../scripts/log-findings.sh"
command -v jq >/dev/null 2>&1 || { echo "skip: jq not installed"; exit 0; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git -C "$TMP" init -q
cd "$TMP"

fail() { echo "ASSERT FAIL: $*" >&2; exit 1; }

# 1. Merged array with engine tags (spec review + code-review + both) is persisted.
"$SCRIPT" --change "openspec/changes/demo" --source result --round 1 <<'JSON' >/dev/null
[
  {"severity":"LOW","title":"hint path omits WARNING","location":"src/base_l2.py","category":"coverage","engine":"claude-result"},
  {"severity":"MEDIUM","title":"max_iterations overrides caller config","location":"src/skill_flow.py","category":"correctness","engine":"code-review"},
  {"severity":"MEDIUM","title":"send_feedback exemption bypasses allowlist","location":"src/executor.py","category":"spec-conflict","engine":"both"}
]
JSON

OUT=".claude/reviewer/history.jsonl"
[[ -f "$OUT" ]] || fail "expected $OUT to exist"
[[ "$(wc -l <"$OUT" | tr -d ' ')" == "3" ]] || fail "expected 3 rows, got $(wc -l <"$OUT")"

engines="$(jq -r '.engine' "$OUT" | paste -sd, -)"
[[ "$engines" == "claude-result,code-review,both" ]] || fail "engine column mismatch: $engines"

cats="$(jq -r '.category' "$OUT" | paste -sd, -)"
[[ "$cats" == "coverage,correctness,spec-conflict" ]] || fail "category column mismatch: $cats"

sevs="$(jq -r '.severity' "$OUT" | sort -u | paste -sd, -)"
for s in ${sevs//,/ }; do
  case "$s" in CRITICAL|HIGH|MEDIUM|LOW) ;; *) fail "severity outside the four legal values: $s" ;; esac
done

jq -e 'select(.source=="result" and .change=="openspec/changes/demo" and .round=="1")' "$OUT" >/dev/null \
  || fail "source/change/round not persisted"

# 2. A finding without an engine still logs, with engine as empty string (single-engine runs).
"$SCRIPT" --change "openspec/changes/demo" --source result --round 2 <<'JSON' >/dev/null
[{"severity":"LOW","title":"no engine field","location":"x.py","category":"coverage"}]
JSON
[[ "$(tail -1 "$OUT" | jq -r '.engine')" == "" ]] || fail "missing engine should persist as empty string"

# 3. Unknown --source is rejected (engine is free text; source is the enum).
if "$SCRIPT" --change c --source code-review <<<'[]' >/dev/null 2>&1; then
  fail "--source code-review should be rejected; engine, not source, carries the engine name"
fi

echo "ok: log-findings persists engine/category per finding (3 rows), empty engine, source enum enforced"
