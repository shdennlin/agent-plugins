# Reviewer Plugin

Structured spec and implementation review with iterative fix loops and parallel multi-angle review.

## Commands

| Command | Purpose |
|---------|---------|
| `/reviewer:spec [path...] [--fix]` | Review specs before implementation |
| `/reviewer:spec-dual [path...] [-n N] [--no-explore]` | Dual-engine (Claude + Codex) spec review, looped to MEDIUM-clean |
| `/reviewer:result [path...] [--base branch] [--angles list] [-c level] [--fix [all]]` | Review implementation against specs, multi-angle by default; add the built-in `/code-review` as a second engine with `-c` |
| `/reviewer:init [--dry-run/-n]` | Inject reviewer rules into openspec/config.yaml |

## Usage

### Spec Review

```bash
# Review a spec folder
/reviewer:spec docs/plans/auth-flow/

# Review specific files
/reviewer:spec proposal.md spec.md tasks.md

# Interactive (asks which files)
/reviewer:spec
```

### Dual-Engine Spec Review

Cross-check a high-stakes spec with **two independent models** before implementation.
Claude and Codex review the same change in parallel; a Workflow takes the **union** of
their findings and counts blockers in pure code. This is coverage-by-union, not
corroboration — the engines agree on almost nothing, so **a blocker needs only one engine;
clearing needs both**. Fixes loop until both engines are MEDIUM-clean, then any remaining
LOW issues are cleared.

```bash
# Dual-engine review of a change folder (default 3 fix rounds, each followed by a review)
/reviewer:spec-dual openspec/changes/my-change/

# Cap rounds and skip the shared codebase scan
/reviewer:spec-dual proposal.md spec.md tasks.md -n 5 --no-explore
```

Unlike a per-turn loop wrapper (a `/goal` or Stop-hook loop), this owns its own fan-out
and loop inside a Workflow — there is no per-turn Stop hook to burn iterations and no
completion string to fake; the stop condition is a pure-code `blockers === 0`.

> **Requires the `openai-codex` plugin** for the Codex engine (`codex:codex-rescue`).
> Without it, the Codex side is reported DOWN every round and the run cannot clear
> (`ready: false`, `degraded: true`); Claude's findings are still returned. The Claude engine
> and the fixer (`reviewer:spec-fixer`) ship with this plugin.

How the loop stays honest (1.9.0):

- **Findings have identity across rounds.** Every finding gets a script-assigned id; the
  previous round's findings are shown to the reviewers with their status, and a re-raised
  concern links to its prior id (`priorId`). Titles are never used for identity — a measured
  run showed the same concern never gets the same title twice.
- **The fixer can say no.** Every finding gets a disposition — `applied`, or rejected as
  `out-of-scope`, `contradicts-spec`, `new-mechanism`, `bogus`, `already-escalated`. Rejected
  items go to `needsHuman`, stay visible in the ledger, and are not re-fixed. "Findings → 0 by
  adding more SHALLs" is explicitly a rejection reason. `ready` is false while any MEDIUM+
  item waits on the human; `enginesClean` reports the engine-only view.
- **Project gates are a hard post-condition.** In a Spectra repo the fixer runs
  `spectra analyze` / `spectra validate` before and after each pass; a regression is escalated
  as `gate-regression`, never auto-reverted or patched over. Override with `gateCommands`.
- **A delivery failure is never a finding.** A Codex wrapper that got no output reports
  `engineStatus: withheld|error`; placeholder entries are stripped and the round is marked
  `degraded` with `enginesDown`.
- **The final fix is always verified.** `-n N` bounds fix passes; N+1 reviews run and the
  reported `findings` describe the post-fix artifacts.
- **Cross-engine intersection is surfaced** per round and in the result. Near-zero is normal.

Regression test (no Claude, no network): `node plugins/reviewer/tests/two-engine.harness.mjs`
stubs the Workflow runtime and asserts each of these behaviours against the script.

### Result Review

```bash
# Review implementation against spec (multi-angle by default, auto-detect base branch)
/reviewer:result docs/plans/auth-flow/

# Compare against specific branch
/reviewer:result docs/plans/auth-flow/ --base develop

# Review specific spec files, one angle only (cheapest run)
/reviewer:result spec.md tasks.md -b main --angles coverage

# Add the built-in /code-review as a second, spec-blind engine (Claude Code only)
/reviewer:result openspec/changes/my-change/ --base develop -c medium
```

#### Why a second engine on result review

