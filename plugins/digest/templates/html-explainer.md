# HTML Explainer — What Must Hold, What the Page Must Say, and What Is Yours

Used by `/digest:explain` for every target by default. A reader often gets one pass at the page, so it has to make the point in the first screen and let them understand the rest without a second read: short sections, a clear order, a diagram or table where the shape helps, and paragraphs they can follow. Write in English unless the user asked for another language; then keep the labels `measured`, `read` and `inferred` as they are.

## Must hold (the checker fails the page when these break)

1. **Use the reference stylesheet.** Copy the whole of `html-explainer-style.css`, which sits next to this template, into the page's `<style>` element, unchanged, then add only what the page needs. It defines the heading colors, the evidence pills, the code token colors and the tables, and every text color in it was measured at about 7:1 in both modes; the checker compares the page's color tokens with it in both modes. Use its hooks: wrap the content in `<main>`, write a label as `<span class="g measured">measured</span>` (or `read`, `inferred`), put each table in `<div class="scroll">`, and color code with `tk-*` spans. Do not restyle these elements from scratch, and use only tokens the stylesheet defines (text is `--ink`, not `--fg`): an undefined token falls back to black, which disappears in dark mode.
2. **One file, zero network requests.** No `<script src>`, `<link>`, `@import`, remote images, fonts, CDN or Mermaid. Inline CSS, SVG and JS are fine. Small images only as `data:` URIs.
3. **Light and dark, both readable.** Define every color as a CSS custom property on `:root`, with `color-scheme: light dark`. A `@media (prefers-color-scheme: dark)` block redefines only those properties; no other rule uses a raw color. The light background is near white (97% lightness or brighter). The dark background is a lifted charcoal, about 16% to 20% lightness, never near-black. Body text, muted text, the evidence labels and the `ok`, `warn` and `bad` colors each reach about 7:1 against their background in both modes; the reference stylesheet already meets this, which is why its tokens must not change.
4. **Fits a narrow window.** Never put `overflow: hidden` or `overflow-x: hidden` on `html` or `body`. Every table sits in its own container with `overflow-x: auto`, as do wide code blocks and diagrams. Table cells keep their words whole: no `overflow-wrap: anywhere` or `word-break: break-all` on `td` or `th`, and `code` inside a cell gets `white-space: nowrap`. Long paths and inline `code` in running text may wrap.
5. **Keyboard focus.** Buttons, `<summary>` and links get a visible `:focus-visible` style.
6. **Grade the evidence.** Tag important claims `measured` (you ran it), `read` (you read the code; cite `file:line`) or `inferred` (not verified). Use at least three labels of at least two kinds. A label reads only `measured`, `read` or `inferred`; show a risk level with the `ok`, `warn` and `bad` classes, never in a label. Grade a conclusion separately from the fact under it; a sentence takes the grade of its weakest link.
7. **Real references.** Cite only commits that exist and `file:line` anchors that point at an existing file and line. A hash that does not exist is invented history.
8. **What I did not verify.** A section that says what was not checked, graded `inferred`.
9. **Every changed file is accounted for** (for a change target). Each file appears by name with `+N −M` and one line on what changed, any total you state ("4 files, 232 added lines") matches the diff, and its risk mark and counts carry the semantic colors `--ok`, `--warn` and `--bad` (through the classes `ok`, `warn`, `bad`).
10. **One highlight.** At least one `<mark>`, on the sentence the reader must not miss. More than three is a warning, since nothing then stands out.
11. **Scripts only from the components.** Every inline `<script>` is a component's script, copied unchanged (spacing may differ). Do not write your own; the page must read fully with scripts off, which is how the render check sees it.

## Avoid (the checker fails the page when these break)

