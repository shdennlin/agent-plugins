# prompt-builder

Build paste-ready prompts from messy context. Turn a long exploratory session, a
jumbled multi-task request, or a rough draft into one polished, self-contained
prompt — printed as a single copyable block and placed on the clipboard, ready to
paste into a fresh session after a rewind.

## Why

A common workflow: explore or implement for a while, realize what you actually
want, then want to restart clean — copy a distilled prompt, rewind the
conversation, paste. Doing that by hand means retyping everything the
conversation already knows. This skill mines the conversation for you, and
guarantees the result survives the rewind: every decision, path, and constraint
gets baked into the prompt itself, with no "as discussed above" left dangling.

## Usage

```
/prompt-builder:build [topic | messy request | draft prompt]
```

Three modes, auto-detected:

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Context extract** | Mid-session with real history | Mines the conversation for the components, presents a draft, asks "which of these are wrong?" |
| **Interview** | Cold start with just a topic | Asks only the questions this task type needs, one at a time |
| **Critique** | Input is an existing prompt draft | Diagnoses gaps against the component checklist, outputs a strengthened version |

Multi-task inputs (e.g. `create branch on corresponding commit first, and give me
a report for each section with html`) are decomposed into ordered steps with
ambiguous referents resolved from context — or asked about — before assembly.

## Output contract

- One fenced code block, nothing after it — copy the whole thing.
- Self-contained: passes a "rewind test" (no references to the wiped conversation).
- On macOS the finished prompt is also placed on the clipboard via `pbcopy`.

## Prerequisites

None. Pure skill + command; no external CLI dependency. Clipboard integration is
macOS-only and skipped silently elsewhere.

## Installation

```bash
/plugin marketplace add shdennlin/agent-plugins
/plugin install prompt-builder@shdennlin-plugins
```
