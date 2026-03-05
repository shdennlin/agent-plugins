# Codex Installation Guide

Install the git-workflow plugin for use with Codex via native skill discovery.

## Prerequisites

- [Codex](https://github.com/openai/codex) installed and configured
- Git

## Install

### Unix / macOS

```bash
# Clone the repository (skip if already cloned for another plugin)
git clone https://github.com/shdennlin/agent-plugins.git ~/.codex/shdennlin-agent-plugins

# Create the skills directory if it doesn't exist
mkdir -p ~/.agents/skills

# Symlink the skills into Codex's skill discovery path
ln -s ~/.codex/shdennlin-agent-plugins/plugins/git-workflow/skills ~/.agents/skills/git-workflow
```

### Windows (PowerShell)

```powershell
# Clone the repository (skip if already cloned for another plugin)
git clone https://github.com/shdennlin/agent-plugins.git "$env:USERPROFILE\.codex\shdennlin-agent-plugins"

# Create the skills directory if it doesn't exist
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.agents\skills"

# Symlink the skills into Codex's skill discovery path
New-Item -ItemType SymbolicLink `
  -Path "$env:USERPROFILE\.agents\skills\git-workflow" `
  -Target "$env:USERPROFILE\.codex\shdennlin-agent-plugins\plugins\git-workflow\skills"
```

## Verify

Confirm the symlink resolves correctly:

```bash
ls -la ~/.agents/skills/git-workflow/
# Should list: merge/
```

## Update

```bash
cd ~/.codex/shdennlin-agent-plugins && git pull
```

The symlink ensures updates are picked up automatically.

## Uninstall

### Unix / macOS

```bash
rm ~/.agents/skills/git-workflow

# Only remove the repo if no other plugins are in use
rm -rf ~/.codex/shdennlin-agent-plugins
```

### Windows (PowerShell)

```powershell
Remove-Item "$env:USERPROFILE\.agents\skills\git-workflow"

# Only remove the repo if no other plugins are in use
Remove-Item -Recurse -Force "$env:USERPROFILE\.codex\shdennlin-agent-plugins"
```
