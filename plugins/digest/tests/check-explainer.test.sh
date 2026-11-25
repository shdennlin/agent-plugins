#!/usr/bin/env bash
# Regression test for scripts/check-explainer.sh: the hard constraints, the meaning rules (semantic color,
# one highlight, evidence grades), the avoid list and the content floor of a generated HTML explainer.
# A known-good page must pass; every bad page below breaks exactly one rule and must be reported with
# that rule's id. Polish items are warnings and never fail the page. No Claude, no network.
#
#   bash plugins/digest/tests/check-explainer.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../scripts/check-explainer.sh"
STYLE="$HERE/../templates/html-explainer-style.css"   # the reference stylesheet every page copies
COMP="$HERE/../templates/components"                   # the component files a page may draw on
command -v jq >/dev/null 2>&1 || { echo "skip: jq not installed"; exit 0; }
command -v python3 >/dev/null 2>&1 || { echo "skip: python3 not installed"; exit 0; }
unset PROJECT_ROOT

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
git init -q -b main
mkdir -p src docs
seq 1 40 | sed 's/^/line /' >src/alpha.ts
seq 1 10 | sed 's/^/line /' >src/beta.ts
seq 1 10 | sed 's/^/line /' >src/util.ts
echo a >a.txt
echo g >docs/gamma.md
git add -A
git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q -m "init"
REAL="$(git rev-parse --short=7 HEAD)"
# A branch that is NOT checked out and has a file the working tree does not: what explaining someone else's branch looks like.
git checkout -q -b feat/x
seq 1 30 | sed 's/^/line /' >src/new.ts
git add -A
git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q -m "feat: new file"
ONLY_ON_FEAT="$(git rev-parse --short=7 HEAD)"
git checkout -q main

fail() { echo "ASSERT FAIL: $*" >&2; exit 1; }

# The changed files, in `git diff --numstat` format: added <TAB> removed <TAB> path.
printf '10\t2\tsrc/alpha.ts\n0\t5\tsrc/beta.ts\n3\t3\tdocs/gamma.md\n' >numstat.tsv

# A page that satisfies every rule for a change target.
good_change() {
  printf '%s\n' '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Change summary</title><style>'
  cat "$STYLE"
  cat <<'EOF'
:root{--fg:var(--ink);--card:var(--panel)}
body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui}
h1,h2{text-wrap:balance}
.panel{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem}
details{border:1px solid var(--line);border-radius:10px;margin:.5rem 0}
td.n{font-variant-numeric:tabular-nums}
.wrap{overflow-x:auto}
td code{white-space:nowrap}
.low{color:var(--ok)}.look{color:var(--warn)}.attn{color:var(--bad)}
.g{border:1px solid var(--line);border-radius:4px;padding:0 .3rem;font-size:.8rem}
mark{background:var(--card)}
button:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--accent)}
</style></head><body><main>
<nav><a href="#focus">Focus</a> · <a href="#files">Files</a> · <a href="#verify">Verify</a> · <a href="#gaps">Gaps</a></nav>
<header><h1>Change summary</h1><p><mark>Moderate risk: the parser is rewritten and one flag is removed.</mark> <span class="g">read</span></p>
<p>Key: <span class="low">low</span> <span class="look">worth a look</span> <span class="attn">needs attention</span></p></header>
<section class="panel" id="focus"><h2>Where to focus</h2><ol><li>src/alpha.ts:12: the new parser, check the error paths. <span class="g">read</span></li></ol></section>
<div class="ctl"><button type="button" class="toggle" data-expand-all data-collapse="Collapse all" aria-expanded="false" hidden>Expand all</button></div>
<details id="files"><summary>Files</summary><div class="wrap"><table>
<tr><td>src/alpha.ts</td><td class="n">+10 −2</td><td class="attn">needs attention</td><td>adds the <code>parser</code></td></tr>
<tr><td>src/beta.ts</td><td class="n">+0 −5</td><td class="low">low</td><td>drops dead code</td></tr>
<tr><td>docs/gamma.md</td><td class="n">+3 −3</td><td class="low">low</td><td>rewords the guide</td></tr>
</table></div></details>
<details><summary>Details</summary><p>Why: the old parser was fragile (see src/util.ts:3). Impact: users see clearer errors. Breaking: the old flag is removed, migrate to the new one. Risk: error paths are new. Design decisions: one parser instead of two, a trade-off for size. Questions for the author: should the flag stay as an alias? Downstream consumers: the CLI wrapper calls the parser.</p></details>
<pre class="diff"><code><span class="d-ctx">…</span><span class="d-add">line 5</span></code></pre>
<section id="verify"><h2>How to verify</h2><p>Run <code>bash tests/run.sh</code> and read the last line.</p></section>
<section id="gaps"><h2>What I did not verify</h2><p>I did not run the CLI end to end. <span class="g">inferred</span> The unit tests passed locally. <span class="g">measured</span></p></section>
</main>
EOF
  printf '<script>'; awk '/^<script>$/{f=1;next} /^<\/script>$/{f=0} f' "$COMP/expand-all.html"; printf '</script>\n</body></html>\n'
}

# A page that satisfies every rule for a state target (no changed-file list, an evidence excerpt).
good_state() {
  good_change | sed 's|<tr><td>src/alpha.ts.*||; s|<tr><td>src/beta.ts.*||; s|<tr><td>docs/gamma.md.*||; s|<pre class="diff">.*</pre>||' \
    | sed "s|<details><summary>Details</summary>|<details><summary>Evidence</summary><pre><code><span class=\"tk-kw\">git</span> log --follow -- a.txt ($REAL)</code></pre>|"
}

