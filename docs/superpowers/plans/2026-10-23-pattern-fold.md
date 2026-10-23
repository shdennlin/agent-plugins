# Pattern Fold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One merged issue per defect: issues that point at the same construct (same `pattern`) fold into one, whether they sit at the same location with different titles or in different files, keeping the worst-severity entry's text and listing the other angles' wording in a new `rationale` field; and angle prompts ask for `pattern` as the smallest construct, not the whole line, so the cross-file sweep can match.

**Architecture:** `scripts/merge-findings.cjs` replaces its title-bound `foldSameConstruct` with a pattern-bound fold run after the per-location dedup and the sweep: group by trimmed `pattern` (issues without a pattern never fold), pick the worst-severity member (then lowest location) as the surviving entry, union `locations` (existing `unionLocations`), union `angles`, union `recommendation` lines, and write `rationale` = the other members' titles with their angles. The three prompt sources that describe `pattern` get the same new sentence. The recall harness measures the effect.

**Tech Stack:** Node 22 CommonJS (no deps), `node --test`, markdown prompts, the recall harness (`tests/recall/run.mjs`).

**Spec:** No written spec; agreed in conversation on 2026-10-23 (user: keep the worst-severity title, other angles' wording into rationale; fold on same location + same pattern; prompt asks for the minimal construct). The "Design summary" below is the authority.

## Design summary

- **Fold key** = `pattern.trim()` (case-sensitive, after the existing location+title dedup and after the sweep has filled `locations`). Issues with no pattern (or whitespace) never fold and keep today's behaviour. Same location or different files makes no difference: same construct → one issue.
- **Survivor** = worst severity, ties broken by lowest `location` string (reuse `byWorst`). The survivor keeps `severity`, `title`, `location`, `category`, `pattern`, `expected`, `actual`, `impact`.
- **`rationale`** (new string field, present only when a fold happened): one line per folded member in `byWorst` order, `"<title>" (<angle list>)`, joined with `\n`. Members whose normalized title equals the survivor's are not repeated.
- **`recommendation`** = survivor's lines first, then each member's lines not already present (exact string match after trim), joined with `\n`.
- **`locations`** = `unionLocations([survivor.locations, ...members.locations])` (path-part dedup, `file:function` wins). **`angles`** = sorted union. **`folded`** (new integer) = number of members merged into the survivor, 0 when none; `counts`, `verdict`, per-file `issue_count` are unchanged (per-file counts stay per angle report).
- The old equal-title cross-file rule is subsumed (equal title implies the same pattern in practice); remove it.
- **Prompt sentence** (replaces every current `pattern` sentence, same text in `templates/review-angles.yaml` ×3 result angles, `agents/result-fix-orchestrator.md`, `skills/result/result-reviewer.md`): "For every issue, set `pattern` to the smallest literal substring that identifies the construct, typically the call, operator or expression at fault (e.g. `int(`, `size - 1`, `.strip()`), never the whole line, and no regex; the merge step treats every issue with the same `pattern` as the same defect and joins their locations." The orchestrator's Step 3 fold text is updated to say the script now folds by pattern across titles and files, so the LLM fold is left with pattern-less duplicates only.
- Logging: `rationale` and `folded` are not added to `history.jsonl` rows (log-findings' key set is unchanged; `locations` already carries the union).
- Version `1.18.0` in both manifests.

## Global Constraints

- No npm dependencies; CommonJS; tests via `node --test plugins/reviewer/tests/merge-findings.test.cjs`; `plugins/reviewer/tests/fixtures/run-basic/` may gain fixture issues but existing assertions keep passing unchanged unless a test's expectation is now wrong by design (then the plan names it).
- `scripts/log-findings.sh`, the MCP schema (`mcp/schema.cjs`) and the tool contract are not modified.
- Commit convention `<type>(reviewer): <description>`; versions `1.18.0` in `plugins/reviewer/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` in the same commit.

## Review Focus

1. Same location, same pattern, different severities and titles (the paginate triple from the baseline): one issue, HIGH, the other two titles in `rationale` with their angles, `folded: 2`. Test pinned in Task 1.
2. Same pattern in two files with different titles (`int(` at `parse.py:parse_amount` and `importer.py:parse_row`): one issue whose `locations` holds both `file:function` entries, not a bare swept path. Test pinned in Task 1.
3. Same location, different patterns (`return int(s)` HIGH vs `start = ...` MEDIUM): stay two issues. Test pinned in Task 1.
4. Pattern present on one member and absent on another at the same location+title: stage-1 dedup already merged them and `patterns.find(hasPattern)` kept the pattern; the fold must not create a second entry. Test pinned in Task 1.
5. A very short pattern (`(` or `=`) would fold unrelated issues: patterns shorter than 3 non-space characters are treated as absent, with a `log`-free silent skip (the script has no logger) and a note in the prompt sentence's "smallest … that identifies the construct". Test pinned in Task 1.

---

### Task 1: Pattern fold in `merge-findings.cjs`

**Files:**
- Modify: `plugins/reviewer/scripts/merge-findings.cjs:63-90` (`foldSameConstruct` → `foldByPattern`), `:211-236` (call site, issue shape gains `rationale`/`folded`), header comment `:8-9`
- Test: `plugins/reviewer/tests/merge-findings.test.cjs`

**Interfaces:**
- Produces: `foldByPattern(issues) -> issues` exported alongside `merge` (for direct unit tests); merged issue fields `rationale?: string`, `folded: number`; `MIN_PATTERN = 3`.

- [ ] **Step 1: Write the failing tests**

```js
const { merge, foldByPattern } = require('../scripts/merge-findings.cjs')
const I = (sev, title, location, pattern, extra = {}) => ({ severity: sev, title, location, locations: [location], category: 'c', pattern, expected: 'e', actual: 'a', impact: 'i', recommendation: `fix ${title}`, angles: ['x'], ...extra })

test('same location + same pattern folds to the worst, other titles into rationale', () => {
  const out = foldByPattern([
    I('MEDIUM', 'page() returns size-1 items (off-by-one slice end)', 'src/paginate.py:page', 'size - 1', { angles: ['coverage'] }),
    I('HIGH', 'Off-by-one: page returns size-1 items', 'src/paginate.py:page', 'size - 1', { angles: ['correctness'] }),
    I('HIGH', 'page returns size-1 items (off-by-one)', 'src/paginate.py:page', 'size - 1', { angles: ['robustness'] }),
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].severity, 'HIGH'); assert.equal(out[0].title, 'Off-by-one: page returns size-1 items')
  assert.equal(out[0].folded, 2)
  assert.equal(out[0].rationale, '"page returns size-1 items (off-by-one)" (robustness)\n"page() returns size-1 items (off-by-one slice end)" (coverage)')
  assert.deepEqual(out[0].angles, ['correctness', 'coverage', 'robustness'])
  assert.equal(out[0].recommendation.split('\n').length, 3)
})
test('same pattern in two files with different titles joins locations with file:function entries', () => {
  const out = foldByPattern([
    I('HIGH', 'parse_amount(None) raises TypeError', 'src/parse.py:parse_amount', 'int(', { locations: ['src/parse.py:parse_amount', 'src/importer.py'] }),
    I('HIGH', 'parse_row bypasses R1 rules', 'src/importer.py:parse_row', 'int(', { locations: ['src/importer.py:parse_row', 'src/parse.py'] }),
  ])
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].locations, ['src/parse.py:parse_amount', 'src/importer.py:parse_row'])
})
test('same location with different patterns stays separate', () => {
  const out = foldByPattern([I('HIGH', 'a', 'src/parse.py:parse_amount', 'return int(s)'), I('MEDIUM', 'b', 'src/parse.py:parse_amount', 'isinstance(')])
  assert.equal(out.length, 2)
})
test('issues without a pattern or with a pattern under 3 chars never fold', () => {
  const out = foldByPattern([I('HIGH', 'a', 'x.py:f', undefined), I('HIGH', 'b', 'x.py:f', undefined), I('LOW', 'c', 'y.py:g', '('), I('LOW', 'd', 'z.py:h', '(')])
  assert.equal(out.length, 4); assert.ok(out.every(i => i.folded === 0 && i.rationale === undefined))
})
test('identical titles are not repeated in rationale', () => {
  const out = foldByPattern([I('HIGH', 'Same', 'a.py:f', 'int('), I('LOW', 'same', 'b.py:g', 'int(')])
  assert.equal(out[0].rationale, undefined); assert.equal(out[0].folded, 1)
})
test('end to end: run-basic merge still yields one a.py:parse issue and the sweep still fills locations', () => {
  const m = merge(run.manifest, run.reports, run.diff)   // existing fixture loader
  const hit = m.issues.filter(i => i.location === 'src/a.py:parse')
  assert.equal(hit.length, 1); assert.deepEqual(hit[0].locations, ['src/a.py:parse', 'src/b.py'])
  assert.ok(m.issues.every(i => typeof i.folded === 'number'))
})
```
Update the two existing fold tests ("fold same construct", "fold requires equal pattern and title") to the new rule: equal pattern alone folds; equal title alone does not.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/reviewer/tests/merge-findings.test.cjs`
Expected: FAIL, `foldByPattern is not a function` and the updated fold expectations

- [ ] **Step 3: Implement `foldByPattern`**

Replace `foldSameConstruct`: key = `pattern.trim()` when `pattern.trim().length >= MIN_PATTERN`, else no group; preserve first-seen order of groups; per group sort by `byWorst`, survivor = first; build `rationale` from the rest (skip equal `normTitle`), `recommendation` union, `locations` via `unionLocations`, `angles` union, `folded` = rest.length. Singletons and pattern-less issues get `folded: 0`. Export it. Update the header comment (`:8-9`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/reviewer/tests/merge-findings.test.cjs`
Expected: PASS (existing count + 6 new − 0 removed; the two rewritten tests count as existing)

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/scripts/merge-findings.cjs plugins/reviewer/tests/merge-findings.test.cjs
git commit -m "feat(reviewer): fold merged issues by pattern across titles and files, keeping the worst entry and listing the rest in rationale"
```

---

### Task 2: Prompt sentence, orchestrator fold text, rendering, version, measurement

**Files:**
- Modify: `plugins/reviewer/templates/review-angles.yaml:121,130,139`
- Modify: `plugins/reviewer/agents/result-fix-orchestrator.md:121-128` (sub-agent `pattern` bullet), `:174` (Step 3 fold item), the section-D render bullet (add: show `rationale` as an indented "also reported as" line when present)
- Modify: `plugins/reviewer/skills/result/result-reviewer.md:98` and its section-D format (same rationale line)
- Modify: `plugins/reviewer/README.md` (one sentence in the structured-pipeline paragraph), `plugins/reviewer/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (`1.18.0`)

**Interfaces:**
- Consumes: merged issue fields `rationale`, `folded` from Task 1.

- [ ] **Step 1: Replace the five `pattern` sentences with the Design-summary sentence**

Exact same text in all five places; in the orchestrator keep the bullet shape (`- **pattern** (optional): …`).

- [ ] **Step 2: Update the orchestrator Step 3 fold item and the D render**

Step 3 item 1 now reads: "**Semantic fold** — the script already folds every issue that shares a `pattern` (across titles and files) and lists the other angles' wording in `rationale`. Only pattern-less issues that describe the same defect are left for you: merge them the same way (worst severity, union `locations`, note the fold). Folds are report-only." D render: after each issue's `locations` line, when `rationale` is present print `also reported as:` followed by its lines indented.

- [ ] **Step 3: README and version**

README: add "issues that share a `pattern` fold into one entry whose `rationale` lists the other angles' wording" to the pipeline paragraph. Bump both manifests to `1.18.0`.

- [ ] **Step 4: Verify**

Run:
```bash
node --test plugins/reviewer/tests/*.test.cjs plugins/reviewer/tests/recall/*.test.cjs && node plugins/reviewer/tests/two-engine.harness.mjs && bash plugins/reviewer/tests/setup-result-review.test.sh && bash plugins/reviewer/tests/log-findings.test.sh && bash plugins/reviewer/tests/review-engines.test.sh && claude plugin validate ./plugins/reviewer && grep -c "smallest literal substring" plugins/reviewer/templates/review-angles.yaml plugins/reviewer/agents/result-fix-orchestrator.md plugins/reviewer/skills/result/result-reviewer.md
```
Expected: all tests pass, harness exit 0, validate passes with only the pre-existing notices, grep shows 3 / 1 / 1.

- [ ] **Step 5: Measure with the recall harness**

Run: `node plugins/reviewer/tests/recall/run.mjs --runs 3 --model sonnet --out <scratchpad>/recall-fold`
Expected (hypothesis, not a gate): `crossfile-cast` moves from 0/3 hit to ≥ 2/3; `issues per hit` on the three single-file seeds drops from 2–3.3 toward 1.0–1.5; recall on those three stays 3/3. Paste the per-seed table next to the 0.75 baseline into the commit body. If `crossfile-cast` stays partial, inspect the three `run-N-merged.json` for the `pattern` values the agents chose and record them in the ledger; a prompt that still yields whole lines is a finding for the orchestrator wording, not for the fold.

- [ ] **Step 6: Commit**

```bash
git add plugins/reviewer/templates/review-angles.yaml plugins/reviewer/agents/result-fix-orchestrator.md plugins/reviewer/skills/result/result-reviewer.md plugins/reviewer/README.md plugins/reviewer/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "feat(reviewer): ask angles for the minimal construct as pattern; render fold rationale (1.18.0)"
```
