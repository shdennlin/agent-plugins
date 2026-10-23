# Project-rules Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/reviewer:spec` and `/reviewer:spec-dual` read harvested project rules from the same place `reviewer:init` writes them: the `rules:` section of `openspec/config.yaml` when that file exists, otherwise `.claude/reviewer/rules.yaml`.

**Architecture:** One zero-dependency script, `scripts/read-rules.cjs`, owns the detection rule and the YAML-subset parsing and prints a JSON object `{ proposal, specs, design, tasks }` (string arrays). The three prompt files (`commands/spec.md`, `commands/spec-dual.md`, `skills/spec-dual/SKILL.md`) stop describing file formats and simply run the script and forward its JSON. This follows the repo's "deterministic prep lives in scripts" rule and removes the hand-written YAML instructions added in 1.16.0.

**Tech Stack:** Node 22 CommonJS (`.cjs`, `'use strict'`, no npm deps, like `scripts/merge-findings.cjs`), `node --test`, markdown prompts.

**Spec:** No written spec; agreed in conversation on 2026-10-23. The "Design summary" below is the authority.

## Design summary

- Detection rule (same as `reviewer:init`, `skills/init/init-reviewer.md:19-26`): if `<git-root>/openspec/config.yaml` exists → read its top-level `rules:` section; else if `<git-root>/.claude/reviewer/rules.yaml` exists → read its top level; else → empty. (`log-findings.sh` keys on the `openspec/` directory; init keys on the config file. The reader follows init, because init is the writer: an `openspec/` directory with no `config.yaml` means init wrote the fallback file.)
- Output: `{ "source": "<relative path or null>", "proposal": [], "specs": [], "design": [], "tasks": [] }` on stdout, exit 0 in every non-error case (missing files are not errors). `--root <abs>` overrides git-root detection (tests). `--quiet` prints only the JSON (default already prints only JSON; `--quiet` reserved, no-op). Exit 2 with one stderr line only when a file exists but cannot be read.
- YAML subset accepted (what init writes): top-level keys `proposal`, `specs`, `design`, `tasks` (in `config.yaml` these sit under `rules:` indented by two spaces); each key holds a block sequence of `- "quoted"` or `- plain` items; comments (`#` outside quotes) and blank lines ignored; CRLF tolerated; keys outside the four are ignored; inside `config.yaml` the section ends at the next top-level (column-0) key. Items are trimmed; surrounding single or double quotes removed; `\"` inside double quotes unescaped. Nothing else (no flow sequences, no multi-line scalars, no anchors): a line that does not fit is skipped with a stderr warning, never a crash.
- Prompt wiring: `commands/spec.md` Step 4 runs the script and passes its JSON as `project_rules`; `agents/spec-orchestrator.md` input doc says `project_rules` is that JSON (its per-angle injection text is unchanged: scope→proposal, completeness→specs, design→design, tasks→tasks); `commands/spec-dual.md` and `skills/spec-dual/SKILL.md` Step 3c run the script and pass its JSON as `args.projectRules`, omitting the key when every array is empty. The workflow's `normalizeRules` already accepts this shape; no workflow change.
- Version bump to `1.17.0` in both manifests, last task.

## Global Constraints

- No npm dependencies anywhere in `plugins/reviewer`; CommonJS `.cjs`, `'use strict'`, exported functions for tests.
- Tests run with `node --test plugins/reviewer/tests/read-rules.test.cjs`; no Claude, no network.
- The workflow script `workflows/two-engine-spec-review.workflow.js` is not modified.
- Commit convention `<type>(reviewer): <description>`; versions `1.17.0` in `plugins/reviewer/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` in the same commit.

## Review Focus

1. `config.yaml` has a `rules:` section followed by another top-level key (e.g. `rules:` … then `project:`): parsing stops at the column-0 key and the later section is not swallowed. Test pinned in Task 1.
2. `openspec/` directory exists but `openspec/config.yaml` does not: the fallback file is read (init wrote there). Test pinned in Task 1.
3. A rule item contains a colon, a `#` inside quotes, or an escaped quote: kept verbatim after unquoting. Test pinned in Task 1.
4. `config.yaml` exists but has no `rules:` section, or `rules:` is empty: all arrays empty, `source` still names the file, exit 0. Test pinned in Task 1.
5. Unknown artifact key under `rules:` (e.g. `adr:`) and an unparseable line: ignored / warned on stderr, JSON still valid. Test pinned in Task 1.

---

### Task 1: `read-rules.cjs`

