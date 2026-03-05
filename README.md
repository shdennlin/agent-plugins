# Agent Plugins

A collection of plugins for AI coding agents including [Claude Code](https://code.claude.com/docs/en/), [Codex](https://github.com/openai/codex), and other agentic development tools.

## Installation

### Claude Code

```bash
# Step 1: Add this marketplace to Claude Code
/plugin marketplace add shdennlin/agent-plugins

# Step 2: Install a plugin
/plugin install mermaid-validator@shdennlin-plugins
```

That's it! The plugin is now installed and ready to use.

## Plugin Catalog

| Plugin | Description | Type |
|--------|-------------|------|
| [mermaid-validator](./plugins/mermaid-validator) | Validates and fixes Mermaid diagram syntax in Markdown files | Command + Agent |
| [git-workflow](./plugins/git-workflow) | Git workflow automation commands with Conventional Commits support | Command + Agent + Skill |

## Commands

```bash
# Add this marketplace
/plugin marketplace add shdennlin/agent-plugins

# Install a plugin
/plugin install mermaid-validator@shdennlin-plugins

# List available plugins
/plugin list shdennlin-plugins

# Update a plugin
/plugin update mermaid-validator@shdennlin-plugins

# Remove a plugin
/plugin uninstall mermaid-validator@shdennlin-plugins
```

## Plugin Details

### mermaid-validator

Validates and **fixes** Mermaid diagram syntax in Markdown files.

**Components:**
- **Command** (`/mermaid-validator:check`): On-demand validation with fix capability
- **Agent**: Proactive validation after editing `.md` files

**Usage:**
```bash
# Check mermaid diagrams
/mermaid-validator:check

# Check and auto-fix
/mermaid-validator:check --fix

# Check specific file
/mermaid-validator:check README.md

# Check all files
/mermaid-validator:check --all
```

**Optional (for deep validation):**
```bash
npm install -g @mermaid-js/mermaid-cli
```

[View full documentation](./plugins/mermaid-validator/README.md)

### git-workflow

Git workflow automation commands with Conventional Commits support.

**Components:**
- **Command** (`/git-workflow:merge`): Merge branches with Conventional Commits
- **Agent**: Executes git merge operations
- **Skill**: Auto-triggers on merge intent

**Usage:**
```bash
/git-workflow:merge
/git-workflow:merge feature/auth -i "#123"
/git-workflow:merge develop main
/git-workflow:merge --all --yes
```

[View full documentation](./plugins/git-workflow/README.md)

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

### Adding a New Plugin

1. Create a new directory under `plugins/`
2. Follow the standard plugin structure:
   ```
   plugins/your-plugin/
   ├── .claude-plugin/
   │   └── plugin.json
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
