# discuss

Portable framing discussions — size the decision, then list assumptions, rank hypotheses,
or interview, converging on an explicit decision. A CLI-free distillation of the
`spectra-discuss` workflow for repos that don't use Spectra.

## Usage

```
/discuss:discuss should search support fuzzy matching?
/discuss:discuss the auth module is getting unwieldy
/discuss:discuss why does the sidebar flash on first paint?
```

The skill first **sizes the decision** (Quick / Standard / Deep) and says so, then scouts
the codebase and picks one of three modes:

| mode | fires when | output |
|---|---|---|
| **Hypotheses** | the topic describes something already broken | ranked root causes, each with the cheapest check that kills it |
| **Assumptions** | 3+ related source files found | a map table, then four lines per assumption: Choice / Rejected / Evidence / If wrong |
| **Interview** | too little related code to form opinions | one question per message, multiple choice where possible |

Ceremony scales with the tier — a Quick decision gets a short paragraph, Deep adds a seam
check (`skills/discuss/references/seam-check.md`). Every discussion ends with an explicit
conclusion: `Decision / Options rejected / Rationale / Risks accepted / How we'll know it
worked / Next step`.

Read-only by design: `disallowed-tools: Edit, Write` blocks the write tools, and the skill
body forbids shell writes too. It never writes code or files, and the conclusion stays in
conversation unless you ask for a file.

## When NOT to use

- **Spectra repos** (`openspec/` exists) — prefer `spectra-discuss`; it integrates with
  artifact tracking and shared vocabulary.
- **A bug that needs instrumentation, not framing** — Hypotheses mode is for ranking
  candidate causes and handing you the cheapest check. Once you need binary search, bisect,
  or repeated hypothesis cycles against a running system, hand off to `spectra-debug`
  (Spectra repos) or `superpowers:systematic-debugging`.
- **A decision already made** — this is pre-decision framing, not an ADR. If your repo
  keeps ADRs, discuss feeds one; it does not replace it.