# run_check <args...>: sets OUT and RC
run_check() { OUT="$("$SCRIPT" "$@" 2>"$TMP/err")" && RC=0 || RC=$?; }
ids() { printf '%s' "$OUT" | jq -r '[.violations[].id] | sort | join(",")'; }
warn_ids() { printf '%s' "$OUT" | jq -r '[.warnings[].id] | sort | join(",")'; }

expect_ok() {  # expect_ok <label> <args...>
  local label="$1"; shift
  run_check "$@"
  [[ "$RC" == "0" ]] || fail "$label should pass, exit $RC: $OUT $(cat "$TMP/err")"
  [[ "$(printf '%s' "$OUT" | jq -r .ok)" == "true" ]] || fail "$label: ok should be true: $OUT"
  [[ "$(ids)" == "" ]] || fail "$label: no violations expected, got $(ids)"
}

expect_only() {  # expect_only <label> <violation-id> <args...>
  local label="$1" want="$2"; shift 2
  run_check "$@"
  [[ "$RC" == "1" ]] || fail "$label should exit 1, got $RC: $OUT $(cat "$TMP/err")"
  [[ "$(printf '%s' "$OUT" | jq -r .ok)" == "false" ]] || fail "$label: ok should be false"
  [[ "$(ids)" == "$want" ]] || fail "$label: want exactly [$want], got [$(ids)]"
}

expect_warn() {  # expect_warn <label> <warning-id> <args...>: the page passes and the only note is that warning
  local label="$1" want="$2"; shift 2
  run_check "$@"
  [[ "$RC" == "0" ]] || fail "$label should pass with a warning, exit $RC: $OUT $(cat "$TMP/err")"
  [[ "$(printf '%s' "$OUT" | jq -r .ok)" == "true" ]] || fail "$label: ok should be true: $OUT"
  [[ "$(ids)" == "" ]] || fail "$label: no violations expected, got $(ids)"
  [[ "$(warn_ids)" == "$want" ]] || fail "$label: want exactly the warning [$want], got [$(warn_ids)]"
}

# 1. Known-good pages pass, with no warnings.
good_change >good-change.html
expect_ok "good change" good-change.html --numstat numstat.tsv
[[ "$(warn_ids)" == "" ]] || fail "good change: no warnings expected, got $(warn_ids)"
good_state >good-state.html
expect_ok "good state" good-state.html --kind state
[[ "$(warn_ids)" == "" ]] || fail "good state: no warnings expected, got $(warn_ids)"

# 2. Hard constraints, one at a time.
good_change | sed 's|</head>|<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script></head>|' >bad.html
expect_only "external request" external_requests bad.html --numstat numstat.tsv
good_change | perl -0pe 's/\@media \(prefers-color-scheme: dark\) \{\n  :root \{.*?\n  \}\n\}\n//s' >bad.html
run_check bad.html --numstat numstat.tsv
[[ "$(ids)" == "no_dark_mode,reference_style_changed" ]] || fail "no dark mode (and so no dark tokens): $(ids)"
good_change | sed 's|body{background:var(--bg);|body{color:#123456;background:var(--bg);|' >bad.html
expect_only "raw color" raw_colors_outside_tokens bad.html --numstat numstat.tsv
good_change | sed 's|<details id="files">|<details open id="files">|' >bad.html
expect_warn "details open" details_open_by_default bad.html --numstat numstat.tsv
good_change | sed 's|<button type="button" class="toggle" data-expand-all data-collapse="Collapse all" aria-expanded="false" hidden>Expand all</button>||' >bad.html
expect_warn "no expand all" expand_all_missing bad.html --numstat numstat.tsv
good_change | sed 's|button:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--accent)}||; s|a:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }||' >bad.html
expect_only "no focus style" focus_style_missing bad.html --numstat numstat.tsv
good_change | sed 's|color-scheme: light dark;||' >bad.html
expect_only "no color-scheme property" color_scheme_missing bad.html --numstat numstat.tsv

# 2c. Palette floor: the light background must be near white, the dark one a lifted charcoal, not near-black.
good_change | sed 's|--bg: #26262e;|--bg: #050505;|' >bad.html
run_check bad.html --numstat numstat.tsv
[[ "$(ids)" == "dark_background_too_dark,reference_style_changed" ]] || fail "dark background near black: $(ids)"
good_change | sed 's|--bg: #fdfdfc;|--bg: #e6e6e6;|' >bad.html
run_check bad.html --numstat numstat.tsv
[[ "$(ids)" == "light_background_dim,reference_style_changed" ]] || fail "light background grey: $(ids)"
good_change | sed 's|--bg: #26262e;||' >bad.html
run_check bad.html --numstat numstat.tsv
[[ "$(warn_ids)" == "palette_not_checked" && "$(ids)" == "reference_style_changed" ]] || fail "a page without a dark --bg token: palette warning and a changed reference: $(warn_ids) / $(ids)"

# 2f. A color token that is used but never defined falls back to black: in dark mode, black text on a dark page.
good_change | sed 's|</style>|svg text{fill:var(--fg2)}</style>|' >bad.html
expect_only "an undefined color token" undefined_token bad.html --numstat numstat.tsv
good_change | sed 's|</style>|.x{color:var(--fg2, var(--ink))}</style>|' >ok-fallback.html
expect_ok "a token with a fallback is fine" ok-fallback.html --numstat numstat.tsv

# 2g. An evidence label says measured, read or inferred; a risk level in a grade pill is a misuse.
good_change | perl -0pe 's|<span class="g">read</span>|<span class="g">low</span>|' >bad.html
expect_only "a risk level in an evidence label" grade_label_misused bad.html --numstat numstat.tsv

