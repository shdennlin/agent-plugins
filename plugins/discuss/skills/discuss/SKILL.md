---
name: discuss
description: "Frame a feature, bug, or design question before building: scout the codebase, surface assumptions, form hypotheses, or interview, compare options, and converge on an explicit decision. Use when an idea needs sharpening before a spec or plan exists. Read-only — never implements."
disallowed-tools: Edit, Write
---

# Discuss — Portable Framing

Have a focused, converging discussion about a topic. Thinking, not implementing: you may
read files and search code, but NEVER write code or create files during this skill — not
with Edit/Write, and not with `sed -i`, redirection, or any other shell write. If the
user asks to implement, tell them to end the discussion first.

**Input**: the argument is the topic — a design question, a problem statement, a vague idea.
If empty, ask what to discuss.

## Step 0: Size the decision and say so

Classify from the topic, announce it in one sentence so the user can override, then scout.

- **Quick** — reversible, local, one obvious approach ("should this button go here or
  there", "which of these two names"). Output: the short form of whichever mode fires —
  a short paragraph, no table and no four-line blocks.
- **Standard** — a real choice with 2+ viable approaches inside existing structure.
  Output: the map table + four-line blocks below.
- **Deep** — introduces a new seam (new module, new public interface, new cross-layer
  flow, new storage format), or is hard to reverse once shipped. Output: Standard, plus
  the seam check in Step 1b.

Say it out loud: "This looks Standard — I'll list assumptions after a quick scout."

**Size by the decision, not the task.** A one-line change that pins a data format for the
next two years is Deep. A 500-line refactor you can revert is Quick.

**The ratchet is one-way.** If the scout or the discussion reveals hidden complexity,
upgrade the tier, say so, and continue. Nothing downgrades mid-discussion.

## Step 1: Scout

Extract 2-5 keywords from the topic. Grep/Glob for related **source** files (not docs/tests).
Read up to 5 of the most relevant. Spend seconds, not minutes.

## Step 1b: Seam check (Deep tier only)

If and only if Step 0 said Deep, read `references/seam-check.md` and answer its four
questions before finalizing output. Skip it entirely for Quick and Standard.

## Step 2: Pick a mode and announce it

- **The topic describes something already broken** — it fails, doesn't appear, returns the
  wrong thing, is slow, "why does it..." → **Hypotheses mode**, regardless of file count.
- **3+ related source files found** → **Assumptions mode.** You have enough context to form
  opinions; list them and let the user correct.
- **Fewer** → **Interview mode.** Ask questions one at a time.

Announce the choice: "Found `a.ts`, `b.ts`, `c.rs` — listing my assumptions." or
"Didn't find much related code — I'll interview."

The user can switch at any time: "ask me questions instead" → Interview mode; "just list
your assumptions" → Assumptions mode (scout first if not done yet).

### Assumptions mode

**Quick tier**: state 1-2 assumptions in a short paragraph, ask "right?", and stop here.

**Standard / Deep**: lead with a map table — one row per assumption:

```markdown
| # | what it decides | my pick | confidence | cost if wrong |
|---|---|---|---|---|
```

Note any dependency between rows in one line beneath it.

Then expand each as exactly four labelled lines — no bullet lists, no sub-prose:

1. **Choice** — what you'd do (one line)
2. **Rejected** — the alternative(s) you ruled out + the one reason each lost, or
   "none — single viable approach". An honest "none" is informative; never invent straw
   options to fill the field.
3. **Evidence** — the single strongest file-grounded reason. One line, one file. Cut the
   rest: the user is judging your call, not auditing your proof.
4. **If wrong** — the consequence **in the user's terms** (what they would see or feel, not
   what the code would do), then the fallback you'd switch to. Never put a rejected
   alternative here; that belongs in **Rejected**.

Render these however reads best — labelled lines, or a four-row table per assumption —
but all four must be present and distinct; a three-row format silently drops **Rejected**.

`confidence` and `cost if wrong` are different axes — risk is probability × cost. A
high-confidence assumption whose failure kills the feature outranks a low-confidence one
whose failure costs a rename.

