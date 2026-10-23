# Codex Installation Guide

Install the reviewer plugin for use with Codex via native skill discovery.

## Prerequisites

- [Codex](https://github.com/openai/codex) installed and configured
- Git
- `node` and `jq` (for the result-review scripts)

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

## Codex differences

What each command can do under Codex (Claude Code's Task, Skill, Workflow and plugin MCP tools do not exist there):

| Command | Under Codex | Notes |
|---|---|---|
| `init` | ✓ | rules go to `openspec/config.yaml` or the portable `.claude/reviewer/rules.yaml`; `--from-history` reads the history file |
| `result` | ✓ without `-c` | one reviewer follows `templates/result-angle-prompt.md` and writes `<run_dir>/single.json` in place of the `report_review` tool; `-c <engine>` is ignored (no Skill tool) |
| `spec` | ✓ single prompt | the orchestrator prompt runs as one reviewer, no parallel angles; `--fix` applies the spec-fixer prompt in the same session |
| `spec-dual` | ✗ | needs Claude Code's Workflow tool and the `codex:codex-rescue` agent; use `$spec` instead |


`/reviewer:result -c <engine>` invokes a second review skill through Claude Code's Skill
tool. Under Codex there is no Skill tool and no built-in `/code-review`, so the flag is
ignored whatever its value and the spec review runs alone; the report says so in one line.

Codex has no plugin MCP server, so the `report_review` tool does not exist: reviewers write
`<run_dir>/<angle>.json` (for the single-reviewer methodology, `<run_dir>/single.json`)
directly with a heredoc, and the report notes that schema enforcement did not apply. No
`plugin_root` is passed either: the methodology resolves its own PHYSICAL directory first
(`readlink -f` on the file reached through `~/.agents/skills/reviewer`, which points into
`plugins/reviewer/skills/`) and runs the scripts from `<physical>/../../scripts/`. `node` is
required for `merge-findings.cjs`, and `jq` for `setup-result-review.sh`.

## Verify

Confirm the symlink resolves correctly:

```bash
ls -la ~/.agents/skills/reviewer/
# Should list: init/  result/  spec/  spec-dual/
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
