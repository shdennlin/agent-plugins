"""Explainer checker. Usage: python3 -I check_explainer.py <file.html> <change|state> <numstat-file-or-empty>
Prints a JSON report and exits 0 (clean) or 1 (violations). Standard library only.

Four groups of violations (a page with any of them fails) and a list of warnings (polish, never fails). All
checks are mechanical and deliberately approximate, so a clean report means "no rule is visibly broken",
not "the page is good":
  hard    - external requests, dark mode, color-scheme, a focus style, raw colors outside :root, overflow
            hidden on the page, <details> open by default, Expand all
  meaning - semantic colors that are actually used, one to three <mark>, evidence grade labels
  avoid   - colored edge bars, a card inside a card, more than 5 emoji
  floor   - change: every changed file named with its +/- counts, the required topics, a review-focus list,
            risk marks, a how-to-verify section; state: a code excerpt and file:line anchors;
            both: a statement of what was not verified, working file:line anchors, jump links, no invented
            commit hashes
  warnings - tabular numbers for +/- counts, text-wrap: balance on headings."""
import json
import os
import re
import subprocess
import sys
from html.parser import HTMLParser

path, kind, numstat_path = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path, encoding="utf-8", errors="replace").read()

violations = []
warnings = []


def violation(group, vid, count, message):
    violations.append({"id": vid, "group": group, "count": count, "message": message})


def warning(wid, message):
    warnings.append({"id": wid, "message": message})


# ---------------------------------------------------------------- parse helpers
css = "\n".join(re.findall(r"<style[^>]*>(.*?)</style>", s, flags=re.S | re.I))
rules = [(m.group(1).strip(), m.group(2)) for m in re.finditer(r"([^{}@]+)\{([^{}]*)\}", css)]

visible = re.sub(r"<(script|style)\b.*?</\1>", " ", s, flags=re.I | re.S)
visible = re.sub(r"<[^>]+>", " ", visible)
visible = re.sub(r"&minus;|&#8722;", "−", visible)
visible = re.sub(r"&amp;", "&", visible)
visible = re.sub(r"\s+", " ", visible)
body_markup = re.sub(r"<(script|style)\b.*?</\1>", " ", s, flags=re.I | re.S)
heads = [re.sub(r"<[^>]+>", "", h).strip()
         for h in re.findall(r"<(?:h[1-6]|summary)\b[^>]*>(.*?)</(?:h[1-6]|summary)>", s, flags=re.S | re.I)]


def px(value):
    m = re.match(r"\s*([\d.]+)\s*(px|rem|em)?", value)
    if not m:
        return 0.0
    n = float(m.group(1))
    return n * 16 if m.group(2) in ("rem", "em") else n


# ---------------------------------------------------------------- hard constraints
urls = [u for u in re.findall(r"https?://[^\s\"'<>)]+", s) if not u.startswith("http://www.w3.org/")]
external = (len(urls)
            + len(re.findall(r"<script\b[^>]*\ssrc\s*=", s, flags=re.I))
            + len(re.findall(r"<link\b", s, flags=re.I))
            + len(re.findall(r"@import", s, flags=re.I))
            + len(re.findall(r"url\(\s*['\"]?(?!#|data:)", s, flags=re.I)))
if external:
    violation("hard", "external_requests", external,
              "The page makes or links to external requests (CDN script, link tag, @import, remote font or image). "
              "Inline everything. Found: " + ", ".join(urls[:3] or ["a script, link or @import"]))

if "prefers-color-scheme" not in s:
    violation("hard", "no_dark_mode", 1,
              "No dark mode: add a @media (prefers-color-scheme: dark) block that redefines the :root color tokens.")

without_root = re.sub(r":root[^{]*\{[^}]*\}", "", s)
raw = 0
for m in re.finditer(r"#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])", without_root):
    before = without_root[max(0, m.start() - 8):m.start()]
    if re.search(r"(href\s*=\s*[\"']|url\(|id\s*=\s*[\"']|for\s*=\s*[\"'])$", before):
        continue
    raw += 1
