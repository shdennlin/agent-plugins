# Digest Plugin

Summarize AI-generated branches, PRs, diffs, and design docs into icon-rich structured cards.

## Problem

AI agents generate specs, branches, PRs, and docs — but understanding what they did and why requires reading diffs, commits, and files. This plugin gives you a quick, structured summary at a glance, with the option to go deeper.

## Commands

| Command | Purpose |
|---------|---------|
| `/digest:digest [target] [-s] [-r] [--export]` | Summarize changes into a structured card |
| `/digest:release [from] [to] [--dev] [--user] [--write] [--out <file>]` | Generate release notes from commit ranges |
| `/digest:weekly [date-range] [--projects <list>] [--brief] [--detail] [--write]` | Synthesize multi-project recall digest over a time window |

## Usage

### Digest

```bash
# Summarize current branch
/digest:digest

# Summarize a feature branch
/digest:digest feat/new-auth

# Summarize a PR
/digest:digest #42

# Summarize a design doc
/digest:digest docs/plans/auth.md

# Plain-language summary (easy to understand for everyone)
/digest:digest --simple
/digest:digest feat/auth -s

# Full report with architecture, design decisions, risks, recommendations
/digest:digest --report
/digest:digest feat/auth -r

# Export report as markdown file with Mermaid diagrams (requires -r)
/digest:digest -r --export
```

### Release

```bash
# Release notes from latest tag to HEAD
/digest:release

# Between two tags
/digest:release v1.0.0 v2.0.0

# Developer changelog only
/digest:release --dev

# User narrative only
/digest:release --user

# Append to CHANGELOG.md
/digest:release --write

# Write to custom file
/digest:release --out docs/release.md
```

### Weekly

#### Setup (optional, only for `/digest:weekly`)

The weekly digest has two optional configuration knobs. Both have inline alternatives, so setup is not required — but recommended if you'll use the command regularly.

**1. Project list** — create `~/.claude/digest-projects.json`:

```json
{
  "projects": [
    { "path": "/Users/me/project-a", "name": "project-a" },
    { "path": "/Users/me/project-b" }
  ]
}
```

`name` is optional (defaults to directory basename). Once this exists, `/digest:weekly` with no `--projects` will scan all listed repos.

Alternative: pass `--projects` inline every time (see examples below).

**2. Output directory** — for `--write` to land in a vault, add to your shell rc (`~/.zshrc`, `~/.bashrc`):

```bash
export WEEKLY_DIGEST_DIR="$HOME/Documents/vault/Weekly"
```

If unset, `--write` falls back to `./Weekly/` in the current directory. Alternative: pass `--out <path>` every time.

#### Usage

```bash
# Past 7 days, projects from ~/.claude/digest-projects.json
/digest:weekly

# Past 14 days
/digest:weekly 14

# Last calendar week (Mon-Sun)
/digest:weekly last week

# Explicit date range
/digest:weekly 2026-05-10..2026-05-17

# Inline project list (markdown bullets)
/digest:weekly 7 --projects
- /Users/me/project-a
- /Users/me/project-b

# Short summary only
/digest:weekly --brief

# Full chronological commit list (escape hatch)
/digest:weekly may --detail

# Save to $WEEKLY_DIGEST_DIR/Weekly YYYY-WNN.md (or ./Weekly/ if env var unset)
/digest:weekly --write

# All authors (team view)
/digest:weekly 7 --author all
```

Output is **synthesized** (themed clusters), not enumerated (commit dumps). Sections auto-hide when empty:
- ✨ Built · 🐛 Fixed · ♻️ Refactored · 🧰 Infra & chores
- 📚 Learning surface (new deps, first-time directories)
- 🎫 Tickets touched (`LIN-123` / `JIRA-456` grouping)
- 🔍 Side quests (commits without a clear theme)

## Output Format

### Default (Structured Card)

```
✨ Type: Feature | 📁 3 files changed | ⚠️ Risk: Low

📝 What: Added JWT-based authentication with refresh tokens
🎯 Why: Users need persistent login sessions
💥 Impact: New auth middleware on all protected routes

📄 Key changes: auth.ts, session-manager.ts, auth.test.ts
🚨 Breaking: None
```

### Simple (--simple)

```
✨ Feature | 📁 3 files changed | ⚠️ Risk: Low

📝 What changed:
  Users can now stay logged in without re-entering their password every time.

🎯 Why:
  Previously, users were logged out after closing the browser. This was annoying.

💥 What users will notice:
  All pages that require login will now check for a saved session first.

📄 Key files: auth.ts, session-manager.ts, auth.test.ts
🚨 Breaking changes: None
```

### Report (--report)

Adds (~5 min read):
- Architecture impact with module dependencies and blast radius
- Design decisions with trade-off analysis
- Breaking changes and migration steps
- Risk assessment and recommendations
- Questions for the author

### Export (--export)

Requires `--report`. Writes the full report to a markdown file with Mermaid diagrams instead of ASCII art. File is named `digest-report-<target>-<YYYY-MM-DD>.md`.

## Change Type Icons

| Type | Icon |
|------|------|
| Bug Fix | 🐛 |
| Feature | ✨ |
| Refactor | ♻️ |
| Docs | 📝 |
| Performance | ⚡ |
| Test | 🧪 |
| Chore | 🔧 |
| Breaking Change | 🚨 |

## Installation

### Claude Code

Install as a Claude Code plugin following the main project README.

### Codex

See [`.codex/INSTALL.md`](.codex/INSTALL.md) for Codex-native installation.

## Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| digest-agent | sonnet | Analyzes diffs, commits, PRs, and docs to produce structured summaries |
| release-agent | sonnet | Gathers commits between tags and produces developer/user release notes |
| weekly-agent | sonnet | Scans multiple project repos over a time window and synthesizes themed recall notes |
