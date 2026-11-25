"""Render checker. Usage: python3 -I check_render.py <file.html> <width> <shots-dir-or-empty> <0|1 run page scripts>
Renders the page in headless Chrome inside an iframe of exactly <width> pixels (so the browser's minimum
window width does not matter), reads the page's own scroll width back, and prints a JSON report.
Exit 0 fits, 1 wider than the window, 4 no Chrome found. Standard library only.
The browser runs with the network cut off (see ISOLATION), because the page is generated content."""
import html
import json
import os
import re
import shutil
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


def find_chrome():
    env = os.environ.get("CHROME")
    if env and os.access(env, os.X_OK):
        return env
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
  document.body.insertAdjacentHTML('beforeend', '<pre id="probe">' + JSON.stringify({
    w: d.documentElement.scrollWidth, h: d.documentElement.scrollHeight, bad: bad.slice(0, 8)}) + '</pre>');
}, 400); };
</script>"""


# The page is generated and untrusted. By default its scripts do not run (the iframe is sandboxed without
# allow-scripts), so there is no fetch, no beacon and no WebRTC to worry about. With --scripts they run, and a
# Content-Security-Policy closes everything except inline script and style on top of the network cut-off.
CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:"


def with_csp(src):
    meta = '<meta http-equiv="Content-Security-Policy" content="%s">' % CSP
    m = re.search(r"<head[^>]*>", src, flags=re.I)
    if m:
        return src[:m.end()] + meta + src[m.end():]
    m = re.search(r"<html[^>]*>", src, flags=re.I)
    if m:
        return src[:m.end()] + "<head>" + meta + "</head>" + src[m.end():]
    return meta + src


def wrapper(src, w, h, probe):
    sandbox = "allow-same-origin allow-scripts" if run_scripts else "allow-same-origin"
    return ('<!doctype html><html><body style="margin:0;background:#888">'
            '<iframe id="f" width="%d" height="%d" sandbox="%s" style="border:0;background:#fff;display:block" srcdoc="%s"></iframe>%s'
            '</body></html>' % (w, h, sandbox, html.escape(with_csp(src), quote=True), PROBE % w if probe else ""))


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
    with tempfile.TemporaryDirectory() as profile:
        return subprocess.run([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                               "--user-data-dir=" + profile] + ISOLATION + args,
                              capture_output=True, text=True, timeout=120)


def probe(src, w):
    with tempfile.TemporaryDirectory() as tmp:
        wp = os.path.join(tmp, "probe.html")
        open(wp, "w", encoding="utf-8").write(wrapper(src, w, 900, True))
        out = run_chrome(["--virtual-time-budget=4000", "--dump-dom", "file://" + wp]).stdout
    # the script's own source also contains the text <pre id="probe">, so insist on a JSON object right after it
    m = re.search(r'<pre id="probe">(\{.*?\})</pre>', out, flags=re.S)
    if not m:
        print("ERROR: the browser did not return a measurement.", file=sys.stderr)
        sys.exit(5)
    return json.loads(html.unescape(m.group(1)))


def themed(src, dark):
    """Force the dark palette on or off by rewriting the prefers-color-scheme: dark media query."""
    return re.sub(r"\(prefers-color-scheme:\s*dark\)", "(min-width: 0px)" if dark else "(min-width: 99999px)", src)


result = probe(source, width)
report = {
    "ok": result["w"] <= width + 1,
    "width": width,
    "doc_scroll_width": result["w"],
    "doc_scroll_height": result["h"],
    "overflowing": result["bad"],
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
