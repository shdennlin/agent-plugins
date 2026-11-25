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
SERVER_PID=""
cleanup() { if [[ -n "$SERVER_PID" ]]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi; rm -rf "$TMP"; }
trap cleanup EXIT
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

# The symptom of a squeezed table: a path inside a table cell broken over several lines. The page itself may
# still fit the window, so the report names the table code that wrapped and the page fails.
cat >table-breaks.html <<EOF
<!doctype html><html><head><meta charset="utf-8"><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111}
@media (prefers-color-scheme: dark){:root{--bg:#111;--fg:#eee}}
body{margin:0;padding:1rem;background:var(--bg);color:var(--fg)}
table{width:100%;border-collapse:collapse}
code{overflow-wrap:anywhere}
</style></head><body><main><table>
<tr><td><code>$LONG</code></td><td>+401 −0</td><td>needs attention</td><td>New rule engine with several checks and a long description</td></tr>
</table></main></body></html>
EOF
run_render table-breaks.html
[[ "$RC" == "1" ]] || fail "a table path broken over lines should exit 1, got $RC: $OUT"
[[ "$(printf '%s' "$OUT" | jq -r '.table_code_wrapped | length')" -ge 1 ]] || fail "the wrapped table code should be named: $OUT"
cat >table-whole.html <<EOF
<!doctype html><html><head><meta charset="utf-8"><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111}
@media (prefers-color-scheme: dark){:root{--bg:#111;--fg:#eee}}
body{margin:0;padding:1rem;background:var(--bg);color:var(--fg)}
.wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse}
td code{white-space:nowrap}
</style></head><body><main><div class="wrap"><table>
<tr><td><code>$LONG</code></td><td>+401 −0</td><td>needs attention</td><td>New rule engine with several checks and a long description</td></tr>
</table></div></main></body></html>
EOF
run_render table-whole.html
[[ "$RC" == "0" ]] || fail "a table that scrolls with whole paths should exit 0, got $RC: $OUT"
[[ "$(printf '%s' "$OUT" | jq -r '.table_code_wrapped | length')" == "0" ]] || fail "no table code should be wrapped: $OUT"

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

# Page scripts do not run unless asked: layout is measured from HTML and CSS, and a generated page's script
# is untrusted. A script that widens the page is ignored by default and counted with --scripts.
cat >script-widens.html <<'EOF'
<!doctype html><html><head><meta charset="utf-8"><style>:root{color-scheme:light dark}
@media (prefers-color-scheme: dark){:root{--x:1}}body{margin:0}</style></head><body><p>hello</p>
<script>document.body.style.width='3000px'</script></body></html>
EOF
run_render script-widens.html
[[ "$RC" == "0" ]] || fail "by default page scripts must not run, so the page fits: rc=$RC $OUT"
run_render script-widens.html --scripts
[[ "$RC" == "1" ]] || fail "with --scripts the page's script runs and widens it: rc=$RC $OUT"

# The browser is cut off from the network: a generated page may contain script (the template allows inline
# JS) and must not be able to reach out while it is being checked, not even to this machine.
PORT="$(python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
mkdir -p srv
python3 -I -m http.server "$PORT" --bind 127.0.0.1 --directory srv >"$TMP/requests.log" 2>&1 &
SERVER_PID=$!
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
  [[ "$RC" == "0" ]] || fail "the page that reaches out must still render (exit 0), got $RC: $OUT $(cat "$TMP/err")"
  run_render reaches-out.html --scripts
  [[ "$RC" == "0" ]] || fail "the page that reaches out must still render with --scripts (exit 0), got $RC: $OUT $(cat "$TMP/err")"
  sleep 0.5
  AFTER="$(wc -l <"$TMP/requests.log" | tr -d ' ')"
  kill "$SERVER_PID" 2>/dev/null || true
  [[ "$AFTER" == "$BEFORE" ]] || fail "the render reached the network: $(tail -n +$((BEFORE + 1)) "$TMP/requests.log" | head -3)"
else
  kill "$SERVER_PID" 2>/dev/null || true
  echo "note: could not start a local server, network isolation was not tested"
fi

# Usage errors and a missing browser have their own exit codes.
run_render
[[ "$RC" == "2" ]] || fail "no file should exit 2, got $RC"
run_render nope.html
[[ "$RC" == "2" ]] || fail "missing file should exit 2, got $RC"
run_render fits.html --width banana
[[ "$RC" == "2" ]] || fail "a non-numeric width should exit 2, got $RC"
# An explicit CHROME that does not exist is an error (exit 4), not a silent fall back to another browser.
OUT="$(env CHROME=/nonexistent/chrome /bin/bash "$SCRIPT" fits.html 2>"$TMP/err")" && RC=0 || RC=$?
[[ "$RC" == "4" ]] || fail "a wrong CHROME should exit 4, got $RC: $OUT"
grep -q 'CHROME' "$TMP/err" || fail "the message should name CHROME: $(cat "$TMP/err")"

# A browser that hangs or prints nothing is exit 5 with a JSON error, never a traceback or a "page overflows" exit 1.
printf '#!/bin/sh\nsleep 30\n' >hang-chrome && chmod +x hang-chrome
OUT="$(env CHROME="$TMP/hang-chrome" CHECK_RENDER_TIMEOUT=2 /bin/bash "$SCRIPT" fits.html 2>"$TMP/err")" && RC=0 || RC=$?
[[ "$RC" == "5" ]] || fail "a hanging browser should exit 5, got $RC: $OUT $(cat "$TMP/err")"
grep -q 'Traceback' "$TMP/err" && fail "a hanging browser must not print a traceback: $(cat "$TMP/err")"
[[ "$(printf '%s' "$OUT" | jq -r .ok)" == "false" && -n "$(printf '%s' "$OUT" | jq -r '.error // empty')" ]] || fail "a hanging browser should report a JSON error: $OUT"
printf '#!/bin/sh\nexit 0\n' >silent-chrome && chmod +x silent-chrome
OUT="$(env CHROME="$TMP/silent-chrome" /bin/bash "$SCRIPT" fits.html 2>"$TMP/err")" && RC=0 || RC=$?
[[ "$RC" == "5" ]] || fail "a browser that prints nothing should exit 5, got $RC: $OUT"

# The wrapper finds its helper through a symlink on PATH and when called by a bare name.
mkdir -p "$TMP/symbin" && ln -sf "$SCRIPT" "$TMP/symbin/check-render"
OUT="$(PATH="$TMP/symbin:$PATH" check-render fits.html 2>"$TMP/err")" && RC=0 || RC=$?
[[ "$RC" == "0" ]] || fail "called through a symlink on PATH: rc=$RC $OUT $(cat "$TMP/err")"
OUT="$(cd "$HERE/../scripts" && bash check-render.sh "$TMP/fits.html" 2>"$TMP/err")" && RC=0 || RC=$?
[[ "$RC" == "0" ]] || fail "called by a bare name: rc=$RC $OUT $(cat "$TMP/err")"

echo "ok: check-render"
