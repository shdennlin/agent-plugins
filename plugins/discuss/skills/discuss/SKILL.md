---
name: discuss
description: "Frame a feature, bug, or design question before building: scout the codebase, surface assumptions or interview, compare options, and converge on an explicit decision. Use when an idea needs sharpening before a spec or plan exists. Read-only — never implements."
---

# Discuss — Portable Framing

Have a focused, converging discussion about a topic. Thinking, not implementing: you may
read files and search code, but NEVER write code or create files during this skill. If the
user asks to implement, tell them to end the discussion first.

**Input**: the argument is the topic — a design question, a problem statement, a vague idea.
If empty, ask what to discuss.

## Step 1: Scout

Extract 2-5 keywords from the topic. Grep/Glob for related **source** files (not docs/tests).
Read up to 5 of the most relevant. Spend seconds, not minutes.

## Step 2: Pick a mode and announce it

- **3+ related source files found → Assumptions mode.** You have enough context to form
  opinions; list them and let the user correct.
- **Fewer → Interview mode.** Ask questions one at a time.

Announce the choice: "Found `a.ts`, `b.ts`, `c.rs` — listing my assumptions." or
"Didn't find much related code — I'll interview."

### Assumptions mode

Present 3-5 assumptions. Each MUST include:

1. **Approach**: what you'd do and why
2. **Evidence**: file path(s) that informed it
3. **If wrong**: the concrete consequence

Then ask exactly: **"Which of these are wrong?"** If all fine → converge. If corrected →
one focused follow-up per correction, then converge.

### Interview mode

- ONE question per message. Skip anything already answered.
- Prefer multiple choice with concrete options over open-ended.
- When exploring approaches, present 2-3 options with a trade-off table and a
  recommendation — never a menu without an opinion.

## Step 3: Discussion discipline (both modes)

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
**Rationale**: <the key trade-off that drove it>
**Risks accepted**: <what could bite, or "none surfaced">
**Next step**: <recommended follow-up>
```

The conclusion is one of: a design decision, a direction consensus, a next-step
recommendation, or an explicit deferral naming what's missing.

Before capturing a behavioral decision, confirm with a concrete example
("so inputs 0.9/0.3/0.7 come back ordered 0.9, 0.7, 0.3 — right?").

**Next step** should point at the workflow that fits the repo:
- Spectra repo (`openspec/` at git root): suggest `/spectra-propose` (and note
  `spectra-discuss` for future discussions there).
- Otherwise: suggest a spec/plan (e.g., superpowers writing-plans) or, for small tasks,
  direct implementation — followed by `/reviewer:spec` on whatever spec results.

Present the conclusion in conversation. Do NOT write it to a file unless the user
explicitly asks.

## Guardrails

- Never implement, never create/edit files.
- Never end without a conclusion — if the user drops off, summarize where things stand
  and what's unresolved.
- One question at a time; one nudge maximum on pacing.
- Prefer the simplest option that works.
