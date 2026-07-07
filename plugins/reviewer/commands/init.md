---
allowed-tools:
  - Read
  - Task
  - AskUserQuestion
  - Bash
  - Edit
description: Inject reviewer-aligned rules into openspec/config.yaml to reduce review round-trips
argument-hint: "[--dry-run/-n] [--from-history] [--help/-h]"
---

# Init Command

Inject reviewer rules into your project's `openspec/config.yaml` so that specs generated
by OpenSpec tooling already satisfy the reviewer's criteria.

## Arguments

Parse the following from `$ARGUMENTS`:

- `--dry-run` or `-n` — Preview rules that would be added without writing
- `--from-history` — Harvest recurring review findings into candidate rules
- `--help` or `-h` — Show usage information and exit

## Instructions

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
1. **help**: if `--help` or `-h` is present, show the usage information below and stop. Do NOT delegate to the agent.
2. **dry_run**: if `--dry-run` or `-n` is present, set dry_run = true
3. **from_history**: if `--from-history` is present, set from_history = true

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /reviewer:init [options]

Inject reviewer rules into openspec/config.yaml so specs pass review on first attempt.

Options:
  -n, --dry-run         Preview what would be added without writing
  --from-history        Harvest recurring review findings into candidate rules
  -h, --help            Show this help message

What it does:
  Reads your project's openspec/config.yaml and appends rules for each artifact
  (proposal, specs, design, tasks) based on the reviewer's focus areas.
  Existing rules are preserved — only new rules are appended (dedup by exact match).

  With --from-history, reads the review findings history (openspec/reviews/history.jsonl
  or .claude/reviewer/history.jsonl), clusters findings that recur across 2+ changes into
  candidate rules, asks you to confirm each, and injects only the confirmed ones.
  The same pass flags existing rules for retirement (finding class never seen in history,
  or superseded by a new rule) — removals are confirmed separately before applying.

Examples:
  /reviewer:init                     # inject rules into openspec/config.yaml
  /reviewer:init --dry-run           # preview without writing
  /reviewer:init -n                  # same as --dry-run
  /reviewer:init --from-history      # cluster review history into new rules
```

### Step 2: Read the Rules Template

Read the reviewer rules template from the plugin:
`${CLAUDE_PLUGIN_ROOT}/templates/reviewer-rules.yaml`

Store the full content — it will be passed to the agent.

### Step 2b: From-History Mode (only when --from-history)

When from_history is true, do NOT use the static template. Instead:

1. **Locate history**: first determine the git root via `git rev-parse --show-toplevel`
   (Bash). Resolve both candidate paths against that root — not the cwd — then read
   `<git-root>/openspec/reviews/history.jsonl` if it exists, else
   `<git-root>/.claude/reviewer/history.jsonl`. If neither exists, tell the user
   "No review history found — run /reviewer:spec, /reviewer:result, or /reviewer:spec-dual first"
   and STOP.
2. **Cluster**: parse the JSONL lines. Group findings that describe the same recurring problem
   (same `category` plus overlapping title keywords — use judgment, not exact match).
3. **Filter**: keep only groups whose findings span **2 or more distinct `change` values** —
   a finding seen in one change is an incident; seen across changes it is systemic.
4. **Draft rules**: for each kept group, write ONE imperative one-line rule in the style of
   the reviewer rules template, and assign it to an artifact key by category:
   scope → `proposal`, completeness/spec → `specs`, platform → `specs`, consistency → `specs`,
   design → `design`, codebase → `design`, cross-cutting → `design`, tasks → `tasks`
   (default `specs` when unclear).
5. **Confirm**: present all candidates with AskUserQuestion (multiSelect: true), each option
   showing the drafted rule and how many changes it recurred in. Only user-selected rules
   proceed. If the user selects none, skip to step 6 (retirement may still apply); if there
   is also nothing to retire, report "no rules confirmed" and STOP.
6. **Retire**: the flywheel must prune as well as add — rules are a per-spec compliance tax.
   Read the current rules target (`openspec/config.yaml` at the git root, else
   `.claude/reviewer/rules.yaml`) and flag retirement candidates: existing rules whose
   finding class appears NOWHERE in the history (guarding against a problem this project
   has never had), and rules duplicated or superseded by a newly confirmed candidate.
   Do NOT flag a rule merely because its finding class stopped after injection — silence
   after injection means the rule is working. If there are candidates, present them in a
   SEPARATE AskUserQuestion (multiSelect: true) clearly labeled as removals, and delete
   only user-selected ones from the rules target with Edit in this conversation — never
   via the init-reviewer agent, which is append-only by design. With dry_run, preview
   removal candidates instead of editing. No existing rules or no candidates: skip silently.
7. **Build the template**: format the confirmed rules as a YAML fragment keyed by artifact
   (same shape as reviewer-rules.yaml) and pass THAT as the template content in Step 3.
   If only retirements were confirmed (no new rules), skip Step 3 and report directly.

### Step 2c: Confirm Portable Fallback (before dispatch)

Before delegating: check for `openspec/config.yaml` at the git root. If it does NOT exist,
tell the user the injection will target the portable fallback `.claude/reviewer/rules.yaml`
(consumed by /reviewer:spec via project_rules, not by OpenSpec generation) and confirm with
AskUserQuestion before dispatching. If the user declines, stop.

### Step 3: Delegate to Agent

Launch the `init-reviewer` agent:

```
Task tool:
- subagent_type: "reviewer:init-reviewer"
- description: "Inject reviewer rules into openspec/config.yaml"
- prompt: |
    Inject reviewer rules into the project's rules target (openspec/config.yaml, or the portable fallback per your instructions).

    Options:
    - dry_run: <true or false>

    Working directory: <current directory>

    ## Reviewer Rules Template

    <paste full content of reviewer-rules.yaml here>
```

Report the agent's results back to the user.

## Examples

```bash
# Inject reviewer rules
/reviewer:init

# Preview without writing
/reviewer:init --dry-run
```
