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
2. Determine the git repository root directory and `cd` to it before dispatching
3. Dispatch the result-reviewer agent using the prompt template in `result-reviewer.md` (in this skill directory)
4. Report findings back

## Agent Dispatch

Before spawning the agent, change to the git root directory:
```bash
cd "$(git rev-parse --show-toplevel)"
```

Then use the companion `result-reviewer.md` in this directory as the agent prompt. Provide it with:
- The list of spec files/folders to review against
- The base branch for diff comparison (or "auto-detect")
