# Git Workflow Plugin

Git workflow automation commands with Conventional Commits support.

## Commands

### `/git-workflow:merge`

Merge branches with auto-generated Conventional Commits messages.

```bash
/git-workflow:merge [source] [target] [--issue/-i <id>] [--spec/-s <name>] [--all] [--yes/-y] [--help/-h]
```

| Argument | Description |
|----------|-------------|
| `[source]` | Source branch (defaults to current branch) |
| `[target]` | Target branch (defaults to develop/main) |
| `--issue/-i` | Issue ID for commit message |
| `--spec/-s` | Spec name for commit message |
| `--all` | Merge across all sub-repos |
| `--yes/-y` | Skip confirmation |
| `--help/-h` | Show usage information |

**Examples:**
```bash
/git-workflow:merge                          # Merge current branch into develop/main
/git-workflow:merge feature/auth             # Merge specific source branch
/git-workflow:merge develop main             # Merge develop into main
/git-workflow:merge -i "#123" -s auth-flow   # With references
/git-workflow:merge --all --yes              # All repos, no confirm
```

## Components

- **Command**: `/git-workflow:merge` - slash command with argument parsing
- **Agent**: `merge` - executes git operations and generates commit messages
- **Skill**: `merge` - auto-triggers on merge intent

## Plugin Structure

```
git-workflow/
├── .claude-plugin/plugin.json
├── commands/merge.md
├── agents/merge.md
├── skills/merge/SKILL.md
└── README.md
```

## License

MIT
