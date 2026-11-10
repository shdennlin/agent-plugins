---
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Task
  - Write
  - AskUserQuestion
description: Explain what code is, how it works, or why it was designed this way — from the current conversation or by investigating a path, symbol, or question
argument-hint: "[path|symbol|question] [-f/--for <audience>] [--help/-h]"
---

# Explain Command

Turn an investigation into understanding. `digest` explains **what changed** (delta); `explain` explains **the current state** — what something is, how it works end-to-end, why it was designed this way, or where a bug comes from. Output is a self-contained HTML explainer.

## Arguments

Parse the following from `$ARGUMENTS`:

- `[path|symbol|question]` — What to explain: a file/directory path, a function/class name, or a free-form question. **Omit entirely** to explain the findings of the current conversation (e.g. right after a debugging session).
- `-f, --for <audience>` — Tailor the explainer for an audience (free-form string, same as digest). Default: developer.
- `--help` or `-h` — Show usage information and exit.

## Instructions

### Step 1: Parse Arguments

1. **help**: if `--help` or `-h` is present, show usage info below and stop.
2. **audience**: if `-f` or `--for` is present, the next token is the audience string, verbatim. Default: `developer`.
3. **target**: everything else joined as-is (a question may be multiple words).

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /digest:explain [path|symbol|question] [options]

Explain code state: what it is, how it works, why it's designed this way, where a bug comes from.
Produces a self-contained HTML explainer (inline SVG diagrams, collapsible evidence).

Modes:
  (no arguments)        Explain the findings of the CURRENT conversation
                        (run right after an investigation or debugging session)
  <path>                Explain a file or module: role, flow, design history
  <symbol>              Explain a function/class: role in the whole flow
  "<question>"          Answer a free-form question, e.g. "why does retry use jitter?"

Options:
  -f, --for <audience>  Tailor for an audience (manager, non-technical, "new teammate", ...)
  -h, --help            Show this help message

Examples:
  /digest:explain                          # after debugging: visualize the finding
  /digest:explain src/auth/session.ts      # how this file works and why it exists
  /digest:explain handleRetry              # this function's role in the flow
  /digest:explain "why saga pattern here?" # design rationale via git archaeology
  /digest:explain src/ -f "new teammate"   # onboarding tour
```

### Step 2: Select Mode

**Slug rule** (both modes): path → basename without extension; symbol → kebab-cased name; question/topic → first ~5 significant words kebab-cased. Sanitize `/` and spaces to `-`.

#### No target → Conversation mode (inline — do NOT dispatch)

The context lives in this conversation; a subagent cannot see it. Do everything inline:

1. Check: does the current conversation actually contain an investigation, finding, or analysis worth explaining? If not, print exactly this and stop (no file, no dispatch):
   `Nothing to explain from this conversation yet. Pass a path, symbol, or question: /digest:explain <target>`
2. Resolve the project root: `$PROJECT_ROOT`, else `git rev-parse --show-toplevel`, else `pwd`.
3. Read the visual spec at `${CLAUDE_PLUGIN_ROOT}/templates/html-explainer.md`.
4. Build the HTML explainer from the conversation's findings, following the spec and the section library: conclusion card (always); call-chain/data-flow SVG for flow or bug findings; why-chain (symptom → proximate cause → root cause) for bugs; evolution timeline for design rationale; component map for module overviews; evidence (commands run, code excerpts, key commits) in default-collapsed `<details>` (always). Calibrate to the audience.
5. Write to `<project-root>/explain-<slug>-<YYYY-MM-DD>.html`.
6. Print a one-paragraph conclusion plus `📄 Explainer written to: <path>`. Nothing else.

#### Target given → Investigation mode (dispatch)

1. Classify the target:
   - Existing path on disk → **file/module**
   - Identifier-like token (no spaces, matches code symbols) → **symbol**
   - Anything else → **question**
2. Resolve `${CLAUDE_PLUGIN_ROOT}/templates/html-explainer.md` and `${CLAUDE_PLUGIN_ROOT}/agents/explain-agent.md` to absolute paths (a subagent cannot expand the variable).
3. Choose the dispatch mode:
   - **Fork** — the current conversation already contains investigation of this target (files read, call chains traced, findings stated about it). A fork inherits that context, so it does not redo the work, and it shares the parent's prompt cache. It always runs on the session model and does NOT load `explain-agent.md` as its system prompt, so the prompt must point it at that file.
   - **Fresh agent** — otherwise (target not yet discussed, or little conversation). Keeps the cheap sonnet agent with a clean context.

   When unsure, use the fresh agent.
4. Launch it.

**Fresh agent:**

```
Task tool:
- subagent_type: "digest:explain-agent"
- description: "Investigate and explain code state"
- prompt: |
    Investigate and explain the following.

    Target: <target verbatim>
    Target kind: <file/module | symbol | question>
    Audience: <audience string, default "developer">
    HTML template path: <absolute path to templates/html-explainer.md>
    Output slug: <slug>
```

**Fork:**

```
Task tool:
- subagent_type: "fork"
- description: "Investigate and explain code state"
- prompt: |
    Read <absolute path to agents/explain-agent.md> and follow its Behavior and Constraints sections (ignore its frontmatter). Reuse the findings already in this conversation instead of re-investigating; only investigate what is still missing.

    Target: <target verbatim>
    Target kind: <file/module | symbol | question>
    Audience: <audience string, default "developer">
    HTML template path: <absolute path to templates/html-explainer.md>
    Output slug: <slug>
```

5. Report the agent's output back to the user verbatim (one-paragraph conclusion + written file path).

## Examples

```bash
# After Claude traced a bug across 8 files — visualize the finding
/digest:explain

# How does this module work?
/digest:explain src/auth/

# What is this function's role in the whole flow?
/digest:explain handleRetry

# Why was it designed this way? (git archaeology)
/digest:explain "why does the queue use at-least-once delivery?"

# Onboarding tour for a new teammate
/digest:explain src/ -f "new teammate"

# Explain the bug to your manager
/digest:explain -f manager
```
