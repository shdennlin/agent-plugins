---
name: reviewer:result
description: "Review implementation against a spec using git diffs to catch mismatches, missing work, and bugs. Supports iterative review+fix with --fix flag and parallel multi-angle review. Use after implementing a feature to verify spec coverage."
---

# reviewer:result

Claude Code runs `commands/result.md`; this file is the Codex entry.

**Under Codex:** follow `result-reviewer.md` in this directory (single-reviewer methodology; it reads the shared angle brief `../../templates/result-angle-prompt.md` and writes `<run_dir>/single.json` in place of the `report_review` tool). Flags and help text live in `../../commands/result.md`; `-c <engine>` is ignored here (no Skill tool). Scripts: `../../scripts/setup-result-review.sh`, `../../scripts/merge-findings.cjs` (needs `node` and `jq`). Full Codex capability table: `../../.codex/INSTALL.md`.
