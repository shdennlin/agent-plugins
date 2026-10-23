---
name: reviewer:init
description: "Inject reviewer-aligned rules into openspec/config.yaml so generated specs pass review on first attempt. Use to reduce review round-trips after /opsx:ff or spectra-propose."
---

# reviewer:init

Claude Code runs `commands/init.md`; this file is the Codex entry.

**Under Codex:** follow `init-reviewer.md` in this directory (the init agent prompt). Flags, help text and the dispatch live in `../../commands/init.md`; read it for the argument rules. Rules go to `openspec/config.yaml` when the repo has `openspec/`, else to `.claude/reviewer/rules.yaml`; `--from-history` reads the history file next to them. Full Codex capability table: `../../.codex/INSTALL.md`.
