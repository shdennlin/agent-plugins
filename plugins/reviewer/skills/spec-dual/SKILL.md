---
name: reviewer:spec-dual
description: "Dual-engine spec review — Claude and Codex review the same change in parallel, then a Workflow loops fixes until BOTH engines are MEDIUM-clean. Use when a spec is high-stakes and you want two different models to cross-check for blind spots before implementation. Requires the openai-codex plugin for the Codex engine."
---

# Dual-Engine Spec Review

Review a change with **two independent engines** (Claude + Codex) and drive fixes
off the **union** of their findings. A finding only one engine sees is signal, not
noise — different models have different blind spots. The blocker rule is deliberately
strict: **MEDIUM or above in EITHER engine is a blocker**, and a PASS from one engine
alone is not enough.

This skill dispatches a **Workflow** that owns the fan-out, the cross-engine union,
the pure-code blocker count, and the fix loop — so there is no Stop-hook iteration to
burn and no `<promise>` signal to fake.

## Dependencies

- **`reviewer:spec-fixer`** — ships with this plugin (used to fix findings).
- **`codex:codex-rescue`** — from the external `openai-codex` plugin (the Codex engine).
  If it is not installed, the Codex engine degrades to empty findings and the review
  becomes Claude-only. Tell the user to install `openai-codex` for true dual-engine review.

## Usage

```
/reviewer:spec-dual openspec/changes/my-change/
/reviewer:spec-dual proposal.md spec.md tasks.md
/reviewer:spec-dual openspec/changes/my-change/ -n 5 --no-explore
```

Options:
- `-n <N>` / `--max-rounds <N>` — max review→fix rounds (default 3, hard cap).
- `--no-explore` — skip the shared codebase-context scan.
- `--help` / `-h` — show usage and stop.

## Process

### Step 1: Parse arguments
From `$ARGUMENTS` extract:
- **change**: the positional path(s) to the change folder or spec files. If multiple
  paths are given, join them into one space-separated string.
- **max_rounds**: integer after `-n` / `--max-rounds`, default `3`.
- **no_explore**: true if `--no-explore` is present.
- **help**: if `--help` / `-h`, print the Usage block above and stop — do NOT dispatch.

If no path is given, use AskUserQuestion to ask which change/spec to review.

### Step 2: Go to git root
`cd` to the git root so the change path resolves consistently (the Workflow agents
run in this working directory).

### Step 3: (Optional) shared codebase context
Unless `--no-explore` is set, dispatch the `feature-dev:code-explorer` agent once to
summarize codebase context relevant to the change (relevant files, architecture
patterns, existing interfaces). Capture its output as `CODEBASE_CONTEXT`. This is
shared by BOTH engines, so exploration happens once, not twice. If `--no-explore`,
set `CODEBASE_CONTEXT` to empty.

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

This is a sanctioned use of the Workflow tool: this skill's instructions direct you
to call it. Only the main agent runs this skill — do not invoke it from inside another
subagent (a Workflow subagent cannot itself call Workflow).

### Step 5: Report and resolve escalations
The Workflow returns `{ ready, change, rounds, lowsFixed?, needsHuman, history }`.
- If `ready: true`, report that both engines are MEDIUM-clean after `rounds` rounds,
  note `lowsFixed`, and summarize `history` (per-round `REVIEW_RESULT` counts).
- If `ready: false`, report it is NOT ready, show `reason` and `history`, and point
  out which rounds still had blockers.

If `needsHuman` is non-empty, these are blockers the fixer could NOT resolve on its own —
they need the user's judgement. The Workflow runs autonomously in the background and cannot
pause to ask, so resolve them HERE in the interactive session: present them with
AskUserQuestion (one question per finding, or grouped if few), each showing severity,
location, which engine(s) saw it (`seenBy`), and the rationale, then ask the user how to
handle each (fix a specific way / accept as-is / defer). Apply the chosen fixes — and if
changes were made, offer to re-run `/reviewer:spec-dual` to confirm the spec now clears.

### Step 6: Log findings history (best-effort)

Persist the final round's findings for the rules-harvest loop (`/reviewer:init --from-history`).
The Workflow result includes `findings` (final-round union). If it is non-empty, pipe it as a
JSON array to the logging script:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/log-findings.sh" --change "<change>" --source spec-dual --round <rounds> <<'FINDINGS_JSON'
<findings as JSON array>
FINDINGS_JSON
```

The script auto-detects the target file (`openspec/reviews/history.jsonl` in Spectra repos,
`.claude/reviewer/history.jsonl` otherwise). Logging is best-effort: if the script fails
(e.g., jq missing), mention it in one line and continue — a logging failure MUST NOT fail
or repeat the review.
