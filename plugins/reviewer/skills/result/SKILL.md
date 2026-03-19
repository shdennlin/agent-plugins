---
name: reviewer:result
description: "Review implementation against a spec using git diffs to catch mismatches, missing work, and bugs. Supports iterative review+fix with --fix flag and parallel multi-angle review. Use after implementing a feature to verify spec coverage."
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

With iterative auto-fix:

```
$result docs/plan/ --fix
$result docs/plan/ --fix --base main -n 5 --fix-all
$result docs/plan/ --fix --parallel "security,coverage"
```

If no paths are given, ask which spec files to review against.

## Process

1. Read the spec files provided
2. Dispatch the result-reviewer agent (or result-fix-orchestrator with `--fix`)
3. Report findings back

## Agent Dispatch

Without `--fix`: use the companion `result-reviewer.md` in this directory as the agent prompt.
With `--fix`: dispatch `reviewer:result-fix-orchestrator` with parameters (spec_paths, working_directory, base_branch, max_iterations, parallel, angles, fix_all, review-angles template content).

The agent will cd to the git root automatically. Provide it with:
- The list of spec files/folders to review against
- The base branch for diff comparison (or "auto-detect")
