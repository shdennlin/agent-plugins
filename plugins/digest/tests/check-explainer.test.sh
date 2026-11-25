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
git add -A
git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q -m "init"
REAL="$(git rev-parse --short=7 HEAD)"

fail() { echo "ASSERT FAIL: $*" >&2; exit 1; }

# The changed files, in `git diff --numstat` format: added <TAB> removed <TAB> path.
printf '10\t2\tsrc/alpha.ts\n0\t5\tsrc/beta.ts\n3\t3\tdocs/gamma.md\n' >numstat.tsv

# A page that satisfies every rule for a change target.
good_change() {
  cat <<'EOF'
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Change summary</title><style>
:root{color-scheme:light dark;--bg:#ffffff;--fg:#111111;--card:#f5f5f5;--line:#dddddd;--accent:#3366cc;--ok:#1a7f37;--warn:#9a6700;--bad:#cf222e}
@media (prefers-color-scheme: dark){:root{--bg:#111111;--fg:#eeeeee;--card:#222222;--line:#333333;--accent:#88aaff;--ok:#3fb950;--warn:#d29922;--bad:#f85149}}
body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui}
h1,h2{text-wrap:balance}
.panel{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem}
details{border:1px solid var(--line);border-radius:10px;margin:.5rem 0}
td.n{font-variant-numeric:tabular-nums}
.low{color:var(--ok)}.look{color:var(--warn)}.attn{color:var(--bad)}
.g{border:1px solid var(--line);border-radius:4px;padding:0 .3rem;font-size:.8rem}
mark{background:var(--card)}
button:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--accent)}
</style></head><body><main>
<nav><a href="#focus">Focus</a> · <a href="#files">Files</a> · <a href="#verify">Verify</a> · <a href="#gaps">Gaps</a></nav>
<header><h1>Change summary</h1><p><mark>Moderate risk: the parser is rewritten and one flag is removed.</mark> <span class="g">read</span></p>
<p>Key: <span class="low">low</span> <span class="look">worth a look</span> <span class="attn">needs attention</span></p></header>
<section class="panel" id="focus"><h2>Where to focus</h2><ol><li>src/alpha.ts:12: the new parser, check the error paths. <span class="g">read</span></li></ol></section>
<div class="ctl"><button id="xall">Expand all</button></div>
<details id="files"><summary>Files</summary><table>
<tr><td>src/alpha.ts</td><td class="n">+10 −2</td><td class="attn">needs attention</td><td>adds the parser</td></tr>
<tr><td>src/beta.ts</td><td class="n">+0 −5</td><td class="low">low</td><td>drops dead code</td></tr>
<tr><td>docs/gamma.md</td><td class="n">+3 −3</td><td class="low">low</td><td>rewords the guide</td></tr>
</table></details>
<details><summary>Details</summary><p>Why: the old parser was fragile (see src/util.ts:3). Impact: users see clearer errors. Breaking: the old flag is removed, migrate to the new one. Risk: error paths are new. Design decisions: one parser instead of two, a trade-off for size. Questions for the author: should the flag stay as an alias? Downstream consumers: the CLI wrapper calls the parser.</p></details>
<section id="verify"><h2>How to verify</h2><p>Run <code>bash tests/run.sh</code> and read the last line.</p></section>
<section id="gaps"><h2>What I did not verify</h2><p>I did not run the CLI end to end. <span class="g">inferred</span> The unit tests passed locally. <span class="g">measured</span></p></section>
<script>(function(){var b=document.getElementById('xall');b.onclick=function(){document.querySelectorAll('details').forEach(function(d){d.open=true})}})();</script>
</main></body></html>
EOF
}

