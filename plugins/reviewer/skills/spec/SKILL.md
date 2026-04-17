---
name: reviewer:spec
description: "Review a spec, proposal, or design before implementation to catch gaps, risks, and ambiguities. Scans codebase for context before review. Supports iterative review+fix with --fix flag and parallel multi-angle review. Use when you want to validate specs before coding."
---

# Spec Review

Review feature specifications, proposals, designs, or task lists before implementation starts.

## Usage

Provide the paths to spec files or folders to review:

```
$spec docs/plans/auth-flow/
$spec proposal.md spec.md tasks.md
```

With iterative auto-fix:

```
$spec docs/plans/auth-flow/ --fix
$spec docs/plan/ --fix -n 5 --fix-all
$spec docs/plan/ --fix --parallel "scope,tasks"
```

Skip codebase exploration:

```
$spec docs/plan/ --no-explore
```

Skip cross-cutting composition check:

```
$spec docs/plan/ --no-cross-cutting
```

If no paths are given, ask which files to review.

## Process

1. Read the spec files provided
2. Explore the codebase for relevant context (code-explorer agent, unless `--no-explore`)
3. If ≥2 spec units are detected in scope, include a cross-cutting composition pass (unless `--no-cross-cutting`)
4. Dispatch the spec-reviewer agent with codebase context (or spec-fix-orchestrator with `--fix`)
5. Report findings back

## Agent Dispatch

Before either dispatch, the code-explorer agent scans the codebase for relevant context based on spec content. Pass `--no-explore` to skip this step.

Without `--fix`: use the companion `spec-reviewer.md` in this directory as the agent prompt.
With `--fix`: dispatch `reviewer:spec-fix-orchestrator` with parameters (paths, max_iterations, parallel, angles, fix_all, codebase_context, review-angles template content).

The agent will cd to the git root automatically. Provide it with:
- The list of files/folders to review
