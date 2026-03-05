# Agent Plugins

A collection of plugins for AI coding agents including [Claude Code](https://code.claude.com/docs/en/), [Codex](https://github.com/openai/codex), and other agentic development tools.

## Plugin Catalog

| Plugin | Description | Type | Command |
|--------|-------------|------|---------|
| [mermaid-validator](./plugins/mermaid-validator) | Validates and fixes Mermaid diagram syntax in Markdown files | Command + Agent | `/mermaid-validator:check` |
| [git-workflow](./plugins/git-workflow) | Git workflow automation with Conventional Commits support | Command + Agent + Skill | `/git-workflow:merge` |
| [reviewer](./plugins/reviewer) | Structured spec and implementation review with agent-loop handoff | Command + Agent | `/reviewer:spec`, `/reviewer:result` |
| [digest](./plugins/digest) | Summarize branches, PRs, diffs, and docs into icon-rich structured cards | Command + Agent + Skill | `/digest:digest`, `/digest:release` |

## Getting Started

### Claude Code

```bash
# Add this marketplace to Claude Code
/plugin marketplace add shdennlin/agent-plugins

# Install a plugin
/plugin install reviewer@shdennlin-plugins

# List available plugins
/plugin list shdennlin-plugins

# Update a plugin
/plugin update reviewer@shdennlin-plugins

# Remove a plugin
/plugin uninstall reviewer@shdennlin-plugins
```

### Codex

Tell Codex to fetch and follow the install instructions for the plugin you want:

| Plugin | Install command |
|--------|----------------|
| reviewer | `Fetch and follow instructions from https://raw.githubusercontent.com/shdennlin/agent-plugins/main/plugins/reviewer/.codex/INSTALL.md` |
| git-workflow | `Fetch and follow instructions from https://raw.githubusercontent.com/shdennlin/agent-plugins/main/plugins/git-workflow/.codex/INSTALL.md` |
| mermaid-validator | `Fetch and follow instructions from https://raw.githubusercontent.com/shdennlin/agent-plugins/main/plugins/mermaid-validator/.codex/INSTALL.md` |
| digest | `Fetch and follow instructions from https://raw.githubusercontent.com/shdennlin/agent-plugins/main/plugins/digest/.codex/INSTALL.md` |

Restart Codex after installation to discover the skills.

**Update:** `cd ~/.codex/shdennlin-agent-plugins && git pull` — skills update instantly through the symlink.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

### Adding a New Plugin

1. Create a new directory under `plugins/`
2. Follow the standard plugin structure:
   ```
   plugins/your-plugin/
   ├── .claude-plugin/
   │   └── plugin.json
   ├── .codex/
   │   └── INSTALL.md   # (optional) - Codex installation guide
   ├── commands/        # (optional) - slash commands
   ├── agents/          # (optional) - proactive agents
   ├── hooks/           # (optional) - event hooks
   ├── skills/          # (optional) - auto-discovery skills
   └── README.md
   ```
3. Add your plugin to `.claude-plugin/marketplace.json`
4. Update this README's plugin catalog
5. Submit a pull request

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Author

**shdennlin** - [GitHub](https://github.com/shdennlin)

## Resources

- [Claude Code Documentation](https://code.claude.com/docs/en/)
- [Plugin Development Guide](https://code.claude.com/docs/en/plugins)
- [Marketplace Documentation](https://code.claude.com/docs/en/plugin-marketplaces)