**Files:**
- Create: `plugins/reviewer/scripts/read-rules.cjs`
- Test: `plugins/reviewer/tests/read-rules.test.cjs`

**Interfaces:**
- Produces: `readRules(root: string) -> { source: string|null, proposal: string[], specs: string[], design: string[], tasks: string[] }` (exported); `parseRulesYaml(text: string, { nested: boolean }) -> { proposal, specs, design, tasks, warnings: string[] }` (exported; `nested: true` = look under a top-level `rules:` key, `false` = keys at top level); CLI `node read-rules.cjs [--root <abs>]` prints `JSON.stringify(readRules(root))` + newline; `require.main === module` guard.

- [ ] **Step 1: Write the failing tests**

```js
// node --test plugins/reviewer/tests/read-rules.test.cjs
const { readRules, parseRulesYaml } = require('../scripts/read-rules.cjs')
// helper mk(files) -> temp root dir with the given relative files written

test('config.yaml rules section wins when the file exists', () => {
  const root = mk({ 'openspec/config.yaml': 'name: x\nrules:\n  proposal:\n    - "P1"\n  design:\n    - D1\nproject:\n  owner: me\n', '.claude/reviewer/rules.yaml': 'proposal:\n  - "IGNORED"\n' })
  const r = readRules(root)
  assert.equal(r.source, 'openspec/config.yaml'); assert.deepEqual(r.proposal, ['P1']); assert.deepEqual(r.design, ['D1']); assert.deepEqual(r.specs, []); assert.deepEqual(r.tasks, [])
})
test('openspec dir without config.yaml falls back to rules.yaml', () => {
  const root = mk({ 'openspec/changes/.keep': '', '.claude/reviewer/rules.yaml': 'tasks:\n  - "T1"\n' })
  const r = readRules(root); assert.equal(r.source, '.claude/reviewer/rules.yaml'); assert.deepEqual(r.tasks, ['T1'])
})
test('neither file: empty shape, source null', () => { const r = readRules(mk({})); assert.equal(r.source, null); assert.deepEqual(r.proposal, []) })
test('rules section stops at the next top-level key', () => {
  const p = parseRulesYaml('rules:\n  specs:\n    - "S1"\nother:\n  specs:\n    - "NOT"\n', { nested: true }); assert.deepEqual(p.specs, ['S1'])
})
test('config.yaml without rules section → empty, source kept', () => {
  const root = mk({ 'openspec/config.yaml': 'name: x\n' }); const r = readRules(root); assert.equal(r.source, 'openspec/config.yaml'); assert.deepEqual(r.design, [])
})
test('items keep colons, hashes inside quotes, and escaped quotes', () => {
  const p = parseRulesYaml('design:\n  - "Rollback: name an owner # not a comment"\n  - "Say \\"why\\""\n  - plain item   # trailing comment\n', { nested: false })
  assert.deepEqual(p.design, ['Rollback: name an owner # not a comment', 'Say "why"', 'plain item'])
})
test('unknown keys ignored, odd lines warned, CRLF tolerated', () => {
  const p = parseRulesYaml('adr:\r\n  - "A"\r\nproposal:\r\n  - [flow, seq]\r\n  - "P1"\r\n', { nested: false })
  assert.deepEqual(p.proposal, ['P1']); assert.equal(p.warnings.length, 1); assert.match(p.warnings[0], /line 4/)
})
test('CLI prints JSON for --root', () => {
  const root = mk({ '.claude/reviewer/rules.yaml': 'specs:\n  - "S"\n' })
  const out = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' })
  assert.equal(out.status, 0); assert.deepEqual(JSON.parse(out.stdout).specs, ['S'])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test plugins/reviewer/tests/read-rules.test.cjs`
Expected: FAIL, `Cannot find module '../scripts/read-rules.cjs'`

- [ ] **Step 3: Implement `plugins/reviewer/scripts/read-rules.cjs`**

Line-based parser: track the current artifact key and the required indent (`nested` ⇒ keys at 2 spaces, items at 4; else keys at 0, items at 2). A column-0 key while `nested` ends the section. Item regex `^\s*-\s+(.*)$`; unquote with a small function (double quotes: strip, unescape `\"` and `\\`; single quotes: strip, `''`→`'`; plain: cut at ` #`, trim). `readRules(root)`: `root` defaults to `git rev-parse --show-toplevel` via `child_process.execFileSync`, falling back to `process.cwd()`; detection rule per Design summary; warnings go to stderr prefixed `read-rules:`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test plugins/reviewer/tests/read-rules.test.cjs`
Expected: PASS, 8 tests, no stray stdout

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/scripts/read-rules.cjs plugins/reviewer/tests/read-rules.test.cjs
git commit -m "feat(reviewer): add read-rules.cjs resolving harvested rules from config.yaml or rules.yaml"
```

