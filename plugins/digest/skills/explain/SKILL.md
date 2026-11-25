---
name: digest:explain
description: "Explain what a file, module, or symbol is, how it works end-to-end, why it was designed this way, or where a bug comes from — code reading plus git archaeology (log, blame, PR history), output as a self-contained HTML explainer with inline SVG diagrams. Use for state questions about existing code: a path, a symbol, a free-form how/why question, or no arguments to explain the current conversation's findings. Use --teach for a short, read-only explanation in chat. For summarizing a branch, PR, diff, or time range — what changed — use digest:digest instead."
---

# Explain

Turn unfamiliar code or a finished investigation into a visual explainer. `digest` covers **delta** (what changed); `explain` covers **state** (what is this, how does it work, why is it like this, where's the bug from).

## Usage

```
$explain                              # explain the current conversation's findings
$explain src/auth/                    # how this module works
$explain handleRetry                  # this function's role in the flow
$explain "why saga pattern here?"     # design rationale via git archaeology
$explain src/ -f "new teammate"       # onboarding tour
```

## Options

| Flag | Description |
|------|-------------|
| `-f, --for <audience>` | Tailor for an audience — free-form string (manager, non-technical, "new teammate", ...). Default: developer |
| `--teach` | Give a short, read-only explanation in chat instead of an HTML file |

The default output is a self-contained HTML explainer written to the project root (`explain-<slug>-<YYYY-MM-DD>.html`), plus a one-paragraph conclusion in the terminal.

## Teach mode

When the user supplies `--teach`, use this mode before the HTML modes. Parse the audience and optional target as usual. Use the named target, or reuse the current conversation's change or finding. If neither is available, ask for a target and stop. Work inline and read only: write no files and change no state. Running an existing test or a read-only command is allowed; editing code, installing, or any command with side effects is not. Return the explanation in chat and stop.

1. Infer the reader's immediate purpose and background from the conversation and any audience flag. Pick one to three concepts that will help them review, debug, or understand the work.
2. Read the relevant diff, code, or existing findings. Read an existing test, or run it or one representative input if that is read-only, to follow the user's action to the observable result. Check the history for the rationale when it matters, and label unsupported rationale as inference. If an external standard matters, use its authoritative source to distinguish its requirements from the project's choices.
3. Open with a brief plain-language definition and tie it to this change. Show one test, example, or observation and explain what a mistake would look like. Say whether the evidence was read or executed. Use a small diagram only if it clarifies the explanation. Expand in follow-ups at the reader's pace.

## Process

1. **No arguments → conversation mode (inline, no dispatch)**: the findings live in the current conversation, so build the explainer directly — read the visual spec at `../../templates/html-explainer.md` (relative to this directory), assemble sections from the section library, write the file. If the conversation holds no investigation yet, say so in one line and stop.
2. **Arguments → investigation mode (dispatch)**: classify the target (existing path → file/module; identifier-like → symbol; else → question) and dispatch the explain agent.

## Agent Dispatch (investigation mode only)

Use the companion `explain-agent.md` in this directory as the agent prompt. Provide it with:
- Target and target kind (file/module | symbol | question)
- Audience (free-form string, default `developer`)
- Output slug (path → basename; symbol → kebab; question → first ~5 significant words, kebab)
- The HTML template at `../../templates/html-explainer.md` relative to this directory

The agent uses `$PROJECT_ROOT` (set by the init hook) or falls back to `git rev-parse --show-toplevel`.
