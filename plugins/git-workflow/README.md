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

### `/git-workflow:commit`

Commit staged changes with auto-generated Conventional Commits messages. Works in single repos and superprojects with submodules.

```bash
/git-workflow:commit [--spec/-s <name>] [--issue/-i <id>] [--dry-run] [--help/-h]
```

| Argument | Description |
|----------|-------------|
| `--spec/-s` | Spec name for commit message |
| `--issue/-i` | Issue ID for commit message |
| `--dry-run` | Show planned commits without executing |
| `--help/-h` | Show usage information |

**Examples:**
```bash
/git-workflow:commit                              # Commit staged changes
/git-workflow:commit -s auth-flow                 # With spec reference
/git-workflow:commit -i "PROJ-123"                # With issue reference
/git-workflow:commit -s auth-flow -i "#123"       # With both references
/git-workflow:commit --dry-run                    # Preview without committing
```

### `/git-workflow:status`

Show per-submodule git status with staged/unstaged/untracked counts. Submodule-only command.

```bash
/git-workflow:status [--help/-h]
```

**Examples:**
```bash
/git-workflow:status                              # Show all submodule statuses
```

### `/git-workflow:sync`

Pull superproject and sync all submodules to latest tracking branches. Submodule-only command.

```bash
/git-workflow:sync [--help/-h]
```

**Examples:**
```bash
/git-workflow:sync                                # Sync all submodules
```

## Components

- **Command**: `/git-workflow:merge` - merge branches with argument parsing
- **Command**: `/git-workflow:commit` - commit staged changes with auto-generated messages
- **Command**: `/git-workflow:status` - per-submodule status table
- **Command**: `/git-workflow:sync` - pull and sync submodules
- **Agent**: `merge` - executes merge operations and generates commit messages
- **Agent**: `commit-agent` - analyzes diffs and commits with conventional messages
- **Agent**: `status-agent` - gathers and displays submodule status
- **Agent**: `sync-agent` - pulls superproject and syncs submodules
- **Skill**: `merge` - auto-triggers on merge intent
- **Skill**: `commit` - auto-triggers on commit intent
- **Skill**: `status` - auto-triggers on submodule status queries
- **Skill**: `sync` - auto-triggers on sync/update intent

## Plugin Structure

```
git-workflow/
├── .claude-plugin/plugin.json
├── .codex/INSTALL.md
├── commands/
│   ├── merge.md
│   ├── commit.md
│   ├── status.md
│   └── sync.md
├── agents/
│   ├── merge.md
│   ├── commit-agent.md
│   ├── status-agent.md
│   └── sync-agent.md
├── skills/
│   ├── merge/
│   │   ├── SKILL.md
│   │   └── merge.md
│   ├── commit/
│   │   ├── SKILL.md
│   │   └── commit-agent.md
│   ├── status/
│   │   ├── SKILL.md
│   │   └── status-agent.md
│   └── sync/
│       ├── SKILL.md
│       └── sync-agent.md
└── README.md
```

## License

MIT