The spec review asks "does the diff do what the spec says". It takes the spec as truth, so a
behaviour the spec sanctions is ticked, never questioned, and a defect that violates no spec
sentence (a manifest value silently overriding a caller's config, one config tree with two
roots, a constructor doing CWD-relative I/O) is not in its question set. `/code-review` asks
"will this code break" and never reads the spec. On one 264-file refactor (2026-10-13) five
spec-review passes — including two that read every source file — produced 2 LOW findings and
overlapped with none of `/code-review`'s 9; all five judged a spec-mandated allowlist exemption
"correct" that `/code-review` flagged as a bypass. Reading more does not close that gap; a
second question does.

With `--with-code-review <level>` (short `-c <level>`):
- the level is required (`/code-review` otherwise reuses whatever level you typed last);
  `medium` is the recommended default, `high` took over ten minutes per PR on ~180 files;
- the base branch is passed to `/code-review` as its target so both engines review the same
  `<base>...HEAD` diff (with no target it diffs against the default branch and may narrow a
  large diff to the last few commits);
- `/code-review` findings get a severity (`CONFIRMED` → medium, `PLAUSIBLE` → low, raised only
  for data loss / security bypass / startup crash), an `engine` tag, and are merged with the
  spec findings — same file and same root cause collapse to one `engine: both` entry;
- a behaviour the spec sanctions and `/code-review` flags is reported as a `spec-conflict`
  entry for a human decision, never dropped;
- the report shows both verdict lines; the merged list is logged once to `history.jsonl` with
  `engine` per finding;
- `--fix` and `--comment` are never passed to `/code-review`; the flag is not available with
  `--fix` in this version; if `/code-review` is unavailable or fails (e.g. under Codex) the
  report says so in one line and the spec findings are still reported and logged;
- it passes `--max-findings all`, which `/code-review` remembers for your own later runs until
  you pass `--max-findings default`.

### Init (Pre-Review Setup)

Inject reviewer-aligned rules into your project's `openspec/config.yaml` so specs generated by `/opsx:ff` or `spectra-propose` already satisfy the reviewer's criteria — reducing review round-trips.

```bash
# Inject reviewer rules into config.yaml
/reviewer:init

# Preview what would be added without writing
/reviewer:init --dry-run
```

Rules are appended per artifact ID (`proposal`, `specs`, `design`, `tasks`). Existing rules are preserved — only new rules are added (dedup by exact match). Run from any project root with an `openspec/config.yaml`.

### Multi-Angle Review and Iterative Fix

`/reviewer:spec` runs multi-angle parallel review on every invocation — first pass extracts maximum signal across all built-in angles. Add `--fix` to layer an iterative review → fix loop on top.

`/reviewer:result` is multi-angle on every invocation too (since 1.12.0); `--angles <list>` narrows it, `--fix` layers the review → fix loop, `--fix all` also auto-fixes critical/high. Since 1.11.0 large diffs are read in full, in batches of 10–15 files, in every result route — the old "skip files unrelated to the spec" rule is gone, because the defects it skipped were exactly the ones a spec-blind reviewer finds.

The spec fix loop:
1. Runs the multi-angle review
2. Merges findings into a unified report
3. Decides per-issue whether the fix needs your judgment — auto-fixes the rest, escalates the design calls
4. Repeats until PASS or max iterations reached

```bash
# Spec: multi-angle review (no fix loop) — bound engineering default
/reviewer:spec docs/plan/

# Spec: multi-angle review + iterative fix (default: 3 rounds)
/reviewer:spec docs/plan/ --fix

# Spec: narrow to specific angles
/reviewer:spec docs/plan/ --angles "scope,tasks"

# Spec: fix loop, 5 rounds
/reviewer:spec docs/plan/ --fix -n 5

# Result: iterative review + auto-fix with base branch
/reviewer:result docs/plan/ --fix --base main

# Result: custom angles
/reviewer:result docs/plan/ --fix --angles security,coverage
```

#### Spec Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--fix` | off | Layer an iterative review → fix loop. The orchestrator decides per-issue whether to auto-fix or escalate to you |
| `--angles <list>` | all | Narrow to a custom subset of angles (comma-separated) |
| `-n, --max-iterations <N>` | 3 | Maximum review-fix rounds (only meaningful with `--fix`) |
| `--no-explore` | off | Skip the code-explorer step |

Composition (cross-cutting) angle auto-runs when the orchestrator judges multiple independent spec units are in scope.

#### Result Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--angles <list>` | all | Narrow to these angles (comma-separated); one angle = single reviewer |
| `-c, --with-code-review <level>` | off | Run the built-in `/code-review` at `level` (`low\|medium\|high\|xhigh\|max`, required) on the same diff and merge its findings; not with `--fix` |
| `--fix [all]` | off | Iterative review → fix loop; `all` also auto-fixes critical/high instead of asking |
| `-n, --max-iterations <N>` | 3 | Maximum iteration rounds (with `--fix`) |