---

### Task 2: Wire the three readers, docs, version

**Files:**
- Modify: `plugins/reviewer/commands/spec.md:130-134` (Step 4), `:159` (dispatch line `project_rules:`)
- Modify: `plugins/reviewer/agents/spec-orchestrator.md:33` (`project_rules` description)
- Modify: `plugins/reviewer/commands/spec-dual.md` Step 3c and `plugins/reviewer/skills/spec-dual/SKILL.md` Step 3c (identical text)
- Modify: `plugins/reviewer/README.md` (one sentence where rules are mentioned: both locations)
- Modify: `plugins/reviewer/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (`1.17.0`)

**Interfaces:**
- Consumes: `node ${CLAUDE_PLUGIN_ROOT}/scripts/read-rules.cjs` JSON from Task 1.

- [ ] **Step 1: Replace `commands/spec.md` Step 4**

"### Step 4: Read Project Rules — Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/read-rules.cjs"` from the git root. It prints one JSON object with `source` and the four artifact arrays, reading `openspec/config.yaml`'s `rules:` section when that file exists and `.claude/reviewer/rules.yaml` otherwise (the same place `reviewer:init` writes). Capture the JSON as `PROJECT_RULES`; if every array is empty, set `PROJECT_RULES` to empty." Dispatch line: `project_rules: <the JSON from Step 4, or empty>`. Orchestrator :33: "**project_rules**: JSON `{ source, proposal[], specs[], design[], tasks[] }` printed by `scripts/read-rules.cjs` (optional, may be empty)".

- [ ] **Step 2: Replace Step 3c in both spec-dual files with the same paragraph**

"### Step 3c: Load project rules — Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/read-rules.cjs"` from the git root; it resolves the rules file the same way `reviewer:init` writes it (`openspec/config.yaml` `rules:` section, else `.claude/reviewer/rules.yaml`) and prints `{ source, proposal, specs, design, tasks }`. Pass the object (minus `source`) as `args.projectRules`; omit the key when every array is empty. The Workflow injects …" (keep the existing second sentence about area mapping).

- [ ] **Step 3: README and version**

README: where it says rules come from `.claude/reviewer/rules.yaml`, say "from `openspec/config.yaml`'s `rules:` section in Spectra/OpenSpec repos, else `.claude/reviewer/rules.yaml`". Bump both manifests to `1.17.0`.

- [ ] **Step 4: Verify**

Run:
```bash
node --test plugins/reviewer/tests/read-rules.test.cjs plugins/reviewer/tests/schema.test.cjs plugins/reviewer/tests/server.test.cjs plugins/reviewer/tests/merge-findings.test.cjs \
&& node plugins/reviewer/tests/two-engine.harness.mjs && bash plugins/reviewer/tests/setup-result-review.test.sh && bash plugins/reviewer/tests/log-findings.test.sh && bash plugins/reviewer/tests/review-engines.test.sh \
&& claude plugin validate ./plugins/reviewer && diff <(sed -n '/### Step 3c/,/### Step 4/p' plugins/reviewer/commands/spec-dual.md) <(sed -n '/### Step 3c/,/### Step 4/p' plugins/reviewer/skills/spec-dual/SKILL.md) \
&& grep -n '"version"' plugins/reviewer/.claude-plugin/plugin.json && grep -n -A3 '"name": "reviewer"' .claude-plugin/marketplace.json | grep version
```
Expected: all tests pass (57 node tests + harness 24 + 3 shell ok), validate passes with only pre-existing notices, the `diff` prints nothing, both greps show `1.17.0`.

- [ ] **Step 5: Smoke the script against a real Spectra-shaped repo**

In a temp dir: `openspec/config.yaml` with a `rules:` section containing one `proposal` rule → `node read-rules.cjs --root <dir>` prints it with `source: "openspec/config.yaml"`; remove the file, add `.claude/reviewer/rules.yaml` → `source` switches. Paste both outputs into the commit message body or the ledger.

- [ ] **Step 6: Commit**

```bash
git add plugins/reviewer/commands/spec.md plugins/reviewer/agents/spec-orchestrator.md plugins/reviewer/commands/spec-dual.md plugins/reviewer/skills/spec-dual/SKILL.md plugins/reviewer/README.md plugins/reviewer/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "feat(reviewer): spec and spec-dual read harvested rules via read-rules.cjs (1.17.0)"
```