raw += len(re.findall(r"\b(?:rgb|rgba|hsl|hsla)\(", without_root))
if raw:
    violation("hard", "raw_colors_outside_tokens", raw,
              "Raw colors are used outside the :root tokens. Define each color once as a custom property and use var(--name).")

open_details = len(re.findall(r"<details\b[^>]*\bopen\b", s, flags=re.I))
if open_details:
    violation("hard", "details_open_by_default", open_details,
              "A <details> starts open. Deep detail must be collapsed by default: remove the open attribute.")

page_hidden = [sel for sel, body in rules
               if any(t.strip() in ("html", "body") for t in sel.split(","))
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

n_details = len(re.findall(r"<details\b", s, flags=re.I))
has_toggle = bool(re.search(r"<button\b[^>]*>[^<]*(expand|collapse|展開|收合|全部)", s, flags=re.I)) and ".open" in s
if n_details >= 2 and not has_toggle:
    violation("hard", "expand_all_missing", 1,
              "The page has %d <details> but no Expand all / Collapse all button. Add one small button above the first <details>." % n_details)

if not re.search(r":focus(?:-visible)?\b", css):
    violation("hard", "focus_style_missing", 1,
              "No visible keyboard focus style. Add a :focus-visible rule (an outline) for buttons, summaries and links.")

if not re.search(r"(?:^|[;{\s])color-scheme\s*:", css):
    violation("hard", "color_scheme_missing", 1,
              "No color-scheme property. Declare color-scheme: light dark on :root so form controls and scrollbars follow the theme.")

# ---------------------------------------------------------------- meaning
SEMANTIC = r"(?:ok|good|warn|warning|bad|danger|err|error|add|del|risk|crit|critical)"
sem_tokens = set(re.findall(r"--(" + SEMANTIC + r"[\w-]*)\s*:", css))
sem_classes = set()
for sel, body in rules:
    if sel.strip().startswith(":root"):
        continue
    if any(re.search(r"var\(--%s\)" % re.escape(t), body) for t in sem_tokens):
        sem_classes.update(re.findall(r"\.([\w-]+)", sel))
sem_used = sum(len(re.findall(r'class\s*=\s*"[^"]*\b%s\b' % re.escape(c), body_markup)) for c in sem_classes)
sem_used += sum(len(re.findall(r'style\s*=\s*"[^"]*var\(--%s\)' % re.escape(t), body_markup)) for t in sem_tokens)
if sem_used < 2:
    violation("meaning", "semantic_color_unused", 1,
              "Semantic colors (ok, warn, bad) are not used on the page (%d element(s)). Use them on risk marks and on the +N and −M "
              "counts, so color carries meaning, not just decoration." % sem_used)

marks = len(re.findall(r"<mark\b", body_markup, flags=re.I))
if marks == 0:
    violation("meaning", "mark_missing", 1,
              "No highlight. Wrap the one sentence the reader must not miss in <mark>.")
elif marks > 3:
    violation("meaning", "mark_overused", marks,
              "%d highlights; use <mark> for at most 3 sentences, otherwise nothing stands out." % marks)

grades = [g.lower() for g in re.findall(r">\s*(measured|read|inferred)\s*<", body_markup, flags=re.I)]
if len(grades) < 3 or len(set(grades)) < 2:
    violation("meaning", "grades_missing", 1,
              "Evidence grades are missing or too few (%d label(s), %d kind(s)). Tag important claims with a small label reading measured "
              "(you ran it), read (you read the code, with file:line) or inferred (not verified); use at least 3 labels of at least 2 kinds."
              % (len(grades), len(set(grades))))

# ---------------------------------------------------------------- avoid list
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

card_tags = {"div", "section", "article", "details", "aside", "figure", "blockquote", "header", "footer", "p", "ul", "table"}
card_classes, card_tagsel = set(), set()
for sel, body in rules:
    radius = re.search(r"border-radius\s*:\s*([^;]+)", body)
    if not radius:
        continue
    if not (0 < px(radius.group(1).split()[0]) < 20):
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
        elif tag in card_tags:
            card_tagsel.add(tag)


class Nest(HTMLParser):
    VOID = {"br", "hr", "img", "meta", "link", "input", "area", "base", "col", "embed", "source", "track", "wbr"}

    def __init__(self):
        super().__init__()
        self.stack, self.nested, self.in_svg = [], 0, 0

    def is_card(self, tag, classes):
        if tag not in card_tags:
            return False
        if tag in card_tagsel:
            return True
        cs = set(classes)
        return any(c <= cs for c in card_classes)

    def handle_starttag(self, tag, attrs):
        if tag == "svg":
            self.in_svg += 1
        if self.in_svg or tag in self.VOID:
            return
        card = self.is_card(tag, (dict(attrs).get("class") or "").split())
        if card and any(c for _, c in self.stack):
            self.nested += 1
        self.stack.append((tag, card))

    def handle_endtag(self, tag):
        if tag == "svg":
            self.in_svg = max(0, self.in_svg - 1)
            return
        if self.in_svg or tag in self.VOID:
            return
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break


nest = Nest()
nest.feed(s)
if nest.nested:
    violation("avoid", "nested_cards", nest.nested,
              "%d box(es) with their own background or border sit inside another such box (number tiles inside a panel, "
              "item boxes inside a <details>, a callout inside a card). Lay them out directly on the page, or inside one "
              "container with spacing and dividers." % nest.nested)

emoji = len(re.findall("[\U0001F300-\U0001FAFF☀-⛿✅✨❌❎❓❗⭐⭕]", s))
if emoji > 5:
    violation("avoid", "emoji_over_5", emoji, "%d emoji on the page; use at most 5, none in running prose." % emoji)

# ---------------------------------------------------------------- content floor
info = {"bytes": len(s.encode("utf-8")), "details": n_details, "emoji": emoji, "visible_words": len(visible.split())}

if kind == "change":
    numstat = []
    for line in open(numstat_path, encoding="utf-8", errors="replace"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 3 and parts[2]:
            numstat.append({"file": parts[2],
                            "added": int(parts[0]) if parts[0].isdigit() else None,
                            "removed": int(parts[1]) if parts[1].isdigit() else None})
    def needles(items):
        """The text to look for per file: its name, or the shortest path suffix that tells it apart from
        every other changed file with the same name."""
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
        spots = [m.start() for m in re.finditer(re.escape(base), visible)]
        if not spots:
            not_named.append(item["file"])
            continue
        if item["added"] is None or item["removed"] is None:
            continue  # a binary file has no line counts
        found = False
        for p in spots:
            window = visible[p:p + 200]
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
        violation("floor", "topics_missing", len(missing),
                  "The page does not cover: %s." % ", ".join(missing))

    if not re.search(r"where to focus|review focus|check first|start here|focus your review|what to review", visible, flags=re.I):
        violation("floor", "focus_list_missing", 1,
                  "No review-focus list. Add an ordered 'Where to focus' list: what a reviewer should check first, each item naming the file and why.")

    risk_words = r"\b(low|worth a look|needs attention|high|medium|critical)\b"
    marked = 0
    for item in numstat:
        base = need[item["file"]]
        for m in re.finditer(re.escape(base), visible):
            if re.search(risk_words, visible[m.start():m.start() + 260], flags=re.I):
                marked += 1
                break
    info["files_with_risk_mark"] = marked
    info["files_total"] = len(numstat)
    if numstat and marked == 0:
        violation("floor", "risk_marks_missing", 1,
                  "No file is marked with a risk level. Mark each changed file low, worth a look, or needs attention.")
else:
    if not re.search(r"<pre\b", s, flags=re.I):
        violation("floor", "evidence_missing", 1,
                  "No code excerpt. A state explainer needs an evidence section: the commands run, the key commits and the code excerpts (in <pre>).")

if kind == "change" and not any(re.search(r"how to verify|test plan|how to check|verification", h, flags=re.I) for h in heads):
    violation("floor", "how_to_verify_missing", 1,
              "No how-to-verify section. Add a section headed 'How to verify' listing the commands the reader should run, since you did not run everything.")

if not re.search(r"not verified|not checked|did not (?:run|verify|check|measure)|was not (?:run|measured)|not (?:run|measured)|unverified|what i did not", visible, flags=re.I):
    violation("floor", "not_verified_missing", 1,
              "The page never says what was not verified. Add a section headed 'What I did not verify' (grade it inferred).")

# file:line anchors: validated against the repository's tracked files (skipped outside a repo)
SKIP_TLDS = {"com", "org", "net", "io", "dev", "app", "gov", "edu"}
anchors = []
for m in re.finditer(r"(?<![\w/.-])([\w./-]*[\w-]\.([A-Za-z]{1,5})):(\d+)(?:[-–](\d+))?(?!\d)", visible):
    if m.group(2).lower() in SKIP_TLDS:
        continue
    anchors.append((m.group(1), int(m.group(3)), int(m.group(4) or m.group(3))))
info["anchors"] = len(anchors)
try:
    tracked = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout.split("\n")
except Exception:
    tracked = None
if tracked is not None:
    bad_anchors = []
    for name, a, b in anchors:
        cands = [f for f in tracked if f == name or f.endswith("/" + name)]
        if not cands and os.path.exists(name):
            cands = [name]
        good = False
        for c in cands:
            data = open(c, encoding="utf-8", errors="replace").read()
            n = data.count("\n") + (0 if (not data or data.endswith("\n")) else 1)
            if 1 <= a <= b <= n:
                good = True
                break
        if not good:
            bad_anchors.append("%s:%d%s" % (name, a, "" if a == b else "-%d" % b))
    if bad_anchors:
        violation("floor", "anchors_invalid", len(bad_anchors),
                  "These file:line anchors do not resolve (no such tracked file, or a line past its end): %s." % ", ".join(bad_anchors[:5]))
if kind == "state" and len(anchors) < 2:
    violation("floor", "anchors_missing", 1,
              "A state explainer must cite file:line anchors (at least 2) for the code it explains.")

link_ids = set(re.findall(r'\bid\s*=\s*"([^"]+)"', s))
working_links = {h for h in re.findall(r'<a\b[^>]*\shref\s*=\s*"#([^"]+)"', s) if h in link_ids}
if len(heads) >= 4 and len(working_links) < 3:
    violation("floor", "jump_links_missing", 1,
              "The page has %d headings but fewer than 3 working jump links. Add a small nav of #links to the main sections (each with an id)." % len(heads))

# polish: warnings only
if kind == "change" and re.search(r"[+]\s*\d+\s*[−\-–]\s*\d+", visible) and "tabular-nums" not in css:
    warning("tabular_nums_missing", "Add font-variant-numeric: tabular-nums to the cells with +N −M so the digits line up.")
if "text-wrap" not in css:
    warning("text_wrap_balance_missing", "Add text-wrap: balance to headings so they do not end in a lone word.")

# commit hashes that do not exist in this repository are invented history (skipped outside a repo)
tokens = {t for t in re.findall(r"\b[0-9a-f]{7,12}\b", visible) if re.search(r"\d", t) and re.search(r"[a-f]", t)}
if tokens:
    try:
        real = subprocess.run(["git", "rev-list", "--all"], capture_output=True, text=True, check=True).stdout.split()
    except Exception:
        real = None
    if real is not None:
        invented = sorted(t for t in tokens if not any(h.startswith(t) for h in real))
        if invented:
            violation("floor", "invented_hashes", len(invented),
                      "Commit hashes that do not exist in this repository: %s. Cite only real commits." % ", ".join(invented[:5]))

info["marks"] = marks
info["grades"] = len(grades)
report = {"ok": not violations, "kind": kind, "violations": violations, "warnings": warnings, "info": info}
print(json.dumps(report, ensure_ascii=False))
sys.exit(0 if report["ok"] else 1)
