---
name: digest:release
description: "Generate release notes from a commit range with developer and user-facing formats. Use when creating changelogs, release notes, or summarizing changes between tags."
---

# Release

Generate structured release notes from a range of commits, with developer-facing changelogs and user-facing narratives.

## Usage

```
$release                              # latest tag to HEAD, both formats
$release v1.0.0                       # v1.0.0 to HEAD
$release v1.0.0 v2.0.0               # between two tags
$release --dev                        # developer changelog only
$release --user                       # user narrative only
$release --write                      # append to CHANGELOG.md
$release --out docs/release.md        # write to custom file
```

## Options

| Flag | Description |
|------|-------------|
| `--dev` | Developer-facing changelog grouped by type |
| `--user` | User-facing plain language narrative |
| `--write` | Append to CHANGELOG.md |
| `--out <file>` | Write to custom file path |

## Process

1. Resolve tag range from arguments
2. Dispatch the release agent using the prompt template in `release-agent.md` (in this skill directory)
3. Gather and classify commits by conventional type
4. Report developer changelog, user narrative, or both

## Agent Dispatch

Use the companion `release-agent.md` in this directory as the agent prompt. Provide it with:
- From and to refs
- Format (dev, user, or both)
- Write and output file options

The agent uses `$PROJECT_ROOT` (set by the init hook) or falls back to `git rev-parse --show-toplevel`.
