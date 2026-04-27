# project-notes

Capture project sessions to a structured journal using a 6-field daily template, then distill highlights to your permanent notes.

A lightweight alternative to writing long-form notes during work — fast capture, manual distillation later.

## Why this plugin

Your sessions touch decisions, surprises, snags, and topics you brushed against but didn't deep-dive. By the time you finish, most of it slips away. Git captures *what changed*; this plugin captures *what you decided and why, what surprised you, what you'd want to re-learn*.

The output is a per-project markdown file you append to over time. Highlights worth keeping long-term get marked with ⭐ and harvested to permanent notes (your vault, wiki, or whatever you use) on a slow cadence.

## What you get

- `/project-notes:log` — Append a 6-field entry to the relevant `<Project Name>.md`
- Auto-detects project from git repo basename, or asks you
- Stateless: no config files, just one env var

## Setup

### 1. Install the plugin

```bash
/plugin marketplace add shdennlin/agent-plugins
/plugin install project-notes@shdennlin-plugins
```

### 2. Choose where notes live

Pick a directory where your project notes will accumulate. Common choices:

- Inside an Obsidian vault (recommended if you already use one — wikilinks to permanent notes work)
- A standalone directory like `~/Documents/project-notes`
- A separate git repo for portability across machines

### 3. Set the env var

Add to your shell rc (`~/.zshrc`, `~/.bashrc`, etc.):

```bash
export PROJECT_NOTES_DIR="$HOME/Documents/project-notes"
```

Reload the shell:

```bash
source ~/.zshrc   # or your equivalent
```

Verify:

```bash
echo $PROJECT_NOTES_DIR
```

### 4. Initialize the directory

```bash
mkdir -p "$PROJECT_NOTES_DIR"
```

The plugin will scaffold `_template.md` automatically on first use, or you can pre-populate it from `templates/project-template.md` in this plugin.

### 5. (Optional) override defaults

```bash
# Use a custom template file (default: $PROJECT_NOTES_DIR/_template.md, falls back to plugin default)
export PROJECT_NOTES_TEMPLATE="$HOME/dotfiles/project-template.md"

# Adhoc filename pattern (default: "Adhoc {YYYY}-{MM}.md")
export PROJECT_NOTES_ADHOC_PATTERN="Adhoc {YYYY}-{MM}.md"

# Title-case auto-detected filenames (default: 1)
# Set to 0 to keep raw git basename (e.g., "my-repo.md" instead of "My Repo.md")
export PROJECT_NOTES_TITLE_CASE=1
```

## Usage

### Log the current session

```bash
# Auto-detect project from git repo / cwd
/project-notes:log

# Explicit project name (skips detection — useful for non-code projects)
/project-notes:log "Photo Organization"

# Auto-confirm (show draft, write without asking)
/project-notes:log "Photo Organization" -y

# Short ad-hoc task → log to monthly catchall file
/project-notes:log --adhoc

# Help
/project-notes:log --help
```

### What happens

1. Plugin reads `$PROJECT_NOTES_DIR` (fails loudly if unset)
2. Auto-seeds `$PROJECT_NOTES_DIR/_template.md` from plugin default if missing (first use)
3. Detects project from git repo basename, fuzzy-matches existing files, or asks you
4. Drafts a 6-field entry from the session context
5. Shows the draft, asks for confirmation (skipped with `-y`)
6. **Inserts at top of `## Sessions`** (newest first) and bumps `updated:` frontmatter
7. Reports which file was updated and how many ⭐ items were flagged

## Entry format

```markdown
### 2026-04-27 Mon

**Focus**: Migrate Google Takeout into NAS via 3-phase rsync

**Decisions**
- Chose by-source structure (`google/<account>/`) over flat year/month — preserves attribution + reversible

**Snags**
- ⭐ rmlint --match-basename is hash-of filter, not hash replacement (always run --help first)
- ⭐ du shows hardlinked file size only against first directory walked (use df for backup totals)

**Touched**
- Immich External library Trash workflow
- ext4 inode density with -T largefile

**Re-learn**
- Postgres advisory locks isolation behavior

**Next**
- Trigger Immich library scan + observe Duplicate Detection results
```

Format rules:
- **Focus** is always inline single-line
- All other fields use a bold header followed by bullet list (allows 0-N items)
- Empty fields are **omitted entirely** (no `(none)` placeholders)
- Newest entry inserted at **top** of `## Sessions`
- ⭐ marks items worth promoting to permanent notes later

## Main project vs adhoc — quick rule

**Main project file (`<Name>.md`)** when:
- Will likely span 3+ sessions
- Has identifiable goal / theme
- Want to track decisions / learnings over weeks or months

**Adhoc (`Adhoc YYYY-MM.md`)** when:
- One-off spike / debug / lookup / research
- Quick decision with no follow-up expected
- Unsure if it'll grow → start here, promote later if it does

When in doubt: adhoc. Promotion is easy; splitting too late is annoying.

## Triage rules (what NOT to log)

Before writing an item, ask:
1. "Will I naturally remember this in 3 months?" → Skip
2. "Is this visible in git commit / PR description?" → Skip
3. "Could this teach future-me something?" → Capture

Avoid:
- ❌ "Ran tests, passed" — git captures
- ❌ Code snippets — code itself is documentation
- ❌ Detailed technical playbooks — use `Re-learn if needed` topic instead
- ❌ Routine work (lint / format / restart) — pure noise

## Distillation workflow (out of scope for plugin v0.1)

Weekly or monthly:
1. Open `$PROJECT_NOTES_DIR` and grep for `⭐`
2. For each starred item still relevant in 6 months, write a topic-organized permanent note
3. Original entry stays in `<Project Name>.md` as timeline reference

Future plugin versions may add `/project-notes:harvest` to surface ⭐ candidates and draft permanent notes automatically.

## File structure

```
$PROJECT_NOTES_DIR/
├── _template.md              # default template (auto-scaffolded)
├── Photo Organization.md     # active project
├── Homelab Infra.md          # active project
├── Adhoc 2026-04.md          # current month's catchall
├── Adhoc 2026-03.md          # last month
└── _archive/                 # finished projects + old adhoc files
    └── Old Project.md
```

## Constraints / philosophy

- **Stateless plugin**: No config files, just env vars. Cross-machine setup is `export ...` per machine.
- **One-line items**: Each bullet is one line. If it needs more, mark ⭐ and promote to permanent notes.
- **Topic-only `Re-learn if needed`**: Never transcribe technical detail. Re-learn from primary sources when needed.
- **Manual trigger only (v0.1)**: No auto-detection of session-end. You decide when to log.
- **No deletion**: Plugin only appends and edits frontmatter. Never deletes content.

## Roadmap

- v0.1 (current): `/project-notes:log` MVP
- v0.2: `/project-notes:list`, `/project-notes:archive` for project lifecycle
- v0.3: `/project-notes:harvest` for distillation candidate review
- v0.4: Codex `INSTALL.md` for cross-tool support
- v1.0: Production-ready, Marketplace-listed

## Author

**shdennlin** — [GitHub](https://github.com/shdennlin)

## License

MIT — see [LICENSE](../../LICENSE).
