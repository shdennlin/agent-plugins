"""Assemble a page from a base explainer and every component file, the way a writer would use them.

    python3 -I assemble-components.py <base.html> <components-dir> > page.html

Each component's <style> rules go before the base page's </style>, its markup (the file minus its comment, <style> and
<script>) before </main>, and its non-empty <script> before </body>. Used by check-explainer.test.sh to prove that the
components pass the checker together, and to build a demo page. Standard library only.
"""
import os
import re
import sys


def parts(text):
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)   # the header comment names <style> and <script> too
    style = "\n".join(re.findall(r"<style>(.*?)</style>", text, flags=re.S))
    scripts = [b for b in re.findall(r"<script>(.*?)</script>", text, flags=re.S) if b.strip()]
    markup = re.sub(r"<style>.*?</style>|<script>.*?</script>", "", text, flags=re.S).strip()
    return style, markup, scripts


def main(base_path, comp_dir):
    page = open(base_path, encoding="utf-8").read()
    styles, markups, scripts = [], [], []
    for name in sorted(os.listdir(comp_dir)):
        if not name.endswith(".html"):
            continue
        style, markup, script = parts(open(os.path.join(comp_dir, name), encoding="utf-8").read())
        styles.append("/* component: %s */\n%s" % (name[:-5], style.strip()))
        markups.append("<!-- component: %s -->\n%s" % (name[:-5], markup))
        scripts += script
    for tag, add in (("</style>", "\n".join(styles) + "\n"), ("</main>", "\n".join(markups) + "\n"),
                     ("</body>", "".join("<script>%s</script>\n" % s for s in scripts))):
        i = page.rfind(tag)
        if i < 0:
            sys.exit("base page has no %s" % tag)
        page = page[:i] + add + page[i:]
    sys.stdout.write(page)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
