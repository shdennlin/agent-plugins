---
allowed-tools:
  - Read
  - Task
  - AskUserQuestion
  - Workflow
  - Bash
description: Dual-engine (Claude + Codex) spec review, looped until both engines are MEDIUM-clean
argument-hint: "[path...] [-n N] [--no-explore] [--help/-h]"
---

# Dual-Engine Spec Review Command

Review a change with **two independent engines** (Claude + Codex) in parallel and drive
fixes off the **union** of their findings. This is coverage-by-union, not corroboration: a
finding only one engine sees is signal, and the engines agree on almost nothing (expect
`intersection` near zero). The rule is **a blocker needs only one engine; clearing needs both**
— MEDIUM or above in EITHER engine is a blocker. Do not read a 17-blocker union as 17
corroborated defects.

This command dispatches a **Workflow** that owns the fan-out, the cross-engine union, the
pure-code blocker count, and the fix loop — so there is no per-turn Stop hook to burn and
no completion string to fake.

## Dependencies

- **`reviewer:spec-fixer`** — ships with this plugin (applies fixes).
- **`codex:codex-rescue`** — from the external `openai-codex` plugin (the Codex engine).
  Without it, the Codex engine is reported DOWN every round: the run ends `ready: false`
  with `degraded: true` rows, and the Claude findings are still returned. Tell the user to
  install `openai-codex` for a review that can clear.

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
  -n, --max-rounds <N>          Maximum fix rounds (default: 3, hard cap). Every fix is
                                followed by a review, so N fixes = N+1 reviews; the last
                                review is verification-only and its findings are reported
  --no-explore                  Skip the shared codebase-context scan

Requires the openai-codex plugin for the Codex engine. Without it, the run cannot clear (Codex is DOWN).

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
patterns, existing interfaces). If that agent type is not available in this session (the
`feature-dev` plugin is not installed), use the built-in `Explore` agent with the same brief
instead. Capture its output as `CODEBASE_CONTEXT`. This is shared by BOTH engines, so
exploration happens once, not twice.

**If `no_explore` IS set:** set `CODEBASE_CONTEXT` to empty.

### Step 4: Dispatch the Workflow

Call the Workflow tool by plugin workflow name (do NOT use `scriptPath` — plugin-cache paths are outside the session's readable directories and get rejected):

```
Workflow({
  name: "reviewer:two-engine-spec-review",
  args: {
    change: "<change path string>",
    maxRounds: <max_rounds>,
    codebaseContext: "<CODEBASE_CONTEXT, or empty>"
  }
})
```

Optional `args`: `gateCommands` (string[]) — project gates the fixer must leave clean, run from the
git root before and after each fix pass. Default when `change` is a single `openspec/changes/<name>/`
folder: `spectra analyze <name> --json` and `spectra validate <name> --json`; pass `[]` to disable.
A gate regression is escalated to `needsHuman` (disposition `gate-regression`), never auto-reverted.

Calling Workflow here is sanctioned: this command's instructions direct you to call it.

### Step 5: Report and resolve escalations

The Workflow returns `{ ready, enginesClean, reason?, change, rounds, fixRounds, lowsFixed?, needsHuman, intersection, gateRan, history, findings }`.
`enginesClean` means both engines were MEDIUM-clean on the last review. `ready` additionally requires
that no MEDIUM+ item is waiting in `needsHuman` — an escalated blocker is still a blocker — so
`ready: false` with `enginesClean: true` means "clean except for what the human must decide".
`gateRan: false` means a fix pass could not run the project gates (tool missing); `null` = no gates.
`rounds` counts reviews (one per `history` row), `fixRounds` counts fix passes; `findings` always
come from the LAST review, i.e. they describe the post-fix artifacts, never a pre-fix snapshot.
`intersection` is `{ both, claudeOnly, codexOnly, anyRound, rounds }` — how many findings BOTH engines
reported. Near-zero is normal for independent engines; report it so the user knows every blocker was
single-engine and the strict either-engine rule is doing the work. Each `history` row also carries
`intersection`, `linked` (findings the reviewer tied to a prior-round id), `enginesDown`, and after a fix pass
`gate`, `fixerDown`, `fixerReportMismatch` (and `lowGate` on the clearing row).
Retain `findings` for Step 6 (history logging).
- If `ready: true`, report that both engines are MEDIUM-clean after `fixRounds` fix round(s) and `rounds` reviews, note
  `lowsFixed`, and summarize `history` (per-round `REVIEW_RESULT` counts).
- If `ready: false`, report it is NOT ready, show `reason` and `history`, and point out
  which rounds still had blockers. The last `history` row is the verification review.

If `needsHuman` is non-empty (then `ready` is false unless every entry is LOW), these are blockers the fixer would not or could not resolve on its own —
they need the user's judgement. The Workflow runs autonomously in the background and cannot
pause to ask, so resolve them HERE: present them with AskUserQuestion (one per finding, or
grouped if few), each showing its `id`, severity, location, which engine(s) saw it (`seenBy`), the rationale, and the fixer's `disposition` + `reason` (out-of-scope / contradicts-spec / new-mechanism / bogus / gate-regression / stale), then ask how to handle each (fix a specific way / accept as-is / defer). Apply the
chosen fixes — and if changes were made, offer to re-run `/reviewer:spec-dual` to confirm.

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

Findings now include `category` and `engine` (both/claude/codex) — pass them through
unchanged; the script persists them.
