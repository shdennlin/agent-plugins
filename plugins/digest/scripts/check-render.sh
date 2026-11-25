#!/bin/bash
# Render Checker (optional)
# Renders a generated HTML explainer in a real browser at a narrow width and reports horizontal overflow,
# which no static check can see. With --shots it also saves wide and narrow, light and dark screenshots
# for a human to look at. Needs python3 and a Chrome or Chromium; without a browser it exits 4 and the
# caller should say the render was not checked.
#
#   "${CLAUDE_PLUGIN_ROOT}/scripts/check-render.sh" <file.html> [--width 400] [--shots <dir>]
#
# Exit codes: 0 fits, 1 the page is wider than the window, 2 usage error, 3 python3 missing, 4 no Chrome found.
# Set CHROME to the browser binary to use a specific one.

set -euo pipefail

show_help() {
  cat <<'EOF'
Usage: check-render.sh <file.html> [--width N] [--shots <dir>]

Render the page at N pixels wide (default 400) in headless Chrome and print a JSON report:
  {"ok": bool, "width": N, "doc_scroll_width": N, "doc_scroll_height": N, "overflowing": [...], "shots": [...]}
The page fails when its own width is larger than the window. Content inside an overflow-x: auto
container is allowed to be wider.

Options:
  --width N        Window width in pixels (default 400)
  --shots <dir>    Also write wide-light.png, wide-dark.png, narrow-light.png and narrow-dark.png there
  -h, --help       Show this help message

Exit codes: 0 fits, 1 wider than the window, 2 usage error, 3 python3 missing, 4 no Chrome found.
Set CHROME to the browser binary to use a specific one.
EOF
}

die() { echo "ERROR: $*" >&2; exit 2; }

file=""
width="400"
shots=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help) show_help; exit 0 ;;
    --width)
      [ "$#" -ge 2 ] || die "--width needs a number"
      width="$2"; shift 2 ;;
    --shots)
      [ "$#" -ge 2 ] || die "--shots needs a directory"
      shots="$2"; shift 2 ;;
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

exec python3 -I "${BASH_SOURCE[0]%/*}/check_render.py" "$file" "$width" "$shots"