# 2h. Totals stated in prose must match the diff (3 files, +13 -10 here).
good_change | sed 's|Moderate risk:|3 files, 99 added lines. Moderate risk:|' >bad.html
expect_only "a wrong total" totals_mismatch bad.html --numstat numstat.tsv
good_change | sed 's|Moderate risk:|3 files, 13 added lines and 10 removed lines. Moderate risk:|' >ok-totals.html
expect_ok "the right totals" ok-totals.html --numstat numstat.tsv

# 2i. Scripts come only from the component files, unchanged except for whitespace.
good_change | sed 's|</main>|<script>document.title = "x";</script></main>|' >bad.html
expect_only "a hand-written script" script_not_from_reference bad.html --numstat numstat.tsv
good_change | perl -0pe 's/var open = b.getAttribute\("aria-expanded"\) !== "true";/var open    =    b.getAttribute("aria-expanded")   !==   "true";/' >ok-ws.html
expect_ok "a component script with different spacing" ok-ws.html --numstat numstat.tsv

# 2j. Every component file together on one page passes the checker: the components are proven, not just written.
good_change >base.html
python3 -I "$HERE/assemble-components.py" base.html "$COMP" >all-components.html
expect_ok "all components on one page" all-components.html --numstat numstat.tsv
[[ "$(grep -c '<!-- component:' all-components.html)" -ge 9 ]] || fail "the assembled page should carry every component"

# 2k. A change page shows the change itself: no diff excerpt is a warning.
good_change | sed 's|<pre class="diff"><code><span class="d-ctx">…</span><span class="d-add">line 5</span></code></pre>||' >warn.html
expect_warn "a change page without a diff" diff_excerpt_missing warn.html --numstat numstat.tsv

# 2l. A diff excerpt quotes the change verbatim: every added or removed line must be a line of git diff
#     <base>...<ref> (base given with --base, or develop / main found on its own). feat/x adds src/new.ts, lines
#     "line 1" to "line 30". Without --ref the rule is skipped, as are the other ref checks.
diffpage() { good_change | sed "s|<pre class=\"diff\"><code><span class=\"d-ctx\">…</span><span class=\"d-add\">line 5</span></code></pre>|<pre class=\"diff\"><code>$1</code></pre>|"; }
diffpage '<span class="d-add">line 5</span><span class="d-add">line 6</span>' >ok-diff.html
expect_ok "added lines that are in the diff" ok-diff.html --numstat numstat.tsv --ref feat/x
diffpage '<span class="d-add">  line   5 </span>' >ok-diff-ws.html
expect_ok "spacing may differ" ok-diff-ws.html --numstat numstat.tsv --ref feat/x
diffpage '<span class="d-add">line 5</span><span class="d-ctx">…</span><span class="d-add">line 9</span>' >ok-gap.html
expect_ok "an ellipsis context line marks skipped lines" ok-gap.html --numstat numstat.tsv --ref feat/x
diffpage '<span class="d-add">line 5</span>' >ok-base.html
expect_ok "with --base given" ok-base.html --numstat numstat.tsv --ref feat/x --base main
diffpage '<span class="d-add">line 5 (the gate)</span>' >bad.html
expect_only "an added line the writer edited" diff_lines_not_in_diff bad.html --numstat numstat.tsv --ref feat/x
diffpage '<span class="d-add"># the gate</span><span class="d-add">line 5</span>' >bad.html
expect_only "a comment of the writer's own marked as added" diff_lines_not_in_diff bad.html --numstat numstat.tsv --ref feat/x
diffpage '<span class="d-del">line 3</span>' >bad.html
expect_only "a removed line the diff never removed" diff_lines_not_in_diff bad.html --numstat numstat.tsv --ref feat/x
diffpage '<span class="d-add">line <span class="tk-num">7</span></span>' >ok-tok.html
expect_ok "token spans inside a line are read as text" ok-tok.html --numstat numstat.tsv --ref feat/x
run_check bad.html --numstat numstat.tsv --ref feat/x --base nope
[[ "$RC" == "2" ]] || fail "--base that is not a branch, tag or commit should exit 2, got $RC"
# Lines shown back to back are adjacent in the diff: two added (or two removed) lines next to each other on the page
# must sit next to each other in one hunk, unless a "…" context line marks the gap. Each line alone being in the diff
# is not enough: dropping the line between two others changes what the excerpt says.
diffpage '<span class="d-add">line 5</span><span class="d-add">line 7</span>' >bad.html
expect_only "two added lines shown together that are not adjacent" diff_lines_not_adjacent bad.html --numstat numstat.tsv --ref feat/x
diffpage '<span class="d-add">line 5</span><span class="d-ctx">…</span><span class="d-add">line 7</span>' >ok-adj.html
expect_ok "an ellipsis between them marks the gap" ok-adj.html --numstat numstat.tsv --ref feat/x
# feat/y removes lines 3, 4, 5 and 8 of src/beta.ts: 3-5 are one run, 8 is another.
git checkout -q -b feat/y main && seq 1 10 | grep -v -x -e 3 -e 4 -e 5 -e 8 | sed 's/^/line /' >src/beta.ts \
  && git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q -am "drop lines" && git checkout -q main