#### Default Review Angles

| Command | Angles | Focus |
|---------|--------|-------|
| `spec` | scope | Problem clarity, goals, boundaries |
| | completeness | Edge cases, error handling, security, observability |
| | tasks | Task coverage, done criteria |
| | platform | Platform, runtime, and third-party tool feasibility |
| | design | Design soundness, coupling, assumptions, API coherence |
| | consistency | Internal contradictions across docs and milestones; PASS sign-off gate |
| | composition | Cross-spec contradictions (auto-runs when ≥2 spec units are in scope) |
| `result` | coverage | Spec requirements vs implementation |
| | robustness | Error handling, validation, security |
| | correctness | Logic matching spec intent |

#### Iteration Flow

```
Round N:
  ┌─── Review (parallel) ───┐
  │ Angle A  Angle B  Angle C│
  └──────────┬───────────────┘
             ↓
       Merge Reports
             ↓
     ┌─── Verdict? ───┐
     │                 │
    PASS             FAIL
     │                 │
    Done         Triage Issues
                       │
              ┌────────┴────────┐
              │                 │
         MEDIUM/LOW        CRITICAL/HIGH
         (auto-fix)        (ask user)
              │                 │
              └────────┬────────┘
                       ↓
                  Fix Agent
                       ↓
                  Next Round
```

### Two-Engine Spec Review (Claude + Codex)

For high-stakes specs where missed perspectives are costly, two independent engines — one local Claude, one Codex — review the same change in parallel and completion is gated on the **union** of their findings. This ships as the **`/reviewer:spec-dual`** skill (see [Dual-Engine Spec Review](#dual-engine-spec-review) above for usage and options); the reviewer plugin stays model-agnostic and composes with the external `openai-codex` plugin's `codex:codex-rescue` agent.

**When to use:**
- Architectural specs (foundation for downstream implementation)
- Security/compliance-sensitive specs
- Any spec where you suspect single-model blind spots

**When NOT to use:**
- Routine result review (one engine is usually enough — see [philosophy note](#why-spec-only) below)
- Low-stakes spec changes
- When the `openai-codex` plugin is not installed

#### Why spec-only?

Multi-model review's value scales with **error propagation cost** and inversely with **review frequency**:

| | Spec | Result |
|---|---|---|
| Error propagates to | All downstream implementation | One file/function |
| Error type | Missed perspectives (security, future maintainability) | Implementation bugs |
| Review frequency | 1-3× per change | 10+× via fix-loop iterations |
| Multi-model ROI | High | Low |

Result review is usually fine with one engine + TDD + verification. Use Codex on result review only for **specific high-risk implementations** (auth/crypto, concurrency, performance hotpaths) — invoke `/codex:review` manually rather than baking it into a loop.

The exception is a different *question*, not a different model: `/reviewer:result --with-code-review` adds the built-in spec-blind bug hunt for large refactors where "matches the spec" and "will not break" diverge (see [Why a second engine on result review](#why-a-second-engine-on-result-review)).

## Checkpoint reviews for long implementations

`/reviewer:result` already reviews partial diffs via `--base`. For long changes, don't wait
until the end: after each milestone (or ~5 tasks), run

```
/reviewer:result <change-dir> --base <branch>
```

and clear CRITICAL findings before continuing. In Spectra repos, `/reviewer:init` injects a
tasks rule so generated `tasks.md` includes these checkpoint tasks automatically for changes
with more than 10 tasks — `spectra-apply` then executes the checkpoints as ordinary tasks.

## Agent-Loop Workflow

The plugin outputs a **Handoff block** designed for copy-pasting between agents:

1. Write spec → `/reviewer:spec` → fix gaps
2. Implement → `/reviewer:result` → get review
3. Copy Handoff block → paste into other agent (e.g., Codex)
4. Other agent fixes issues
5. `/reviewer:result` → re-review
6. Repeat until Verdict = PASS

Or use `--fix` to automate steps 3-6.

## Installation

### Claude Code

Install as a Claude Code plugin following the main project README.

### Codex

See [`.codex/INSTALL.md`](.codex/INSTALL.md) for Codex-native installation via symlinked skill discovery.

## Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| result-reviewer | sonnet | Compares git diffs against spec requirements |
| init-reviewer | haiku | Injects reviewer rules into openspec/config.yaml |
| spec-orchestrator | sonnet | Orchestrates multi-angle spec review (optionally with iterative fix loop) |
| result-fix-orchestrator | sonnet | Orchestrates iterative result review + fix loops |
| spec-fixer | sonnet | Applies fixes to spec/design documents |
| result-fixer | sonnet | Applies fixes to implementation code |
