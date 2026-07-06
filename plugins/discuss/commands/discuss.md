---
description: Frame a feature, bug, or design question before building — assumptions-first discussion that converges on a decision
argument-hint: "[topic] [--help/-h]"
---

# Discuss Command

## Arguments

Parse `$ARGUMENTS`:

- `--help` or `-h` — Show usage information and exit
- Everything else — the topic to discuss (a design question, a problem statement, a vague idea)

### Help Output

If `--help` or `-h` is present, display this and stop:

```
Usage: /discuss:discuss [topic]

Frame a feature, bug, or design question before building: scout the codebase, surface
assumptions or interview, compare options, and converge on an explicit decision.

Examples:
  /discuss:discuss should we cache this at the edge or origin?
  /discuss:discuss
```

## Instructions

If help was requested, stop here. Otherwise, invoke the `discuss` skill with the topic
from `$ARGUMENTS` (or, if empty, no topic — the skill will ask what to discuss) and
follow it exactly.
