#!/usr/bin/env bash
# Regression test for scripts/log-findings.sh — now a wrapper over log-findings.cjs (history row v2):
# rows are validated (engine vocabulary, integer round), completed (v, ts, engines, locations, pattern,
# run_id) and appended all-or-nothing under <git-root>/.claude/reviewer/history.jsonl. No Claude, no network.
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

# 1. A merged array with engine tags (claude + code-review + agreement via engines[]) is persisted.
"$SCRIPT" --change "openspec/changes/demo/" --source result --round 1 <<'JSON' >/dev/null
[
  {"severity":"LOW","title":"hint path omits WARNING","location":"src/base_l2.py","category":"coverage","engine":"claude"},
  {"severity":"MEDIUM","title":"max_iterations overrides caller config","location":"src/skill_flow.py","category":"correctness","engine":"code-review"},
  {"severity":"MEDIUM","title":"send_feedback exemption bypasses allowlist","location":"src/executor.py","category":"spec-conflict","engine":"claude","engines":["claude","code-review"]}
]
JSON

OUT=".claude/reviewer/history.jsonl"
[[ -f "$OUT" ]] || fail "expected $OUT to exist"
[[ "$(wc -l <"$OUT" | tr -d ' ')" == "3" ]] || fail "expected 3 rows, got $(wc -l <"$OUT")"
[[ "$(jq -r '.engine' "$OUT" | paste -sd, -)" == "claude,code-review,claude" ]] || fail "engine column mismatch"
[[ "$(tail -1 "$OUT" | jq -c '.engines')" == '["claude","code-review"]' ]] || fail "engines[] not persisted"
[[ "$(jq -r '.category' "$OUT" | paste -sd, -)" == "coverage,correctness,spec-conflict" ]] || fail "category column mismatch"
jq -e 'select(.source=="result" and .change=="openspec/changes/demo" and .round==1 and .v==2)' "$OUT" >/dev/null \
  || fail "source/normalized change/integer round/v not persisted"

# 2. A finding without an engine is rejected (v2 requires the vocabulary) and nothing is appended.
if "$SCRIPT" --change "openspec/changes/demo" --source result --round 2 <<'JSON' >/dev/null 2>"$TMP/err.txt"
[{"severity":"LOW","title":"no engine field","location":"x.py","category":"coverage"}]
JSON
then fail "a row without engine must be rejected"; fi
grep -q "row 0 rejected: engine" "$TMP/err.txt" || fail "rejection names the row and field (got: $(cat "$TMP/err.txt"))"
[[ "$(wc -l <"$OUT" | tr -d ' ')" == "3" ]] || fail "rejected batch must not append"

# 3. `locations` persists as an array; absent → [location]; bare string → [string]; pattern absent → null.
"$SCRIPT" --change "openspec/changes/demo" --source result --round 3 <<'JSON' >/dev/null
[
  {"severity":"MEDIUM","title":"unchecked cast","location":"a.py:parse","category":"correctness","engine":"claude","pattern":"int(","locations":["a.py:parse","b.py:parse","c.py:load"]},
  {"severity":"LOW","title":"no locations field","location":"x.py","category":"coverage","engine":"claude"},
  {"severity":"LOW","title":"bare string locations","location":"y.py","category":"coverage","engine":"claude","locations":"y.py:run"}
]
JSON
[[ "$(tail -3 "$OUT" | head -1 | jq -c '.locations')" == '["a.py:parse","b.py:parse","c.py:load"]' ]] || fail "locations array not persisted verbatim"
[[ "$(tail -3 "$OUT" | head -1 | jq -r '.pattern')" == 'int(' ]] || fail "pattern not persisted"
[[ "$(tail -2 "$OUT" | head -1 | jq -c '.locations')" == '["x.py"]' ]] || fail "missing locations should default to [location]"
[[ "$(tail -2 "$OUT" | head -1 | jq -r '.pattern')" == 'null' ]] || fail "missing pattern should persist as null"
[[ "$(tail -1 "$OUT" | jq -c '.locations')" == '["y.py:run"]' ]] || fail "bare-string locations should be wrapped into an array"

# 4. Unknown --source is rejected (engine is the vocabulary; source is the pipeline).
if "$SCRIPT" --change c --source code-review <<<'[]' >/dev/null 2>&1; then
  fail "--source code-review should be rejected; engine, not source, carries the engine name"
fi

echo "ok: log-findings v2 rows via the wrapper (engine vocabulary, engines[], integer round, normalized change, locations/pattern defaults, all-or-nothing, source enum)"
