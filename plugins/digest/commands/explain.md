---
allowed-tools:
  - Read
  - Bash
  - Bash(${CLAUDE_PLUGIN_ROOT}/scripts/classify-target.sh:*)
  - Bash(${CLAUDE_PLUGIN_ROOT}/scripts/check-explainer.sh:*)
  - Bash(${CLAUDE_PLUGIN_ROOT}/scripts/check-render.sh:*)
  - Glob
  - Grep
  - Task
  - Write
  - AskUserQuestion
description: Explain what code is, how it works, or why it was designed this way, and summarize what a branch or pull request changes — from the current conversation or by investigating a path, symbol, question, #PR, or branch
argument-hint: "[path|symbol|question|#PR|branch] [-f|--for <audience>] [-t|--teach] [-p|--print] [-a|--as <kind>] [-h|--help]"
---

# Explain Command

Turn an investigation into understanding. `explain` covers **the current state** — what something is, how it works end-to-end, why it was designed this way, where a bug comes from — and **a change** — what a pull request, a branch, or the current branch does and why.

- **Default, every target** (path, symbol, question, `#PR`, branch, current branch, the conversation's findings): a self-contained HTML explainer; the reply is a short conclusion plus the file path.
- **`--print`**: the answer in the chat and no file: a card for a change target, a concise answer for a state target.
- `--teach`: a short, read-only lesson in chat.

## MANDATORY FIRST STEP — DO NOT SKIP

You MUST run this BEFORE doing anything else. The script parses the arguments, classifies the target, and prints a JSON object. Never classify the target or parse flags yourself.

```
"${CLAUDE_PLUGIN_ROOT}/scripts/classify-target.sh" <<'DIGEST_EXPLAIN_ARGS_9f3a'
$ARGUMENTS
DIGEST_EXPLAIN_ARGS_9f3a
```

**If the script exits non-zero**, show its stderr verbatim and stop.
**If `--help` or `-h` was in the arguments**, the script prints the help text and exits 0. Show it verbatim and stop.

The JSON has: `audience`, `teach`, `print`, `forced`, `target`, `kind` (`file | pr | branch | symbol | question | empty`), `slug`, `resolved_line`, `branch`, `base`, `on_base`, `diff_empty`, `gh_ok`.

## Instructions

### Step 1: Say how the target was read

Print `resolved_line` as the first line of your reply, unchanged. (For `empty`, print the line from the stage you land on in Step 2.)

### Step 2: Select the mode

1. **`teach` is true** → Teach mode (inline). Read the Teach mode section of `${CLAUDE_PLUGIN_ROOT}/skills/explain/SKILL.md` and follow it with the JSON. Reply in chat and stop.
2. **`kind` is `empty`** → three stages, first match wins:
   1. The current conversation contains an investigation, finding, or analysis worth explaining → print `解析為:conversation`, then **Conversation mode**.
   2. Else, `on_base` is false, `base` is not empty, and `diff_empty` is false → print `解析為:current-branch <branch> vs <base>`, then **Change mode** with target kind `current-branch` and target `HEAD`.
   3. Else print exactly this and stop (no file, no dispatch):
      `Nothing to explain from this conversation yet. Pass a path, symbol, question, #PR, or branch: /digest:explain <target>`
3. **`kind` is `pr` and `gh_ok` is false** → print this and stop:
   `gh is unavailable or not logged in, so PR #<n> cannot be read. Pass the branch name instead: /digest:explain <branch>`
4. **`kind` is `branch` and `base` is empty** → print this and stop:
   `No base branch (develop or main) found, so <target> cannot be compared. Ask a question about it instead: /digest:explain "<question>"`
5. **`kind` is `branch` and (`on_base` is true or `diff_empty` is true)** → print this and stop:
   `<target> has no changes against <base>, so there is nothing to summarize.`
6. **`kind` is `pr` or `branch`** → **Change mode**.
7. **`kind` is `file`, `symbol`, or `question`** → **Investigation mode** (state target).

**Output mode** for any dispatch: `print` when `print` is true, else `html`.

#### Conversation mode (inline — do NOT dispatch)

The context lives in this conversation; a subagent cannot see it. Do everything inline. If `print` is true, answer directly in the chat (a short conclusion, then the key evidence with `file:line` anchors) and stop; otherwise:

1. Resolve the project root: `$PROJECT_ROOT`, else `git rev-parse --show-toplevel`, else `pwd`.
2. Read the visual spec at `${CLAUDE_PLUGIN_ROOT}/templates/html-explainer.md` and the reference stylesheet `${CLAUDE_PLUGIN_ROOT}/templates/html-explainer-style.css`.
3. Write the HTML explainer from the conversation's findings, to the spec in the template: its must-hold rules, what the page must say, and the avoid list; the form is yours. Copy the reference stylesheet into the page's `<style>` unchanged. For ready-made parts (Expand all, diff and code excerpts, file tree, callouts, diagrams), read only the files you will use in `${CLAUDE_PLUGIN_ROOT}/templates/components/`, as the template's component list says; copy their CSS and script unchanged and change only their text. Write in English unless the user asked for another language. Pick what makes the finding obvious, for example a call-chain or data-flow diagram for flow or bug findings, a symptom → proximate cause → root cause why-chain for bugs, an evolution timeline for design rationale, a component map for module overviews, with the evidence (commands run, code excerpts, key commits) in collapsed `<details>`. Calibrate to the audience.
4. Write to `<project-root>/explain-<topic-slug>-<YYYY-MM-DD>.html`, where `<topic-slug>` is the first ~5 significant words of the finding, kebab-cased with `/` and spaces turned into `-` (the script gives no slug for an empty target).
5. Check the file: run `"${CLAUDE_PLUGIN_ROOT}/scripts/check-explainer.sh" <file> --kind state` and fix every violation it reports, at most two rounds. If a Chrome is installed, also run `"${CLAUDE_PLUGIN_ROOT}/scripts/check-render.sh" <file>` and fix any overflow it reports (exit 4 means no browser: say the render was not checked). If violations remain, add one line naming them to the reply. Warnings never fail the page: act on the ones that help the reader and add one line naming the warnings you left.
6. Print a one-paragraph conclusion plus `📄 Explainer written to: <path>`, and the one line about remaining violations if there is one. Nothing else.

#### Investigation mode and Change mode (dispatch)

1. Resolve `${CLAUDE_PLUGIN_ROOT}/templates/html-explainer.md`, `${CLAUDE_PLUGIN_ROOT}/scripts/check-explainer.sh`, `${CLAUDE_PLUGIN_ROOT}/scripts/check-render.sh` and `${CLAUDE_PLUGIN_ROOT}/agents/explain-agent.md` to absolute paths (a subagent cannot expand the variable). The agent finds the reference stylesheet and the `components/` folder next to the template path, and passes `Base` to the checker as `--base` for a change target. The template and checker paths are needed whenever Output mode is `html`.
2. Target kind for the prompt: `file` → `file/module`; `symbol`, `question`, `pr`, `branch` as is; the empty-target stage 2 → `current-branch`.
3. Choose the dispatch mode:
   - **Fork** — the current conversation already contains investigation of this target (files read, call chains traced, findings stated about it). A fork inherits that context, so it does not redo the work, and it shares the parent's prompt cache. It always runs on the session model and does NOT load `explain-agent.md` as its system prompt, so the prompt must point it at that file.
   - **Fresh agent** — otherwise (target not yet discussed, or little conversation). Keeps the cheap sonnet agent with a clean context.

   When unsure, use the fresh agent.
4. Launch it.

**Fresh agent:**

```
Task tool:
- subagent_type: "digest:explain-agent"
- description: "Explain code state or summarize a change"
- prompt: |
    Explain or summarize the following.

    Target: <target verbatim; for current-branch use HEAD>
    Target kind: <file/module | symbol | question | pr | branch | current-branch>
    Base: <base from the JSON, empty for state targets>
    Output mode: <html | print>
    Audience: <audience string, default "developer">
    HTML template path: <absolute path to templates/html-explainer.md — include when Output mode is html>
    Checker script path: <absolute path to scripts/check-explainer.sh — include when Output mode is html>
    Render checker path: <absolute path to scripts/check-render.sh — optional, include when Output mode is html>
    Output slug: <slug; for current-branch use the branch name sanitized>
```

**Fork:**

```
Task tool:
- subagent_type: "fork"
- description: "Explain code state or summarize a change"
- prompt: |
    Read <absolute path to agents/explain-agent.md> and follow everything below its frontmatter (ignore the frontmatter itself). Reuse the findings already in this conversation instead of re-investigating; only investigate what is still missing.

    Target: <target verbatim; for current-branch use HEAD>
    Target kind: <file/module | symbol | question | pr | branch | current-branch>
    Base: <base from the JSON, empty for state targets>
    Output mode: <html | print>
    Audience: <audience string, default "developer">
    HTML template path: <absolute path to templates/html-explainer.md — include when Output mode is html>
    Checker script path: <absolute path to scripts/check-explainer.sh — include when Output mode is html>
    Render checker path: <absolute path to scripts/check-render.sh — optional, include when Output mode is html>
    Output slug: <slug; for current-branch use the branch name sanitized>
```

5. Report the agent's output back to the user verbatim: for `print` the answer itself (the card for a change target), for `html` the one-paragraph conclusion plus the written file path.

## Examples

```bash
# After Claude traced a bug across 8 files — visualize the finding (else: the current branch vs its base)
/digest:explain

# How does this module work?
/digest:explain src/auth/

# What is this function's role in the whole flow?
/digest:explain handleRetry

# Why was it designed this way? (git archaeology)
/digest:explain "why does the queue use at-least-once delivery?"

# What does this pull request do?
/digest:explain #42

# What does this branch change? (HTML file)
/digest:explain feat/auth

# Same, printed in the chat instead of a file
/digest:explain feat/auth --print

# Read "main" as a symbol instead of the branch
/digest:explain main --as symbol

# Onboarding tour for a new teammate
/digest:explain src/ -f "new teammate"

# Explain the bug to your manager
/digest:explain -f manager
```
