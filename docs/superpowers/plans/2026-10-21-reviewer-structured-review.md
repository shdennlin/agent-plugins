# Reviewer Structured Review (minimal version) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Result-review angle sub-agents hand their findings to a schema-enforced MCP tool instead of markdown, and a script (not the orchestrator LLM) does dedup, pattern-sweep locations, NOT-REVIEWED detection and logging.

**Architecture:** The reviewer plugin ships a zero-dependency Node stdio MCP server exposing one tool, `report_review`, whose input schema is the review contract. A setup script creates a per-run directory with a manifest (diff strategy, file list, diff patch); each angle sub-agent ends by calling the tool, which validates against the manifest and writes `<run_dir>/<angle>.json`. A merge script reads the angle files, performs the deterministic set operations, writes `merged.json` and appends to `history.jsonl` through the existing `log-findings.sh`. The orchestrator keeps only LLM work: spec summary, semantic fold, rendering sections A–E from `merged.json`, triage, fixer dispatch, Handoff.

**Tech Stack:** Node 22 (CommonJS, no npm dependencies, same as `plugins/cache-keepalive/bin`), `node --test`, bash + jq (existing `log-findings.sh`).

**Spec:** No written spec; the design was agreed in conversation on 2026-10-21. The "Design summary" below is the spec executors argue from.

## Design summary

- Server name `review`, so the model sees the tool as `mcp__plugin_reviewer_review__report_review`.
- Run directory: `<git-root>/openspec/reviews/runs/<run_id>/` when `openspec/` exists, else `<git-root>/.claude/reviewer/runs/<run_id>/` (same root rule as `log-findings.sh:42-46`).
- `run_id` = `YYYYMMDDTHHMMSSZ-<4 hex>`.
- Manifest `manifest.json`: `{ run_id, created, working_directory, diff_strategy, files: [path...] }`. `diff.patch` holds the full diff once, so the merge script can grep it.
- Tool contract (`report_review` input): `run_dir` (absolute), `angle` (lowercase key), `files[]` `{path, verdict: clean|issues|skimmed, issue_count}`, `issues[]` `{severity: CRITICAL|HIGH|MEDIUM|LOW, title, location, category, pattern?, expected, actual, impact, recommendation}`, `coverage[]?` `{requirement, status: implemented|missing|partial, location?}`, `verdict: PASS|FAIL`.
- Tool-side enforcement (returns `isError: true` with every violation listed, nothing written): every manifest path present in `files`; no path outside the manifest; `clean` ⇒ `issue_count == 0`, `issues` ⇒ `issue_count >= 1`; `issue_count` equals the number of issues whose `location` starts with that path; `run_dir` contains `/reviews/runs/` or `/reviewer/runs/` and holds a `manifest.json`.
- The tool stamps every file it writes with `via: "report_review"` and `reported_at`. Fallback when the tool is absent (Codex, server failed to start): the sub-agent writes the same report JSON to `<run_dir>/<angle>.json` with a heredoc, WITHOUT those two keys; the merge script validates it with the same schema module, reports violations as a merge finding, and records `via` per angle in `merged.json` so a run that silently fell back is visible.
- Merge rules: dedup on identical `location` AND identical title (lowercased, trimmed), keep worst severity, concatenate recommendations; after the sweep, issues with the same title and the same non-empty `pattern` fold into one (primary = worst severity, then lowest location; `locations` unioned by path part, a `file:function` entry winning over a bare swept path; `angles` unioned); `locations` = `[location]` ∪ files in `diff.patch` whose added lines contain `pattern` (literal substring, case-sensitive), primary first, swept entries are bare file paths (the script knows no function names); NOT REVIEWED = manifest files minus the angle's `files` paths (should be empty after tool validation; non-empty only via the fallback path); per-file coverage = `clean` only if every angle says clean or skimmed, else summed `issue_count`; verdict `FAIL` if any CRITICAL or HIGH; `complete` = no invalid report and no `not_reviewed` file — when false the prompts render `FAIL (review incomplete: <angles>)`, never PASS.
- Semantic fold (two differently worded issues that are the same defect) stays with the orchestrator LLM, after the script runs.
- The log reflects the script's merge only: the orchestrator's semantic folds and `review-process` entries are report-only and never reach `history.jsonl`.
- Logging: the merge script invokes `log-findings.sh` once with the merged array (`locations` included) unless `--no-log` is passed. The orchestrator passes `--no-log` exactly when the command omitted `log_script_path` (the `-c` route, which logs the two-engine merge itself in `commands/result.md` Step 3d).
- Markdown report rendering stays in the orchestrator for this version (Section B from the coverage table, D from the issue list). Thin-orchestrator rendering is deferred.

## Global Constraints

