---
name: reviewer:result
description: "Review implementation against a spec using git diffs to catch mismatches, missing work, and bugs. Use after implementing a feature to verify spec coverage."
---

# Result Review

Review implementation against a spec by analyzing git diffs and cross-referencing with spec requirements.

## Usage

Provide spec file paths and optionally a base branch:

```
$result docs/plans/auth-flow/
$result spec.md tasks.md --base develop
$result docs/plan/ -b main
```

If no paths are given, ask which spec files to review against.

## Process

1. Read the spec files provided
2. Dispatch the result-reviewer agent using the prompt template in `result-reviewer.md` (in this skill directory)
3. Report findings back

## Agent Dispatch

Use the companion `result-reviewer.md` in this directory as the agent prompt. The agent will cd to the git root automatically. Provide it with:
- The list of spec files/folders to review against
- The base branch for diff comparison (or "auto-detect")
