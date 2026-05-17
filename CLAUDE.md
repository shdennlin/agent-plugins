# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A marketplace of Claude Code plugins providing workflow automation for AI coding agents. Four plugins ship in a monorepo with a central marketplace registry.

## Architecture

### Plugin Component Types

Each plugin lives under `plugins/{name}/` and can contain any combination of:

- **Commands** (`commands/*.md`) — Slash commands invoked by users. Parse `$ARGUMENTS`, show `--help`, then dispatch to an agent via `Task` tool with `subagent_type`.
- **Agents** (`agents/*.md`) — Autonomous agents with YAML frontmatter (`identifier`, `model`, `tools`, `whenToUse`). The markdown body is the system prompt.
- **Skills** (`skills/{name}/SKILL.md` + companion agent `.md`) — Auto-discovered capabilities. `SKILL.md` defines metadata; the companion file is the agent prompt template.
- **Scripts** (`scripts/*.sh`) — Deterministic shell logic invoked by commands or hooks. Used for argument parsing, env validation, path resolution, state setup. Keeps deterministic work out of agent prompts. See "Where to put logic" below.
- **Hooks** (`hooks/hooks.json` + `hooks/*.sh`, or `.claude-plugin/hooks/hooks.json`) — Event-driven automation (`SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`).
- **Templates** (`templates/`) — Static content injected by agents (e.g., YAML rules).

### Dispatch Pattern

Commands and skills follow the same flow: parse args → validate → cd to git root → dispatch agent via Task tool → report results. The agent prompt template (companion `.md` in skill directory) is separate from the agent definition (`agents/*.md` with frontmatter).

### Where to put logic (design convention)

Each layer has one responsibility. Do not mix layers — putting deterministic work in agent prompts wastes LLM tokens; putting LLM judgment in scripts is impossible. Follow this table:

| Logic type | Location | Why |
|------------|----------|-----|
| **Deterministic prep** (arg parsing, env validation, path resolution, mkdir, JSON I/O) | `scripts/<name>.sh` | No LLM involvement; independently testable from shell; easy to update without re-tokenizing prompts |
| **LLM judgment** (synthesis, classification, summarization, theming) | `agents/<name>.md` body | This is what LLMs do well — keep their prompts focused on it |
| **Session-level persistent state** (env vars exported once per session) | `hooks/<name>.sh` via `SessionStart`, written to `$CLAUDE_ENV_FILE` | Persistent across all commands in the session |
| **Orchestration** (run script, parse its output, dispatch agent) | `commands/<name>.md` | Thin (~30–60 lines); links the script result to the agent dispatch |

**Anti-patterns** to avoid:
- Inline bash validation in `commands/*.md` for Claude to execute — mixes orchestration with implementation, can't be unit-tested, gets rewritten in every similar command
- Argument parsing or config-file reading inside `agents/*.md` — every agent invocation pays the token cost of mechanical work the LLM shouldn't be doing

**Canonical examples**:
- `ralph-loop/scripts/setup-ralph-loop.sh` + `ralph-loop/commands/ralph-loop.md` — thin command, all setup in script
- `digest/scripts/setup-weekly.sh` + `digest/commands/weekly.md` — args → JSON → agent dispatch

### Dual Registration

Every plugin must be registered in two places that must stay in sync:
1. `plugins/{name}/.claude-plugin/plugin.json` — plugin-level manifest
2. `.claude-plugin/marketplace.json` — central registry (version must match)

### Environment Variables

- `$ARGUMENTS` — command argument string (in commands)
- `${CLAUDE_PLUGIN_ROOT}` — plugin directory (in hooks/scripts)
- `${CLAUDE_PROJECT_DIR}` — user's project directory

## Development

### Testing a Plugin

```bash
claude --debug --plugin-dir ./plugins/your-plugin
```

### Adding a Plugin

1. Create directory structure under `plugins/{name}/`
2. Create `.claude-plugin/plugin.json` with name, version, description, author, keywords
3. Add commands/agents/skills/hooks as needed
4. Register in `.claude-plugin/marketplace.json`
5. Update root README catalog
6. Add `.codex/INSTALL.md` for Codex support

### Commit Convention

```
<type>(<plugin-name>): <description>
```

Types: `feat`, `fix`, `refactor`, `docs`, `chore`

### Version Bumping

Update both `plugins/{name}/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` — versions must match.