- No npm dependencies anywhere in `plugins/reviewer` (marketplace install does not run `npm install`).
- Node files are CommonJS (`.cjs`), `'use strict'`, exported functions for tests, same as `plugins/cache-keepalive/bin/keepalive-cache`.
- Tests run with `node --test plugins/reviewer/tests/<file>.test.cjs` or `bash plugins/reviewer/tests/<file>.test.sh`; no Claude, no network.
- Every script accepts absolute paths only for run directories; relative `--change` identifiers for logging stay relative to the git root (existing `log-findings.sh` rule).
- Version: bump `plugins/reviewer/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` to `1.15.0` in the last task, both in the same commit.
- Commit convention: `<type>(reviewer): <description>`.

## Review Focus

1. A sub-agent reports a path with a trailing `./` or a path the manifest spells differently (e.g. renamed file `old => new` from `--name-only`). Expected: the tool rejects it with the exact unmatched path named. Test pinned in Task 3.
2. `pattern` is a regex-looking string such as `foo(` or `[0]`. Expected: literal substring match, no regex error, no false positives. Test pinned in Task 5.
3. Two angles report the same location AND same title with different severities and one is `CRITICAL`. Expected: one merged issue with `CRITICAL`, both recommendations kept. (Same location, different title → two issues.) Test pinned in Task 5.
4. The run directory has an angle file written by the fallback path with a schema violation. Expected: merge does not crash; the file's issues are still merged where parseable, and a `NOT REVIEWED` / `invalid report` entry names the angle. Test pinned in Task 5.
5. The MCP server receives a request it does not implement (`resources/list`, `prompts/list`) or a notification. Expected: JSON-RPC `-32601` for unknown methods, silence for notifications, process keeps running. Test pinned in Task 2.

---

### Task 1: Review contract schema and validator

**Files:**
- Create: `plugins/reviewer/mcp/schema.cjs`
- Test: `plugins/reviewer/tests/schema.test.cjs`

**Interfaces:**
- Produces: `REPORT_SCHEMA` (JSON Schema object, the exact `inputSchema` the server advertises), `SEVERITIES = ['CRITICAL','HIGH','MEDIUM','LOW']`, `validateReport(report: object, manifestFiles: string[]) -> string[]` (empty array = valid; each string is one human-readable violation).

- [ ] **Step 1: Write the failing tests**

```js
// node --test plugins/reviewer/tests/schema.test.cjs
const { REPORT_SCHEMA, validateReport } = require('../mcp/schema.cjs')
const FILES = ['src/a.py', 'src/b.py']
const good = () => ({
  run_dir: '/tmp/x/.claude/reviewer/runs/r1', angle: 'correctness',
  files: [{ path: 'src/a.py', verdict: 'issues', issue_count: 1 }, { path: 'src/b.py', verdict: 'clean', issue_count: 0 }],
  issues: [{ severity: 'HIGH', title: 't', location: 'src/a.py:parse', category: 'correctness', pattern: 'int(', expected: 'e', actual: 'a', impact: 'i', recommendation: 'r' }],
  verdict: 'FAIL',
})
test('valid report has no violations', () => assert.deepEqual(validateReport(good(), FILES), []))
test('schema advertises required top-level keys', () => assert.deepEqual(REPORT_SCHEMA.required.sort(), ['angle','files','issues','run_dir','verdict']))
test('missing manifest path is named', () => { const r = good(); r.files.pop(); assert.match(validateReport(r, FILES).join('\n'), /src\/b\.py.*missing/) })
test('path outside manifest is named', () => { const r = good(); r.files.push({ path: 'src/c.py', verdict: 'clean', issue_count: 0 }); assert.match(validateReport(r, FILES).join('\n'), /src\/c\.py.*not in manifest/) })
test('clean file with issue_count>0 is rejected', () => { const r = good(); r.files[1].issue_count = 2; assert.equal(validateReport(r, FILES).length, 1) })
test('issue_count must equal issues under that path', () => { const r = good(); r.files[0].issue_count = 3; assert.match(validateReport(r, FILES).join('\n'), /src\/a\.py.*issue_count 3.*1 issue/) })
test('severity outside enum is rejected', () => { const r = good(); r.issues[0].severity = 'BLOCKER'; assert.match(validateReport(r, FILES).join('\n'), /severity/) })
test('run_dir outside a runs directory is rejected', () => { const r = good(); r.run_dir = '/etc'; assert.match(validateReport(r, FILES).join('\n'), /run_dir/) })
test('coverage is optional and validated when present', () => { const r = good(); r.coverage = [{ requirement: 'R1', status: 'done' }]; assert.match(validateReport(r, FILES).join('\n'), /coverage\[0\]\.status/) })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test plugins/reviewer/tests/schema.test.cjs`
Expected: FAIL, `Cannot find module '../mcp/schema.cjs'`

- [ ] **Step 3: Implement `plugins/reviewer/mcp/schema.cjs`**

