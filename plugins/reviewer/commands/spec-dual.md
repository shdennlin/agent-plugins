---
allowed-tools:
  - Read
  - Task
  - AskUserQuestion
  - Workflow
description: Dual-engine (Claude + Codex) spec review, looped until both engines are MEDIUM-clean
argument-hint: "[path...] [-n N] [--no-explore] [--help/-h]"
---

# Dual-Engine Spec Review Command

Review a change with **two independent engines** (Claude + Codex) in parallel and drive
fixes off the **union** of their findings. A finding only one engine sees is signal, not
noise. The blocker rule is strict: **MEDIUM or above in EITHER engine is a blocker**, and
a PASS from one engine alone is not enough.

This command dispatches a **Workflow** that owns the fan-out, the cross-engine union, the
pure-code blocker count, and the fix loop — so there is no per-turn Stop hook to burn and
no completion string to fake.

## Dependencies

- **`reviewer:spec-fixer`** — ships with this plugin (applies fixes).
- **`codex:codex-rescue`** — from the external `openai-codex` plugin (the Codex engine).
  Without it, the Codex engine degrades to empty findings and the review becomes
  Claude-only; tell the user to install `openai-codex` for true dual-engine review.

## Instructions

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
1. **help**: if `--help` or `-h` is present, show the Help Output below and stop. Do NOT dispatch.
2. **paths**: collect all positional arguments (not flags or flag values). Join multiple paths into one space-separated string as `change`.
3. **max_rounds**: integer after `-n` or `--max-rounds`, default `3`.
4. **no_explore**: true if `--no-explore` is present.

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /reviewer:spec-dual [path...] [options]

Dual-engine (Claude + Codex) spec review. Both engines review the same change in
parallel; fixes loop until BOTH engines report zero MEDIUM+ findings, then LOW is cleared.

Positional arguments:
  path...                       One or more change folders or spec files to review

Options:
  -h, --help                    Show this help message
  -n, --max-rounds <N>          Maximum review→fix rounds (default: 3, hard cap)
  --no-explore                  Skip the shared codebase-context scan

Requires the openai-codex plugin for the Codex engine. Without it, review is Claude-only.

Examples:
  /reviewer:spec-dual openspec/changes/my-change/
  /reviewer:spec-dual proposal.md spec.md tasks.md -n 5
  /reviewer:spec-dual openspec/changes/my-change/ --no-explore
```

### Step 2: Resolve Paths

- If paths were provided: use them directly.
- If no paths provided: use AskUserQuestion to ask which change/spec files to review.

Then `cd` to the git root so the change path resolves consistently (the Workflow agents
run in this working directory).

### Step 3: Explore Codebase

**If `no_explore` is NOT set** (default): dispatch the `feature-dev:code-explorer` agent
once to summarize codebase context relevant to the change (relevant files, architecture
patterns, existing interfaces). Capture its output as `CODEBASE_CONTEXT`. This is shared
by BOTH engines, so exploration happens once, not twice.

**If `no_explore` IS set:** set `CODEBASE_CONTEXT` to empty.

### Step 4: Dispatch the Workflow

Resolve `${CLAUDE_PLUGIN_ROOT}` and call the Workflow tool:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/two-engine-spec-review.workflow.js",
  args: {
    change: "<change path string>",
    maxRounds: <max_rounds>,
    codebaseContext: "<CODEBASE_CONTEXT, or empty>"
  }
})
```

Calling Workflow here is sanctioned: this command's instructions direct you to call it.

### Step 5: Report

The Workflow returns `{ ready, change, rounds, lowsFixed?, history }`.
- If `ready: true`, report that both engines are MEDIUM-clean after `rounds` rounds, note
  `lowsFixed`, and summarize `history` (per-round `REVIEW_RESULT` counts).
- If `ready: false`, report it is NOT ready, show `reason` and `history`, and point out
  which rounds still had blockers so the user can decide next steps.