# A page that satisfies every rule for a state target (no changed-file list, an evidence excerpt).
good_state() {
  good_change | sed 's|<tr><td>src/alpha.ts.*||; s|<tr><td>src/beta.ts.*||; s|<tr><td>docs/gamma.md.*||' \
    | sed "s|<details><summary>Details</summary>|<details><summary>Evidence</summary><pre><code>git log --follow -- a.txt ($REAL)</code></pre>|"
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
good_change | sed 's|@media (prefers-color-scheme: dark){:root{[^}]*}}||' >bad.html
expect_only "no dark mode" no_dark_mode bad.html --numstat numstat.tsv
good_change | sed 's|body{background:var(--bg);|body{color:#123456;background:var(--bg);|' >bad.html
expect_only "raw color" raw_colors_outside_tokens bad.html --numstat numstat.tsv
good_change | sed 's|<details id="files">|<details open id="files">|' >bad.html
expect_only "details open" details_open_by_default bad.html --numstat numstat.tsv
good_change | sed 's|<button id="xall">Expand all</button>||' >bad.html
expect_only "no expand all" expand_all_missing bad.html --numstat numstat.tsv
good_change | sed 's|button:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--accent)}||' >bad.html
expect_only "no focus style" focus_style_missing bad.html --numstat numstat.tsv
good_change | sed 's|color-scheme:light dark;||' >bad.html
expect_only "no color-scheme property" color_scheme_missing bad.html --numstat numstat.tsv

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

# 3. Meaning: semantic color that is actually used, one highlight, evidence grades, what was not verified.
good_change | sed 's| class="low"||g; s| class="attn"||g; s| class="look"||g' >bad.html
expect_only "semantic colors defined but unused" semantic_color_unused bad.html --numstat numstat.tsv
good_change | sed 's|<mark>||; s|</mark>||' >bad.html
expect_only "no highlight" mark_missing bad.html --numstat numstat.tsv
good_change | sed 's|<h1>Change summary</h1>|<h1>Change summary</h1><mark>a</mark><mark>b</mark><mark>c</mark><mark>d</mark>|' >bad.html
expect_only "too many highlights" mark_overused bad.html --numstat numstat.tsv
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
expect_only "topic missing" topics_missing bad.html --numstat numstat.tsv
# The topics may be named in the page's own words: "What users see" covers the impact, no keyword "impact" needed.
good_change | sed 's|Impact: users see clearer errors.|What users see: clearer errors.|' >ok-words.html
expect_ok "impact in other words" ok-words.html --numstat numstat.tsv
good_change | sed 's|<h2>Where to focus</h2>|<h2>Notes</h2>|' >bad.html
expect_only "no focus list" focus_list_missing bad.html --numstat numstat.tsv
good_change | sed 's|needs attention|ok|g; s|>low<|>fine<|g' >bad.html
expect_only "no risk marks" risk_marks_missing bad.html --numstat numstat.tsv
good_change | sed 's|<h2>How to verify</h2>|<h2>Notes</h2>|' >bad.html
expect_only "no how-to-verify" how_to_verify_missing bad.html --numstat numstat.tsv

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
good_state | sed 's|<pre><code>[^<]*</code></pre>||' >bad.html
expect_only "no evidence excerpt" evidence_missing bad.html --kind state
good_state | sed 's|Evidence</summary>|Evidence</summary><p>fixed in deadbe1</p>|' >bad.html
expect_only "invented commit hash" invented_hashes bad.html --kind state
good_state | sed 's|src/alpha.ts:12|src/alpha.ts|; s|src/util.ts:3|src/util.ts|' >bad.html
expect_only "state page cites no file:line" anchors_missing bad.html --kind state

# 6b. A file:line anchor must point at a real file and a line inside it.
good_change | sed 's|src/alpha.ts:12|src/alpha.ts:999|' >bad.html
expect_only "anchor past the end of the file" anchors_invalid bad.html --numstat numstat.tsv
good_change | sed 's|src/alpha.ts:12|nofile.ts:3|' >bad.html
expect_only "anchor in a file that does not exist" anchors_invalid bad.html --numstat numstat.tsv
good_change | sed 's|src/alpha.ts:12|src/alpha.ts:10-30|' >ok-range.html
expect_ok "anchor with a line range" ok-range.html --numstat numstat.tsv
good_change | sed 's|src/alpha.ts:12|alpha.ts:12|' >ok-base.html
expect_ok "anchor by file name only" ok-base.html --numstat numstat.tsv
good_change | sed 's|Why: the old parser|Why at 10:30 and port example.com:8080: the old parser|' >ok-noise.html
expect_ok "times and host:port are not anchors" ok-noise.html --numstat numstat.tsv

# 7. Navigation: a page with four or more headings needs working jump links.
good_change | sed 's|<nav>.*</nav>||' >bad.html
expect_only "no jump links" jump_links_missing bad.html --numstat numstat.tsv
good_change | sed 's|href="#\([a-z]*\)"|href="#x\1"|g' >bad.html
expect_only "jump links to nowhere" jump_links_missing bad.html --numstat numstat.tsv

# 8. Polish items are warnings: the page still passes.
good_change | sed 's|td.n{font-variant-numeric:tabular-nums}||' >warn.html
run_check warn.html --numstat numstat.tsv
[[ "$RC" == "0" && "$(ids)" == "" && "$(warn_ids)" == "tabular_nums_missing" ]] || fail "tabular-nums is a warning: rc=$RC ids=$(ids) warns=$(warn_ids)"
good_change | sed 's|h1,h2{text-wrap:balance}||' >warn.html
run_check warn.html --numstat numstat.tsv
[[ "$RC" == "0" && "$(ids)" == "" && "$(warn_ids)" == "text_wrap_balance_missing" ]] || fail "text-wrap balance is a warning: rc=$RC ids=$(ids) warns=$(warn_ids)"

# 9. Several violations are all reported, and the output is valid JSON with a message per violation.
good_change | sed 's|</head>|<link rel="stylesheet" href="https://x.test/a.css"></head>|; s|<h2>Where to focus</h2>|<h2>Notes</h2>|' >bad.html
run_check bad.html --numstat numstat.tsv
[[ "$(ids)" == "external_requests,focus_list_missing" ]] || fail "two violations expected: $(ids)"
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
