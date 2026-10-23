# Seeded Recall Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure how often `/reviewer:result` finds bugs we planted: build a scratch repo with four known defects, run the review headlessly N times, score each run's `merged.json` against the seed list, and print recall per seed and per run.

**Architecture:** Everything lives under `plugins/reviewer/tests/recall/` and never ships in the plugin runtime. Three pure-code pieces are unit-tested without Claude: a fixture builder that materialises the scratch git repo (base commit + feature commit with the seeded bugs), a seed list with deterministic match rules, and a scorer that reads a `merged.json` and reports hit / miss / extra. One runner script glues them to `claude -p` and aggregates N runs into a table and a `summary.json`; it has a `--dry-run` mode that scores an existing `merged.json` so its aggregation is testable too. The harness is a measurement, not a gate: it exits 0 unless `--min-recall` is given.

**Tech Stack:** Node 22 CommonJS for the testable modules (`.cjs`, `'use strict'`, no npm deps), one `.mjs` runner (same style as `tests/two-engine.harness.mjs`), `node --test`, `claude -p` headless.

**Spec:** No written spec; agreed in conversation on 2026-10-23. The "Design summary" below is the authority.

## Design summary

- **Scratch repo** (built by code, not stored as files): Python, four source files plus `docs/spec.md`. Base commit = correct-looking stubs; feature commit = the implementation with the seeds. The reviewer runs with `--base main`, so the seeds are all inside `main...HEAD`.
- **Seeds** (`seeds.json`, the oracle), each `{ id, kind, file, function, pattern, titleHints[], crossFile? }`:
  1. `type-none` — `src/parse.py:parse_amount` calls `int(s)` on a value the spec says may be `None` → `TypeError` instead of the spec's `ValueError`. kind `type`.
  2. `boundary-slice` — `src/paginate.py:page` returns `items[start:start + size - 1]`, one short of `size`; the spec says a page holds exactly `size` items. kind `boundary`.
  3. `dataflow-stale` — `src/report.py:build_report` computes `total = sum(filtered)` but writes `sum(items)` (the unfiltered list) into the result, so the exclusion the spec mandates never reaches the output. kind `dataflow`.
  4. `crossfile-cast` — the same unchecked `int(raw)` cast appears in `src/parse.py:parse_amount` AND `src/importer.py:parse_row`; the spec requires rejecting non-numeric input in both. kind `crossfile`; `crossFile: ["src/parse.py", "src/importer.py"]`. This seed measures the sweep/fold, not just detection.
- **Match rule** (pure code, `score.cjs`): an issue hits a seed when at least one of the issue's `locations` (fallback: `location`) has path part equal to the seed's `file` AND (the location names the seed's `function` OR the function is absent from the location AND the issue's `title`+`expected`+`actual` text matches any `titleHints` regex, case-insensitive). A `crossFile` seed is a hit only when the issue's `locations` cover every listed file (any function); a partial cover is reported as `partial`. One seed counts once even if several issues match. Issues matching no seed are `extra`.
- **Per run**: `{ run, ok, hits: [seedId], partial: [seedId], misses: [seedId], extra: n, complete, verdict, counts }`; a run whose `merged.json` cannot be found or parsed is `ok: false` and excluded from averages but shown in the table.
- **Summary**: recall per run = hits / seeds; mean recall over ok runs; per-seed hit count out of ok runs (this is the number that tells you which bug class the reviewer misses); extra mean. Written to `<out>/summary.json` and printed as a table.
- **Runner CLI**: `node tests/recall/run.mjs [--runs 3] [--model sonnet] [--angles coverage,robustness,correctness] [--plugin-dir <abs>] [--out <dir>] [--min-recall 0.0] [--dry-run <merged.json>...]`. Each run: fresh scratch repo in a temp dir (so history and run dirs never leak between runs), `claude -p "/reviewer:result docs/spec.md --base main --angles <angles>" --plugin-dir <dir> --model <m> --output-format text --max-turns 60`, then the newest `.claude/reviewer/runs/*/merged.json` in that repo is scored. `--plugin-dir` defaults to the plugin directory two levels up from the script. Each run's stdout is saved to `<out>/run-<n>.txt`.
- Version: no bump (tests only). README gets a "Recall harness" paragraph under the existing test commands.

## Global Constraints

- No npm dependencies; CommonJS `.cjs` for modules, `'use strict'`, exported functions; the runner is `.mjs` like the existing harness.
- Unit tests (`fixture`, `score`, `run --dry-run`) run with `node --test plugins/reviewer/tests/recall/*.test.cjs` and need no Claude and no network. Only the real measurement calls `claude`.
- The scratch repo is built in a temp directory and removed afterwards unless `--keep` is passed.
- Nothing under `tests/recall/` is referenced by any command, skill or agent prompt.

