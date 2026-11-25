---
allowed-tools:
  - Read
  - Bash
  - Bash(${CLAUDE_PLUGIN_ROOT}/scripts/classify-target.sh:*)
  - Glob
  - Grep
  - Task
  - Write
  - AskUserQuestion
description: Explain what code is, how it works, or why it was designed this way, and summarize what a branch or pull request changes — from the current conversation or by investigating a path, symbol, question, #PR, or branch
argument-hint: "[path|symbol|question|#PR|branch] [-f/--for <audience>] [--teach] [--html] [--as <kind>] [--help/-h]"
---

# Explain Command

Turn an investigation into understanding. `explain` covers **the current state** — what something is, how it works end-to-end, why it was designed this way, where a bug comes from — and **a change** — what a pull request, a branch, or the current branch does and why.

- **State targets** (path, symbol, question, the conversation's findings): a self-contained HTML explainer.
- **Change targets** (`#PR`, branch, current branch): a card in chat. `--html` writes the HTML explainer too.
- `--teach`: a short, read-only lesson in chat.

## MANDATORY FIRST STEP — DO NOT SKIP

You MUST run this BEFORE doing anything else. The script parses the arguments, classifies the target, and prints a JSON object. Never classify the target or parse flags yourself.

```
"${CLAUDE_PLUGIN_ROOT}/scripts/classify-target.sh" <<'ARGS'
$ARGUMENTS
ARGS
```

**If the script exits non-zero**, show its stderr verbatim and stop.
**If `--help` or `-h` was in the arguments**, the script prints the help text and exits 0. Show it verbatim and stop.

The JSON has: `audience`, `teach`, `html`, `forced`, `target`, `kind` (`file | pr | branch | symbol | question | empty`), `slug`, `resolved_line`, `branch`, `base`, `on_base`, `diff_empty`, `gh_ok`.

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
4. **`kind` is `pr` or `branch`** → **Change mode**.
5. **`kind` is `file`, `symbol`, or `question`** → **Investigation mode** (state target).

**Output mode** for any dispatch: `card` for a change target unless `html` is true; `html` for every state target.

#### Conversation mode (inline — do NOT dispatch)

The context lives in this conversation; a subagent cannot see it. Do everything inline:

1. Resolve the project root: `$PROJECT_ROOT`, else `git rev-parse --show-toplevel`, else `pwd`.
2. Read the visual spec at `${CLAUDE_PLUGIN_ROOT}/templates/html-explainer.md`.
3. Build the HTML explainer from the conversation's findings, following the spec and the section library: conclusion card (always); call-chain/data-flow SVG for flow or bug findings; why-chain (symptom → proximate cause → root cause) for bugs; evolution timeline for design rationale; component map for module overviews; evidence (commands run, code excerpts, key commits) in default-collapsed `<details>` (always). Calibrate to the audience.
4. Write to `<project-root>/explain-<topic-slug>-<YYYY-MM-DD>.html`, where `<topic-slug>` is the first ~5 significant words of the finding, kebab-cased with `/` and spaces turned into `-` (the script gives no slug for an empty target).
5. Print a one-paragraph conclusion plus `📄 Explainer written to: <path>`. Nothing else.

#### Investigation mode and Change mode (dispatch)

1. Resolve `${CLAUDE_PLUGIN_ROOT}/templates/html-explainer.md` and `${CLAUDE_PLUGIN_ROOT}/agents/explain-agent.md` to absolute paths (a subagent cannot expand the variable). The template path is needed whenever Output mode is `html`.
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
    Output mode: <card | html>
    Audience: <audience string, default "developer">
    HTML template path: <absolute path to templates/html-explainer.md — include when Output mode is html>
    Output slug: <slug; for current-branch use the branch name sanitized>
```

**Fork:**

```
Task tool:
- subagent_type: "fork"
- description: "Explain code state or summarize a change"
- prompt: |
    Read <absolute path to agents/explain-agent.md> and follow its Input, Behavior, Change targets and Constraints sections (ignore its frontmatter). Reuse the findings already in this conversation instead of re-investigating; only investigate what is still missing.

    Target: <target verbatim; for current-branch use HEAD>
    Target kind: <file/module | symbol | question | pr | branch | current-branch>
    Base: <base from the JSON, empty for state targets>
    Output mode: <card | html>
    Audience: <audience string, default "developer">
    HTML template path: <absolute path to templates/html-explainer.md — include when Output mode is html>
    Output slug: <slug; for current-branch use the branch name sanitized>
```

5. Report the agent's output back to the user verbatim: the card for `card`, or the one-paragraph conclusion plus the written file path for `html`.

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

# What does this branch change, as a shareable HTML file?
/digest:explain feat/auth --html

# Read "main" as a symbol instead of the branch
/digest:explain main --as symbol

# Onboarding tour for a new teammate
/digest:explain src/ -f "new teammate"

# Explain the bug to your manager
/digest:explain -f manager
```
