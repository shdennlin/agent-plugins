---
name: reviewer:spec
description: "Review a spec, proposal, or design before implementation to catch gaps, risks, and ambiguities. Runs multi-angle parallel review by default; scans codebase for context first. Use --fix for iterative review+fix loop (agent escalates design-judgment issues to you), --angles to narrow the angle set."
---

# Spec Review

Review feature specifications, proposals, designs, or task lists before implementation starts.

Every invocation fans out across all built-in review angles by default (bound engineering — first pass extracts maximum signal). Flags only narrow that set or layer a fix loop on top.

## Usage

Provide the paths to spec files or folders to review:

```
$spec docs/plans/auth-flow/
$spec proposal.md spec.md tasks.md
```

With iterative fix loop (agent decides which issues need your call):

```
$spec docs/plans/auth-flow/ --fix
$spec docs/plan/ --fix -n 5
```

Narrow to specific angles (still parallel, just fewer):

```
$spec docs/plan/ --angles "scope,tasks"
```

Skip codebase exploration:

```
$spec docs/plan/ --no-explore
```

If no paths are given, ask which files to review.

## Process

1. Read the spec files provided
2. Explore the codebase for relevant context (code-explorer agent, unless `--no-explore`)
3. Dispatch the spec-orchestrator agent with codebase context and `fix_enabled` derived from `--fix`
4. Report findings back

## Agent Dispatch

Before dispatching the orchestrator, the code-explorer agent scans the codebase for relevant context based on spec content. Pass `--no-explore` to skip this step.

Always dispatch `reviewer:spec-orchestrator` with parameters (paths, fix_enabled, max_iterations, angles, codebase_context, review-angles template content, log_script_path — resolve `${CLAUDE_PLUGIN_ROOT}/scripts/log-findings.sh` to an absolute path). The orchestrator fans out per angle in parallel and decides whether to also run the composition angle based on whether the scope contains multiple independent spec units. When `fix_enabled` is true it also runs Steps 5–7, escalating only the issues that need design judgment.

The agent will cd to the git root automatically. Provide it with:
- The list of files/folders to review