diffpage '<span class="d-del">line 3</span><span class="d-del">line 4</span>' >ok-del.html
expect_ok "adjacent removed lines" ok-del.html --numstat numstat.tsv --ref feat/y
diffpage '<span class="d-del">line 4</span><span class="d-del">line 8</span>' >bad.html
expect_only "removed lines that are not adjacent" diff_lines_not_adjacent bad.html --numstat numstat.tsv --ref feat/y
diffpage '<span class="d-del">line 5</span><span class="d-ctx">…</span><span class="d-del">line 8</span>' >ok-del-gap.html
expect_ok "removed lines with an ellipsis between them" ok-del-gap.html --numstat numstat.tsv --ref feat/y

# Without --base the checker picks the base the way classify-target.sh does: develop or main, whichever the ref is
# fewer commits ahead of, so a stale develop (here one with no shared history) never stands in for main.
git checkout -q --orphan develop && git rm -q -r --cached . >/dev/null && echo stale >stale.txt && git add stale.txt \
  && git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q -m "stale develop" && git checkout -q -f main \
  && rm -f stale.txt
expect_ok "a stale develop does not replace main as the base" ok-diff.html --numstat numstat.tsv --ref feat/x
git branch -q -D develop

# 2e. The reference stylesheet: its tokens unchanged and its pill and code-token rules present.
good_change | sed 's|--m-ink: #0b4a5e;|--m-ink: #99aabb;|' >bad.html
expect_only "a restyled evidence pill" reference_style_changed bad.html --numstat numstat.tsv
good_change | sed 's|^\.tk-kw { color: var(--kw); font-weight: 600; }$||' >bad.html
expect_only "no code token rule" reference_style_missing bad.html --numstat numstat.tsv


# 2b. The narrow-window rule is met by fitting, not by hiding: no overflow hidden on html or body,
#     and table cells keep their words whole.
good_change | sed 's|body{background:var(--bg);|body{overflow-x:hidden;background:var(--bg);|' >bad.html
expect_only "overflow hidden on body" overflow_hidden_on_page bad.html --numstat numstat.tsv
good_change | sed 's|</style>|html{overflow:hidden}</style>|' >bad.html
expect_only "overflow hidden on html" overflow_hidden_on_page bad.html --numstat numstat.tsv
good_change | sed 's|</style>|td{overflow-wrap:anywhere}</style>|' >bad.html
expect_only "table cells break anywhere" table_cells_break_words bad.html --numstat numstat.tsv
good_change | sed 's|</style>|td{word-break:break-all}</style>|' >bad.html
expect_only "table cells break all" table_cells_break_words bad.html --numstat numstat.tsv
good_change | sed 's|</style>|.bar{overflow:hidden}.wrap{overflow-x:auto}td{overflow-wrap:break-word}</style>|' >ok-overflow.html
expect_ok "scrolling wrapper and a clipping bar" ok-overflow.html --numstat numstat.tsv

# 2c. A table never squeezes a path into one letter per line: every table sits in its own overflow-x container,
#     and code inside a table cell stays whole, so a narrow window scrolls the table instead.
good_change | sed 's|<div class="wrap"><table>|<table>|; s|</table></div>|</table>|' >bad.html
expect_only "table outside a scroll container" table_not_scrollable bad.html --numstat numstat.tsv
good_change | sed 's|\.wrap{overflow-x:auto}||' >bad.html
expect_only "scroll container class without the rule" table_not_scrollable bad.html --numstat numstat.tsv
good_change | sed 's|\.wrap{overflow-x:auto}||; s|<div class="wrap">|<div style="overflow-x:auto">|' >ok-inline.html
expect_ok "scroll container by inline style" ok-inline.html --numstat numstat.tsv
good_change | sed 's|td code{white-space:nowrap}||; s|td code, th code { white-space: nowrap; overflow-wrap: normal; }||' >bad.html
expect_only "code in a table cell may wrap" table_code_not_whole bad.html --numstat numstat.tsv
good_change | sed 's|td code{white-space:nowrap}||; s|<code>parser</code>|parser|' >ok-nocode.html
expect_ok "no code in the table, no rule needed" ok-nocode.html --numstat numstat.tsv

# 3. Meaning: semantic color that is actually used, one highlight, evidence grades, what was not verified.
good_change | sed 's| class="low"||g; s| class="attn"||g; s| class="look"||g' >bad.html
expect_only "semantic colors defined but unused" semantic_color_unused bad.html --numstat numstat.tsv
good_change | sed 's|<mark>||; s|</mark>||' >bad.html
expect_only "no highlight" mark_missing bad.html --numstat numstat.tsv
good_change | sed 's|<h1>Change summary</h1>|<h1>Change summary</h1><mark>a</mark><mark>b</mark><mark>c</mark><mark>d</mark>|' >bad.html
expect_warn "too many highlights" mark_overused bad.html --numstat numstat.tsv
good_change | sed 's|<span class="g">[a-z]*</span>||g' >bad.html
expect_only "no grades" grades_missing bad.html --numstat numstat.tsv
good_change | sed 's|>measured<|>read<|; s|>inferred<|>read<|' >bad.html
expect_only "only one kind of grade" grades_missing bad.html --numstat numstat.tsv
good_change | sed 's|What I did not verify|Notes on scope|; s|I did not run the CLI end to end.|The CLI works.|' >bad.html
expect_only "no statement of what was not verified" not_verified_missing bad.html --numstat numstat.tsv

