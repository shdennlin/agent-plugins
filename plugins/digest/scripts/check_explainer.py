"""Explainer checker. Usage: python3 -I check_explainer.py <file.html> <change|state> <numstat-file-or-empty> <ref-or-empty>
Prints a JSON report. Exit 0 clean, 1 violations, 5 the checker itself failed (the report is then {"ok": false,
"error": ...}). Standard library only.

Violations fail the page; warnings are advice or "could not check" and never fail it. The violations keep to the
rules that must hold (a self-contained page, readable on a narrow window, dark mode, evidence grades, the avoid
list, every changed file accounted for, real references). Layout suggestions such as Expand all, jump links, a
review-focus list or a how-to-verify section are warnings.
All checks are mechanical and deliberately approximate, so a clean report means "no rule is visibly broken", not
"the page is good":
  hard    - external requests, dark mode, color-scheme, a focus style, raw colors outside :root, overflow hidden on
            the page, every table in a scroll container with whole paths in its cells, evidence grade labels, a light
            background near white and a dark one that is not near-black, the reference stylesheet (its color tokens unchanged in both modes, its pill and code-token rules), and
            no color token used without being defined, inline scripts only from the component files
  meaning - at least one <mark>; for a change, semantic colors (ok, warn, bad) actually used; evidence labels that
            read only measured, read or inferred
  avoid   - colored edge bars, a card inside a card, more than 5 emoji
  floor   - change: every changed file named with its +/- counts, stated totals that match the diff, diff-excerpt
            lines copied verbatim from git diff <base>...<ref> and adjacent there when shown back to back; both: a statement of what was not verified,
            file:line anchors that resolve, no invented commit hashes
  warnings - everything else: a change page without a diff excerpt, code excerpts without token colors, more than 3 <mark>, Expand all, jump links, topics,
            review-focus list, risk marks, how-to-verify, state evidence and anchors, tabular numbers, text-wrap:
            balance, untracked anchor files, keyword checks skipped because the page is not in English.
"""
import json
import os
import re
import subprocess
import sys
from html import unescape
from html.parser import HTMLParser

VOID = {"br", "hr", "img", "meta", "link", "input", "area", "base", "col", "embed", "source", "track", "wbr"}
SCROLLS = r"overflow(?:-x)?\s*:\s*(?:auto|scroll)"
LOCAL_PREFIXES = ("data:", "#", "about:", "javascript:", "mailto:")


def git(*args):
    return subprocess.run(["git"] + list(args), capture_output=True, text=True)


def px(value):
    m = re.match(r"\s*([\d.]+)\s*(px|rem|em)?", value)
    if not m:
        return 0.0
    n = float(m.group(1))
    return n * 16 if m.group(2) in ("rem", "em") else n


def simple_selectors(sel):
    """The last compound of each comma-separated selector, pseudo-classes removed: 'main .wrap:not(.x)' -> '.wrap'."""
    out = []
    for one in sel.split(","):
        one = re.sub(r"::?[\w-]+(?:\([^)]*\))?", "", one.strip())
        parts = re.split(r"[\s>+~]+", one.strip())
        if parts and parts[-1]:
            out.append(parts[-1])
    return out


def unquote_path(p):
    """git quotes paths with special or non-ASCII bytes as "src/\\346\\227..."; undo that."""
    p = p.strip()
    if len(p) >= 2 and p[0] == '"' and p[-1] == '"':
        raw, out, i = p[1:-1], bytearray(), 0
        escapes = {"n": b"\n", "t": b"\t", "\\": b"\\", '"': b'"'}
        while i < len(raw):
            c = raw[i]
            if c == "\\" and i + 1 < len(raw):
                nxt = raw[i + 1]
                if nxt in "01234567":
                    j = i + 1
                    k = j
                    while k < len(raw) and k < j + 3 and raw[k] in "01234567":
                        k += 1
                    out.append(int(raw[j:k], 8) & 0xFF)
                    i = k
                    continue
                out += escapes.get(nxt, nxt.encode("utf-8"))
                i += 2
                continue
            out += c.encode("utf-8")
            i += 1
        return out.decode("utf-8", "replace")
    return p


def new_path(p):
    """The path a changed file has now: 'src/{a => b}/x' and 'a => b' both name the new side."""
    p = unquote_path(p)
    m = re.fullmatch(r"(.*)\{(.*) => (.*)\}(.*)", p)
    if m:
        pre, _old, new, post = m.groups()
        return (pre + new + post).replace("//", "/")
    if " => " in p:
        return p.split(" => ", 1)[1]
    return p


class TableScroll(HTMLParser):
    """Counts tables, tables outside a scroll container, and <code> inside a table."""

    def __init__(self, scroll_classes, scroll_tags, scroll_ids):
        super().__init__()
        self.scroll_classes, self.scroll_tags, self.scroll_ids = scroll_classes, scroll_tags, scroll_ids
        self.stack, self.tables, self.unscrolled, self.code_in_table, self.table_depth = [], 0, 0, 0, 0

    def scrolls(self, tag, attrs):
        a = dict(attrs)
        if re.search(SCROLLS, a.get("style") or ""):
            return True
        if tag in self.scroll_tags or a.get("id") in self.scroll_ids:
            return True
        cs = set((a.get("class") or "").split())
        return any(c <= cs for c in self.scroll_classes)

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        if tag == "table":
            self.tables += 1
            if not any(scrolls for _, scrolls in self.stack):
                self.unscrolled += 1
            self.table_depth += 1
        if tag == "code" and self.table_depth:
            self.code_in_table += 1
        self.stack.append((tag, self.scrolls(tag, attrs)))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                if tag == "table":
                    self.table_depth = max(0, self.table_depth - 1)
                del self.stack[i:]
                break


