---
allowed-tools:
  - Read
  - Task
description: Inject reviewer-aligned rules into openspec/config.yaml to reduce review round-trips
argument-hint: "[--dry-run/-n] [--help/-h]"
---

# Init Command

Inject reviewer rules into your project's `openspec/config.yaml` so that specs generated
by OpenSpec tooling already satisfy the reviewer's criteria.

## Arguments

Parse the following from `$ARGUMENTS`:

- `--dry-run` or `-n` — Preview rules that would be added without writing
- `--help` or `-h` — Show usage information and exit

## Instructions

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
1. **help**: if `--help` or `-h` is present, show the usage information below and stop. Do NOT delegate to the agent.
2. **dry_run**: if `--dry-run` or `-n` is present, set dry_run = true

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /reviewer:init [options]

Inject reviewer rules into openspec/config.yaml so specs pass review on first attempt.

Options:
  -n, --dry-run         Preview what would be added without writing
  -h, --help            Show this help message

What it does:
  Reads your project's openspec/config.yaml and appends rules for each artifact
  (proposal, specs, design, tasks) based on the reviewer's focus areas.
  Existing rules are preserved — only new rules are appended (dedup by exact match).

Examples:
  /reviewer:init                     # inject rules into openspec/config.yaml
  /reviewer:init --dry-run           # preview without writing
  /reviewer:init -n                  # same as --dry-run
```

### Step 2: Read the Rules Template

Read the reviewer rules template from the plugin:
`${CLAUDE_PLUGIN_ROOT}/templates/reviewer-rules.yaml`

Store the full content — it will be passed to the agent.

### Step 3: Delegate to Agent

Launch the `init-reviewer` agent:

```
Task tool:
- subagent_type: "reviewer:init-reviewer"
- description: "Inject reviewer rules into openspec/config.yaml"
- prompt: |
    Inject reviewer rules into the project's openspec/config.yaml.

    Options:
    - dry_run: <true or false>

    Working directory: <current directory>

    ## Reviewer Rules Template

    <paste full content of reviewer-rules.yaml here>
```

Report the agent's results back to the user.

## Examples

```bash
# Inject reviewer rules
/reviewer:init

# Preview without writing
/reviewer:init --dry-run
```
