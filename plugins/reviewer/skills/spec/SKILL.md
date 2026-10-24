---
name: reviewer:spec
description: "Review a spec, proposal, or design before implementation to catch gaps, risks, and ambiguities. Runs multi-angle parallel review by default; scans codebase for context first. Use --fix for iterative review+fix loop (agent escalates design-judgment issues to you), --angles to narrow the angle set."
---

# reviewer:spec

Claude Code runs `commands/spec.md`; this file is the Codex entry.

**Under Codex:** run the steps of `../../commands/spec.md` yourself, using `../../agents/spec-orchestrator.md` as the orchestration and `../../templates/spec-angle-prompt.md` as the reviewer brief (one reviewer, all angles in one pass; no parallel sub-agents; the setup and merge scripts run as written). Project rules come from `node ../../scripts/read-rules.cjs`; angle keys are validated by `node ../../scripts/check-angles.cjs --section spec`. Full Codex capability table: `../../.codex/INSTALL.md`.
