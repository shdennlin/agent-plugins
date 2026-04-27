# project-notes

Capture project sessions to a structured journal using a 6-field daily template, then distill highlights to your permanent notes.

A lightweight alternative to writing long-form notes during work — fast capture, manual distillation later.

## Why this plugin

Your sessions touch decisions, surprises, snags, and topics you brushed against but didn't deep-dive. By the time you finish, most of it slips away. Git captures *what changed*; this plugin captures *what you decided and why, what surprised you, what you'd want to re-learn*.

The output is a per-project markdown file you append to over time. Highlights worth keeping long-term get marked with ⭐ and harvested to permanent notes (your vault, wiki, or whatever you use) on a slow cadence.

## What you get

- `/project-notes:log` — Insert a 6-field entry at top of `<Project Name>.md`
- `/project-notes:harvest` — Find ⭐ items across recent notes, group by theme, draft permanent notes
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

## Distillation workflow

Weekly ritual (~15 min). Run:

```bash
# List ⭐ items from last 7 days, grouped by emerging theme
/project-notes:harvest

# Generate draft files in _harvest/ for review
/project-notes:harvest --draft

# Wider window
/project-notes:harvest --since 14d

# Focus on one emerging theme
/project-notes:harvest --theme rmlint
```

`--draft` mode writes draft `.md` files to `$PROJECT_NOTES_DIR/_harvest/` — one per theme, with framing + source items. After review:

1. Open each `_harvest/<Title>.md`
2. Rewrite the framing in your own words (don't just copy)
3. Add cross-links to related notes
4. Move to your vault root or chosen folder
5. Delete the draft from `_harvest/`

Original ⭐ markers in `<Project>.md` stay in place — keep or remove manually as you process.

## File structure

```
$PROJECT_NOTES_DIR/
├── _template.md              # default template (auto-scaffolded)
├── Photo Organization.md     # active project
├── Homelab Infra.md          # active project
├── Adhoc 2026-04.md          # current month's catchall
├── Adhoc 2026-03.md          # last month
├── _harvest/                 # distillation drafts (ephemeral, manually moved to vault)
│   └── Backup Verification Invariants.md
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

### v0.1 ✅ — capture MVP

- `/project-notes:log` — insert 6-field entry at top of `<Project>.md`
- Auto-detect project from git basename, fuzzy-match existing files, or ask
- Stateless: env var only, no config file
- Auto-seeds `_template.md` on first use
- `-y` / `--yes` flag for auto-confirm
- Adhoc month catchall (`Adhoc YYYY-MM.md`) for short tasks

### v0.2 ✅ (current) — weekly distillation

- `/project-notes:harvest` — find ⭐ items in time window, group by emerging theme
- List mode: render markdown report grouped by theme
- `--draft` mode: write per-theme draft files to `_harvest/`
- `--since DURATION` (7d / 14d / 1m / all) and `--theme KEYWORD` filters
- Drafts include framing + source attribution + promotion checklist

### v0.3 ⏳ — lifecycle management

- `/project-notes:list` — overview of all project notes:
  - Active / paused / done split
  - Last entry date per project (flag stale `30d+`)
  - Adhoc month entry counts
  - Type tag rollup
- `/project-notes:archive [project]` — move done project to `_archive/`:
  - Update `status: done` in frontmatter
  - Move file to `_archive/` subfolder
  - `--all-stale 60d` batch mode
  - Reversible (just `mv` back to root)
- `/project-notes:promote [adhoc-entry]` (stretch goal):
  - Extract a specific entry from `Adhoc YYYY-MM.md`
  - Scaffold new `<Project>.md`
  - Move entry over, leave breadcrumb in original

**Why deferred from v0.2**: `ls` and `mv` cover the same workflow manually. List/archive are convenience, not necessity.

### v0.4 ⏳ — cross-tool compatibility

- Add `.codex/INSTALL.md` for OpenAI Codex / other agentic CLIs
- Mirror command behavior in Codex skills format
- Validate plugin works through Codex without Task tool dependency
- Document any Claude-Code-specific behavior in plugin README

**Why deferred**: focus on dogfooding the workflow first. Cross-tool support adds value once the design stabilizes.

### v0.5 ⏳ — quality-of-life additions

- `/project-notes:search KEYWORD` — full-text search across project notes (skip `_archive`)
- `/project-notes:stats` — project / entry / ⭐ counts, distillation rate, ritual cadence health
- `/project-notes:open [project]` — open file in user's default markdown editor
- Optional `Stop` hook: if user opted-in, gentle reminder at session end (`config flag`)

### v1.0 ⏳ — production-ready

- All commands stabilized through 1+ month of dogfood
- Comprehensive edge-case coverage (multi-day same-entry, frontmatter migration, etc.)
- Public marketplace listing
- Contributor guide for community templates / format extensions
- Migration path documented for users coming from journal / day-one / similar tools
- i18n consideration: confirm template + agent prompts work for non-English entries

### Out of scope (intentional)

These are **not** plugin goals:

- ❌ Auto-detection of session-end (manual trigger by design)
- ❌ Direct write to user's permanent vault (drafts go to `_harvest/`, user curates)
- ❌ Sync / backup / cloud storage (rely on user's existing setup: git, iCloud, Syncthing)
- ❌ GUI / dashboard (Obsidian / VS Code / any markdown editor handles browsing)
- ❌ AI-generated permanent notes without user review (distillation is a thinking ritual, not automation)

## Author

**shdennlin** — [GitHub](https://github.com/shdennlin)

## License

MIT — see [LICENSE](../../LICENSE).