## Review Focus

1. A merged issue carries only a bare file path in `locations` (swept entry) and no function: it still counts for a seed whose `titleHints` match, but never for a seed in another file. Test pinned in Task 2.
2. The reviewer reports the cross-file cast as two separate issues (one per file) instead of one issue with two locations: the seed is `partial` in both and `hit` in neither — that is the intended signal that the fold did not fire. Test pinned in Task 2.
3. A run where `claude` exits non-zero or writes no `merged.json`: the run is `ok: false`, shows in the table, is excluded from means, and the harness still writes `summary.json`. Test pinned in Task 3 (`--dry-run` with a missing path).
4. Two runs leave different `run_id` directories: the scorer must pick the newest `merged.json` of the run it just made, never a leftover; the fresh temp repo per run makes leftovers impossible. Test pinned in Task 1 (each `buildFixture` call yields a distinct directory with exactly one commit on `feat`).
5. The seeded bug text drifts from `seeds.json` after someone edits the fixture: Task 1's test asserts every seed's `pattern` appears in the built repo's `git diff main...HEAD`, so fixture and oracle cannot diverge silently.

---

### Task 1: Seeds and fixture builder

**Files:**
- Create: `plugins/reviewer/tests/recall/seeds.json`
- Create: `plugins/reviewer/tests/recall/fixture.cjs`
- Test: `plugins/reviewer/tests/recall/fixture.test.cjs`

**Interfaces:**
- Produces: `buildFixture(dir: string) -> { repo: string, base: 'main', head: 'feat' }` (creates `<dir>/repo`, `git init`, base commit on `main`, feature commit on `feat`, leaves `feat` checked out; sets `user.email`/`user.name` locally so it works on any machine); `SEEDS` = parsed `seeds.json` (exported from `fixture.cjs` for convenience); `seeds.json` shape per Design summary with the four seeds and their exact `pattern` strings (the literal source line fragment, e.g. `return int(s)` and `items[start:start + size - 1]`).

- [ ] **Step 1: Write the failing test**

```js
// node --test plugins/reviewer/tests/recall/fixture.test.cjs
const { buildFixture, SEEDS } = require('./fixture.cjs')
test('seeds.json has the four kinds with the required fields', () => {
  assert.deepEqual(SEEDS.map(s => s.kind).sort(), ['boundary', 'crossfile', 'dataflow', 'type'])
  for (const s of SEEDS) for (const k of ['id','kind','file','function','pattern','titleHints']) assert.ok(k in s, `${s.id}.${k}`)
  assert.deepEqual(SEEDS.find(s => s.kind === 'crossfile').crossFile, ['src/parse.py', 'src/importer.py'])
})
test('buildFixture makes a repo whose main...feat diff contains every seed pattern', () => {
  const { repo } = buildFixture(mkTmp())
  const diff = git(repo, 'diff', 'main...feat')
  for (const s of SEEDS) assert.ok(diff.includes(s.pattern), `pattern of ${s.id} not in diff`)
  assert.equal(git(repo, 'rev-list', '--count', 'main..feat').trim(), '1')
  assert.ok(fs.existsSync(path.join(repo, 'docs/spec.md')))
})
test('two builds are independent directories', () => {
  const a = buildFixture(mkTmp()).repo, b = buildFixture(mkTmp()).repo
  assert.notEqual(a, b); assert.ok(fs.existsSync(path.join(a, '.git')) && fs.existsSync(path.join(b, '.git')))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/reviewer/tests/recall/fixture.test.cjs`
Expected: FAIL, `Cannot find module './fixture.cjs'`

- [ ] **Step 3: Write `seeds.json` and implement `fixture.cjs`**

`fixture.cjs` holds the file contents as template strings (base and feature versions of `src/parse.py`, `src/paginate.py`, `src/report.py`, `src/importer.py`, plus `docs/spec.md` stating: amounts may arrive as `None` or non-numeric and must raise `ValueError` with a message; a page holds exactly `size` items; the report total must exclude items flagged `skip`; the importer must reject non-numeric cells the same way `parse_amount` does). Base versions are correct stubs (`raise NotImplementedError`); feature versions contain the seeds verbatim as `seeds.json` `pattern`s. Use `execFileSync('git', …)` with `-c user.email=t@t -c user.name=t`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/reviewer/tests/recall/fixture.test.cjs`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/tests/recall/seeds.json plugins/reviewer/tests/recall/fixture.cjs plugins/reviewer/tests/recall/fixture.test.cjs
git commit -m "test(reviewer): recall harness fixture with four seeded bugs"
```