# 4. Avoid list.
good_change | sed 's|</style>|.note{border-left:4px solid var(--accent);padding-left:1rem}</style>|; s|<header>|<header class="note">|' >bad.html
expect_only "colored edge bar" colored_edge_bars bad.html --numstat numstat.tsv
good_change | sed 's|</style>|.tile{background:var(--bg);border-radius:8px;padding:.5rem}</style>|; s|<h2>Where to focus</h2>|<h2>Where to focus</h2><div class="tile">1</div>|' >bad.html
expect_only "tiles inside a card" nested_cards bad.html --numstat numstat.tsv
good_change | sed 's|</style>|.filebox{background:var(--bg);border:1px solid var(--line);border-radius:6px}</style>|; s|<details><summary>Details</summary><p>|<details><summary>Details</summary><div class="filebox"><p>|; s|consumers: the CLI wrapper calls the parser.</p>|consumers: the CLI wrapper calls the parser.</p></div>|' >bad.html
expect_only "box inside details" nested_cards bad.html --numstat numstat.tsv
good_change | sed 's|<h1>Change summary</h1>|<h1>Change summary 🔥🔥🔥🔥🔥🔥</h1>|' >bad.html
expect_only "too many emoji" emoji_over_5 bad.html --numstat numstat.tsv
good_change | sed 's|<h1>Change summary</h1>|<h1>Change summary 🔥🔥🔥🔥🔥</h1>|; s|</style>|.quote{border-left:1px solid var(--line)}</style>|; s|<header>|<header class="quote">|' >ok-edge.html
expect_ok "five emoji and a hairline" ok-edge.html --numstat numstat.tsv

# 5. Content floor for a change target.
good_change | sed 's|<tr><td>src/beta.ts.*||' >bad.html
expect_only "file not named" files_not_named bad.html --numstat numstat.tsv
good_change | sed 's|<td class="n">+0 −5</td>||' >bad.html
expect_only "file without +/-" files_without_counts bad.html --numstat numstat.tsv
good_change | sed 's|Downstream consumers: the CLI wrapper calls the parser.||' >bad.html
expect_warn "topic missing" topics_missing bad.html --numstat numstat.tsv
# The topics may be named in the page's own words: "What users see" covers the impact, no keyword "impact" needed.
good_change | sed 's|Impact: users see clearer errors.|What users see: clearer errors.|' >ok-words.html
expect_ok "impact in other words" ok-words.html --numstat numstat.tsv
good_change | sed 's|<h2>Where to focus</h2>|<h2>Notes</h2>|' >bad.html
expect_warn "no focus list" focus_list_missing bad.html --numstat numstat.tsv
good_change | sed 's|needs attention|ok|g; s|>low<|>fine<|g' >bad.html
expect_warn "no risk marks" risk_marks_missing bad.html --numstat numstat.tsv
good_change | sed 's|<h2>How to verify</h2>|<h2>Notes</h2>|' >bad.html
expect_warn "no how-to-verify" how_to_verify_missing bad.html --numstat numstat.tsv

# 5b. Two changed files with the same name are told apart by their path.
printf '1\t1\tagents/explain-agent.md\n2\t2\tskills/explain/explain-agent.md\n' >collide.tsv
collide_page() {  # collide_page <row...>: the good page with its file rows replaced
  good_change | sed 's|<tr><td>src/beta.ts.*||; s|<tr><td>docs/gamma.md.*||' | sed "s|<tr><td>src/alpha.ts.*|$1|"
}
collide_page '<tr><td>agents/explain-agent.md</td><td class="n">+1 −1</td><td class="low">low</td><td>one copy</td></tr>' >bad.html
expect_only "same name, only one named" files_not_named bad.html --numstat collide.tsv
collide_page '<tr><td>plugins/digest/agents/explain-agent.md</td><td class="n">+1 −1</td><td class="low">low</td><td>a</td></tr><tr><td>plugins/digest/skills/explain/explain-agent.md</td><td class="n">+2 −2</td><td class="low">low</td><td>b</td></tr>' >ok-collide.html
expect_ok "same name, both named" ok-collide.html --numstat collide.tsv
collide_page '<tr><td>agents/explain-agent.md</td><td class="n">+1 −1</td><td class="low">low</td><td>a</td></tr><tr><td>skills/explain/explain-agent.md</td><td class="n">+9 −9</td><td class="low">low</td><td>b</td></tr>' >bad.html
expect_only "same name, wrong counts on one" files_without_counts bad.html --numstat collide.tsv

# 6. Content floor for a state target.
good_state | sed 's|<pre><code>.*</code></pre>||' >bad.html
expect_warn "no evidence excerpt" evidence_missing bad.html --kind state
good_state | sed 's|<span class="tk-kw">git</span>|git|' >bad.html
expect_warn "a plain code excerpt" code_not_highlighted bad.html --kind state
good_state | sed 's|Evidence</summary>|Evidence</summary><p>fixed in deadbe1</p>|' >bad.html
expect_only "invented commit hash" invented_hashes bad.html --kind state
good_state | sed 's|src/alpha.ts:12|src/alpha.ts|; s|src/util.ts:3|src/util.ts|' >bad.html
expect_warn "state page cites no file:line" anchors_missing bad.html --kind state

# 6b. A file:line anchor must point at a real file and a line inside it.
good_change | sed 's|src/alpha.ts:12|src/alpha.ts:999|' >bad.html
expect_only "anchor past the end of the file" anchors_invalid bad.html --numstat numstat.tsv
good_change | sed 's|src/alpha.ts:12|src/alpha.ts:10-30|' >ok-range.html
expect_ok "anchor with a line range" ok-range.html --numstat numstat.tsv
good_change | sed 's|src/alpha.ts:12|alpha.ts:12|' >ok-base.html
expect_ok "anchor by file name only" ok-base.html --numstat numstat.tsv
good_change | sed 's|Why: the old parser|Why at 10:30 and port example.com:8080: the old parser|' >ok-noise.html
expect_ok "times and host:port are not anchors" ok-noise.html --numstat numstat.tsv

