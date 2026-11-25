---
name: digest:explain
description: "Explain code (a file, symbol or question) or a change (a PR, branch or the current branch): what it is, how it works, why it was built that way. Writes an HTML explainer; --print answers in chat, --teach gives a short lesson. Use for 'explain this', 'what does this branch do', 'explain PR #42'."
---

# Explain

Explain code or a change. Examples: `$explain src/auth/`, `$explain "why saga here?"`, `$explain #42`, `$explain feat/auth --print`.

Every flag and target form is listed by `../../scripts/classify-target.sh --help` (relative to this directory); that help is the single list. In short: `-f/--for <audience>`, `-t/--teach`, `-p/--print`, `-a/--as <kind>`. Every target writes a self-contained HTML explainer to the project root (`explain-<slug>-<YYYY-MM-DD>.html`) with a one-paragraph conclusion; `--print` writes nothing and answers in chat.

## Teach mode

With `--teach`: read only, in chat, no files, no command with side effects (an existing test or a read-only command is fine). Use the named target; with none, apply the empty-target rule below.

1. Infer the reader's purpose and background from the conversation and `-f`; pick one to three concepts that help them review, debug or understand the work.
2. Read the diff, code or findings; read or run (if read-only) a test or one example to follow the user's action to its observable result. Check history for the rationale when it matters and label unsupported rationale as inference; for an external standard, use its authoritative source to separate its rules from the project's choices.
3. Open with a short plain-language definition tied to this change; show one test, example or observation and what a mistake would look like; say whether the evidence was read or executed; add a small diagram only if it helps. Expand in follow-ups.

## Process

1. **Classify with the script.** Run `../../scripts/classify-target.sh` with the raw arguments on stdin. It prints JSON (`audience`, `teach`, `print`, `forced`, `target`, `kind`, `slug`, `resolved_line`, `branch`, `base`, `on_base`, `diff_empty`, `gh_ok`). Never classify the target yourself. Print `resolved_line` first.
2. **Empty target**, first match wins: the conversation holds a finding → conversation mode (inline: read `../../templates/html-explainer.md`, write the page, check it with `../../scripts/check-explainer.sh <file> --kind state` and fix what it reports); else `on_base` is false, `base` is set and `diff_empty` is false → explain the current branch against its base; else print `Nothing to explain from this conversation yet. Pass a path, symbol, question, #PR, or branch: /digest:explain <target>` and stop.
3. **`pr` with `gh_ok` false**: print `gh is unavailable or not logged in, so PR #<n> cannot be read. Pass the branch name instead: /digest:explain <branch>` and stop.
4. **Otherwise dispatch the explain agent.** Output mode is `print` when `print` is true, else `html`.

## Agent Dispatch

Use the companion `explain-agent.md` in this directory as the agent prompt, with: the target and its kind (file/module | symbol | question | pr | branch | current-branch), the base, the output mode (`html` | `print`), the audience (default `developer`), the script's `slug`, and for `html` the template `../../templates/html-explainer.md` and the checker `../../scripts/check-explainer.sh` (the agent runs it on the file it writes and fixes what it reports). The agent uses `$PROJECT_ROOT`, or `git rev-parse --show-toplevel`.
