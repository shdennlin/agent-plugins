# Digest Plugin

Summarize AI-generated branches, PRs, diffs, and design docs into icon-rich structured cards.

## Problem

AI agents generate specs, branches, PRs, and docs — but understanding what they did and why requires reading diffs, commits, and files. This plugin gives you a quick, structured summary at a glance, with the option to go deeper.

## Commands

| Command | Purpose |
|---------|---------|
| `/digest:digest [target] [-s] [-r] [--export]` | Summarize changes into a structured card |
| `/digest:release [from] [to] [--dev] [--user] [--write] [--out <file>]` | Generate release notes from commit ranges |

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