# 6c. Explaining a branch that is not checked out: anchors and hashes are validated against the TARGET ref, not
#     the working tree, and are skipped (with a warning, never a violation) when the ref is not available locally.
good_change | sed 's|src/alpha.ts:12|src/new.ts:12|' >on-feat.html
run_check on-feat.html --numstat numstat.tsv
[[ "$RC" == "0" && "$(ids)" == "" && "$(warn_ids)" == "unknown_anchor_files" ]] \
  || fail "without --ref an anchor into a file the working tree lacks is a warning, never a violation: rc=$RC ids=$(ids) warns=$(warn_ids)"
expect_ok "same anchor, validated against --ref feat/x" on-feat.html --numstat numstat.tsv --ref feat/x
good_change | sed 's|src/alpha.ts:12|src/new.ts:999|' >bad.html
expect_only "anchor past the end of the file on the ref" anchors_invalid bad.html --numstat numstat.tsv --ref feat/x
run_check on-feat.html --numstat numstat.tsv --ref refs/pull/9/head
[[ "$RC" == "0" && "$(ids)" == "" && "$(warn_ids)" == "references_unchecked" ]] \
  || fail "an unavailable ref skips reference checks with a warning: rc=$RC ids=$(ids) warns=$(warn_ids)"
good_change | sed 's|Why: the old parser|Why: commit deadbe1 broke the old parser|' >hash-bad.html
run_check hash-bad.html --numstat numstat.tsv --ref refs/pull/9/head
[[ "$RC" == "0" && "$(ids)" == "" && "$(warn_ids)" == "references_unchecked" ]] \
  || fail "hashes are not judged when the ref is unavailable: rc=$RC ids=$(ids) warns=$(warn_ids)"
expect_only "invented hash still caught on a real ref" invented_hashes hash-bad.html --numstat numstat.tsv --ref feat/x
good_change | sed "s|Why: the old parser|Why: $ONLY_ON_FEAT added the new file, the old parser|" >hash-feat.html
expect_ok "a hash that exists only on another local branch" hash-feat.html --numstat numstat.tsv
run_check good-change.html --numstat numstat.tsv --ref
[[ "$RC" == "2" ]] || fail "--ref without a value should exit 2, got $RC"

# 6d. An HTML character reference such as &#8594; is not a raw color.
good_change | sed 's|Moderate risk|Moderate \&#8594; \&#169; risk|' >ok-entity.html
grep -q '&#8594;' ok-entity.html || fail "the entity fixture was not built"
expect_ok "numeric character references" ok-entity.html --numstat numstat.tsv

# 7. Navigation: a page with four or more headings needs working jump links.
good_change | sed 's|<nav>.*</nav>||' >bad.html
expect_warn "no jump links" jump_links_missing bad.html --numstat numstat.tsv
good_change | sed 's|href="#\([a-z]*\)"|href="#x\1"|g' >bad.html
expect_warn "jump links to nowhere" jump_links_missing bad.html --numstat numstat.tsv

# 11. Review fixes. Paths in numstat: renames and git-quoted non-ASCII names must be matchable by an honest page.
printf '10\t2\tsrc/alpha.ts\n0\t0\tsrc/{beta.ts => gamma2.ts}\n3\t3\tdocs/gamma.md\n' >rename.tsv
good_change | sed 's|src/beta.ts|src/gamma2.ts|g; s|+0 −5|+0 −0|' >ok-rename.html
expect_ok "a {old => new} rename in numstat" ok-rename.html --numstat rename.tsv
printf '1\t1\tsrc/old.ts => src/new2.ts\n' >rename2.tsv
collide_page '<tr><td>src/new2.ts</td><td class="n">+1 −1</td><td class="low">low</td><td>moved</td></tr>' >ok-rename2.html
expect_ok "an old => new rename in numstat" ok-rename2.html --numstat rename2.tsv
printf '1\t1\t"src/\\346\\227\\245\\350\\252\\214.ts"\n' >quoted.tsv
collide_page '<tr><td>src/日誌.ts</td><td class="n">+1 −1</td><td class="low">low</td><td>x</td></tr>' >ok-quoted.html
expect_ok "a git-quoted non-ASCII path in numstat" ok-quoted.html --numstat quoted.tsv
printf '1234\t5\tsrc/big.ts\n' >big.tsv
collide_page '<tr><td>src/big.ts</td><td class="n">+1,234 −5</td><td class="low">low</td><td>x</td></tr>' >ok-big.html
expect_ok "thousands separators in counts" ok-big.html --numstat big.tsv

# 11b. A page in another language: the keyword checks cannot read it, so they warn instead of failing it.
good_change | sed 's|<html lang="en">|<html lang="zh-TW">|; s|Where to focus|重點|; s|How to verify|驗證方式|; s|What I did not verify|未驗證|; s|needs attention|需注意|g; s|>low<|>低<|g; s|worth a look|值得看|g; s|Expand all|展開全部|; s|Why: .*Downstream consumers: the CLI wrapper calls the parser.|說明:舊解析器脆弱(見 src/util.ts:3),影響使用者。|; s|I did not run the CLI end to end.|我沒有端到端執行 CLI。|' >zh.html
run_check zh.html --numstat numstat.tsv
[[ "$RC" == "0" && "$(ids)" == "" && "$(warn_ids)" == "language_unchecked" ]] \
  || fail "a non-English page is warned about, not failed: rc=$RC ids=$(ids) warns=$(warn_ids) $OUT"

