# Digest Plugin

Explain existing code (what / how / why / where's the bug) and summarize what a pull request or branch changes — as self-contained HTML explainers or icon-rich cards in chat.

## Problem

AI agents generate specs, branches, PRs, and docs — but understanding what they did and why requires reading diffs, commits, and files. This plugin gives you a quick, structured summary at a glance, with the option to go deeper.

## Commands

| Command | Purpose |
|---------|---------|
| `/digest:explain [target] [-f <audience>] [--teach] [--html] [--as <kind>]` | Explain code state, or summarize what a PR, branch, or the current branch changes — an HTML explainer, a card in chat, or a short lesson (`--teach`) |
| `/digest:release [from] [to] [--dev] [--user] [--write] [--out <file>]` | Generate release notes from commit ranges |
| `/digest:weekly [date-range] [--projects <list>] [--brief] [--detail] [--write]` | Synthesize multi-project recall digest over a time window |

## Usage

### Explain

```bash
# After an investigation in the current session — visualize the finding
# (with nothing to explain, summarizes the current branch against its base)
/digest:explain

# How does this module work?
/digest:explain src/auth/

# What is this function's role in the whole flow?
/digest:explain handleRetry

# Why was it designed this way? (git archaeology)
/digest:explain "why does the queue use at-least-once delivery?"

# What does this pull request do? (card in chat, no file)
/digest:explain #42

# What does this branch change? (card in chat)
/digest:explain feat/auth

# Same, as a shareable HTML file
/digest:explain feat/auth --html

# Tailor for an audience (free-form: manager, pm, designer, non-technical, ...)
/digest:explain #42 -f manager

# Short lesson in chat about the key concept in a recent change
/digest:explain --teach

# Read "main" as a symbol instead of the branch
/digest:explain main --as symbol

# Onboarding tour for a new teammate
/digest:explain src/ -f "new teammate"
```

The first line of every run says how the target was read (`解析為:branch main`); `--as <kind>` (`file`, `pr`, `branch`, `symbol`, `question`) forces another reading. A target is classified in this order: an existing path, then `#N`, then a local or remote-tracking branch, then an identifier-like symbol, then a free-form question.

| Target | Default output |
|--------|----------------|
| path, symbol, question, the conversation's findings | self-contained HTML explainer |
| `#PR`, branch, current branch | change card in chat (no file); `--html` writes the HTML explainer instead (a short conclusion plus the file path) |
| any target with `--teach` | short read-only lesson in chat |

With no target, `explain` uses the current conversation's findings; if there are none, it explains the current branch against its base (`develop` or `main`, whichever is nearer); if there is nothing to diff either, it says so. A path, symbol, or question dispatches an investigation with git archaeology (`git log --follow`, `blame`, commit messages, PR discussions). A `#PR` needs `gh` installed and logged in; without it, `explain` stops and asks for the branch name instead.

#### Migrating from 2.x

`/digest:digest` was removed in 3.0.0 and has no alias. Use `/digest:explain` with the same target:

| 2.x | 3.0 |
|-----|-----|
| `/digest:digest` | `/digest:explain` |
| `/digest:digest feat/auth`, `#42`, a design doc path | `/digest:explain feat/auth`, `#42`, the same path |
| `/digest:digest ... -f manager` | `/digest:explain ... -f manager` |
| `-e html` | `--html` (prints a short conclusion and the path, not the card) |
| `-e md` | no replacement |

Any `-e` or `--export` now stops with an error and this hint, instead of being read as part of a question. To explain text that contains `-e`, put the whole question in quotes.

A design doc path is now explained as a file (what it says), not summarized as a change; pass the branch or PR to see what changed.

2.x read any non-path text as a branch. Now only a local or remote-tracking branch is detected as one, so a tag (`v1`), a short commit hash, or `HEAD~1` is read as a symbol or a question. To summarize what such a commit-ish changes, force it: `/digest:explain v1 --as branch`.

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

### Change card (default for `#PR`, branch, and the current branch)

```
✨ Type: Feature | 📁 3 files changed | ⚠️ Risk: Low

📝 What: Added JWT-based authentication with refresh tokens
🎯 Why: Users need persistent login sessions
💥 Impact: New auth middleware on all protected routes

📄 Key changes: auth.ts, session-manager.ts, auth.test.ts
🚨 Breaking: None
```

### Audience (`-f`)

Free-form audience string calibrates both material and language. `-f manager` leads with impact, risk, timeline, and decisions (no code); `-f pm` with user value and scope; `-f designer` with UX surface. Example with `-f non-technical`:

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

### HTML explainer (`--html`, and the default for state targets)

A single self-contained HTML file — zero external requests, inline SVG diagrams (layer/dependency, call-chain, why-chain, evolution timeline), light/dark via `prefers-color-scheme`, deep sections in collapsible `<details>`. Opens from `file://` with no network. File: `explain-<slug>-<date>.html` in the project root.

For a change target (`#PR`, branch, current branch) the HTML adds the full-depth sections: code walkthrough, design decisions, breaking changes & migration, risks & recommendations, questions for the author, and downstream consumers of the changed files.

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
| explain-agent | sonnet | Reads code and git history to explain what/how/why, and analyzes pull requests and branches into change cards; produces a card in chat or an HTML explainer |
| release-agent | sonnet | Gathers commits between tags and produces developer/user release notes |
| weekly-agent | sonnet | Scans multiple project repos over a time window and synthesizes themed recall notes |