`REPORT_SCHEMA` is a hand-written JSON Schema (draft 2020-12 keywords only: `type`, `properties`, `required`, `enum`, `items`, `minimum`, `additionalProperties: false` on issue and file objects). `validateReport` is a hand-rolled checker over that same shape (no ajv): type and enum checks per field, then the five manifest rules from the design summary. Violation strings follow `"<json-path>: <problem>"`, e.g. `files: src/b.py missing (every manifest path must be reported)`, `files[0]: src/a.py issue_count 3 but 1 issue(s) point at it`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test plugins/reviewer/tests/schema.test.cjs`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/mcp/schema.cjs plugins/reviewer/tests/schema.test.cjs
git commit -m "feat(reviewer): add report_review contract schema and validator"
```

---

### Task 2: Stdio MCP server with `report_review`

**Files:**
- Create: `plugins/reviewer/mcp/server.cjs`
- Create: `plugins/reviewer/mcp/report-review.cjs`
- Create: `plugins/reviewer/.mcp.json`
- Test: `plugins/reviewer/tests/server.test.cjs`

**Interfaces:**
- Consumes: `REPORT_SCHEMA`, `validateReport` from Task 1.
- Produces: `handleReportReview(args: object) -> { content: [{type:'text', text}], isError?: true }` in `report-review.cjs`; `dispatch(message: object) -> object | undefined` in `server.cjs` (undefined for notifications); the server binary reads newline-delimited JSON-RPC 2.0 from stdin and writes one JSON line per response to stdout, nothing else on stdout.

- [ ] **Step 1: Write the failing tests**

```js
// node --test plugins/reviewer/tests/server.test.cjs
const { spawn } = require('node:child_process')
const { dispatch } = require('../mcp/server.cjs')
const { handleReportReview } = require('../mcp/report-review.cjs')
// helper: mkRun() creates <tmp>/.claude/reviewer/runs/r1/manifest.json with files ['src/a.py','src/b.py'] and returns the run dir

test('initialize advertises protocol and tools capability', () => {
  const res = dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
  assert.equal(res.result.serverInfo.name, 'reviewer-review')
  assert.ok(res.result.capabilities.tools)
})
test('tools/list exposes report_review with the contract schema', () => {
  const res = dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  assert.equal(res.result.tools[0].name, 'report_review')
  assert.deepEqual(res.result.tools[0].inputSchema.required.sort(), ['angle','files','issues','run_dir','verdict'])
})
test('unknown method returns -32601, notification returns nothing', () => {
  assert.equal(dispatch({ jsonrpc: '2.0', id: 3, method: 'resources/list' }).error.code, -32601)
  assert.equal(dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined)
})
test('report_review writes <run_dir>/<angle>.json on valid input', () => {
  const run = mkRun(); const res = handleReportReview(validReport(run))
  assert.notEqual(res.isError, true)
  const written = JSON.parse(fs.readFileSync(path.join(run, 'correctness.json'), 'utf8'))
  assert.equal(written.angle, 'correctness'); assert.equal(written.via, 'report_review'); assert.ok(written.reported_at)
})
test('report_review returns isError and writes nothing on violations', () => {
  const run = mkRun(); const bad = validReport(run); bad.files.pop()
  const res = handleReportReview(bad)
  assert.equal(res.isError, true); assert.match(res.content[0].text, /src\/b\.py missing/)
  assert.equal(fs.existsSync(path.join(run, 'correctness.json')), false)
})
test('report_review refuses a run_dir without manifest.json', () => {
  const res = handleReportReview({ ...validReport('/tmp/nope/.claude/reviewer/runs/zz') })
  assert.equal(res.isError, true); assert.match(res.content[0].text, /manifest\.json/)
})
test('stdio round-trip: initialize then tools/call', async () => {
  const run = mkRun()
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'server.cjs')])
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n')
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'report_review', arguments: validReport(run) } }) + '\n')
  child.stdin.end()
  const lines = (await text(child.stdout)).trim().split('\n').map(JSON.parse)
  assert.equal(lines.length, 2); assert.equal(lines[1].id, 2); assert.notEqual(lines[1].result.isError, true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test plugins/reviewer/tests/server.test.cjs`
Expected: FAIL, `Cannot find module '../mcp/server.cjs'`

- [ ] **Step 3: Implement `plugins/reviewer/mcp/report-review.cjs`**

`handleReportReview(args)`: resolve `args.run_dir`; if `manifest.json` is missing return `isError` naming it; read `manifest.files`; run `validateReport(args, manifest.files)`; on violations return `isError: true` with one violation per line prefixed by `report_review rejected (N violation(s)), fix and call again:`; else write `<run_dir>/<angle>.json` = `{ ...args, via: 'report_review', reported_at: ISO }` with `JSON.stringify(_, null, 2)` and return a one-line text `wrote <angle>.json: <files.length> file(s), <issues.length> issue(s), verdict <verdict>`.