# 11c. The checker works from the repository root, whatever directory it is run from.
OUT="$(cd docs && "$SCRIPT" ../good-change.html --numstat ../numstat.tsv 2>"$TMP/err")" && RC=0 || RC=$?
[[ "$RC" == "0" && "$(ids)" == "" ]] || fail "run from a subdirectory: rc=$RC $OUT $(cat "$TMP/err")"
OUT="$(cd docs && "$SCRIPT" ../good-change.html --numstat ../numstat.tsv --ref main 2>"$TMP/err")" && RC=0 || RC=$?
[[ "$RC" == "0" && "$(ids)" == "" ]] || fail "run from a subdirectory with --ref: rc=$RC $OUT $(cat "$TMP/err")"

# 11d. The hard rules look at CSS, resource attributes and script requests, not at prose, <pre> or <a href>.
good_change | sed 's|Why: the old parser|Why: PR #123, #1042 and #beef changed the old parser|' >ok-pr.html
expect_ok "PR numbers in prose are not colors" ok-pr.html --numstat numstat.tsv
good_change | sed 's|Why: the old parser|Why: see <a href="https://github.com/o/r/pull/1">the PR</a>, the old parser|' >ok-link.html
expect_ok "a link is not a request" ok-link.html --numstat numstat.tsv
good_change | sed 's|Why: the old parser|Why: https://example.test/a and new URL(x) in <code>get_url(y)</code> explain the old parser|' >ok-urltext.html
expect_ok "URLs and url( in text" ok-urltext.html --numstat numstat.tsv
good_change | sed 's|<details id="files">|<details id="open-questions">|' >ok-openid.html
expect_ok "an id that contains the word open" ok-openid.html --numstat numstat.tsv
good_change | sed 's|<section id="verify"><h2>How to verify</h2>|<section id="verify"><h2>How to verify</h2><pre>a{color:#fff;background:rgba(0,0,0,.5)}</pre>|' >ok-cssexcerpt.html
expect_ok "a CSS excerpt in <pre>" ok-cssexcerpt.html --numstat numstat.tsv
good_change | sed 's|</main>|<img src="x.png"></main>|' >bad.html
expect_only "a relative image is an external file" external_requests bad.html --numstat numstat.tsv
good_change | sed 's|</main>|<script>fetch("https://x.test/y")</script></main>|' >bad.html
run_check bad.html --numstat numstat.tsv
[[ "$(ids)" == "external_requests,script_not_from_reference" ]] || fail "a script that fetches a URL: $(ids)"
good_change | perl -0pe 's/\@media \(prefers-color-scheme: dark\) \{\n  :root \{.*?\n  \}\n\}\n//s; s/Why: the old parser/Why: prefers-color-scheme is not used, the old parser/' >bad.html
run_check bad.html --numstat numstat.tsv
[[ "$(ids)" == "no_dark_mode,reference_style_changed" ]] || fail "prefers-color-scheme only in prose is not a dark mode: $(ids)"
good_change | sed 's|</style>|:root{overflow-x:hidden}</style>|' >bad.html
expect_only "overflow hidden on :root" overflow_hidden_on_page bad.html --numstat numstat.tsv

# 11e. References: only tracked files count as anchors, and a hash needs commit context.
good_change | sed 's|Why: the old parser|Why: the trace node_modules/express/lib/router.js:284 and db.prod:5432 show the old parser|' >ok-trace.html
run_check ok-trace.html --numstat numstat.tsv
[[ "$RC" == "0" && "$(ids)" == "" && "$(warn_ids)" == "unknown_anchor_files" ]] || fail "unknown files in anchors are warned about: rc=$RC ids=$(ids) warns=$(warn_ids)"
good_change | sed 's|src/alpha.ts:12|nofile.ts:3|' >ok-unknown.html
run_check ok-unknown.html --numstat numstat.tsv
[[ "$RC" == "0" && "$(ids)" == "" && "$(warn_ids)" == "unknown_anchor_files" ]] || fail "an anchor in an unknown file is a warning: rc=$RC ids=$(ids) warns=$(warn_ids)"
good_change | sed 's|Why: the old parser|Why: id 550e8400-e29b-41d4-a716-446655440000 and the color decaf12 describe the old parser|' >ok-uuid.html
expect_ok "a UUID and a hex word are not commits" ok-uuid.html --numstat numstat.tsv
good_state | sed 's|src/alpha.ts:12|foo.ts:1|; s|src/util.ts:3|bar.ts:2|' >bad.html
run_check bad.html --kind state
[[ "$RC" == "0" && "$(ids)" == "" && "$(warn_ids)" == "anchors_missing,unknown_anchor_files" ]] || fail "anchors in unknown files do not satisfy a state page (a warning now): rc=$RC ids=$(ids) warns=$(warn_ids)"

# 11f. Risk marks: the template says every file, so one marked file out of three is not enough.
good_change | sed 's|<td class="low">low</td>|<td></td>|g' >bad.html
expect_warn "one file marked out of three" risk_marks_missing bad.html --numstat numstat.tsv
good_change | sed 's|<td class="low">low</td>|<td></td>|g; s|<h1>Change summary</h1>|<h1>Change summary</h1><h2>Low risk (2 files)</h2>|' >ok-group.html
expect_ok "files grouped under a low-risk heading" ok-group.html --numstat numstat.tsv