---

### Task 2: Scorer

**Files:**
- Create: `plugins/reviewer/tests/recall/score.cjs`
- Test: `plugins/reviewer/tests/recall/score.test.cjs`

**Interfaces:**
- Consumes: `SEEDS` shape from Task 1; `merged.json` shape from `scripts/merge-findings.cjs` (`issues[].{title, location, locations[], expected, actual}`, `complete`, `verdict`, `counts`).
- Produces: `scoreRun(merged: object, seeds: Seed[]) -> { hits: string[], partial: string[], misses: string[], extra: number, complete: boolean, verdict: string, counts: object }`; `pathPart(location) -> string` and `funcPart(location) -> string|null` helpers (reuse `normalizePath` from `../../mcp/schema.cjs`).

- [ ] **Step 1: Write the failing tests**

```js
const { scoreRun } = require('./score.cjs')
const seeds = [
  { id: 'type-none', kind: 'type', file: 'src/parse.py', function: 'parse_amount', pattern: 'return int(s)', titleHints: ['TypeError', 'None'] },
  { id: 'crossfile-cast', kind: 'crossfile', file: 'src/parse.py', function: 'parse_amount', pattern: 'int(', titleHints: ['non-numeric'], crossFile: ['src/parse.py', 'src/importer.py'] },
]
const merged = (issues) => ({ issues, complete: true, verdict: 'FAIL', counts: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 } })
test('function match hits regardless of title', () => {
  const r = scoreRun(merged([{ title: 'x', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] }]), seeds.slice(0, 1))
  assert.deepEqual(r.hits, ['type-none']); assert.equal(r.extra, 0)
})
test('bare path location hits only with a title hint, and only for its own file', () => {
  const a = scoreRun(merged([{ title: 'None input raises TypeError', location: 'src/parse.py', locations: ['src/parse.py'] }]), seeds.slice(0, 1))
  assert.deepEqual(a.hits, ['type-none'])
  const b = scoreRun(merged([{ title: 'None input raises TypeError', location: 'src/other.py', locations: ['src/other.py'] }]), seeds.slice(0, 1))
  assert.deepEqual(b.misses, ['type-none']); assert.equal(b.extra, 1)
})
test('crossfile seed: both files in one issue → hit; one file → partial; two separate issues → partial', () => {
  const one = scoreRun(merged([{ title: 'non-numeric cast', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount', 'src/importer.py:parse_row'] }]), seeds.slice(1))
  assert.deepEqual(one.hits, ['crossfile-cast'])
  const half = scoreRun(merged([{ title: 'non-numeric cast', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] }]), seeds.slice(1))
  assert.deepEqual(half.partial, ['crossfile-cast']); assert.deepEqual(half.hits, [])
  const two = scoreRun(merged([
    { title: 'non-numeric cast', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] },
    { title: 'non-numeric cast', location: 'src/importer.py:parse_row', locations: ['src/importer.py:parse_row'] }]), seeds.slice(1))
  assert.deepEqual(two.partial, ['crossfile-cast']); assert.equal(two.extra, 0)
})
test('a seed counts once even when two issues match it', () => {
  const r = scoreRun(merged([{ title: 'a', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] }, { title: 'b', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] }]), seeds.slice(0, 1))
  assert.deepEqual(r.hits, ['type-none']); assert.equal(r.extra, 0)
})
test('issues matching no seed are extra; complete/verdict/counts pass through', () => {
  const r = scoreRun(merged([{ title: 'unrelated', location: 'src/report.py:build_report', locations: ['src/report.py:build_report'] }]), seeds.slice(0, 1))
  assert.equal(r.extra, 1); assert.deepEqual(r.misses, ['type-none']); assert.equal(r.complete, true); assert.equal(r.verdict, 'FAIL'); assert.equal(r.counts.HIGH, 1)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test plugins/reviewer/tests/recall/score.test.cjs`
Expected: FAIL, `Cannot find module './score.cjs'`

- [ ] **Step 3: Implement `score.cjs`**

Match rule exactly as the Design summary states; an issue that matches a `crossFile` seed in only some of its files contributes to `partial` and is NOT counted as `extra`; an issue that matches nothing is `extra`. Order `hits`/`partial`/`misses` by seed order.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test plugins/reviewer/tests/recall/score.test.cjs`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/tests/recall/score.cjs plugins/reviewer/tests/recall/score.test.cjs
git commit -m "test(reviewer): recall scorer with cross-file partial credit"
```

