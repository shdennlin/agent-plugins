---
name: reviewer:spec
description: "Review a spec, proposal, or design before implementation to catch gaps, risks, and ambiguities. Use when you want to validate specs before coding."
---

# Spec Review

Review feature specifications, proposals, designs, or task lists before implementation starts.

## Usage

Provide the paths to spec files or folders to review:

```
$spec docs/plans/auth-flow/
$spec proposal.md spec.md tasks.md
```

If no paths are given, ask which files to review.

## Process

1. Read the spec files provided
2. Dispatch the spec-reviewer agent using the prompt template in `spec-reviewer.md` (in this skill directory)
3. Report findings back

## Agent Dispatch

Use the companion `spec-reviewer.md` in this directory as the agent prompt. The agent will cd to the git root automatically. Provide it with:
- The list of files/folders to review
