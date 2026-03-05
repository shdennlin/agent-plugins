# Digest Plugin

Summarize AI-generated branches, PRs, diffs, and design docs into icon-rich structured cards.

## Problem

AI agents generate specs, branches, PRs, and docs — but understanding what they did and why requires reading diffs, commits, and files. This plugin gives you a quick, structured summary at a glance, with the option to go deeper.

## Commands

| Command | Purpose |
|---------|---------|
| `/digest:digest [target] [-d]` | Summarize changes into a structured card |
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

# Detailed output with file breakdown and audience sections
/digest:digest --detail
/digest:digest feat/auth -d
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

### Detailed (--detail)

Adds:
- File-by-file breakdown with function-level changes
- Developer view (architecture, tests, dependencies)
- Reviewer view (risk assessment, spec compliance)
- Stakeholder view (plain language, user-facing impact)

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
