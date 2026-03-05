# Codex Installation Guide

Install the reviewer plugin for use with Codex via native skill discovery.

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
ln -s ~/.codex/shdennlin-agent-plugins/plugins/reviewer/skills ~/.agents/skills/reviewer
```

### Windows (PowerShell)

```powershell
# Clone the repository (skip if already cloned for another plugin)
git clone https://github.com/shdennlin/agent-plugins.git "$env:USERPROFILE\.codex\shdennlin-agent-plugins"

# Create the skills directory if it doesn't exist
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.agents\skills"

# Symlink the skills into Codex's skill discovery path (no admin required)
cmd /c mklink /J "$env:USERPROFILE\.agents\skills\reviewer" "$env:USERPROFILE\.codex\shdennlin-agent-plugins\plugins\reviewer\skills"
```

3. **Restart Codex** (quit and relaunch the CLI) to discover the skills.

## Verify

Confirm the symlink resolves correctly:

```bash
ls -la ~/.agents/skills/reviewer/
# Should list: spec/  result/
```

## Update

```bash
cd ~/.codex/shdennlin-agent-plugins && git pull
```

The symlink ensures updates are picked up automatically.

## Uninstall

### Unix / macOS

```bash
rm ~/.agents/skills/reviewer

# Only remove the repo if no other plugins are in use
rm -rf ~/.codex/shdennlin-agent-plugins
```

### Windows (PowerShell)

```powershell
cmd /c rmdir "$env:USERPROFILE\.agents\skills\reviewer"

# Only remove the repo if no other plugins are in use
Remove-Item -Recurse -Force "$env:USERPROFILE\.codex\shdennlin-agent-plugins"
```