class Nest(HTMLParser):
    """Counts boxes that have their own background or border inside another such box."""

    CARD_TAGS = {"div", "section", "article", "details", "aside", "figure", "blockquote", "header", "footer", "p", "ul", "table"}

    def __init__(self, card_classes, card_tagsel):
        super().__init__()
        self.card_classes, self.card_tagsel = card_classes, card_tagsel
        self.stack, self.nested, self.in_svg = [], 0, 0

    def is_card(self, tag, classes):
        if tag not in self.CARD_TAGS:
            return False
        if tag in self.card_tagsel:
            return True
        cs = set(classes)
        return any(c <= cs for c in self.card_classes)

    def handle_starttag(self, tag, attrs):
        if tag == "svg":
            self.in_svg += 1
        if self.in_svg or tag in VOID:
            return
        card = self.is_card(tag, (dict(attrs).get("class") or "").split())
        if card and any(c for _, c in self.stack):
            self.nested += 1
        self.stack.append((tag, card))

    def handle_endtag(self, tag):
        if tag == "svg":
            self.in_svg = max(0, self.in_svg - 1)
            return
        if self.in_svg or tag in VOID:
            return
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break


def run(path, kind, numstat_path, ref, base_branch=""):
    violations, warnings = [], []

    def violation(group, vid, count, message):
        violations.append({"id": vid, "group": group, "count": count, "message": message})

    def warning(wid, message):
        warnings.append({"id": wid, "message": message})

    # Resolve the inputs against the directory the checker was started in, then work from the repository root,
    # so a file:line anchor resolves the same way wherever the checker is run from.
    path = os.path.abspath(path)
    if numstat_path:
        numstat_path = os.path.abspath(numstat_path)
    top = git("rev-parse", "--show-toplevel")
    in_repo = top.returncode == 0 and bool(top.stdout.strip())
    if in_repo:
        os.chdir(top.stdout.strip())

    s = open(path, encoding="utf-8", errors="replace").read().replace("\r\n", "\n")

    # ------------------------------------------------------------ parse helpers
    css = "\n".join(re.findall(r"<style[^>]*>(.*?)</style>", s, flags=re.S | re.I))
    rules = [(m.group(1).strip(), m.group(2)) for m in re.finditer(r"([^{}@]+)\{([^{}]*)\}", css)]

    body_markup = re.sub(r"<(script|style)\b.*?</\1>", " ", s, flags=re.I | re.S)
    visible = re.sub(r"<[^>]+>", " ", body_markup)
    visible = re.sub(r"&minus;|&#8722;", "−", visible)
    visible = re.sub(r"&amp;", "&", visible)
    visible = re.sub(r"\s+", " ", visible)
    visible_n = re.sub(r"(?<=\d),(?=\d)", "", visible)  # 1,234 and 1234 are the same count
    heads = [re.sub(r"<[^>]+>", "", h).strip()
             for h in re.findall(r"<(?:h[1-6]|summary)\b[^>]*>(.*?)</(?:h[1-6]|summary)>", s, flags=re.S | re.I)]
    h_heads = len(re.findall(r"<h[1-6]\b", s, flags=re.I))
    m = re.search(r"<html\b[^>]*\blang\s*=\s*[\"']?([A-Za-z-]+)", s, flags=re.I)
    lang = m.group(1).lower() if m else "en"
    non_en = not lang.startswith("en")
    inline_styles = " ".join(a or b for a, b in re.findall(r"\sstyle\s*=\s*(?:\"([^\"]*)\"|'([^']*)')", body_markup))

    # ------------------------------------------------------------ hard constraints
    def is_local(u):
        u = (u or "").strip().strip("\"'")
        return u == "" or u.lower().startswith(LOCAL_PREFIXES)

    def attr_of(attrs, name):
        mm = re.search(r"(?:^|\s)%s\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)" % re.escape(name), attrs, flags=re.I)
        return mm.group(1).strip("\"'") if mm else None

    tags_only = re.sub(r"(<script\b[^>]*>).*?(</script>)", r"\1\2", s, flags=re.I | re.S)
    tags_only = re.sub(r"<style\b[^>]*>.*?</style>", "", tags_only, flags=re.I | re.S)
    ext_hits = []
    for m in re.finditer(r"<(script|img|iframe|source|video|audio|embed|track|input|image|object|link|form|meta|use)\b([^>]*)>", tags_only, flags=re.I):
        tag, attrs = m.group(1).lower(), m.group(2)
        candidates = []
        if tag in ("script", "img", "iframe", "source", "video", "audio", "embed", "track", "input"):
            candidates.append(attr_of(attrs, "src"))
        if tag == "video":
            candidates.append(attr_of(attrs, "poster"))
        if tag == "link":
            candidates.append(attr_of(attrs, "href"))
        if tag == "object":
            candidates.append(attr_of(attrs, "data"))
        if tag == "form":
            action = attr_of(attrs, "action")
            if action and re.match(r"https?:|//", action):
                candidates.append(action)
        if tag in ("image", "use"):
            candidates.append(attr_of(attrs, "href") or attr_of(attrs, "xlink:href"))
        if tag == "meta" and re.search(r"http-equiv\s*=\s*[\"']?refresh", attrs, flags=re.I):
            mm = re.search(r"url\s*=\s*([^\"';]+)", attr_of(attrs, "content") or "", flags=re.I)
            candidates.append(mm.group(1) if mm else None)
        ext_hits += [u for u in candidates if u is not None and not is_local(u)]
    for text in (css, inline_styles):
        ext_hits += [u for u in re.findall(r"url\(\s*['\"]?([^'\")]*)", text, flags=re.I) if not is_local(u)]
        ext_hits += ["@import" for _ in re.findall(r"@import", text, flags=re.I)]
    for body in re.findall(r"<script\b[^>]*>(.*?)</script>", s, flags=re.I | re.S):
        if re.search(r"\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b", body) and re.search(r"https?://|[\"']//[\w.-]", body):
            ext_hits.append("a script that requests a URL")
    if ext_hits:
        violation("hard", "external_requests", len(ext_hits),
                  "The page loads or requests something outside itself (script src, link, image, iframe, CSS url(), @import, or a script that "
                  "fetches a URL). Inline everything. Found: " + ", ".join(ext_hits[:3]))

    if not (re.search(r"prefers-color-scheme", css) or re.search(r"<style\b[^>]*prefers-color-scheme", s, flags=re.I)):
        violation("hard", "no_dark_mode", 1,
                  "No dark mode: add a @media (prefers-color-scheme: dark) block that redefines the :root color tokens.")

    # Palette floor: the page must not read dim. Approximate by design: the --bg token is what is read.
    def css_block(text, pattern):
        mm = re.search(pattern, text, flags=re.S)
        return mm.group(1) if mm else None

    def css_decl(block, name):
        mm = re.search(r"(?:^|[;{\s])%s\s*:\s*([^;}]+)" % re.escape(name), block or "")
        return mm.group(1).strip() if mm else None

    def lightness(value):
        """HSL lightness (0 to 1) of a #rgb, #rrggbb or rgb() color, or None when the value is not a plain color."""
        v = (value or "").strip().lower()
        mm = re.match(r"#([0-9a-f]{3}|[0-9a-f]{6})$", v)
        if mm:
            h = mm.group(1)
            if len(h) == 3:
                h = "".join(c * 2 for c in h)
            r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
        else:
            mm = re.match(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", v)
            if not mm:
                return None
            r, g, b = (int(x) for x in mm.groups())
        return (max(r, g, b) + min(r, g, b)) / 2 / 255.0

    css_light = re.sub(r"@media[^{]*\{\s*:root\s*\{[^}]*\}\s*\}", "", css)
    light_root = css_block(css_light, r":root\s*\{([^}]*)\}")
    dark_root = css_block(css, r"prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}")
    light_l = lightness(css_decl(light_root, "--bg"))
    dark_l = lightness(css_decl(dark_root, "--bg"))
    palette_info = {"light": None if light_l is None else round(light_l, 3),
                    "dark": None if dark_l is None else round(dark_l, 3)}
    if light_l is None or dark_l is None:
        warning("palette_not_checked", "The --bg token was not found in both :root blocks, so the background floor was not checked.")
    else:
        if light_l < 0.97:
            violation("hard", "light_background_dim", 1,
                      "The light background is %d%% lightness. Use near white (97%% or brighter) so the page does not read grey."
                      % round(light_l * 100))
        if dark_l < 0.16:
            violation("hard", "dark_background_too_dark", 1,
                      "The dark background is %d%% lightness, close to black. Use a lifted charcoal of about 16%% to 20%%."
                      % round(dark_l * 100))

    # The reference stylesheet (html-explainer-style.css next to the template) carries the measured colors for the
    # evidence pills and code tokens; a page that restyles them from scratch loses the contrast that was measured.
    def root_tokens(text):
        """The color tokens of a stylesheet: (light, dark) dicts of --name -> normalized value, later blocks winning."""
        light_text = re.sub(r"@media[^{]*\{\s*:root\s*\{[^}]*\}\s*\}", "", text)
        norm = lambda v: re.sub(r"\s+", " ", v.strip().lower())
        light, dark = {}, {}
        for blk in re.findall(r":root\s*\{([^}]*)\}", light_text):
            light.update({k: norm(v) for k, v in re.findall(r"(--[\w-]+)\s*:\s*([^;}]+)", blk)})
        for blk in re.findall(r"prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}", text):
            dark.update({k: norm(v) for k, v in re.findall(r"(--[\w-]+)\s*:\s*([^;}]+)", blk)})
        return light, dark

    style_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "templates", "html-explainer-style.css")
    try:
        with open(style_path, encoding="utf-8") as fh:
            ref_light, ref_dark = root_tokens(fh.read())
    except OSError:
        ref_light = ref_dark = None
    if ref_light is None:
        warning("reference_style_not_checked", "The reference stylesheet html-explainer-style.css was not found next to the "
                "template, so the page's color tokens were not compared with it.")
    else:
        page_light, page_dark = root_tokens(css)
        changed = ["%s (light)" % k for k, v in ref_light.items() if page_light.get(k) != v]
        changed += ["%s (dark)" % k for k, v in ref_dark.items() if page_dark.get(k) != v]
        if changed:
            violation("hard", "reference_style_changed", len(changed),
                      "These color tokens are missing or differ from html-explainer-style.css, whose values were measured at "
                      "about 7:1: %s. Copy the reference block unchanged." % ", ".join(changed[:8]))
    defined_tokens = set(re.findall(r"(--[\w-]+)\s*:", css))
    token_uses = css + " " + inline_styles + " " + " ".join(
        re.findall(r"\s(?:fill|stroke|stop-color|color)\s*=\s*[\"']([^\"']*)[\"']", body_markup, flags=re.I))
    undefined = sorted({u for u in re.findall(r"var\(\s*(--[\w-]+)\s*\)", token_uses) if u not in defined_tokens})
    if undefined:
        violation("hard", "undefined_token", len(undefined),
                  "These color tokens are used but never defined, so the browser falls back to black or transparent (in dark "
                  "mode, black text on a dark page): %s. Use the reference stylesheet's tokens, such as --ink for text."
                  % ", ".join(undefined[:5]))
    # Scripts: a page may only carry the scripts of the component files next to the template, unchanged, so what runs
    # in a reader's browser is code that was reviewed once, not code an agent wrote for this page.
    comp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "templates", "components")
    squash = lambda t: re.sub(r"\s+", " ", t).strip()
    page_scripts = [squash(b) for b in re.findall(r"<script\b[^>]*>(.*?)</script>", s, flags=re.S | re.I) if squash(b)]
    if os.path.isdir(comp_dir):
        allowed = set()
        for name in sorted(os.listdir(comp_dir)):
            if name.endswith(".html"):
                with open(os.path.join(comp_dir, name), encoding="utf-8") as fh:
                    text = re.sub(r"<!--.*?-->", "", fh.read(), flags=re.S)   # the header comment names <script> too
                    allowed.update(squash(b) for b in re.findall(r"<script>(.*?)</script>", text, flags=re.S) if squash(b))
        foreign = [b for b in page_scripts if b not in allowed]
        if foreign:
            violation("hard", "script_not_from_reference", len(foreign),
                      "%d inline script(s) are not one of the component scripts (templates/components/*.html). Copy a "
                      "component's <script> unchanged, or drop the script; the page must read fully without it. First one "
                      "starts: %s" % (len(foreign), foreign[0][:80]))
    elif page_scripts:
        warning("scripts_not_checked", "The components folder was not found next to the template, so the page's scripts "
                "were not compared with the component scripts.")
    missing_cls = [mk for mk in (".g.measured", ".g.read", ".g.inferred", ".tk-kw", ".tk-str", ".tk-com", ".tk-num") if mk not in css]
    if missing_cls:
        violation("hard", "reference_style_missing", len(missing_cls),
                  "The page lacks the reference stylesheet's rules for %s. Copy the whole block of html-explainer-style.css "
                  "into the page's <style> element." % ", ".join(missing_cls))
    plain_pre = [b for b in re.findall(r"<pre\b[^>]*>(.*?)</pre>", s, flags=re.S | re.I)
                 if len(re.sub(r"<[^>]+>", "", b).strip()) >= 20 and not re.search(r"tk-|d-add|d-del", b)]
    if plain_pre:
        warning("code_not_highlighted",
                "%d code excerpt(s) have no token colors. Wrap keywords, strings, comments and numbers in tk-kw, tk-str, "
                "tk-com and tk-num spans." % len(plain_pre))

    # Raw colors: in CSS outside :root, in style attributes and in SVG color attributes, not in prose or <pre>.
    css_wo_root = re.sub(r":root[^{]*\{[^}]*\}", "", css)
    svg_values = " ".join(re.findall(r"\s(?:fill|stroke|stop-color|flood-color)\s*=\s*[\"']([^\"']*)[\"']", body_markup))
    color_text = css_wo_root + " " + inline_styles + " " + svg_values
    raw = 0
    for m in re.finditer(r"#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])", color_text):
        if color_text[max(0, m.start() - 4):m.start()].lower().endswith("url("):
            continue
        raw += 1
    raw += len(re.findall(r"\b(?:rgb|rgba|hsl|hsla)\(", color_text))
    if raw:
        violation("hard", "raw_colors_outside_tokens", raw,
                  "Raw colors are used outside the :root tokens. Define each color once as a custom property and use var(--name).")

    open_details = 0
    for m in re.finditer(r"<details\b([^>]*)>", s, flags=re.I):
        attrs = re.sub(r"\"[^\"]*\"|'[^']*'", '""', m.group(1))
        if re.search(r"(?:^|\s)open(?=[\s=/]|$)", attrs, flags=re.I):
            open_details += 1
    if open_details:
        warning("details_open_by_default", "A <details> starts open. Deep detail must be collapsed by default: remove the open attribute.")

    page_hidden = [sel for sel, body in rules
                   if any(t.strip() in ("html", "body", ":root") for t in sel.split(","))
                   and re.search(r"overflow(?:-x)?\s*:\s*hidden", body)]
    if page_hidden:
        violation("hard", "overflow_hidden_on_page", len(page_hidden),
                  "overflow is hidden on html or body (%s). That clips content on a narrow window instead of fitting it. "
                  "Remove it and put wide tables, code and diagrams in their own container with overflow-x: auto." % ", ".join(page_hidden))

    cell_breaks = [sel for sel, body in rules
                   if re.search(r"\b(?:td|th)\b", sel)
                   and re.search(r"overflow-wrap\s*:\s*anywhere|word-break\s*:\s*break-all", body)]
    if cell_breaks:
        violation("hard", "table_cells_break_words", len(cell_breaks),
                  "Table cells may break inside a word (%s), so a narrow window shows split words and numbers. "
                  "Keep words whole and let a wide table scroll in an overflow-x: auto container." % ", ".join(cell_breaks))

    # Every table scrolls in its own container, and code inside a table cell stays whole, so a narrow window
    # scrolls the table instead of squeezing a path into one letter per line.
    scroll_classes, scroll_tags, scroll_ids = [], set(), set()
    for sel, body in rules:
        if not re.search(SCROLLS, body):
            continue
        for one in simple_selectors(sel):
            m = re.fullmatch(r"([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)(#[\w-]+)?", one)
            if not m or not one:
                continue
            tag, classes, ident = m.group(1), [c for c in m.group(2).split(".") if c], m.group(3)
            if ident:
                scroll_ids.add(ident[1:])
            elif classes:
                scroll_classes.append(frozenset(classes))
            elif tag and tag not in ("html", "body"):
                scroll_tags.add(tag)
    tbl = TableScroll(scroll_classes, scroll_tags, scroll_ids)
    tbl.feed(s)
    if tbl.unscrolled:
        violation("hard", "table_not_scrollable", tbl.unscrolled,
                  "%d table(s) are not inside a container with overflow-x: auto. A narrow window squeezes the cells until a path "
                  "breaks into one letter per line; put each table in a wrapper that scrolls." % tbl.unscrolled)
    cells_stay_whole = any(
        re.search(r"white-space\s*:\s*(?:nowrap|pre)\b", body) and any(re.fullmatch(r"code(?:[.#][\w-]+)*", c) for c in simple_selectors(sel))
        for sel, body in rules)
    if tbl.code_in_table and not cells_stay_whole:
        violation("hard", "table_code_not_whole", tbl.code_in_table,
                  "Code inside table cells is allowed to wrap (%d element(s)). Add 'td code { white-space: nowrap }' so a path stays whole "
                  "and the table scrolls instead." % tbl.code_in_table)

    n_details = len(re.findall(r"<details\b", s, flags=re.I))
    has_toggle = bool(re.search(r"<button\b[^>]*>(?:(?!</button>).)*?(?:expand|collapse|展開|收合|全部)", s, flags=re.I | re.S)) and ".open" in s
    if n_details >= 2 and not has_toggle:
        warning("expand_all_missing", "The page has %d <details> but no Expand all / Collapse all button. Add one small button above the first <details>." % n_details)

    if not re.search(r":focus(?:-visible)?\b", css):
        violation("hard", "focus_style_missing", 1,
                  "No visible keyboard focus style. Add a :focus-visible rule (an outline) for buttons, summaries and links.")

    if not re.search(r"(?:^|[;{\s])color-scheme\s*:", css):
        violation("hard", "color_scheme_missing", 1,
                  "No color-scheme property. Declare color-scheme: light dark on :root so form controls and scrollbars follow the theme.")

    # ------------------------------------------------------------ meaning
    semantic = r"(?:ok|good|warn|warning|bad|danger|err|error|add|del|risk|crit|critical)"
    sem_tokens = set(re.findall(r"--(" + semantic + r"[\w-]*)\s*:", css))
    sem_classes = set()
    for sel, body in rules:
        if sel.strip().startswith(":root"):
            continue
        if any(re.search(r"var\(--%s\)" % re.escape(t), body) for t in sem_tokens):
            sem_classes.update(re.findall(r"\.([\w-]+)", sel))
    sem_used = sum(len(re.findall(r'class\s*=\s*["\'][^"\']*\b%s\b' % re.escape(c), body_markup)) for c in sem_classes)
    sem_used += sum(len(re.findall(r'style\s*=\s*["\'][^"\']*var\(--%s\)' % re.escape(t), body_markup)) for t in sem_tokens)
    if sem_used < 2 and kind == "change":
        violation("meaning", "semantic_color_unused", 1, "Semantic colors (ok, warn, bad) are not used on the page (%d element(s)). Use them on risk marks and on the +N and −M "
                  "counts, so color carries meaning, not just decoration." % sem_used)

    marks = len(re.findall(r"<mark\b", body_markup, flags=re.I))
    if marks == 0:
        violation("meaning", "mark_missing", 1, "No highlight. Wrap the one sentence the reader must not miss in <mark>.")
    elif marks > 3:
        warning("mark_overused", "%d highlights; use <mark> for at most 3 sentences, otherwise nothing stands out." % marks)

    grades = [g.lower() for g in re.findall(r">\s*(measured|read|inferred)\s*<", body_markup, flags=re.I)]
    if len(grades) < 3 or len(set(grades)) < 2:
        violation("meaning", "grades_missing", 1,
                  "Evidence grades are missing or too few (%d label(s), %d kind(s)). Tag important claims with a small label reading measured "
                  "(you ran it), read (you read the code, with file:line) or inferred (not verified); use at least 3 labels of at least 2 kinds."
                  % (len(grades), len(set(grades))))

    label_texts = [re.sub(r"<[^>]+>", "", t).strip().lower()
                   for t in re.findall(r"<span\b[^>]*\bclass\s*=\s*[\"'](?:[^\"']*\s)?g(?:\s[^\"']*)?[\"'][^>]*>(.*?)</span>",
                                       body_markup, flags=re.S | re.I)]
    misused = sorted({t for t in label_texts if t not in ("measured", "read", "inferred")})
    if misused:
        violation("meaning", "grade_label_misused", len(misused),
                  "Evidence labels (class g) must read measured, read or inferred; found: %s. Show a risk level with the "
                  "classes ok, warn and bad instead." % ", ".join(misused[:5]))

    # ------------------------------------------------------------ avoid list
    bars = []
    for sel, body in rules:
        for m in re.finditer(r"(border-(?:left|right|inline-start|inline-end))\s*:\s*([^;]+)", body):
            val = m.group(2)
            quiet = re.search(r"var\(--(?:border|line|rule|grid|hairline)\)|transparent|none", val)
            if px(val) >= 2 and not quiet:
                bars.append(sel)
        if re.search(r"box-shadow\s*:[^;]*inset\s+-?\d+(?:\.\d+)?px\s+0\s+0", body):
            bars.append(sel + " (inset shadow)")
    bars_total = len(bars) + len(re.findall(r"style\s*=\s*\"[^\"]*border-(?:left|right)\s*:\s*[2-9]", s))
    if bars_total:
        violation("avoid", "colored_edge_bars", bars_total,
                  "A colored bar sits on the edge of a box (%s). Do not use border-left, border-right or an inset shadow as an "
                  "accent stripe; use spacing, a background tint, a small label or a full border." % ", ".join(bars[:3] or ["inline style"]))

    card_classes, card_tagsel = set(), set()
    for sel, body in rules:
        radius = re.search(r"border-radius\s*:\s*([^;]+)", body)
        if not radius:
            continue
        parts = radius.group(1).split()
        if not parts or not (0 < px(parts[0]) < 20):
            continue
        if not (re.search(r"background", body) or re.search(r"(^|;)\s*border\s*:", body)):
            continue
        for one in sel.split(","):
            one = one.strip()
            m = re.fullmatch(r"([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)", one)
            if not m or not one:
                continue
            tag, classes = m.group(1), [c for c in m.group(2).split(".") if c]
            if classes:
                card_classes.add(frozenset(classes))
            elif tag in Nest.CARD_TAGS:
                card_tagsel.add(tag)
    nest = Nest(card_classes, card_tagsel)
    nest.feed(s)
    if nest.nested:
        violation("avoid", "nested_cards", nest.nested,
                  "%d box(es) with their own background or border sit inside another such box (number tiles inside a panel, "
                  "item boxes inside a <details>, a callout inside a card). Lay them out directly on the page, or inside one "
                  "container with spacing and dividers." % nest.nested)

    emoji = len(re.findall("[\U0001F300-\U0001FAFF☀-⛿✅✨❌❎❓❗⭐⭕]", s))
    if emoji > 5:
        violation("avoid", "emoji_over_5", emoji, "%d emoji on the page; use at most 5, none in running prose." % emoji)

    # ------------------------------------------------------------ content floor
    info = {"bytes": len(s.encode("utf-8")), "details": n_details, "emoji": emoji, "visible_words": len(visible.split()), "lang": lang}
    info["background_lightness"] = palette_info
    skipped_for_language = []

    if kind == "change":
        numstat = []
        for line in open(numstat_path, encoding="utf-8", errors="replace"):
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 3 and parts[2].strip():
                numstat.append({"file": new_path(parts[2]),
                                "added": int(parts[0]) if parts[0].isdigit() else None,
                                "removed": int(parts[1]) if parts[1].isdigit() else None})

        def needles(items):
            """The text to look for per file: its name, or the shortest path suffix that tells it apart from every
            other changed file with the same name."""
            by_name = {}
            for it in items:
                by_name.setdefault(os.path.basename(it["file"]), []).append(it["file"])
            out = {}
            for name, group in by_name.items():
                for f in group:
                    parts = f.split("/")
                    depth = 1
                    while depth < len(parts) and any(g != f and g.split("/")[-depth:] == parts[-depth:] for g in group):
                        depth += 1
                    out[f] = "/".join(parts[-depth:])
            return out

        need = needles(numstat)
        not_named, no_counts = [], []
        for item in numstat:
            base = need[item["file"]]
            spots = [m.start() for m in re.finditer(re.escape(base), visible_n)]
            if not spots:
                not_named.append(item["file"])
                continue
            if item["added"] is None or item["removed"] is None:
                continue  # a binary file has no line counts
            found = False
            for p in spots:
                window = visible_n[p:p + 200]
                if (re.search(r"\+\s*%d(?!\d)" % item["added"], window)
                        and re.search(r"[−\-–]\s*%d(?!\d)" % item["removed"], window)):
                    found = True
                    break
            if not found:
                no_counts.append(item["file"])
        if not_named:
            violation("floor", "files_not_named", len(not_named),
                      "Changed files are missing from the page: %s. Every changed file must appear by name." % ", ".join(not_named[:5]))
        if no_counts:
            violation("floor", "files_without_counts", len(no_counts),
                      "These files are named without their line counts as +N −M next to the name: %s." % ", ".join(no_counts[:5]))

        tot_add = sum(i["added"] or 0 for i in numstat)
        tot_rem = sum(i["removed"] or 0 for i in numstat)
        bad_totals = []
        for mm in re.finditer(r"(\d+)\s+(?:changed\s+)?files?\b[^.]{0,40}?(\d[\d,]*)\s+(added|new|inserted|removed|deleted)\s+lines?",
                              visible_n, flags=re.I):
            nf, n, what = int(mm.group(1)), int(mm.group(2).replace(",", "")), mm.group(3).lower()
            want = tot_rem if what in ("removed", "deleted") else tot_add
            if nf != len(numstat) or n != want:
                bad_totals.append("'%s' (the diff has %d files, +%d -%d)" % (mm.group(0), len(numstat), tot_add, tot_rem))
        if bad_totals:
            violation("floor", "totals_mismatch", len(bad_totals),
                      "The page states totals the diff does not match: %s." % "; ".join(bad_totals[:3]))
        if not re.search(r"\bd-(?:add|del)\b", s):
            warning("diff_excerpt_missing", "The page shows no diff excerpt. Show the key lines of the change as added and "
                    "removed lines with the code-diff component (components/code-diff.html next to the template).")

        if non_en:
            skipped_for_language += ["required topics", "review-focus list", "risk marks"]
        else:
            topics = {
                "why": r"\bwhy\b|motivation|rationale|because|so that",
                "impact": r"impact|affects?\b|blast radius|who is affected|consequence|what users? (?:see|get|notice)|for users|users? (?:now|will|see)|before and after|what changes for|user-facing",
                "breaking changes": r"breaking|migrat|removed|no alias",
                "risk": r"\brisk",
                "design decisions": r"decision|trade-?off|chose\b|rejected|alternative",
                "questions for the author": r"question|open issue|unclear|for the author",
                "downstream": r"downstream|consumers?\b|depends? on|dependents?|callers?|affected by",
            }
            missing = [k for k, pat in topics.items() if not re.search(pat, visible, flags=re.I)]
            if missing:
                warning("topics_missing", "The page does not cover: %s." % ", ".join(missing))

            if not re.search(r"where to focus|review focus|check first|start here|focus your review|what to review", visible, flags=re.I):
                warning("focus_list_missing", "No review-focus list. Add an ordered 'Where to focus' list: what a reviewer should check first, each item naming the file and why.")

            risk_words = r"\b(low|worth a look|needs attention|high|medium|critical)\b"
            marked = 0
            for item in numstat:
                base = need[item["file"]]
                for m in re.finditer(re.escape(base), visible_n):
                    if re.search(risk_words, visible_n[m.start():m.start() + 260], flags=re.I):
                        marked += 1
                        break
            info["files_with_risk_mark"] = marked
            info["files_total"] = len(numstat)
            grouped_low = bool(re.search(r"low[- ]risk", visible, flags=re.I))
            if numstat and marked < (len(numstat) + 1) // 2 and not grouped_low:
                warning("risk_marks_missing", "Only %d of %d changed files carry a risk level. Mark each file low, worth a look, or needs attention on its row, "
                          "or group the rest under a heading such as 'Low risk (8 files)'." % (marked, len(numstat)))
    else:
        if not re.search(r"<pre\b", s, flags=re.I):
            warning("evidence_missing", "No code excerpt. A state explainer needs an evidence section: the commands run, the key commits and the code excerpts (in <pre>).")

    if kind == "change":
        if non_en:
            skipped_for_language.append("how-to-verify section")
        elif not any(re.search(r"how to verify|test plan|how to check|verification", h, flags=re.I) for h in heads):
            warning("how_to_verify_missing", "No how-to-verify section. Add a section headed 'How to verify' listing the commands the reader should run, since you did not run everything.")

    if non_en:
        skipped_for_language.append("what-was-not-verified statement")
    elif not re.search(r"not verified|not checked|did not (?:run|verify|check|measure)|was not (?:run|measured)|not (?:run|measured)|unverified|what i did not", visible, flags=re.I):
        violation("floor", "not_verified_missing", 1,
                  "The page never says what was not verified. Add a section headed 'What I did not verify' (grade it inferred).")

    # file:line anchors and commit hashes are judged against the branch the page explains (--ref), not the working
    # tree. An unavailable ref, or no repository, skips them with a warning, never a violation.
    skip_anchors = {"ext_tlds": {"com", "org", "net", "io", "dev", "app", "gov", "edu"}}
    anchors = []
    for m in re.finditer(r"(?<![\w/.-])([\w./-]*[\w-]\.([A-Za-z]{1,5})):(\d+)(?:[-–](\d+))?(?!\d)", visible):
        if m.group(2).lower() in skip_anchors["ext_tlds"]:
            continue
        anchors.append((m.group(1), int(m.group(3)), int(m.group(4) or m.group(3))))
    info["anchors"] = len(anchors)

    ref_state = "none"
    if not in_repo:
        ref_state = "norepo"
        warning("references_unchecked",
                "The checker is not running inside a git repository, so file:line anchors and commit hashes were not checked.")
    elif ref:
        try:
            ref_state = "ok" if git("rev-parse", "--verify", "--quiet", ref + "^{commit}").returncode == 0 else "missing"
        except Exception:
            ref_state = "missing"
        if ref_state == "missing":
            pr = re.fullmatch(r"refs/pull/(\d+)/head", ref)
            how = ("git fetch origin pull/%s/head:%s" % (pr.group(1), ref)) if pr else ("git fetch origin %s" % ref)
            warning("references_unchecked",
                    "The ref %s is not available locally, so file:line anchors and commit hashes were not checked. Fetch it (%s) "
                    "and run the checker again." % (ref, how))

    def read_at_ref(name):
        if ref_state == "ok":
            r = git("show", "%s:%s" % (ref, name))
            return r.stdout if r.returncode == 0 else None
        try:
            return open(name, encoding="utf-8", errors="replace").read()
        except OSError:
            return None

    tracked = None
    if ref_state == "ok":
        tracked = git("ls-tree", "-r", "--full-name", "--name-only", ref).stdout.split("\n")
    elif ref_state == "none":
        tracked = git("ls-files", "--full-name").stdout.split("\n")

    # Diff excerpts quote the change verbatim: each added (d-add) or removed (d-del) line on the page must be a line
    # that git diff <base>...<ref> adds or removes. Spacing may differ; wording may not. Needs a usable --ref.
    def d_spans(body):
        """(kind, text) for every d-add, d-del and d-ctx line span in a block of markup, in order; spans may nest."""
        found = []
        for m in re.finditer(r"<span\b[^>]*\bclass\s*=\s*[\"'](?:[^\"']*\s)?(d-add|d-del|d-ctx)(?:\s[^\"']*)?[\"'][^>]*>",
                             body, flags=re.I):
            depth, j = 1, m.end()
            while depth and j < len(body):
                o, c = body.find("<span", j), body.find("</span>", j)
                if c < 0:
                    break
                if 0 <= o < c:
                    depth, j = depth + 1, o + 5
                else:
                    depth, j = depth - 1, c + 7
            text = re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", "", body[m.end():j - 7]))).strip()
            found.append((m.group(1).lower(), text))
        return found

    diff_blocks = [b for b in (d_spans(pm.group(1)) for pm in re.finditer(r"<pre\b[^>]*>(.*?)</pre>", s, flags=re.S | re.I)) if b]
    diff_lines = [(k, t) for b in diff_blocks for k, t in b if k != "d-ctx" and t]
    if kind == "change" and diff_lines and ref_state == "ok":
        base_ref = base_branch
        if not base_ref:
            # the base classify-target.sh would pick: develop or main, whichever the ref is fewer commits ahead of
            # (a tie keeps develop), so a stale develop never stands in for main; master only when neither exists
            best = None
            for order, cand in enumerate(("develop", "main", "master")):
                if cand == "master" and best is not None:
                    break
                if git("rev-parse", "--verify", "--quiet", cand + "^{commit}").returncode != 0:
                    continue
                n = git("rev-list", "--count", "%s..%s" % (cand, ref)).stdout.strip()
                key = (int(n) if n.isdigit() else 10 ** 9, order)
                if best is None or key < best[0]:
                    best = (key, cand)
            base_ref = best[1] if best else ""
        same = base_ref and git("rev-parse", base_ref + "^{commit}").stdout.strip() == git("rev-parse", ref + "^{commit}").stdout.strip()
        if not base_ref:
            warning("diff_lines_unchecked", "No base branch (develop or main) was found and --base was not given, so the "
                    "diff excerpt's lines were not compared with the change.")
        elif not same:
            out = git("-c", "core.quotepath=off", "diff", "-U0", "--no-color", "%s...%s" % (base_ref, ref)).stdout.split("\n")
            squash_line = lambda t: re.sub(r"\s+", " ", t).strip()
            added = {squash_line(l[1:]) for l in out if l.startswith("+") and not l.startswith("+++")}
            removed = {squash_line(l[1:]) for l in out if l.startswith("-") and not l.startswith("---")}
            wrong = ["%s '%s'" % ("+" if k == "d-add" else "-", t[:60]) for k, t in diff_lines
                     if t not in (added if k == "d-add" else removed)]
            # runs: lines one hunk adds (or removes) one after another; with -U0 a hunk header ends a run
            pairs = {"d-add": set(), "d-del": set()}
            run = {"d-add": [], "d-del": []}
            for line in out + ["@@"]:
                if line.startswith("@@") or line.startswith("diff "):
                    for k in run:
                        pairs[k].update(zip(run[k], run[k][1:]))
                        run[k] = []
                elif line.startswith("+") and not line.startswith("+++"):
                    run["d-add"].append(squash_line(line[1:]))
                elif line.startswith("-") and not line.startswith("---"):
                    run["d-del"].append(squash_line(line[1:]))
            apart = []
            for block in diff_blocks:
                for (k1, t1), (k2, t2) in zip(block, block[1:]):
                    if k1 == k2 and k1 in pairs and t1 in (added if k1 == "d-add" else removed) \
                            and t2 in (added if k1 == "d-add" else removed) and (t1, t2) not in pairs[k1]:
                        apart.append("%s '%s' then '%s'" % ("+" if k1 == "d-add" else "-", t1[:40], t2[:40]))
            if apart:
                violation("floor", "diff_lines_not_adjacent", len(apart),
                          "These diff lines sit next to each other on the page but not in git diff %s...%s: %s. Show the "
                          "lines between them, or put a d-ctx line reading '…' between them to mark the gap."
                          % (base_ref, ref, "; ".join(apart[:3])))
            if wrong:
                violation("floor", "diff_lines_not_in_diff", len(wrong),
                          "These diff lines are not lines that git diff %s...%s %s: %s. Copy lines verbatim from the diff, "
                          "mark skipped lines with a '…' context line, and never mark your own comment as added."
                          % (base_ref, ref, "adds or removes", "; ".join(wrong[:4])))

    resolved = len(anchors)
    if tracked is not None:
        resolved, bad_anchors, unknown = 0, [], []
        for name, a, b in anchors:
            cands = [f for f in tracked if f == name or f.endswith("/" + name)]
            if not cands:
                unknown.append(name)
                continue
            resolved += 1
            good = False
            for c in cands:
                data = read_at_ref(c)
                if data is None:
                    continue
                n = data.count("\n") + (0 if (not data or data.endswith("\n")) else 1)
                if 1 <= a <= b <= n:
                    good = True
                    break
            if not good:
                bad_anchors.append("%s:%d%s" % (name, a, "" if a == b else "-%d" % b))
        if unknown:
            warning("unknown_anchor_files",
                    "These file:line anchors name files that are not tracked, so they were not checked: %s." % ", ".join(sorted(set(unknown))[:5]))
        if bad_anchors:
            violation("floor", "anchors_invalid", len(bad_anchors),
                      "These file:line anchors point past the end of the file: %s." % ", ".join(bad_anchors[:5]))
    if kind == "state" and resolved < 2:
        warning("anchors_missing", "A state explainer must cite file:line anchors (at least 2) for the code it explains, in files that exist.")

    link_ids = set(re.findall(r'\bid\s*=\s*"([^"]+)"', s))
    working_links = {h for h in re.findall(r'<a\b[^>]*\shref\s*=\s*"#([^"]+)"', s) if h in link_ids}
    if h_heads >= 4 and len(working_links) < 3:
        warning("jump_links_missing", "The page has %d headings but fewer than 3 working jump links. Add a small nav of #links to the main sections (each with an id)." % h_heads)

    # commit hashes: only ones in code or next to a word like commit/sha/fixed in; they must exist in the repository
    def is_hash(t):
        return bool(re.search(r"\d", t) and re.search(r"[a-f]", t))

    hex_re = r"(?<![\w-])[0-9a-f]{7,12}(?![\w-])"
    context = re.compile(r"(?:commit|sha|hash|revision|rev|fixed in|fixed by|introduced in|added in|changed in|reverts?|cherry-pick(?:ed)?)\W{0,3}$", re.I)
    code_text = " ".join(re.sub(r"<[^>]+>", " ", c) for c in re.findall(r"<(?:code|pre)\b[^>]*>(.*?)</(?:code|pre)>", s, flags=re.I | re.S))
    tokens = {t for t in re.findall(hex_re, code_text) if is_hash(t)}
    for m in re.finditer(hex_re, visible):
        if is_hash(m.group(0)) and context.search(visible[max(0, m.start() - 25):m.start()]):
            tokens.add(m.group(0))
    if tokens and ref_state in ("none", "ok"):
        real = git("rev-list", "--all").stdout.split()
        invented = sorted(t for t in tokens if not any(h.startswith(t) for h in real))
        if invented:
            violation("floor", "invented_hashes", len(invented),
                      "Commit hashes that do not exist in this repository: %s. Cite only real commits." % ", ".join(invented[:5]))

    if skipped_for_language:
        warning("language_unchecked",
                "The page is in '%s', and these keyword checks only read English, so they were skipped: %s. Keep the labels measured, read "
                "and inferred as they are." % (lang, ", ".join(skipped_for_language)))

    # ------------------------------------------------------------ polish: warnings only
    if kind == "change" and re.search(r"[+]\s*\d+\s*[−\-–]\s*\d+", visible) and "tabular-nums" not in css:
        warning("tabular_nums_missing", "Add font-variant-numeric: tabular-nums to the cells with +N −M so the digits line up.")
    if "text-wrap" not in css:
        warning("text_wrap_balance_missing", "Add text-wrap: balance to headings so they do not end in a lone word.")

    info["marks"] = marks
    info["grades"] = len(grades)
    return {"ok": not violations, "kind": kind, "violations": violations, "warnings": warnings, "info": info}


def main():
    try:
        path, kind, numstat_path = sys.argv[1], sys.argv[2], sys.argv[3]
        ref = sys.argv[4] if len(sys.argv) > 4 else ""
        base = sys.argv[5] if len(sys.argv) > 5 else ""
        report = run(path, kind, numstat_path, ref, base)
    except SystemExit:
        raise
    except Exception as e:  # the checker is broken, which is not the same as the page having violations
        print(json.dumps({"ok": False, "error": "%s: %s" % (type(e).__name__, e)}, ensure_ascii=False))
        print("ERROR: the checker itself failed (%s: %s); this says nothing about the page." % (type(e).__name__, e), file=sys.stderr)
        sys.exit(5)
    print(json.dumps(report, ensure_ascii=False))
    sys.exit(0 if report["ok"] else 1)


main()
