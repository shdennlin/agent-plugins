#!/usr/bin/env bash
# Regression test for scripts/log-findings.cjs (history row v3):
# rows are validated (engine vocabulary, integer round), completed (v, ts, engines, locations, pattern,
# run_id) and appended all-or-nothing under <git-root>/.claude/reviewer/history.jsonl. No Claude, no network.
#
#   bash plugins/reviewer/tests/log-findings.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../scripts/log-findings.cjs"
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
jq -e 'select(.source=="result" and .change=="openspec/changes/demo" and .round==1 and .v==3)' "$OUT" >/dev/null \
  || fail "source/normalized change/integer round/v not persisted"

# 2. Rows are normalized (missing engine → claude for result/spec; lowercase severity upper-cased); an
#    unfixable row (empty title) is dropped and named, the rest of the batch is still appended.
"$SCRIPT" --change "openspec/changes/demo" --source result --round 2 <<'JSON' >"$TMP/out2.txt" 2>"$TMP/err.txt"
[{"severity":"low","title":"no engine field","location":"x.py","category":"coverage"},{"severity":"LOW","title":"","location":"x.py","category":"coverage","engine":"claude"}]
JSON
grep -q "logged 1 finding(s) to .claude/reviewer/history.jsonl (1 rejected)" "$TMP/out2.txt" || fail "row-level logging summary (got: $(cat "$TMP/out2.txt"))"
grep -q "row 1 rejected: title" "$TMP/err.txt" || fail "rejection names the row and field (got: $(cat "$TMP/err.txt"))"
[[ "$(tail -1 "$OUT" | jq -r '.engine + " " + .severity')" == "claude LOW" ]] || fail "engine default and severity case"
[[ "$(wc -l <"$OUT" | tr -d ' ')" == "4" ]] || fail "one row appended from the second batch"

# 3. `locations` persists as an array of objects; absent → [location]; bare string → [string]; pattern absent → null.
"$SCRIPT" --change "openspec/changes/demo" --source result --round 3 <<'JSON' >/dev/null
[
  {"severity":"MEDIUM","title":"unchecked cast","location":"a.py:parse","category":"correctness","engine":"claude","pattern":"int(","locations":["a.py:parse","b.py:parse","c.py:load"]},
  {"severity":"LOW","title":"no locations field","location":"x.py","category":"coverage","engine":"claude"},
  {"severity":"LOW","title":"bare string locations","location":"y.py","category":"coverage","engine":"claude","locations":"y.py:run"}
]
JSON
[[ "$(tail -3 "$OUT" | head -1 | jq -c '.locations')" == '[{"path":"a.py","symbol":"parse"},{"path":"b.py","symbol":"parse"},{"path":"c.py","symbol":"load"}]' ]] || fail "locations array parsed into objects"
[[ "$(tail -3 "$OUT" | head -1 | jq -r '.pattern')" == 'int(' ]] || fail "pattern not persisted"
[[ "$(tail -2 "$OUT" | head -1 | jq -c '.locations')" == '[{"path":"x.py"}]' ]] || fail "missing locations should default to [location]"
[[ "$(tail -2 "$OUT" | head -1 | jq -r '.pattern')" == 'null' ]] || fail "missing pattern should persist as null"
[[ "$(tail -1 "$OUT" | jq -c '.locations')" == '[{"path":"y.py","symbol":"run"}]' ]] || fail "bare-string locations should be wrapped into an array"

# 4. Unknown --source is rejected (engine is the vocabulary; source is the pipeline).
if "$SCRIPT" --change c --source code-review <<<'[]' >/dev/null 2>&1; then
  fail "--source code-review should be rejected; engine, not source, carries the engine name"
fi

echo "ok: log-findings v3 rows (engine vocabulary + normalization, engines[], integer round, normalized change, locations/pattern defaults, row-level rejection, source enum)"
