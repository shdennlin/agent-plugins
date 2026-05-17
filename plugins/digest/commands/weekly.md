---
allowed-tools:
  - Bash(${CLAUDE_PLUGIN_ROOT}/scripts/setup-weekly.sh:*)
  - Task
description: Summarize git activity across multiple projects over a time window into themed recall notes
argument-hint: "[date-range] [--projects <list>] [--config <path>] [--author <email>] [--brief] [--detail] [--write] [--out <file>] [--help/-h]"
---

# Weekly Digest Command

Scan git activity across multiple projects over a time window and synthesize a themed recall report — what you actually worked on, fixed, refactored, and explored.

## MANDATORY FIRST STEP — DO NOT SKIP

You MUST execute this Bash command BEFORE doing anything else. The setup script parses arguments, resolves project list, validates output destination, and returns a JSON config for the agent.

```
"${CLAUDE_PLUGIN_ROOT}/scripts/setup-weekly.sh" $ARGUMENTS
```

**If the script exits non-zero**, report its stderr output to the user verbatim and stop. Do NOT proceed to dispatch the agent.

**If `--help` or `-h` was in arguments**, the script prints help to stdout and exits 0. Show that output to the user and stop.

## After setup succeeds

The script's stdout is a JSON object like:

```json
{
  "date_range": "last week",
  "projects": [{"path":"/Users/me/repo-a","name":"repo-a"}],
  "author": "me@example.com",
  "brief": false,
  "detail": false,
  "write": true,
  "out_path": "",
  "target_dir": "/Users/me/vault/Weekly"
}
```

Dispatch the weekly-agent with these resolved values:

```
Task tool:
- subagent_type: "digest:weekly-agent"
- description: "Synthesize multi-project weekly git digest"
- prompt: |
    Synthesize a themed weekly digest. The setup script has already
    resolved arguments, project paths, and output destination — your
    job is the LLM judgment work (clustering, theming, synthesis).

    Config (from setup-weekly.sh):
    <paste the JSON output from setup-weekly.sh here>

    Notes:
    - target_dir is already validated and writable; just write to it
      if write=true or out_path is set
    - Project paths are absolute; cd into each before running git log
    - If a project path is not a git repo, skip it gracefully and note
      at the end
```

Report the agent's output back to the user.
