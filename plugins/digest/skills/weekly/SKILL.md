---
name: digest:weekly
description: "Synthesize git activity across multiple projects over a time window into themed recall notes. Clusters commits into themes (features, fixes, refactors, infra, learning surface, tickets, side quests), auto-hides empty sections, and surfaces work that PM tools don't track. Use when the user asks 'what did I do last week', wants a multi-project activity summary, or needs to recall their development history."
---

# Weekly Digest

Synthesize git activity across multiple projects into a themed recall report — what you actually worked on, fixed, refactored, and explored. Designed for **recall** (memory aid), not enumeration (commit dumps).

## Usage

```
$weekly                                    # past 7 days, projects from config
$weekly 14                                  # past 14 days
$weekly last week                           # previous Mon-Sun
$weekly since friday                        # natural-language range
$weekly 2026-05-10..2026-05-17              # explicit range
$weekly may                                 # whole month
$weekly 7 --projects
- /Users/me/project-a
- /Users/me/project-b                       # inline project list
$weekly --write                             # save to $WEEKLY_DIGEST_DIR
$weekly 30 --detail                         # past month + chronological list
```

## Options

| Flag | Description |
|------|-------------|
| `--projects <list>` | Markdown bullet list of project paths (multi-line) |
| `--config <path>` | Custom config file (default: `~/.claude/digest-projects.json`) |
| `--author <email>` | Filter by author email. Default: your git email. `all` for everyone. |
| `--brief` | Short summary only |
| `--detail` | Include full chronological commit list |
| `--write` | Save to `$WEEKLY_DIGEST_DIR` (or `./Weekly/` if env var unset) |
| `--out <file>` | Save to custom path |

## Environment Variables

- `WEEKLY_DIGEST_DIR` — Output directory for `--write`. Set in your shell rc:
  ```bash
  export WEEKLY_DIGEST_DIR="$HOME/Documents/vault/Weekly"
  ```

## Project List Resolution

In order of precedence:
1. `--projects` inline bullet list
2. `--config <path>` JSON file
3. `~/.claude/digest-projects.json`
4. Error with example config

Config format:
```json
{
  "projects": [
    { "path": "/Users/me/project-a", "name": "project-a" },
    { "path": "/Users/me/project-b" }
  ]
}
```

## Architecture

This skill follows the **script + thin command + judgment-focused agent** pattern (see ralph-loop for the canonical example):

- `scripts/setup-weekly.sh` — Parses arguments, resolves project list, validates output destination, emits JSON. **All deterministic work lives here.**
- `commands/weekly.md` — Thin orchestrator: runs the script, dispatches the agent.
- `agents/weekly-agent.md` — Pure LLM judgment work: clustering commits into themes, detecting Learning surface, grouping by ticket.

This separation keeps the agent prompt small (no token waste on argument parsing) and makes the deterministic logic independently testable (`./setup-weekly.sh 7 --projects - /path` from the shell).

## Output Sections (auto-hidden if empty)

- ✨ Built (feat)
- 🐛 Fixed (fix) — with root cause when inferable
- ♻️ Refactored (refactor)
- 🧰 Infra & chores (chore/ci/build/perf)
- 📚 Learning surface — new deps, first-time directories
- 🎫 Tickets touched — grouped by `[A-Z]+-\d+` regex
- 🔍 Side quests — commits without a clear theme

Plus cross-project stats (most active project / day, total lines).
