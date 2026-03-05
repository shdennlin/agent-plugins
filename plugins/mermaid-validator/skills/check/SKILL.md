---
name: mermaid-validator:check
description: "Validate and fix Mermaid diagram syntax in Markdown files. Use when editing or reviewing files with mermaid code blocks."
---

# Mermaid Check

Validate and fix Mermaid diagram syntax in Markdown files.

## Usage

```
$check                    # Check git changed .md files
$check README.md          # Check specific file
$check --fix              # Auto-fix common errors
$check --all              # Check all .md files in project
```

## Process

1. Determine which files to check (git changes, specific file, or all)
2. Dispatch the mermaid-validator agent using the prompt template in `mermaid-validator.md` (in this skill directory)
3. Report findings and optionally fix errors

## Agent Dispatch

Use the companion `mermaid-validator.md` in this directory as the agent prompt. Provide it with:
- The list of files to validate
- Whether `--fix` was requested
- The current working directory