---

### Task 3: Runner with dry-run, README, first measurement

**Files:**
- Create: `plugins/reviewer/tests/recall/run.mjs`
- Test: `plugins/reviewer/tests/recall/run.test.cjs` (dry-run path only)
- Modify: `plugins/reviewer/README.md` (test commands section, near line 121)

**Interfaces:**
- Consumes: `buildFixture`, `SEEDS` (Task 1), `scoreRun` (Task 2).
- Produces: CLI per Design summary; `summarize(runs: RunResult[], seeds) -> Summary` exported for the test (`{ runs, okRuns, meanRecall, perSeed: {[id]: {hits, partial, outOf}}, meanExtra }`); `summary.json` written to `--out` (default `<os.tmpdir()>/reviewer-recall-<ts>`); `--dry-run <path>...` scores the given `merged.json` files as runs 1..n without calling `claude`.

- [ ] **Step 1: Write the failing test**

```js
// node --test plugins/reviewer/tests/recall/run.test.cjs
test('dry-run scores given merged.json files and writes summary.json', () => {
  const out = mkTmp()
  const good = write(out, 'good.json', { issues: [{ title: 'None → TypeError', location: 'src/parse.py:parse_amount', locations: ['src/parse.py:parse_amount'] }], complete: true, verdict: 'FAIL', counts: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 } })
  const r = spawnSync(process.execPath, [RUN, '--dry-run', good, path.join(out, 'missing.json'), '--out', out], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const s = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'))
  assert.equal(s.runs.length, 2); assert.equal(s.okRuns, 1); assert.equal(s.runs[1].ok, false)
  assert.equal(s.perSeed['type-none'].hits, 1); assert.equal(s.perSeed['type-none'].outOf, 1)
  assert.ok(Math.abs(s.meanRecall - 0.25) < 1e-9)
  assert.match(r.stdout, /type-none/)
})
test('--min-recall gates the exit code', () => {
  const out = mkTmp(); const good = write(out, 'g.json', { issues: [], complete: true, verdict: 'PASS', counts: {} })
  const r = spawnSync(process.execPath, [RUN, '--dry-run', good, '--out', out, '--min-recall', '0.5'], { encoding: 'utf8' })
  assert.equal(r.status, 1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/reviewer/tests/recall/run.test.cjs`
Expected: FAIL, `ENOENT` spawning `run.mjs`

- [ ] **Step 3: Implement `run.mjs`**

Argument parsing like `two-engine.harness.mjs`; for a real run: `buildFixture(tmp)`, `spawnSync('claude', ['-p', prompt, '--plugin-dir', dir, '--model', model, '--output-format', 'text', '--max-turns', '60'], { cwd: repo, encoding: 'utf8', timeout: 20 * 60 * 1000 })`, save stdout to `run-<n>.txt`, find `merged.json` under `<repo>/.claude/reviewer/runs/*/` (newest by directory name), `scoreRun`, remove the temp dir unless `--keep`. Table: one row per run (`run | ok | recall | hits | partial | extra | complete`) then one row per seed (`seed | kind | hits/outOf`). Exit 1 only when `--min-recall` is set and `meanRecall` is below it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test plugins/reviewer/tests/recall/*.test.cjs`
Expected: PASS, 10 tests (3 + 5 + 2)

- [ ] **Step 5: README**

Under the test commands add: "Recall harness (calls Claude, costs tokens): `node plugins/reviewer/tests/recall/run.mjs --runs 3` builds a scratch repo with four seeded bugs (type, boundary, data flow, cross-file), runs `/reviewer:result` headlessly, and prints recall per run and per seed; unit tests for it: `node --test plugins/reviewer/tests/recall/*.test.cjs`."

- [ ] **Step 6: First real measurement**

Run: `node plugins/reviewer/tests/recall/run.mjs --runs 3 --model sonnet --out /private/tmp/claude-501/<scratchpad>/recall-1`
Expected: three ok runs and a table; paste the per-seed rows into the commit body. Whatever the numbers are, they are the baseline; a low number on `crossfile-cast` with `partial` counts means the fold did not fire in a live run and goes to the ledger as a finding for the result pipeline, not for this harness.

- [ ] **Step 7: Commit**

```bash
git add plugins/reviewer/tests/recall/run.mjs plugins/reviewer/tests/recall/run.test.cjs plugins/reviewer/README.md
git commit -m "test(reviewer): seeded recall harness runner with dry-run and first baseline"
```
