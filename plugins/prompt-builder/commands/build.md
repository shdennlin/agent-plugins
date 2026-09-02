---
description: Build a paste-ready prompt — extract from conversation context, decompose multi-task requests, and emit a self-contained prompt that survives a rewind
argument-hint: "[topic | draft prompt] [--help/-h]"
---

# Build Command

## Arguments

Parse `$ARGUMENTS`:

- `--help` or `-h` — Show usage information and exit
- Everything else — the input: a topic, a messy multi-task request, or an existing draft prompt to strengthen

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /prompt-builder:build [topic | draft prompt]

Build a polished, self-contained prompt from messy input. Three modes, auto-detected:
  context extract — mid-session with history: mine the conversation for the components
  interview       — cold start with a topic: ask only the questions that matter
  critique        — input is an existing prompt draft: diagnose and strengthen it

The finished prompt is printed as one copyable block and placed on the clipboard,
ready to paste after a rewind.

Examples:
  /prompt-builder:build fix the flaky auth test and write a migration note
  /prompt-builder:build            (uses the current conversation as source material)
  /prompt-builder:build <paste an existing prompt draft to critique>
```

## Instructions

If help was requested, stop here. Otherwise, invoke the `prompt-builder` skill with
`$ARGUMENTS` as the input (empty input is fine — the skill will draw on the
conversation or ask) and follow it exactly.