Then ask for corrections **by number**, and name both the assumption you are least confident
about and the one that is most expensive to get wrong. If all are fine → converge. If any are
corrected → one focused follow-up per correction, then converge.

### Hypotheses mode

A bug's answer lives in the environment, not in the user's head. Do not ask them to pick
between causes — give them something to run.

**Quick tier**: one or two hypotheses and the single cheapest check, in a short
paragraph. No table.

**Standard / Deep**: lead with a table ordered by likelihood:

```markdown
| # | root cause | likelihood | verifiable in a minute? |
|---|---|---|---|
```

Then expand each as exactly four labelled lines:

1. **Hypothesis** — the mechanism, stated so it can be false
2. **Evidence** — what in the code or the symptom points here (one line, one file)
3. **How to kill it** — the single cheapest command or check that rules it out
4. **If it holds** — where the fix goes and roughly how big

Never converge on a fix before one hypothesis survives a check. If all are still alive, say
so and hand over the cheapest check — "we don't know yet, run this" is a valid conclusion.
Expect the first hypothesis to be wrong sometimes, and revise without being pushed.

For a bug that needs actual instrumentation rather than framing — binary search, bisect,
repeated hypothesis cycles against a running system — hand off: `spectra-debug` in a
Spectra repo, otherwise `superpowers:systematic-debugging`.

### Interview mode

- ONE question per message. Skip anything already answered.
- **Quick tier**: at most two questions, then converge.
- Prefer multiple choice with concrete options over open-ended.
- When exploring approaches, present 2-3 options with a trade-off table and a
  recommendation — never a menu without an opinion.

## Step 3: Discussion discipline (all modes)

- **Ground in reality** — cite actual files, not theory.
- **Challenge assumptions** — the user's and yours. Apply YAGNI; ask "do we need this?"
- **No empty validation** — never "great question" / "that could work"; state why or why not.
- **Push for specifics** — "make it more modular" is not an answer; ask what gets split,
  into what, at what cost.
- **Be direct** — lead with your recommendation and the reason.
- **Respect pace** — if the user pushes to move on, flag the single most important
  unresolved question in one sentence, then converge. One nudge maximum.

## Step 4: Converge

Every discussion ends with an explicit conclusion:

```
## Conclusion

**Decision**: <what was decided>
**Options rejected**: <what else was on the table, and the one reason each lost>
**Rationale**: <the key trade-off that drove it>
**Risks accepted**: <what could bite, or "none surfaced">
**How we'll know it worked**: <the observable that would confirm this was right>
**Next step**: <recommended follow-up>
```

The conclusion is one of: a design decision, a direction consensus, a next-step
recommendation, or an explicit deferral naming what's missing.

**Quick tier** may collapse this to two lines (Decision + Next step). The ceremony scales
with the tier; the conclusion never disappears.

Before capturing a behavioral decision, confirm with a concrete example
("so inputs 0.9/0.3/0.7 come back ordered 0.9, 0.7, 0.3 — right?").

**Next step** should point at the workflow that fits the repo:
- Spectra repo (`openspec/` at git root): suggest `/spectra-propose` (and note
  `spectra-discuss` for future discussions there).
- Repo with an ADR directory (`docs/adr/`, `doc/adr/`, `docs/architecture/decisions/`):
  say it warrants an ADR and carry Decision / Options rejected / Risks accepted into it.
  You are that ADR's upstream, never its substitute — an ADR needs a number, a status,
  and a supersedes chain that one discussion can't supply.
- Otherwise: suggest a spec/plan (e.g., superpowers writing-plans) or, for small tasks,
  direct implementation — followed by `/reviewer:spec` on whatever spec results.

Present the conclusion in conversation. Do NOT write it to a file unless the user
explicitly asks.

## Guardrails

- Never implement, never create/edit files — including via shell writes.
- Size the decision before scouting, and upgrade only — never talk yourself down a tier.
- Never ask the user to adjudicate a bug's root cause; hand them a check instead.
- Keep each assumption or hypothesis to its four lines — information with no field of its
  own squats in a neighbouring one and bloats it.
- Never end without a conclusion — if the user drops off, summarize where things stand and
  what's unresolved.
- One question at a time; one nudge maximum on pacing.
- Prefer the simplest option that works.
