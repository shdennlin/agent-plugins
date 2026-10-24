---
name: reviewer:spec-dual
description: "Dual-engine spec review — Claude and Codex review the same change in parallel, then a Workflow loops fixes until BOTH engines are MEDIUM-clean. Use when a spec is high-stakes and you want two different models to cross-check for blind spots before implementation. Requires the openai-codex plugin for the Codex engine."
---

# reviewer:spec-dual

Claude Code runs `commands/spec-dual.md`; this file is the Codex entry.

**Under Codex:** not available. The dual-engine loop needs Claude Code's Workflow tool and the `codex:codex-rescue` agent; use `$spec` (`skills/spec/SKILL.md`) for a single-engine review. Full Codex capability table: `../../.codex/INSTALL.md`.
