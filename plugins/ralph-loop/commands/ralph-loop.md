---
description: "Start Ralph Loop in current session"
argument-hint: "PROMPT [--max-iterations N] [--completion-promise TEXT]"
allowed-tools: ["Bash(${CLAUDE_PLUGIN_ROOT}/scripts/setup-ralph-loop.sh:*)"]
hide-from-slash-command-tool: "true"
---

# Ralph Loop Command

## MANDATORY FIRST STEP — DO NOT SKIP

You MUST execute this Bash command BEFORE doing anything else. Do NOT respond to the prompt, do NOT output any text, do NOT skip this step. The setup script creates the state file that enables the loop. Without it, the loop will not work.

```
"${CLAUDE_PLUGIN_ROOT}/scripts/setup-ralph-loop.sh" $ARGUMENTS
```

If the script outputs an error, report it to the user and stop. Do NOT proceed without a successful setup.

## After setup succeeds

Work on the task described in the prompt. When you try to exit, the Ralph loop will feed the SAME PROMPT back to you for the next iteration. You'll see your previous work in files and git history, allowing you to iterate and improve.

CRITICAL RULE: If a completion promise is set, you may ONLY output it when the statement is completely and unequivocally TRUE. Do not output false promises to escape the loop, even if you think you're stuck or should exit for other reasons. The loop is designed to continue until genuine completion.