# 11g. Selector forms real CSS uses, and a label wrapped in a span.
good_change | sed 's|\.wrap{overflow-x:auto}|main .wrap{overflow-x:auto}|' >ok-sel1.html
expect_ok "scroll container with a descendant selector" ok-sel1.html --numstat numstat.tsv
good_change | sed 's|\.wrap{overflow-x:auto}|.wrap:not(.x){overflow-x:auto}|' >ok-sel2.html
expect_ok "scroll container with a pseudo-class" ok-sel2.html --numstat numstat.tsv
good_change | sed 's|td code{white-space:nowrap}|.files code{white-space:nowrap}|' >ok-sel3.html
expect_ok "nowrap on a descendant code selector" ok-sel3.html --numstat numstat.tsv
good_change | sed 's|hidden>Expand all</button>|hidden><span>Expand all</span></button>|' >ok-span.html
expect_ok "Expand all label inside a span" ok-span.html --numstat numstat.tsv
good_change | sed $'s|</style>|.z{border-radius:\\\n;background:var(--bg)}</style>|' >ok-radius.html
grep -q 'border-radius:' ok-radius.html || fail "the border-radius fixture was not built"
expect_ok "a border-radius declaration with no value" ok-radius.html --numstat numstat.tsv

# 11h. Messages and warnings that tell the truth.
run_check on-feat.html --numstat numstat.tsv --ref refs/pull/9/head
printf '%s' "$OUT" | jq -r '.warnings[0].message' | grep -q 'pull/9/head:refs/pull/9/head' || fail "the fetch advice must name a destination ref: $OUT"
NOREPO="$(mktemp -d)"   # not under $TMP, which is itself a repository
OUT="$(cd "$NOREPO" && "$SCRIPT" "$TMP/good-change.html" --numstat "$TMP/numstat.tsv" 2>"$TMP/err")" && RC=0 || RC=$?
rm -rf "$NOREPO"
printf '%s' "$OUT" | jq -e '[.warnings[].id] | index("references_unchecked")' >/dev/null || fail "outside a git repository the reference checks are skipped with a warning: $OUT"

# 11i. The wrappers find their helper through a symlink on PATH and when called by a bare name.
mkdir -p "$TMP/symbin"
ln -sf "$SCRIPT" "$TMP/symbin/check-explainer"
OUT="$(PATH="$TMP/symbin:$PATH" check-explainer good-change.html --numstat numstat.tsv 2>"$TMP/err")" && RC=0 || RC=$?
[[ "$RC" == "0" && "$(printf '%s' "$OUT" | jq -r .ok)" == "true" ]] || fail "called through a symlink on PATH: rc=$RC $OUT $(cat "$TMP/err")"
OUT="$(cd "$HERE/../scripts" && bash check-explainer.sh "$TMP/good-change.html" --numstat "$TMP/numstat.tsv" 2>"$TMP/err")" && RC=0 || RC=$?
[[ "$RC" == "0" && "$(printf '%s' "$OUT" | jq -r .ok)" == "true" ]] || fail "called by a bare name: rc=$RC $OUT $(cat "$TMP/err")"

# 8. Polish items are warnings: the page still passes.
good_change | sed 's|td.n{font-variant-numeric:tabular-nums}||; s| font-variant-numeric: tabular-nums;||g' >warn.html
run_check warn.html --numstat numstat.tsv
[[ "$RC" == "0" && "$(ids)" == "" && "$(warn_ids)" == "tabular_nums_missing" ]] || fail "tabular-nums is a warning: rc=$RC ids=$(ids) warns=$(warn_ids)"
good_change | sed 's|h1,h2{text-wrap:balance}||; s| text-wrap: balance;||' >warn.html
run_check warn.html --numstat numstat.tsv
[[ "$RC" == "0" && "$(ids)" == "" && "$(warn_ids)" == "text_wrap_balance_missing" ]] || fail "text-wrap balance is a warning: rc=$RC ids=$(ids) warns=$(warn_ids)"

# 9. Several violations are all reported, and the output is valid JSON with a message per violation.
good_change | sed 's|</head>|<link rel="stylesheet" href="https://x.test/a.css"></head>|; s|<span class="g">[a-z]*</span>||g' >bad.html
run_check bad.html --numstat numstat.tsv
[[ "$(ids)" == "external_requests,grades_missing" ]] || fail "two violations expected: $(ids)"
[[ "$(printf '%s' "$OUT" | jq -r '[.violations[] | select((.message // "") == "")] | length')" == "0" ]] || fail "every violation needs a message"
[[ "$(printf '%s' "$OUT" | jq -r '.violations[0].group')" =~ ^(hard|meaning|avoid|floor)$ ]] || fail "each violation has a group"

# 10. Usage errors and a missing interpreter fail with their own exit codes.
run_check
[[ "$RC" == "2" ]] || fail "no file should exit 2, got $RC"
run_check nope.html --numstat numstat.tsv
[[ "$RC" == "2" ]] || fail "missing file should exit 2, got $RC"
run_check good-change.html --kind banana
[[ "$RC" == "2" ]] || fail "bad --kind should exit 2, got $RC"
run_check good-change.html --numstat nope.tsv
[[ "$RC" == "2" ]] || fail "missing numstat file should exit 2, got $RC"
run_check good-change.html
[[ "$RC" == "2" ]] || fail "a change page without --numstat should exit 2, got $RC"
EMPTY="$TMP/emptybin"; mkdir -p "$EMPTY"
OUT="$(env PATH="$EMPTY" /bin/bash "$SCRIPT" good-change.html --numstat numstat.tsv 2>"$TMP/err")" && RC=0 || RC=$?
[[ "$RC" == "3" ]] || fail "missing python3 should exit 3, got $RC"
grep -q 'python3' "$TMP/err" || fail "missing python3 should say so: $(cat "$TMP/err")"

echo "ok: check-explainer"
