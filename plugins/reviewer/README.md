# Reviewer Plugin

Structured spec and implementation review with agent-loop handoff support.

## Commands

| Command | Purpose |
|---------|---------|
| `/reviewer:spec [path...]` | Review specs before implementation |
| `/reviewer:result [path...] [--base branch]` | Review implementation against specs |

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

### Result Review

```bash
# Review implementation against spec (auto-detect base branch)
/reviewer:result docs/plans/auth-flow/

# Compare against specific branch
/reviewer:result docs/plans/auth-flow/ --base develop

# Review specific spec files
/reviewer:result spec.md tasks.md -b main
```

## Agent-Loop Workflow

The plugin outputs a **Handoff block** designed for copy-pasting between agents:

1. Write spec → `/reviewer:spec` → fix gaps
2. Implement → `/reviewer:result` → get review
3. Copy Handoff block → paste into other agent (e.g., Codex)
4. Other agent fixes issues
5. `/reviewer:result` → re-review
6. Repeat until Verdict = PASS

## Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| spec-reviewer | sonnet | Analyzes specs for gaps, risks, ambiguities |
| result-reviewer | sonnet | Compares git diffs against spec requirements |
