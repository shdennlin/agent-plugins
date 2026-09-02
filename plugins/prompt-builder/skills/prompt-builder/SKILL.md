---
name: prompt-builder
description: "Use when the user wants a prompt built, tidied, or critiqued instead of executed — turning a rough multi-task request, a long exploratory session, or a draft prompt into one polished paste-ready prompt, typically to copy, rewind, and paste into a fresh session. Never performs the task the prompt describes."
---

# Prompt Builder

Build the prompt; never do the work it describes. The deliverable is a block of
text the user will carry away (usually into a fresh session after a rewind that
wipes this conversation). If the user asks you to also execute it, tell them to
paste it after rewinding instead.

**Input**: the argument — a topic, a messy multi-task request, or an existing
draft prompt. Empty input is fine: the conversation is the source material.

## Step 1: Detect mode and announce it

- Input reads as an existing prompt draft (already imperative/structured) →
  **Critique mode**.
- The session has real history relevant to the request → **Context-extract
  mode** (the default mid-session).
- Neither → **Interview mode**.

Announce: "Context-extract mode — mining this conversation." A hybrid is normal:
extract what the conversation has, interview only for what it lacks.

## Step 2: Gather the five components

Checklist — for each, mark *found / asked / deliberately omitted*:

| Component | What to capture |
|---|---|
| **Role** | Only when it changes vocabulary or depth; most repo tasks need none |
| **Context** | Decisions already made, file paths, commit hashes, prior findings — everything the fresh session cannot know |
| **Task** | One primary verb per task; normalize typos silently |
| **Constraints** | What to include/skip/avoid; explicit values, never "something like" — name the thing or explicitly delegate the choice |
| **Output format** | Files, structure, destination |

- **Context-extract**: mine the conversation; cite where each item came from.
- **Interview**: ask only the components this task type needs, ONE question per
  message, concrete options preferred.
- **Critique**: map the draft onto the table; gaps become the diagnosis.

## Step 3: Decompose multi-task input

- Split into discrete tasks. Keep the user's explicit ordering words ("first");
  order the rest by dependency.
- List every ambiguous referent ("corresponding commit", "each section"). Each
  one either **resolves from context** (say which evidence) or **becomes a
  question**. An ambiguity that changes the work is never shipped inside the
  final prompt as an embedded assumption — it gets asked in Step 4.

## Step 4: Draft round (repeat until approved)

Present, in this order: the component table, open questions, then the current
draft prompt. **All open questions go in this same message** — batched, never
one per round. Match the asking mechanism to each question's shape:

- **Enumerable fork** (an ambiguity whose answers can be listed): offer options
  — the platform's question UI when it has one, a lettered list otherwise —
  with your recommended answer first.
- **Open correction**: free text — close the message with **"Which of these
  are wrong?"**
- **Delegable detail** (a name, a wording, a trivial choice): don't ask; mark
  it delegated to the target session in the component table.

Iterate — multi-round is the normal case, and two rounds (draft → final) is the
floor: the draft round is never skipped, even when nothing seems ambiguous.
Enter Step 5 only when the user approves and no question is open.

## Step 5: Assemble per doctrine

- Context and data first; the immediate task instruction toward the end.
- **State every fact as a standalone present-tense instruction.** The fresh
  session has no "we", no "previous session", no "as discussed" — a memory like
  "the regression we found in a1b2c3d" becomes "commit a1b2c3d introduced a
  regression in scripts/report_gen.py".
- Phrase instructions as what TO do; keep a negative only when it fences a real
  hazard ("do not commit").
- **Mark settled decisions as settled** — e.g. "(already decided; do not
  revisit)" on the requirements block. The prompt may land on top of retained
  or stale conversation context and must win over it: a decision changed during
  the build rounds exists only in the prompt, while the old version still sits
  upstream in the history.
- Destination Claude Code (default): markdown structure; file/commit references
  by path or hash are enough — the fresh session can read the repo itself.
  Destination claude.ai / API system prompt: XML-tagged sections; inline any
  data the target cannot fetch.
- Divergent tasks (brainstorm, explore): constraints go to a filter stage after
  generation, not before it.
- For executable work, end the prompt with a verification instruction (what to
  check, what "done" looks like).

## Step 6: Rewind test, then finalize

Scan the assembled prompt; fix every hit before printing:

- any reference to this conversation ("as discussed", "we", "previous session",
  "上面/剛剛") — rewrite as standalone fact
- any path/name/value still vague or hedged
- any decision from the conversation still missing
- any question still open

Then, if `pbcopy` exists, pipe the exact prompt into it. **The final message
IS, in full:**

1. One line: components covered / deliberately omitted, plus "✅ clipboard" when
   pbcopy succeeded.
2. The complete prompt in ONE fenced code block.

Nothing follows the code block. Caveats, alternatives, and assumption notes
belong in Step 4's draft rounds, not after the deliverable.

## Critique mode output

Diagnosis table first — each component: status (missing / misused / OK) and the
concrete fix, including stage misuse (constraints choking a divergent task).
Then the strengthened prompt via Steps 5–6.
