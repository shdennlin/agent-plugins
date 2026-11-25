#!/bin/bash
# Render Checker (optional)
# Renders a generated HTML explainer in a real browser at a narrow width and reports horizontal overflow,
# which no static check can see. With --shots it also saves wide and narrow, light and dark screenshots
# for a human to look at. Needs python3 and a Chrome or Chromium; without a browser it exits 4 and the
# caller should say the render was not checked.
#
#   "${CLAUDE_PLUGIN_ROOT}/scripts/check-render.sh" <file.html> [--width 400] [--shots <dir>] [--scripts]
#
# Exit codes: 0 fits, 1 the page is wider than the window or a table path is broken over lines, 2 usage error,
# 3 python3 missing, 4 no Chrome found, 5 the browser failed or timed out.
# Set CHROME to the browser binary to use a specific one.

set -euo pipefail

show_help() {
  cat <<'EOF'
Usage: check-render.sh <file.html> [--width N] [--shots <dir>] [--scripts]

Render the page at N pixels wide (default 400) in headless Chrome and print a JSON report:
  {"ok": bool, "width": N, "doc_scroll_width": N, "doc_scroll_height": N, "overflowing": [...],
   "table_code_wrapped": [...], "shots": [...]}
The page fails when its own width is larger than the window, or when code inside a table cell is
broken over several lines (a squeezed table). Content inside an overflow-x: auto container is
allowed to be wider.

Options:
  --width N        Window width in pixels (default 400)
  --shots <dir>    Also write wide-light.png, wide-dark.png, narrow-light.png and narrow-dark.png there
  --scripts        Let the page's own scripts run. They are off by default because the page is generated
                   and untrusted, and layout is measured from HTML and CSS; the cost is that content a
                   script builds (a chart) is not measured. With --scripts the network is still cut off
                   (proxy, name resolution and a Content-Security-Policy) and WebRTC's non-proxied UDP is
                   disabled, but do not use it on a page from a source you do not trust.
  -h, --help       Show this help message

Exit codes: 0 fits, 1 wider than the window or a table path broken over lines, 2 usage error, 3 python3 missing,
4 no Chrome found, 5 the browser failed or timed out (the report is then {"ok": false, "error": ...}).
Set CHROME to the browser binary to use a specific one; a CHROME that does not exist is an error, not
something to work around. CHECK_RENDER_TIMEOUT (seconds, default 120) bounds one browser run.
EOF
}

die() { echo "ERROR: $*" >&2; exit 2; }

file=""
width="400"
shots=""
scripts="0"

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help) show_help; exit 0 ;;
    --width)
      [ "$#" -ge 2 ] || die "--width needs a number"
      width="$2"; shift 2 ;;
    --shots)
      [ "$#" -ge 2 ] || die "--shots needs a directory"
      shots="$2"; shift 2 ;;
    --scripts) scripts="1"; shift ;;
    -*) die "unknown option: $1" ;;
    *)
      [ -z "$file" ] || die "only one file can be checked at a time"
      file="$1"; shift ;;
  esac
done

[ -n "$file" ] || die "no file given (see --help)"
[ -f "$file" ] || die "file not found: $file"
case "$width" in ''|*[!0-9]*) die "--width must be a whole number of pixels, not '$width'" ;; esac

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required to render-check an explainer. The render was not checked." >&2
  exit 3
fi

# this script's real directory, found through symlinks and when it is called by a bare name
src="${BASH_SOURCE[0]}"
while [ -L "$src" ]; do
  dir="$(cd "$(dirname "$src")" && pwd)"
  src="$(readlink "$src")"
  case "$src" in /*) ;; *) src="$dir/$src" ;; esac
done
here="$(cd "$(dirname "$src")" && pwd)"

exec python3 -I "$here/check_render.py" "$file" "$width" "$shots" "$scripts"
