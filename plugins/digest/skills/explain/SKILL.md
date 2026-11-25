---
name: digest:explain
description: "Explain what a file, module, or symbol is, how it works end-to-end, why it was designed this way, or where a bug comes from — code reading plus git archaeology (log, blame, PR history), output as a self-contained HTML explainer with inline SVG diagrams. Also summarizes what a pull request, branch, or the current branch changes and why — as an HTML explainer, or printed in chat with --print. Use for state questions about existing code (a path, a symbol, a free-form how/why question, or no arguments to explain the current conversation's findings) and for requests like 'what does this branch do', 'explain PR #42', or 'summarize the changes on feat/auth'. Use --teach for a short, read-only explanation in chat."
---

# Explain

Turn unfamiliar code, a change, or a finished investigation into an explanation. It covers **state** (what is this, how does it work, why is it like this, where's the bug from) and **change** (what does this pull request or branch do, and why).

## Usage

```
$explain                              # the conversation's findings; else the current branch vs its base
$explain src/auth/                    # how this module works
$explain handleRetry                  # this function's role in the flow
$explain "why saga pattern here?"     # design rationale via git archaeology
$explain #42                          # what a pull request does (HTML file)
$explain feat/auth --print            # what a branch changes, printed in chat
$explain main --as symbol             # read "main" as a symbol, not the branch
$explain src/ -f "new teammate"       # onboarding tour
```

## Options

| Flag | Description |
|------|-------------|
| `-f, --for <audience>` | Tailor for an audience — free-form string (manager, non-technical, "new teammate", ...). Default: developer |
| `-t, --teach` | Give a short, read-only explanation in chat instead of an HTML file (cannot be combined with `--print`) |
| `-p, --print` | Answer in chat and write no file: a card for a change target, a concise answer for a state target |
| `-a, --as <kind>` | Force how the target is read: `file`, `pr`, `branch`, `symbol`, or `question` (`branch` also accepts a tag or a commit) |

Every target defaults to a self-contained HTML explainer written to the project root (`explain-<slug>-<YYYY-MM-DD>.html`), plus a one-paragraph conclusion in the terminal. With `--print` nothing is written: a change target gets a card, a state target a concise answer.

## Teach mode

When the user supplies `--teach`, use this mode before the HTML modes. Parse the audience and optional target as usual. Use the named target. With no target, apply the empty-target rule from the Process section below: the current conversation's change or finding, else the current branch against its base, else print the "Nothing to explain" line and stop. Work inline and read only: write no files and change no state. Running an existing test or a read-only command is allowed; editing code, installing, or any command with side effects is not. Return the explanation in chat and stop.

1. Infer the reader's immediate purpose and background from the conversation and any audience flag. Pick one to three concepts that will help them review, debug, or understand the work.
2. Read the relevant diff, code, or existing findings. Read an existing test, or run it or one representative input if that is read-only, to follow the user's action to the observable result. Check the history for the rationale when it matters, and label unsupported rationale as inference. If an external standard matters, use its authoritative source to distinguish its requirements from the project's choices.
3. Open with a brief plain-language definition and tie it to this change. Show one test, example, or observation and explain what a mistake would look like. Say whether the evidence was read or executed. Use a small diagram only if it clarifies the explanation. Expand in follow-ups at the reader's pace.

## Process

1. **Classify the target with the script.** Run `../../scripts/classify-target.sh` (relative to this directory), feeding the raw arguments on stdin. It prints JSON (`audience`, `teach`, `print`, `forced`, `target`, `kind`, `slug`, `resolved_line`, `branch`, `base`, `on_base`, `diff_empty`, `gh_ok`). Never classify the target yourself. Its order is: existing path → file; `#N` → pr; local or remote-tracking branch → branch; identifier-like → symbol; anything else → question; nothing → empty. Say how the target was read by printing `resolved_line` first.
2. **Empty target**, first match wins: the current conversation holds an investigation or finding → conversation mode (inline, no dispatch: read the visual spec at `../../templates/html-explainer.md`, assemble sections from the section library, write the file); else `on_base` is false, `base` is set and `diff_empty` is false → explain the current branch against its base as a change target; else print `Nothing to explain from this conversation yet. Pass a path, symbol, question, #PR, or branch: /digest:explain <target>` and stop.
3. **`pr` with `gh_ok` false**: print `gh is unavailable or not logged in, so PR #<n> cannot be read. Pass the branch name instead: /digest:explain <branch>` and stop.
4. **Otherwise dispatch the explain agent.** Output mode is `print` when `print` is true, else `html`.

## Agent Dispatch

Use the companion `explain-agent.md` in this directory as the agent prompt. Provide it with:
- Target and target kind (file/module | symbol | question | pr | branch | current-branch)
- Base (the base branch for change targets, empty otherwise)
- Output mode (`html` | `print`)
- Audience (free-form string, default `developer`)
- Output slug (the script's `slug`)
- The HTML template at `../../templates/html-explainer.md` relative to this directory (needed when Output mode is `html`)

The agent uses `$PROJECT_ROOT` (set by the init hook) or falls back to `git rev-parse --show-toplevel`.
