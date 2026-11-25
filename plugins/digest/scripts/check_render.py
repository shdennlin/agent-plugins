"""Render checker. Usage: python3 -I check_render.py <file.html> <width> <shots-dir-or-empty> <0|1 run page scripts>
Renders the page in headless Chrome inside an iframe of exactly <width> pixels (so the browser's minimum
window width does not matter), reads the page's own scroll width back, and prints a JSON report.
Exit 0 fits, 1 wider than the window or a path in a table cell broken over lines, 4 no Chrome found, 5 the browser
failed or timed out. Standard library only.
The browser runs with the network cut off (see ISOLATION), because the page is generated content."""
import html
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile

path, width, shots_dir, run_scripts = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4] == "1"
source = open(path, encoding="utf-8", errors="replace").read()

CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome",
]


def fail(message):
    """The browser failed or timed out: say so as an error (exit 5), never as a page that overflows."""
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    print("ERROR: " + message, file=sys.stderr)
    sys.exit(5)


def find_chrome():
    env = os.environ.get("CHROME")
    if env:
        if os.access(env, os.X_OK):
            return env
        print("ERROR: CHROME=%s is not an executable browser, so the render was not checked." % env, file=sys.stderr)
        sys.exit(4)
    for c in CANDIDATES:
        found = c if os.path.isabs(c) and os.access(c, os.X_OK) else shutil.which(c)
        if found:
            return found
    return None


chrome = find_chrome()
if not chrome:
    print("ERROR: no Chrome or Chromium found, so the render was not checked. Set CHROME to a browser binary.", file=sys.stderr)
    sys.exit(4)

PROBE = """<script>
window.onload = function () { setTimeout(function () {
  var f = document.getElementById('f'), d = f.contentDocument, w = f.contentWindow, W = %d, bad = [];
  d.querySelectorAll('body *').forEach(function (el) {
    if (el.tagName === 'SCRIPT') return;
    var r = el.getBoundingClientRect();
    if (r.right <= W + 1) return;
    for (var a = el.parentElement; a && a !== d.body; a = a.parentElement) {
      if (/(auto|scroll)/.test(w.getComputedStyle(a).overflowX)) return;
    }
    var cls = (typeof el.className === 'string' && el.className) ? '.' + el.className.split(' ')[0] : '';
    bad.push(el.tagName.toLowerCase() + cls + ':' + Math.round(r.right));
  });
  var wrapped = [];
  d.querySelectorAll('td code, th code').forEach(function (el) {
    if (el.getClientRects().length > 1) wrapped.push((el.textContent || '').slice(0, 40));
  });
  document.body.insertAdjacentHTML('beforeend', '<pre id="probe">' + JSON.stringify({
    w: d.documentElement.scrollWidth, h: d.documentElement.scrollHeight, bad: bad.slice(0, 8), wc: wrapped.slice(0, 8)}) + '</pre>');
}, 400); };
</script>"""


# The page is generated and untrusted. By default its scripts do not run (the iframe is sandboxed without
# allow-scripts), so there is no fetch, no beacon and no WebRTC to worry about. With --scripts they run, and a
# Content-Security-Policy, set on the wrapper document that every srcdoc frame inherits (so a page without a <head>,
# or with a commented-out one, cannot dodge it), closes everything except inline script and style on top of the
# network cut-off. frame-src about: lets the wrapper hold its own srcdoc frame and nothing else, so a page cannot
# frame a local file.
CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-src about:"


def wrapper(src, w, h, probe):
    sandbox = "allow-same-origin allow-scripts" if run_scripts else "allow-same-origin"
    return ('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="%s"></head><body style="margin:0;background:#888">'
            '<iframe id="f" width="%d" height="%d" sandbox="%s" style="border:0;background:#fff;display:block" srcdoc="%s"></iframe>%s'
            '</body></html>' % (html.escape(CSP, quote=True), w, h, sandbox, html.escape(src, quote=True), PROBE % w if probe else ""))


# The page being checked is generated, may contain script, and must not reach out while it is rendered:
# not to the internet and not to services on this machine either. The proxy points at a closed port and
# is not bypassed for loopback, every host name fails to resolve, and the profile is a throwaway.
ISOLATION = [
    "--proxy-server=127.0.0.1:9",
    "--proxy-bypass-list=<-loopback>",
    "--host-resolver-rules=MAP * ~NOTFOUND",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--no-first-run",
    # WebRTC sends UDP that ignores the proxy; only matters when page scripts run (--scripts)
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
]


def run_chrome(args):
    """Run the browser in its own process group and kill the whole group on a timeout, so no helper process lingers."""
    timeout = float(os.environ.get("CHECK_RENDER_TIMEOUT", "120"))
    with tempfile.TemporaryDirectory() as profile:
        proc = subprocess.Popen([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--user-data-dir=" + profile] + ISOLATION + args,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        try:
            out, err = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except OSError:
                pass
            proc.communicate()
            fail("the browser did not finish within %g seconds, so the render was not checked." % timeout)
    return subprocess.CompletedProcess(proc.args, proc.returncode, out, err)


def probe(src, w):
    with tempfile.TemporaryDirectory() as tmp:
        wp = os.path.join(tmp, "probe.html")
        open(wp, "w", encoding="utf-8").write(wrapper(src, w, 900, True))
        out = run_chrome(["--virtual-time-budget=4000", "--dump-dom", "file://" + wp]).stdout
    # the script's own source also contains the text <pre id="probe">, so insist on a JSON object right after it
    m = re.search(r'<pre id="probe">(\{.*?\})</pre>', out, flags=re.S)
    if not m:
        fail("the browser did not return a measurement, so the render was not checked.")
    return json.loads(html.unescape(m.group(1)))


def themed(src, dark):
    """Force the dark palette on or off by rewriting the prefers-color-scheme: dark media query."""
    return re.sub(r"\(prefers-color-scheme:\s*dark\)", "(min-width: 0px)" if dark else "(min-width: 99999px)", src)


result = probe(source, width)
report = {
    "ok": result["w"] <= width + 1 and not result["wc"],
    "width": width,
    "doc_scroll_width": result["w"],
    "doc_scroll_height": result["h"],
    "overflowing": result["bad"],
    "table_code_wrapped": result["wc"],
    "shots": [],
}

if shots_dir:
    os.makedirs(shots_dir, exist_ok=True)
    for label, w in (("wide", 1100), ("narrow", width)):
        height = min(max(probe(source, w)["h"] + 8, 400), 9000)
        for theme in ("light", "dark"):
            out_png = os.path.abspath(os.path.join(shots_dir, "%s-%s.png" % (label, theme)))
            with tempfile.TemporaryDirectory() as tmp:
                wp = os.path.join(tmp, "shot.html")
                open(wp, "w", encoding="utf-8").write(wrapper(themed(source, theme == "dark"), w, height, False))
                run_chrome(["--window-size=%d,%d" % (max(w, 600), height), "--screenshot=" + out_png, "file://" + wp])
            if os.path.exists(out_png):
                report["shots"].append(out_png)

print(json.dumps(report, ensure_ascii=False))
sys.exit(0 if report["ok"] else 1)