- [ ] **Step 4: Implement `plugins/reviewer/mcp/server.cjs`**

`dispatch(msg)` handles `initialize` (protocolVersion `2024-11-05`, `capabilities: { tools: {} }`, `serverInfo: { name: 'reviewer-review', version: <plugin.json version read at startup> }`), `ping`, `tools/list` (one tool: name `report_review`, description from the design summary's "tool contract" sentence plus the fallback note, `inputSchema: REPORT_SCHEMA`), `tools/call` (only `report_review`; others `-32602`), any `notifications/*` → `undefined`, everything else `-32601`. Main: when `require.main === module`, read stdin with `readline`, `JSON.parse` each line (parse error → `-32700` with `id: null`), write `JSON.stringify(response) + '\n'` to stdout. All diagnostics to stderr.

- [ ] **Step 5: Create `plugins/reviewer/.mcp.json`**

```json
{ "mcpServers": { "review": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.cjs"] } } }
```

- [ ] **Step 6: Run tests and validate the plugin**

Run: `node --test plugins/reviewer/tests/server.test.cjs && claude plugin validate ./plugins/reviewer`
Expected: PASS, 7 tests; validation passes (the 6 pre-existing "No description" warnings are allowed, no new ones)

- [ ] **Step 7: Smoke-test in a live session, including from a sub-agent**

Run: `claude --plugin-dir ./plugins/reviewer` then `/mcp` inside it.
Expected: server `review` listed as connected with 1 tool. Record the exact tool name shown; if it is not `mcp__plugin_reviewer_review__report_review`, update the name in Tasks 6 and 7 before continuing.
Then, in the same session, create a scratch run dir by hand (`manifest.json` with `files: ["x.py"]`) and spawn an Agent whose whole prompt is "call the report_review tool with this JSON: <valid report for x.py>".
Expected: `<run_dir>/test.json` exists and contains `"via": "report_review"`. Tool availability inside Agent-spawned sub-agents is not documented; if this fails, STOP here and rethink before Tasks 3–7, because the fallback path would make the pipeline run with no schema enforcement at all.

- [ ] **Step 8: Commit**

```bash
git add plugins/reviewer/mcp plugins/reviewer/.mcp.json plugins/reviewer/tests/server.test.cjs
git commit -m "feat(reviewer): ship stdio MCP server with report_review tool"
```

---

### Task 3: Manifest path normalization

**Files:**
- Modify: `plugins/reviewer/mcp/schema.cjs`
- Test: `plugins/reviewer/tests/schema.test.cjs`

**Interfaces:**
- Produces: `normalizePath(p: string) -> string` exported from `schema.cjs`; used by `validateReport` on both sides of every path comparison and by Task 4's setup script output contract (manifest paths are already normalized).

- [ ] **Step 1: Write the failing tests**

```js
test('normalizePath strips ./ and trailing slash, keeps rename target', () => {
  assert.equal(normalizePath('./src/a.py'), 'src/a.py')
  assert.equal(normalizePath('src/dir/'), 'src/dir')
  assert.equal(normalizePath('old/name.py => new/name.py'), 'new/name.py')
  assert.equal(normalizePath('src/{old => new}/f.py'), 'src/new/f.py')
})
test('validateReport matches ./-prefixed report paths to manifest paths', () => {
  const r = good(); r.files[0].path = './src/a.py'; r.issues[0].location = './src/a.py:parse'
  assert.deepEqual(validateReport(r, FILES), [])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test plugins/reviewer/tests/schema.test.cjs`
Expected: FAIL, `normalizePath is not a function`

- [ ] **Step 3: Implement `normalizePath` and apply it inside `validateReport`**

Rules in test order: drop leading `./`, drop trailing `/`, `a => b` → `b`, `{a => b}` segment → `b`. Apply to `files[].path`, `issues[].location` (the part before the first `:`), and each manifest entry.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test plugins/reviewer/tests/schema.test.cjs`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/mcp/schema.cjs plugins/reviewer/tests/schema.test.cjs
git commit -m "fix(reviewer): normalize diff paths before manifest matching"
```

---

### Task 4: Run setup script

**Files:**
- Create: `plugins/reviewer/scripts/setup-result-review.sh`
- Test: `plugins/reviewer/tests/setup-result-review.test.sh`

**Interfaces:**
- Produces: `setup-result-review.sh --working-dir <abs> (--base <branch> | --auto-detect)`, prints one JSON object to stdout: `{ run_id, run_dir, diff_strategy, files: [...], file_count, line_count, size_class: "small"|"large" }` and creates `<run_dir>/manifest.json` (same object minus `size_class`, plus `created`, `working_directory`, and under `WORKTREE` also `staged_only: [...]` and `unstaged_only: [...]`) and `<run_dir>/diff.patch`. On first use it writes `<runs_root>/.gitignore` containing `*` so run directories (which hold the full diff) are never committed, even under `openspec/`. Exit 2 with a one-line stderr message for: not a git repo, detached HEAD under auto-detect, empty diff.

- [ ] **Step 1: Write the failing test**

```bash
# bash plugins/reviewer/tests/setup-result-review.test.sh
# temp repo: commit a.py on main, branch feat, modify a.py and add b.py, commit.
out="$("$SCRIPT" --working-dir "$TMP" --base main)"
[[ "$(jq -r .diff_strategy <<<"$out")" == "main...HEAD" ]] || fail "diff_strategy"
[[ "$(jq -r '.files|join(",")' <<<"$out")" == "a.py,b.py" ]] || fail "files"
[[ "$(jq -r .size_class <<<"$out")" == "small" ]] || fail "size_class"
run="$(jq -r .run_dir <<<"$out")"
[[ "$run" == "$TMP/.claude/reviewer/runs/"* ]] || fail "run_dir root"
[[ -f "$run/manifest.json" && -s "$run/diff.patch" ]] || fail "manifest/diff missing"
[[ "$(jq -r .run_id "$run/manifest.json")" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{4}$ ]] || fail "run_id format"
# openspec root rule
mkdir "$TMP/openspec"; run2="$("$SCRIPT" --working-dir "$TMP" --base main | jq -r .run_dir)"
[[ "$run2" == "$TMP/openspec/reviews/runs/"* ]] || fail "openspec root"
[[ "$(cat "$TMP/openspec/reviews/runs/.gitignore")" == "*" ]] || fail "runs root must be gitignored"
# auto-detect on feature branch picks main (no develop)
[[ "$("$SCRIPT" --working-dir "$TMP" --auto-detect | jq -r .diff_strategy)" == "main...HEAD" ]] || fail "auto-detect"
# detached HEAD under auto-detect exits 2
git -C "$TMP" checkout -q --detach; "$SCRIPT" --working-dir "$TMP" --auto-detect >/dev/null 2>&1 && fail "detached should exit 2"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash plugins/reviewer/tests/setup-result-review.test.sh`
Expected: FAIL, script not found

- [ ] **Step 3: Implement `plugins/reviewer/scripts/setup-result-review.sh`**

`set -euo pipefail`, requires `jq`. Auto-detect reproduces `agents/result-fix-orchestrator.md` Step 0b: feature branch → `develop...HEAD` if `develop` exists else `main...HEAD`; on `main`/`develop` → working tree (`diff_strategy` = `WORKTREE`, patch = `git diff` + `git diff --cached`, files = union of both `--name-only`, `staged_only` / `unstaged_only` = the set differences, so section E Staging Check keeps its data source); detached → exit 2. `size_class` = `large` when `file_count >= 20 || line_count >= 500` (`line_count` from `--shortstat` insertions + deletions). Paths in `files` are passed through the same four normalization rules as Task 3 (`sed`). `run_id` = `date -u +%Y%m%dT%H%M%SZ`-`$(head -c2 /dev/urandom | xxd -p)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash plugins/reviewer/tests/setup-result-review.test.sh`
Expected: `ok: setup-result-review ...`

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/scripts/setup-result-review.sh plugins/reviewer/tests/setup-result-review.test.sh
git commit -m "feat(reviewer): add setup-result-review.sh producing a run manifest"
```

---

### Task 5: Merge script

**Files:**
- Create: `plugins/reviewer/scripts/merge-findings.cjs`
- Test: `plugins/reviewer/tests/merge-findings.test.cjs`
- Test fixtures: `plugins/reviewer/tests/fixtures/run-basic/` (`manifest.json`, `diff.patch`, `coverage.json`, `robustness.json`, `correctness.json`)

**Interfaces:**
- Consumes: `validateReport`, `normalizePath`, `SEVERITIES` from Tasks 1 and 3; run directory layout from Task 4; `log-findings.sh` CLI (existing).
- Produces: `node merge-findings.cjs <run_dir> --change <rel> --round <N> [--no-log] [--log-script <abs>]` writes `<run_dir>/merged.json` and prints it to stdout. Exported for tests: `merge(manifest, reports: object[], diffPatch: string) -> Merged`. `Merged` = `{ run_id, angles: string[], via: {[angle]: 'report_review'|'file'}, invalid_reports: [{angle, violations}], files: [{path, verdict: 'clean'|'issues'|'skimmed'|'not_reviewed', issue_count, not_reviewed_by: string[]}], issues: [{severity, title, location, locations: string[], category, pattern?, expected, actual, impact, recommendation, angles: string[]}], coverage: [...union, status worst-wins: missing > partial > implemented], verdict: 'PASS'|'FAIL', counts: {CRITICAL, HIGH, MEDIUM, LOW} }`. Issues sorted worst severity first, then location.

- [ ] **Step 1: Write the fixtures**

`manifest.json` files: `src/a.py`, `src/b.py`, `src/c.py`, `lock.json`. `diff.patch`: added lines containing `int(x)` in `src/a.py` and `src/b.py`, not in `src/c.py`. `correctness.json`: issue HIGH at `src/a.py:parse` with `pattern: "int("`; files a=issues(1), b=clean, c=clean, lock=skimmed. `robustness.json`: same location `src/a.py:parse` and same title (the same defect from another angle) as CRITICAL, different recommendation; omits `src/c.py` from files (fallback-shaped violation), has `verdict: FAIL`, and has no `via` key (fallback-written). `correctness.json` and `coverage.json` carry `via: "report_review"`. `coverage.json`: no issues, all clean, `coverage: [{requirement:'R1', status:'implemented', location:'src/a.py'}, {requirement:'R2', status:'missing'}]`.

- [ ] **Step 2: Write the failing tests**

```js
// node --test plugins/reviewer/tests/merge-findings.test.cjs
const { merge } = require('../scripts/merge-findings.cjs')
const run = loadFixture('run-basic')   // returns { manifest, reports: [coverage, robustness, correctness], diff }
test('same location merges to worst severity with both recommendations', () => {
  const m = merge(run.manifest, run.reports, run.diff)
  const hit = m.issues.filter(i => i.location === 'src/a.py:parse')
  assert.equal(hit.length, 1); assert.equal(hit[0].severity, 'CRITICAL')
  assert.deepEqual(hit[0].angles.sort(), ['correctness', 'robustness']); assert.match(hit[0].recommendation, /\n/)
})
test('pattern sweep adds files whose added lines contain the literal pattern', () => {
  const m = merge(run.manifest, run.reports, run.diff)
  assert.deepEqual(m.issues[0].locations, ['src/a.py:parse', 'src/b.py'])
})
test('pattern is literal, not regex', () => {
  const reports = clone(run.reports); reports[2].issues[0].pattern = 'x[0'
  assert.doesNotThrow(() => merge(run.manifest, reports, run.diff))
})
test('missing path in a report becomes not_reviewed_by that angle', () => {
  const m = merge(run.manifest, run.reports, run.diff)
  const c = m.files.find(f => f.path === 'src/c.py')
  assert.equal(c.verdict, 'not_reviewed'); assert.deepEqual(c.not_reviewed_by, ['robustness'])
  assert.equal(m.invalid_reports[0].angle, 'robustness')
})
test('per-file verdict is clean only when every angle is clean or skimmed', () => {
  const m = merge(run.manifest, run.reports, run.diff)
  assert.equal(m.files.find(f => f.path === 'src/b.py').verdict, 'clean')
  assert.equal(m.files.find(f => f.path === 'src/a.py').issue_count, 2)
  assert.equal(m.files.find(f => f.path === 'lock.json').verdict, 'skimmed')
})
test('coverage unions with worst status winning', () => {
  const m = merge(run.manifest, run.reports, run.diff)
  assert.deepEqual(m.coverage.map(c => c.status), ['implemented', 'missing'])
})
test('verdict FAIL on CRITICAL/HIGH, counts filled', () => {
  const m = merge(run.manifest, run.reports, run.diff)
  assert.equal(m.verdict, 'FAIL'); assert.equal(m.counts.CRITICAL, 1); assert.equal(m.counts.LOW, 0)
})
test('via records tool vs fallback per angle', () => {
  const m = merge(run.manifest, run.reports, run.diff)   // fixture: correctness has via, robustness does not
  assert.equal(m.via.correctness, 'report_review'); assert.equal(m.via.robustness, 'file')
})
test('CLI writes merged.json and logs through log-findings.sh with locations', () => {
  // copy fixture into a temp git repo, run the CLI with --log-script pointing at scripts/log-findings.sh
  // assert <run>/merged.json exists, .claude/reviewer/history.jsonl has 1 row, row.locations.length === 2, row.engine === ''
})
test('CLI --no-log writes merged.json and no history file', () => { /* same temp repo, assert history.jsonl absent */ })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test plugins/reviewer/tests/merge-findings.test.cjs`
Expected: FAIL, `Cannot find module '../scripts/merge-findings.cjs'`

- [ ] **Step 4: Implement `plugins/reviewer/scripts/merge-findings.cjs`**

Loading: every `<run_dir>/*.json` except `manifest.json` and `merged.json` is a report; run `validateReport` on each; violations go to `invalid_reports` but the report's parseable issues and files are still merged. Pattern sweep: parse `diff.patch` into `{file -> addedLines[]}` by `diff --git a/<x> b/<y>` headers and `+` lines (skip `+++`); match with `String.prototype.includes`, skipping the file already named by the issue's own `location`. Severity order from `SEVERITIES`. Logging: `spawnSync(logScript, ['--change', change, '--source', 'result', '--round', round], { input: JSON.stringify(issues.map(toLogRow)) })` where `toLogRow` emits `severity,title,location,category,locations` and `engine: ''`; default `--log-script` = `path.join(__dirname, 'log-findings.sh')`; print its stdout line after the JSON.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test plugins/reviewer/tests/merge-findings.test.cjs`
Expected: PASS, 10 tests

- [ ] **Step 6: Commit**

```bash
git add plugins/reviewer/scripts/merge-findings.cjs plugins/reviewer/tests/merge-findings.test.cjs plugins/reviewer/tests/fixtures
git commit -m "feat(reviewer): add merge-findings.cjs for deterministic angle merge and logging"
```

---

### Task 6: Orchestrator reads the run directory

**Files:**
- Modify: `plugins/reviewer/agents/result-fix-orchestrator.md:47-68` (Step 0b), `:83-156` (Step 2 sub-agent prompt), `:158-186` (Step 3), `:282-300` (Log Findings)
- Modify: `plugins/reviewer/commands/result.md:126-165` (dispatch prompt gains `plugin_root`)
- Modify: `plugins/reviewer/templates/review-angles.yaml:111-136` (result angles: add one sentence each that `pattern` must be a literal substring copied from the offending line)

**Interfaces:**
- Consumes: setup script JSON (Task 4), `report_review` tool name `mcp__plugin_reviewer_review__report_review` (Task 2, Step 7), merge CLI (Task 5).
- Produces: orchestrator input parameter `plugin_root` (absolute path to the plugin, passed by the command); prompt wording below is the contract the sub-agents follow.

- [ ] **Step 1: Replace Step 0b with the setup script**

Orchestrator runs `"{plugin_root}/scripts/setup-result-review.sh" --working-dir {working_directory} (--base {base_branch} | --auto-detect)` and keeps `run_id`, `run_dir`, `diff_strategy`, `files`, `size_class`. Exit 2 → report the stderr line and stop (replaces the three prose branches).

- [ ] **Step 2: Rewrite the sub-agent prompt's diff and output sections**

Replace "### Analyze the Diff" so the sub-agent reads `{run_dir}/diff.patch` as the single source of the diff (whole file when `size_class` is `small`, otherwise in 10–15-file slices with `sed -n` / `awk` on the `diff --git` headers) and still opens surrounding context with `git show HEAD:<path>` and callers; this also covers `diff_strategy = WORKTREE`, which is not a `git diff` argument. Replace "### Output Format … ## Directives" with: the sub-agent's last action is one call to `mcp__plugin_reviewer_review__report_review` with `run_dir`, `angle`, `files` (every path from the manifest list given in the prompt), `issues`, `coverage` (coverage angle only), `verdict`. State: "Your run is INCOMPLETE until the tool returns a line starting with `wrote`. If it returns an error, fix exactly the violations it lists and call again (max 3 attempts). If the tool is not available, write the identical JSON to `{run_dir}/{angle}.json` with a Bash heredoc and say `report_review unavailable, wrote file directly`." Keep `Locations` out of the sub-agent (the script computes it); add `pattern`: "a literal substring copied from the offending added line, enough to find the same construct elsewhere, or omit it". After the tool call, print only a 3-line summary (angle, verdict, issue count); the orchestrator never parses the summary.

- [ ] **Step 3: Replace Step 3 (merge) with the script call plus LLM-only steps**

Run `node "{plugin_root}/scripts/merge-findings.cjs" {run_dir} --change <change id> --round {N}` with `--no-log` appended when `log_script_path` was not provided. Read `merged.json`. LLM steps that remain: (a) semantic fold: two merged issues with different locations that describe the same defect → one issue, union `locations`, note the fold in the report; (b) render sections A–E: B from `files` (`— clean` / `— N issue(s)` / `— NOT REVIEWED by <angles>` / `— skimmed`), C from `coverage`, D from `issues` (each with its `locations` line), E from `verdict` and `counts`; (c) if `invalid_reports` is non-empty, add one D entry per angle, severity MEDIUM, category `review-process`, titled `<angle> report failed validation`. Delete the old Dedup / Pattern sweep / Merge per-file coverage / Merge coverage checklists items.

- [ ] **Step 4: Replace the Log Findings section**

Logging now happens inside the merge script. The section becomes: "If the merge script printed a `logged N finding(s)` line, repeat it in the Final Summary; if it printed `findings not logged`, repeat that. Never log again yourself." Keep the `findings not logged: <reason>` fallback wording for when the script itself failed.

- [ ] **Step 5: Thread `plugin_root` through `commands/result.md`**

Add `- plugin_root: ${CLAUDE_PLUGIN_ROOT}` (resolved to an absolute path, same way `log_script_path` is resolved today) to both dispatch prompts; remove the sentence telling the orchestrator to omit `log_script_path` on `-c` and instead say: "When `-c` is set, pass `log_script_path` as `none`; the orchestrator then runs the merge with `--no-log` and Step 3d logs the two-engine merge once."

- [ ] **Step 6: Update the three result angles in `review-angles.yaml`**

Append to each `focus:` the sentence: "For every issue, set `pattern` to a literal substring copied from the offending added line (no regex) when the same construct could appear in another changed file."

- [ ] **Step 7: Live run against a known diff**

In a scratch git repo with 3 changed files where the same unchecked `int(` cast appears in two of them, run `claude --plugin-dir ./plugins/reviewer` and `/reviewer:result <spec> --base main --angles correctness,robustness`. Expected: `<run_dir>` holds `correctness.json`, `robustness.json`, `merged.json`; section B lists all 3 files with verdicts; the cast issue appears once with 2 `locations`; `merged.json` has `via` = `report_review` for every angle (no silent fallback); `history.jsonl` gained rows with `locations.length == 2`.

- [ ] **Step 8: Commit**

```bash
git add plugins/reviewer/agents/result-fix-orchestrator.md plugins/reviewer/commands/result.md plugins/reviewer/templates/review-angles.yaml
git commit -m "feat(reviewer): orchestrator reads report_review JSON and merges via script"
```

---

### Task 7: Single-reviewer path, docs, version

**Files:**
- Modify: `plugins/reviewer/skills/result/result-reviewer.md:61-101` (Steps 4–5b), `:102-185` (report), `:186-205` (Log Findings)
- Modify: `plugins/reviewer/agents/result-reviewer.md:23-28` (tools), `:39-47` (behavior), `:58-77` (Log Findings)
- Modify: `plugins/reviewer/skills/result/SKILL.md:27,57-59`
- Modify: `plugins/reviewer/README.md` (result section near line 76 and the `history.jsonl` paragraph near line 129)
- Modify: `plugins/reviewer/.codex/INSTALL.md` ("Codex differences")
- Modify: `plugins/reviewer/.claude-plugin/plugin.json:3`, `.claude-plugin/marketplace.json:57` (version `1.15.0`)

**Interfaces:**
- Consumes: tool name and fallback wording from Task 6 Step 2; scripts from Tasks 4 and 5.

- [ ] **Step 1: Make the single-reviewer methodology use the same pipeline**

In `result-reviewer.md`: Step 3/4 call `setup-result-review.sh` (path given as `plugin_root`; under Codex, resolve the skill file's PHYSICAL directory first (`readlink -f` on the symlinked skills dir, which points into `plugins/reviewer/skills/`) and use `<physical>/../../scripts/`); after Step 5b the reviewer calls `report_review` with `angle: "single"` (fallback: heredoc to `{run_dir}/single.json`), then runs `merge-findings.cjs {run_dir} --change <id> --round 1` (which also logs), then renders sections A–G from `merged.json` (section E from the manifest's `staged_only` / `unstaged_only` lists, only when `diff_strategy` is `WORKTREE`). Remove the hand-written Log Findings command; keep the "findings not logged" fallback sentence.

- [ ] **Step 2: Update `agents/result-reviewer.md`**

Add `mcp__plugin_reviewer_review__report_review` to `tools:`; replace the two ledger/sweep behavior bullets with one: "Report through the `report_review` tool (every diff path gets a verdict; the tool rejects incomplete reports), then merge and log with `merge-findings.cjs`"; replace the Log Findings section with the Task 6 Step 4 wording.

- [ ] **Step 3: Update `SKILL.md`, `README.md`, `.codex/INSTALL.md`**

SKILL.md line 27: replace the batching sentence with "Each angle reports through the `report_review` MCP tool; every file in the diff must carry a verdict or the report is rejected; merge and logging are deterministic (`scripts/merge-findings.cjs`)." README: one paragraph "Structured review pipeline" listing `.mcp.json`, the run directory layout, `merged.json`, and the two test commands. INSTALL.md "Codex differences": Codex has no plugin MCP server, so reviewers write `<run_dir>/<angle>.json` directly; `node` is required for `merge-findings.cjs`.

- [ ] **Step 4: Bump versions**

Set `"version": "1.15.0"` in both manifests.

- [ ] **Step 5: Run the whole suite**

Run:
```bash
node --test plugins/reviewer/tests/schema.test.cjs plugins/reviewer/tests/server.test.cjs plugins/reviewer/tests/merge-findings.test.cjs \
&& bash plugins/reviewer/tests/setup-result-review.test.sh \
&& bash plugins/reviewer/tests/log-findings.test.sh \
&& bash plugins/reviewer/tests/review-engines.test.sh \
&& claude plugin validate ./plugins/reviewer
```
Expected: all `ok` / PASS, validation passes with only the 6 pre-existing warnings.

- [ ] **Step 6: Commit**

```bash
git add plugins/reviewer .claude-plugin/marketplace.json
git commit -m "feat(reviewer): structured review pipeline via report_review tool (1.15.0)"
```
