---
project:
type:
status: active
created:
updated:
---

# <Project Name>

**One-line context**: <stack / motivation / key person or goal>

---

## Sessions

### YYYY-MM-DD Day

**Focus**: <one line summarizing this session's main thread>

**Decisions**
- <non-obvious choice + why>

**Snags**
- <expected vs actual mismatch, gotchas, Claude / tool misadvice>

**Touched**
- <concept / tool encountered but not deep-dived>

**Re-learn**
- <topic name only, no content>

**Next**
- <thread not closed in this session>

---

## How to use this file

> Append new `### YYYY-MM-DD Day` block per session at the **top** of `## Sessions` (newest first). Skip empty fields entirely.

### Triage rules

Before writing each item, ask:
1. "Will I remember this naturally in 3 months?" → skip
2. "Visible in git commit / PR description?" → skip
3. "Could teach future-me something?" → capture

### Field semantics

- **Focus** (always inline, single line): This session's main thread
- **Decisions**: Non-obvious choices + **why** (3 months later you'll forget the reasoning)
- **Snags**: Expected vs actual mismatch, gotchas, Claude / tool misadvice
- **Touched**: Concepts / tools encountered but not deep-dived (navigation hint, not content)
- **Re-learn**: Topic name only, no content (Google / re-learn from source later)
- **Next**: Threads not closed in this session, what to resume

### ⭐ marker

Items worth remembering 6+ months get a `⭐` prefix:

```markdown
**Snags**
- ⭐ Byte hash dedup fails on EXIF-rewritten sources (broad lesson)
- Tmux session name typo, redid (trivial)
```

Weekly / monthly review: harvest ⭐ items into permanent notes (topic-organized).

### Do NOT capture

- ❌ "Ran tests, passed" — git captures this
- ❌ Code snippets — code itself is the documentation
- ❌ Detailed technical playbooks — leave a `Re-learn` topic instead
- ❌ Routine work (lint / formatting / service restart) — pure noise

### Main project vs adhoc — quick rule

**Main project file (`<Name>.md`)** when:
- Will likely span 3+ sessions
- Has identifiable goal / theme
- Want to track decisions / learnings over weeks or months

**Adhoc (`Adhoc YYYY-MM.md`)** when:
- One-off spike / debug / lookup / research
- Quick decision with no follow-up expected
- Unsure if it'll grow → start here, promote later if it does

When in doubt: adhoc. Promotion is easy; splitting too late is annoying.

### Type field

Free-form, used as tag (not enum):

```yaml
type: work                  # plain work project
type: [hobby, learning]     # both hobby and learning (e.g. homelab)
type: life                  # life decision / discussion
type: health                # health-related tracking
type: adhoc                 # for Adhoc YYYY-MM.md only
```

### Status field

- `active` — currently in progress
- `paused` — paused but will return
- `done` — completed (whole file can move to `_archive/`)
