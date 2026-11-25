# HTML Explainer — Constraints, Meaning, Content Floor, Things to Avoid

Used by `/digest:explain` for every target by default. The reader should get the point in 3 seconds, the shape in 30, and the full story only if they expand. Write the page to this spec, then run the checker (see Checking) and fix what it reports. Write in English unless the user asked for another language.

## Must hold (the checker enforces these)

1. **One file, zero network requests.** No `<script src>`, no `<link>`, no `@import`, no remote images, fonts, CDN or Mermaid. Inline CSS, inline SVG and inline JS are fine. Small images only as `data:` URIs.
2. **Light and dark.** Define every color as a CSS custom property on `:root`, with `color-scheme: light dark` there; a `@media (prefers-color-scheme: dark)` block redefines only those properties. No other rule uses a raw color.
3. **Deep detail is collapsed.** Anything the reader does not need in the first 30 seconds goes in `<details>` without the `open` attribute. The page must read coherently with every `<details>` closed.
4. **The conclusion comes first.** The first thing on the page answers "what is this" and, for a change, how risky it is, without scrolling.
5. **It must work on a narrow window.** The body never scrolls horizontally, and you get there by fitting, not hiding: never put `overflow: hidden` or `overflow-x: hidden` on `html` or `body`. Every table sits in its own container with `overflow-x: auto`, as do wide code blocks and diagrams, and table cells keep their words whole: no `overflow-wrap: anywhere` or `word-break: break-all` on `td` or `th`, and `code` inside a cell gets `white-space: nowrap`. A narrow window then scrolls the table instead of squeezing a path into one letter per line. Long file paths and inline `code` in running text must be allowed to wrap (`overflow-wrap: anywhere` on `code` outside table cells), or the page grows wider than a phone. A diagram has to stay readable at the width it is shown: if it needs a wide viewBox, let it scroll in its container instead of shrinking its text below 11px.
6. **Expand all.** When the page has two or more `<details>`, include one small button above the first one that toggles all of them (label it "Expand all" / "Collapse all"). Inline JS is allowed for this. Without JS each `<details>` still opens natively.
7. **Keyboard focus.** Buttons, `<summary>` and links get a visible `:focus-visible` style.

## Meaning (the checker enforces these)

- **Semantic color.** Define `--ok`, `--warn` and `--bad` and use them where color carries meaning: each file's risk mark (low is ok, worth a look is warn, needs attention is bad) and the `+N` and `−M` counts. A color that is defined but not used does not count. Never as an edge stripe.
- **One highlight.** Wrap the sentence the reader must not miss in `<mark>`; at most 3 on the page.
- **Grade the evidence.** Tag important claims with a small label reading `measured` (you ran it), `read` (you read the code; cite `file:line`) or `inferred` (not verified), each kind in its own color. Use at least 3 labels of at least 2 kinds. Grade a conclusion separately from the fact under it, and let a sentence take the grade of its weakest link ("X is slow (`measured`), so Y (`inferred`)").

## Content floor (the checker enforces these too)

For a **change** (a pull request, a branch, the current branch):

- **Every changed file is accounted for.** Each file appears by its name with its added and removed line counts written as `+N −M` and one line saying what changed in it. Group by directory if you like, but do not leave a file out.
- **Where to focus.** An ordered list, most important first, of what a reviewer should check first. Each item names the file and says why it matters.
- **Risk per file.** Mark every changed file with a risk level (low, worth a look, or needs attention). Files marked low may be collapsed; the others stay visible.
- **How to verify.** A section headed "How to verify" with the commands the reader should run.
- The page covers, wherever it fits best: what changed and why, the impact (what users now see), breaking changes and how to migrate, risks, design decisions, questions for the author, and downstream consumers (what else depends on the changed files).

For a **state** question (a file, a symbol, a how/why question): an evidence section with the commands run, the key commits by short hash, the code excerpts (in `<pre>`), and at least 2 `file:line` anchors.

For **every** page:

- **What I did not verify.** A section headed "What I did not verify" (grade it `inferred`).
- **Real references.** Cite only real commits, and only `file:line` anchors that point at an existing file and line. A hash that does not exist is invented history.
- **Jump links.** A page with four or more headings has a small nav of jump links (`#` links) to its main sections.

## Avoid

- **No colored bars on the edge of a card, callout, banner or quote.** Do not use `border-left`, `border-right` or an inset box-shadow as an accent stripe. Set things apart with spacing, a background tint, a small label, or a full border.
- **No cards inside cards.** A box that has its own background tint or border is a card. All of these count as a card inside a card: a row of number tiles (stat boxes) inside a section or panel that already has a background or border; a tinted or bordered box for each file or item inside a `<details>` (a `<details>` with a border is itself a card); a callout inside a card. Lay such things out directly on the page, or inside one container using spacing, dividers and type. If you want number tiles, let the tiles be the only boxes: put them on the page, not in a boxed parent.
- **Emoji sparingly.** At most 5 on the whole page, none in running prose. A page that needs none is fine.

## Everything else is yours

Choose the layout, typography, diagram types and sections that make this particular answer obvious. There is no required skeleton and no required component. Do not reuse the same form out of habit: a bug trace, a module map, a design history and a change summary should not look alike. Prefer fewer, bigger, clearer things over many small ones. A diagram earns its place only when it shows something the text cannot, such as branching, a timeline or a comparison; do not draw a straight chain of boxes that restates a sentence. Diagrams are inline SVG drawn with the color tokens, big enough to read. Labels stay clear of every line and inside their box, and every arrow has an arrowhead. The checker cannot verify this one, so check the coordinates yourself. Polish the checker only warns about: `font-variant-numeric: tabular-nums` on cells with counts, and `text-wrap: balance` on headings.

## Checking

After writing the file, run the checker on it. For a change, pass the changed files in `git diff --numstat` format (added, removed, path, tab separated):

`"${CLAUDE_PLUGIN_ROOT}/scripts/check-explainer.sh" <file.html> --numstat <changed.tsv> --ref <target>`

`--ref` is the branch the page explains (`HEAD` for the current branch, `refs/pull/<N>/head` for a PR): anchors and hashes are checked against it, and skipped with a warning when it is not available locally. For a state question: `"${CLAUDE_PLUGIN_ROOT}/scripts/check-explainer.sh" <file.html> --kind state`. If it reports violations, fix the page and run it again, at most twice. If violations remain, name them in your report; do not call the page clean without a clean run. If a Chrome is installed, also run `"${CLAUDE_PLUGIN_ROOT}/scripts/check-render.sh" <file.html>`, which renders the page at 400px and reports horizontal overflow; exit 4 means no browser, so say the render was not checked. In Codex the scripts are at `../../scripts/` relative to the skill directory.
