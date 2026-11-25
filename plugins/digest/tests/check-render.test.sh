#!/usr/bin/env bash
# Regression test for scripts/check-render.sh: renders a page in a real browser at a narrow width and
# reports horizontal overflow that no static check can see, and can save screenshots for a human to
# look at. Skipped when python3 or a Chrome is not installed. No Claude, no network.
#
#   bash plugins/digest/tests/check-render.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../scripts/check-render.sh"
command -v jq >/dev/null 2>&1 || { echo "skip: jq not installed"; exit 0; }
command -v python3 >/dev/null 2>&1 || { echo "skip: python3 not installed"; exit 0; }
CHROME_BIN="${CHROME:-}"
if [[ -z "$CHROME_BIN" ]]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           "$(command -v google-chrome || true)" "$(command -v chromium || true)" "$(command -v chromium-browser || true)"; do
    if [[ -n "$c" && -x "$c" ]]; then CHROME_BIN="$c"; break; fi
  done
fi
[[ -n "$CHROME_BIN" ]] || { echo "skip: no Chrome found"; exit 0; }
export CHROME="$CHROME_BIN"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

fail() { echo "ASSERT FAIL: $*" >&2; exit 1; }
run_render() { OUT="$("$SCRIPT" "$@" 2>"$TMP/err")" && RC=0 || RC=$?; }

LONG='plugins/digest/scripts/very/long/path/that/never/breaks/check_explainer_with_a_really_long_name.py'

# A page whose content fits: text wraps, a wide table scrolls in its own container.
cat >fits.html <<EOF
<!doctype html><html><head><meta charset="utf-8"><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111}
@media (prefers-color-scheme: dark){:root{--bg:#111;--fg:#eee}}
body{margin:0;padding:1rem;background:var(--bg);color:var(--fg)}
code{overflow-wrap:anywhere}
.wrap{overflow-x:auto}
</style></head><body><main>
<h1>Fits</h1><p>Some prose that wraps and a long path <code>$LONG</code> that is allowed to wrap.</p>
<div class="wrap"><table><tr><td style="white-space:nowrap">$LONG$LONG</td></tr></table></div>
</main></body></html>
EOF
run_render fits.html
[[ "$RC" == "0" ]] || fail "a page that fits should exit 0, got $RC: $OUT $(cat err)"
[[ "$(printf '%s' "$OUT" | jq -r .ok)" == "true" ]] || fail "fits: ok should be true: $OUT"
[[ "$(printf '%s' "$OUT" | jq -r .doc_scroll_width)" -le 400 ]] || fail "fits: the document should not be wider than 400: $OUT"

# A page that overflows: an unbreakable long path in running text, no wrapping, no scroller.
cat >overflows.html <<EOF
<!doctype html><html><head><meta charset="utf-8"><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111}
@media (prefers-color-scheme: dark){:root{--bg:#111;--fg:#eee}}
body{margin:0;padding:1rem;background:var(--bg);color:var(--fg)}
code{white-space:nowrap}
</style></head><body><main>
<h1>Overflows</h1><p>A long path <code>$LONG</code> in running text.</p>
</main></body></html>
EOF
run_render overflows.html
[[ "$RC" == "1" ]] || fail "an overflowing page should exit 1, got $RC: $OUT"
[[ "$(printf '%s' "$OUT" | jq -r .ok)" == "false" ]] || fail "overflows: ok should be false: $OUT"
[[ "$(printf '%s' "$OUT" | jq -r '.doc_scroll_width')" -gt 400 ]] || fail "overflows: the document should be wider than 400: $OUT"
[[ "$(printf '%s' "$OUT" | jq -r '.overflowing | length')" -ge 1 ]] || fail "overflows: the offending element should be named: $OUT"
printf '%s' "$OUT" | jq -r '.overflowing[0]' | grep -q 'code' || fail "overflows: the offender should be the code element: $OUT"

# The width is configurable: the same fitting page also fits at 320.
run_render fits.html --width 320
[[ "$RC" == "0" ]] || fail "fits at 320 should exit 0, got $RC: $OUT"
[[ "$(printf '%s' "$OUT" | jq -r .width)" == "320" ]] || fail "the reported width should be 320: $OUT"

# Screenshots for a human: wide and narrow, light and dark, written as PNG files.
run_render fits.html --shots "$TMP/shots"
[[ "$RC" == "0" ]] || fail "shots run should exit 0, got $RC: $OUT $(cat err)"
for f in wide-light wide-dark narrow-light narrow-dark; do
  [[ -s "$TMP/shots/$f.png" ]] || fail "missing screenshot $f.png"
done
[[ "$(printf '%s' "$OUT" | jq -r '.shots | length')" == "4" ]] || fail "the report should list 4 screenshots: $OUT"

# The browser is cut off from the network: a generated page may contain script (the template allows inline
# JS) and must not be able to reach out while it is being checked, not even to this machine.
PORT="$(python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
mkdir -p srv && (cd srv && python3 -I -m http.server "$PORT" --bind 127.0.0.1 >"$TMP/requests.log" 2>&1 &) 
SERVER_UP=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/control"; then SERVER_UP=1; break; fi
  sleep 0.3
done
if [[ "$SERVER_UP" == "1" ]]; then
  sleep 0.3
  grep -q 'GET /control' "$TMP/requests.log" || fail "the control request was not logged, so this test cannot tell anything"
  BEFORE="$(wc -l <"$TMP/requests.log" | tr -d ' ')"
  cat >reaches-out.html <<EOF
<!doctype html><html><head><meta charset="utf-8"><style>:root{color-scheme:light dark}
@media (prefers-color-scheme: dark){:root{--x:1}}body{margin:0}</style></head><body>
<img src="http://127.0.0.1:$PORT/probe.png"><link rel="stylesheet" href="http://127.0.0.1:$PORT/probe.css">
<script>fetch('http://127.0.0.1:'+'$PORT'+'/fetch');new Image().src='http://127.0.0.1:'+'$PORT'+'/beacon';</script>
<p>hello</p></body></html>
EOF
  run_render reaches-out.html --shots "$TMP/shots2"
  sleep 0.5
  AFTER="$(wc -l <"$TMP/requests.log" | tr -d ' ')"
  pkill -f "http.server $PORT" >/dev/null 2>&1 || true
  [[ "$AFTER" == "$BEFORE" ]] || fail "the render reached the network: $(tail -n +$((BEFORE + 1)) "$TMP/requests.log" | head -3)"
else
  pkill -f "http.server $PORT" >/dev/null 2>&1 || true
  echo "note: could not start a local server, network isolation was not tested"
fi

# Usage errors and a missing browser have their own exit codes.
run_render
[[ "$RC" == "2" ]] || fail "no file should exit 2, got $RC"
run_render nope.html
[[ "$RC" == "2" ]] || fail "missing file should exit 2, got $RC"
run_render fits.html --width banana
[[ "$RC" == "2" ]] || fail "a non-numeric width should exit 2, got $RC"
OUT="$(env CHROME=/nonexistent/chrome PATH="/usr/bin:/bin" HOME="$TMP" /bin/bash "$SCRIPT" fits.html 2>"$TMP/err")" && RC=0 || RC=$?
if [[ "$RC" != "4" ]]; then
  # a Chrome may still be found on PATH or in /Applications on this machine; only check the message shape
  [[ "$RC" == "0" || "$RC" == "1" ]] || fail "unexpected exit $RC when CHROME is wrong: $(cat "$TMP/err")"
else
  grep -q -i 'chrome' "$TMP/err" || fail "no Chrome should say so: $(cat "$TMP/err")"
fi

echo "ok: check-render"
