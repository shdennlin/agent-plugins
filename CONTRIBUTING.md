# Contributing to Agent Plugins

Thank you for your interest in contributing! This document provides guidelines for contributing to this plugin collection.

## Getting Started

1. **Fork** this repository
2. **Clone** your fork locally
3. **Create a branch** for your contribution

```bash
git clone https://github.com/YOUR_USERNAME/agent-plugins.git
cd agent-plugins
git checkout -b feature/your-plugin-name
```

## Adding a New Plugin

### 1. Create Plugin Structure

```bash
mkdir -p plugins/your-plugin/.claude-plugin
mkdir -p plugins/your-plugin/hooks      # if using hooks
mkdir -p plugins/your-plugin/commands   # if using commands
mkdir -p plugins/your-plugin/scripts    # if using scripts
```

### 2. Required Files

**`.claude-plugin/plugin.json`** (required):
```json
{
  "name": "your-plugin-name",
  "version": "1.0.0",
  "description": "Brief description of what your plugin does",
  "author": {
    "name": "Your Name"
  },
  "keywords": ["relevant", "keywords"]
}
```

**`README.md`** (required):
- Description of what the plugin does
- Prerequisites and installation
- Usage examples
- Configuration options (if any)

### 3. Hook Configuration (if applicable)

**`hooks/hooks.json`**:
```json
{
  "description": "What your hooks do",
  "hooks": {
    "Stop": [...],
    "PreToolUse": [...],
    "PostToolUse": [...]
  }
}
```

### 4. Register in Marketplace

Add your plugin to `.claude-plugin/marketplace.json`:

```json
{
  "name": "your-plugin-name",
  "source": "./plugins/your-plugin",
  "description": "Brief description",
  "version": "1.0.0",
  "author": {
    "name": "Your Name"
  },
  "keywords": ["relevant", "keywords"],
  "category": "your-category"
}
```

### 5. Update Root README

Add your plugin to the catalog table in the root `README.md`.

## Code Guidelines

### Shell Scripts

- Use `#!/bin/bash` shebang
- Include `set -uo pipefail` for safety
- Use `${CLAUDE_PLUGIN_ROOT}` for plugin-relative paths
- Use `${CLAUDE_PROJECT_DIR}` for project directory
- Always exit 0 for non-blocking hooks
- Clean up temp files using `trap`

### JSON Files

- Use 2-space indentation
- Validate JSON before committing
- Include descriptive `description` fields

### Documentation

- Write clear, concise README files
- Include prerequisites with install commands
- Provide usage examples
- Document any configuration options

## Testing Your Plugin

```bash
# Test with debug mode
claude --debug --plugin-dir ./plugins/your-plugin

# Verify hook registration in debug output
# Test with real scenarios
```

## Submitting a Pull Request

1. **Test** your plugin thoroughly
2. **Validate** all JSON files
3. **Update** `.claude-plugin/marketplace.json`
4. **Update** the root README catalog
5. **Commit** with a clear message:
   ```bash
   git commit -m "Add your-plugin: brief description"
   ```
6. **Push** to your fork
7. **Create** a pull request with:
   - Description of the plugin
   - Prerequisites
   - Testing instructions

## Questions?

Open an issue for questions or suggestions.
