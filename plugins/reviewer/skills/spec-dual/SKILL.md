---
name: reviewer:spec-dual
description: "Dual-engine spec review — Claude and Codex review the same change in parallel, then a Workflow loops fixes until BOTH engines are MEDIUM-clean. Use when a spec is high-stakes and you want two different models to cross-check for blind spots before implementation. Requires the openai-codex plugin for the Codex engine."
---

# Dual-Engine Spec Review

Review a change with **two independent engines** (Claude + Codex) and drive fixes
off the **union** of their findings. This is coverage-by-union, not corroboration: a
finding only one engine sees is signal (different models have different blind spots),
and the engines agree on almost nothing — expect `intersection` near zero. The rule is
**a blocker needs only one engine; clearing needs both**: MEDIUM or above in EITHER
engine is a blocker. Do not read a 17-blocker union as 17 corroborated defects.

This skill dispatches a **Workflow** that owns the fan-out, the cross-engine union,
the pure-code blocker count, and the fix loop — so there is no Stop-hook iteration to
burn and no `<promise>` signal to fake.

## Dependencies

- **`reviewer:spec-fixer`** — ships with this plugin (used to fix findings).
- **`codex:codex-rescue`** — from the external `openai-codex` plugin (the Codex engine).
  If it is not installed, the Codex engine is reported DOWN every round: the run ends
  `ready: false` with `degraded: true` rows, and the Claude findings are still returned.
  Tell the user to install `openai-codex` for a review that can clear.

## Usage

```
/reviewer:spec-dual openspec/changes/my-change/
/reviewer:spec-dual proposal.md spec.md tasks.md
/reviewer:spec-dual openspec/changes/my-change/ -n 5 --no-explore
```

Options:
- `-n <N>` / `--max-rounds <N>` — max fix rounds (default 3, hard cap). Every fix is followed by a review, so N fixes = N+1 reviews; the last review is verification-only and its findings are what gets reported.
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
patterns, existing interfaces). If that agent type is not available in this session
(the `feature-dev` plugin is not installed), use the built-in `Explore` agent with the
same brief instead. Capture its output as `CODEBASE_CONTEXT`. This is
shared by BOTH engines, so exploration happens once, not twice. If `--no-explore`,
set `CODEBASE_CONTEXT` to empty.

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

This is a sanctioned use of the Workflow tool: this skill's instructions direct you
to call it. Only the main agent runs this skill — do not invoke it from inside another
subagent (a Workflow subagent cannot itself call Workflow).

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
- If `ready: true`, report that both engines are MEDIUM-clean after `fixRounds` fix round(s) and `rounds` reviews,
  note `lowsFixed`, and summarize `history` (per-round `REVIEW_RESULT` counts).
- If `ready: false`, report it is NOT ready, show `reason` and `history`, and point
  out which rounds still had blockers.

If `needsHuman` is non-empty (then `ready` is false unless every entry is LOW), these are blockers the fixer would not or could not resolve on its own —
they need the user's judgement. The Workflow runs autonomously in the background and cannot
pause to ask, so resolve them HERE in the interactive session: present them with
AskUserQuestion (one question per finding, or grouped if few), each showing severity,
location, which engine(s) saw it (`seenBy`), the rationale, and the fixer's `disposition` + `reason` (out-of-scope / contradicts-spec / new-mechanism / bogus / gate-regression / stale), then ask the user how to
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

Findings now include `category` and `engine` (both/claude/codex) — pass them through
unchanged; the script persists them.
