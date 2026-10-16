#!/usr/bin/env bash
# Structural test for templates/review-engines.yaml, the data behind `/reviewer:result -c <engine>`:
# every entry the command may select must exist and carry the fields Step 3b/3c read.
# grep-only so it runs without PyYAML.
#
#   bash plugins/reviewer/tests/review-engines.test.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$HERE/../templates/review-engines.yaml"
fail() { echo "ASSERT FAIL: $*" >&2; exit 1; }
[[ -f "$T" ]] || fail "missing $T"

for engine in code-review spectra-review _default; do
  grep -qE "^  ${engine}:\$" "$T" || fail "engine entry '$engine' missing"
  block="$(awk -v e="  ${engine}:" '$0==e{f=1;next} f&&/^  [A-Za-z_-]+:$/{f=0} f' "$T")"
  for field in skill: args: never_pass: findings_from: severity_map: notes:; do
    grep -q "^    ${field}" <<<"$block" || fail "engine '$engine' lacks field '$field'"
  done
done
awk '$0=="  code-review:"{f=1;next} f&&/^  [A-Za-z_-]+:$/{f=0} f' "$T" | grep -q 'level_required: true' || fail "code-review must require a level"
awk '$0=="  code-review:"{f=1;next} f&&/^  [A-Za-z_-]+:$/{f=0} f' "$T" | grep -qE 'CONFIRMED: medium|PLAUSIBLE: low' || fail "code-review severity_map changed"
awk '$0=="  spectra-review:"{f=1;next} f&&/^  [A-Za-z_-]+:$/{f=0} f' "$T" | grep -qE 'Critical: high' || fail "spectra-review severity_map changed"
grep -q 'review-engines.yaml' "$HERE/../commands/result.md" || fail "commands/result.md does not reference the template"
echo "ok: review-engines.yaml has code-review, spectra-review, _default with skill/args/never_pass/findings_from/severity_map/notes"