- **No colored bars on the edge of a card, callout, banner or quote.** No `border-left`, `border-right` or inset accent shadow. Set things apart with spacing, a tint, a label, or a full border.
- **No cards inside cards.** A tinted or bordered box inside another boxed section, a stat tile inside a boxed section, or a box per item inside a `<details>`, all count. Lay things out directly on the page.
- **Emoji sparingly:** at most five on the page, none in running prose.

## The page must say (the checker warns when these are missing)

- **Conclusion first.** Say what this is, and for a change how risky it is, before any detail.
- **For a change:** what changed and why; the impact, what users now see; breaking changes and how to migrate; risks; design decisions and trade-offs; questions for the author; and downstream consumers or callers, meaning what else depends on the changed files. Name each file with `+N −M` and a risk level (low, worth a look, needs attention) on its row, or group the low-risk files under a heading such as "Low risk (8 files)". Show the key lines of the change as a diff with the `code-diff` component, copied verbatim from the diff. Add a "Where to focus" list, most important first, naming the file and why. End with a "How to verify" section listing the commands to run.
- **For a state question** (a file, symbol or how-or-why): the commands you ran, the key commits by short hash, code excerpts in `<pre>`, and at least two `file:line` anchors.
- **Highlighted code.** In every code excerpt, wrap keywords, strings, comments and numbers in `<span class="tk-kw">`, `tk-str`, `tk-com` and `tk-num`.
- Pick the words and order that suit the answer. Diagrams and tables earn their place when they show something the text cannot.

## Components (read only the ones you use)

Ready-made parts in `components/`, next to this template. Each file says when to use it, what to copy, and how it reads with scripts off. Pick from this list and read only the files you will use; copy their CSS and script unchanged, and change only the markup's text and data.

- `expand-all.html`: an Expand all / Collapse all button, for a page with two or more `<details>`.
- `code-diff.html`: a diff-style excerpt with added and removed lines; the best excerpt for a branch or PR.
- `code-extras.html`: a file-name bar with a Copy button, real line numbers, and highlighted lines, for a long excerpt.
- `file-tree.html`: changed files as a folder tree with `+N −M` and risk, for about ten or more files.
- `table-tools.html`: zebra rows, risk filter buttons and sortable columns, for a file table of more than about eight rows.
- `callouts.html`: a note, risk or tip box, for the one point that must stand apart.
- `diagrams.html`: a sequence diagram (who calls whom) and a timeline (events over time).
- `reading-ux.html`: a reading-progress bar, a Top link and `#` links on headings, for a page longer than about four screens.
- `tldr.html`: a "Conclusion only" toggle, for a long page whose reader may want only the answer.

## Yours (suggestions; the checker only notes them)

- **Shape.** The layout, sections and typography that make this answer obvious. A bug trace, a module map, a design history and a change summary should not look alike.
- **Collapse depth.** Put detail the reader does not need at first in `<details>` (without `open`). With several, add the `expand-all` component.
- **Navigation.** On a long page, a short row of jump links to the main sections.
- **Diagrams.** Inline SVG, drawn with the color tokens, when the shape shows branching, a timeline or a comparison. Keep labels inside their boxes and clear of lines, give every arrow a head, and check the coordinates yourself.

## Checking

After writing the file, run the checker. For a change, pass the changed files in `git diff --numstat` format:

`"${CLAUDE_PLUGIN_ROOT}/scripts/check-explainer.sh" <file.html> --numstat <changed.tsv> --ref <target>`

`--ref` is the branch the page explains (`HEAD` for the current branch, `refs/pull/<N>/head` for a PR). For a state question: `"${CLAUDE_PLUGIN_ROOT}/scripts/check-explainer.sh" <file.html> --kind state`. Fix every violation and run it again, at most twice. If violations remain, name them in your report; do not call the page clean without a clean run. Warnings are notes: weigh them and say which you took. If a Chrome is installed, `"${CLAUDE_PLUGIN_ROOT}/scripts/check-render.sh" <file.html>` renders the page at 400px and reports horizontal overflow; exit 4 means no browser, so say the render was not checked.
