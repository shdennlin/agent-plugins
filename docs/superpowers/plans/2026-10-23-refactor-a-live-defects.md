# Reviewer Refactor — Batch A (Live Defects) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six live defects the 2026-10-23 four-lens audit found in `plugins/reviewer`, each pinned by a test, without changing any data shape.

**Architecture:** Three kinds of change: prompt/command contracts (spec.md tools and explorer fallback, angle docs) pinned by a new `tests/commands.test.cjs` that parses the command files; a new deterministic `scripts/check-angles.cjs` that commands call before dispatch; validator and shell hardening in `mcp/schema.cjs`, `scripts/setup-result-review.sh`, `scripts/merge-findings.cjs` with tests in their existing suites. No version bump here: the branch `feat/reviewer-refactor` bumps once to 1.20.0 in batch E.

**Tech Stack:** node (`node:test`), bash, jq, markdown prompts.

**Spec:** `~/.claude/prompt-builder/reviewer-refactor.md` section "A. Live defects" (settled); evidence in the audit reports it names.

## Global Constraints

- Commit convention `<type>(reviewer): <desc>`; no version bump in this batch.
- Every `git diff` in the setup script keeps going through `gd()` (quotePath/noprefix/mnemonicPrefix/ignore-submodules pinned).
- Plain-repo output of the setup script stays identical except for the run-id suffix format.
- Suites that must stay green after every task: `node --test plugins/reviewer/tests/*.test.cjs plugins/reviewer/tests/recall/*.test.cjs`, `node plugins/reviewer/tests/two-engine.harness.mjs`, `bash plugins/reviewer/tests/*.test.sh`, `claude plugin validate ./plugins/reviewer`.

## Review Focus

1. `--angles "coverage, robustness"` with a space after the comma: trimmed, accepted. Pinned in Task 2.
2. `--base nosuch` where the ref does not exist: exit 2 with a message naming `nosuch`, not "no merge base". Pinned in Task 4.
3. A repo with no remote (no `origin/HEAD`) on a feature branch: falls through to develop, main, master in that order. Pinned in Task 4.
4. A report with `verdict: FAIL` and only LOW issues: valid (FAIL needs ≥1 issue of any severity). Pinned in Task 3.
5. Two setup runs inside the same second: distinct run dirs. Pinned in Task 4.

---

### Task 1: `/reviewer:spec` can run its rules step; explorer fallback; default-angle wording

**Files:**
- Modify: `plugins/reviewer/commands/spec.md:2-5` (allowed-tools), `:12-18` (default angles sentence), `:60-62` (help "Available:" line), `:95-112` (explorer dispatch)
- Create: `plugins/reviewer/tests/commands.test.cjs`

**Interfaces:**
- Produces: `tests/commands.test.cjs` exporting nothing; helper `frontmatter(file) -> {allowedTools: string[]}` and `body(file) -> string` defined inside the test file; Task 2 adds tests to this file.

- [ ] **Step 1: Write the failing tests**

```js
// tests/commands.test.cjs — contracts the command files must keep
const CMDS = fs.readdirSync(path.join(__dirname, '..', 'commands')).filter(f => f.endsWith('.md'))
test('every command that runs node or a script lists Bash in allowed-tools', () => {
  for (const f of CMDS) {
    const text = read(f)
    const runsShell = /node "\$\{CLAUDE_PLUGIN_ROOT\}|\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\//.test(text)
    if (runsShell) assert.ok(frontmatter(text).allowedTools.includes('Bash'), `${f} runs a script but has no Bash`)
  }
})
test('spec.md default-angle sentence lists every spec angle except composition', () => {
  const keys = specAngleKeys()               // parse templates/review-angles.yaml spec: section, 2-space keys
  const sentence = body('spec.md').match(/built-in angles \(([^)]*)\)/)[1]
  for (const k of keys.filter(k => k !== 'composition')) assert.match(sentence, new RegExp(`\\b${k}\\b`), `spec.md default sentence lacks ${k}`)
})
test('spec.md explorer step has the Explore fallback spec-dual has', () => {
  assert.match(body('spec.md'), /built-in `Explore` agent/)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/reviewer/tests/commands.test.cjs`
Expected: 3 failing: `spec.md runs a script but has no Bash`, `lacks design`, no match for `Explore`.

- [ ] **Step 3: Edit `commands/spec.md`**

Add `  - Bash` to allowed-tools. Default sentence: "built-in angles (scope, completeness, tasks, platform, design, consistency, and composition when the orchestrator judges multiple independent spec units are in scope)". Help "Available:" line lists the same six. After the explorer dispatch block add the sentence from `commands/spec-dual.md:81-83` verbatim: "If that agent type is not available in this session (the `feature-dev` plugin is not installed), use the built-in `Explore` agent with the same brief instead."

- [ ] **Step 4: Run to verify they pass**

Run: `node --test plugins/reviewer/tests/commands.test.cjs`
Expected: PASS 3/3

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/commands/spec.md plugins/reviewer/tests/commands.test.cjs
git commit -m "fix(reviewer): /reviewer:spec gets Bash for its rules step, an Explore fallback, and the real default-angle list"
```

---

### Task 2: Angle keys are validated by a script; docs stop advertising `security`

**Files:**
- Create: `plugins/reviewer/scripts/check-angles.cjs`, `plugins/reviewer/tests/check-angles.test.cjs`
- Modify: `plugins/reviewer/commands/result.md` (Step 1 item 6 → call the script; examples at `:117` and `:274`), `plugins/reviewer/commands/spec.md` (Step 1 item 5), `plugins/reviewer/skills/result/SKILL.md:34`, `plugins/reviewer/README.md:225`
- Test: `plugins/reviewer/tests/commands.test.cjs` (one more test)

**Interfaces:**
- Produces: CLI `node scripts/check-angles.cjs --section <spec|result> --angles <csv|default>`; stdout JSON `{"section":"result","angles":["coverage","robustness"]}`; exit 1 and stderr `check-angles: unknown angle 'security' for result; valid: coverage, robustness, correctness` on any unknown key; `default` → every key of the section (spec: without `composition`, which the orchestrator adds by judgment). Module export `checkAngles(section, csv, yamlText) -> {angles} | throws Error(message)`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/check-angles.test.cjs
test('default expands to the section keys, composition excluded for spec', () => {
  assert.deepEqual(checkAngles('result', 'default', YAML).angles, ['coverage', 'robustness', 'correctness'])
  assert.ok(!checkAngles('spec', 'default', YAML).angles.includes('composition'))
})
test('csv is trimmed and order-preserving', () => assert.deepEqual(checkAngles('result', ' robustness, coverage ', YAML).angles, ['robustness', 'coverage']))
test('unknown key names itself and the valid list', () => assert.throws(() => checkAngles('result', 'security,coverage', YAML), /unknown angle 'security' for result; valid: coverage, robustness, correctness/))
test('composition may be requested explicitly for spec', () => assert.ok(checkAngles('spec', 'scope,composition', YAML).angles.includes('composition')))
test('CLI exit codes', () => { /* spawnSync node scripts/check-angles.cjs --section result --angles security → status 1, stderr matches; --angles default → status 0, JSON */ })
// tests/commands.test.cjs
test('no doc advertises an angle the template lacks', () => {
  const keys = new Set([...specAngleKeys(), ...resultAngleKeys()])
  for (const f of [...CMDS.map(c => 'commands/' + c), 'skills/result/SKILL.md', 'skills/spec/SKILL.md', 'README.md'])
    for (const m of read(f).matchAll(/--angles ([a-z,]+)/g)) for (const k of m[1].split(','))
      assert.ok(keys.has(k), `${f} advertises --angles ${k}`)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/reviewer/tests/check-angles.test.cjs plugins/reviewer/tests/commands.test.cjs`
Expected: check-angles fails with `Cannot find module`; commands test fails with `advertises --angles security` (README, result.md, SKILL.md).

- [ ] **Step 3: Implement `scripts/check-angles.cjs`**

Parse the section keys from `templates/review-angles.yaml` by the same 2-space-key rule `read-rules.cjs` uses (lines matching `/^  ([a-z-]+):\s*$/` under the `spec:` or `result:` header); do not add a YAML library. Change the four doc examples to `--angles robustness,coverage`. In `commands/result.md` Step 1 item 6 and `commands/spec.md` Step 1 item 5: "Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-angles.cjs" --section <result|spec> --angles <value or default>`; on exit 1 print its stderr line and stop; pass its `angles` array to the orchestrator as `angles`."

- [ ] **Step 4: Run to verify they pass**

Run: `node --test plugins/reviewer/tests/check-angles.test.cjs plugins/reviewer/tests/commands.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/scripts/check-angles.cjs plugins/reviewer/tests/check-angles.test.cjs plugins/reviewer/tests/commands.test.cjs plugins/reviewer/commands/result.md plugins/reviewer/commands/spec.md plugins/reviewer/skills/result/SKILL.md plugins/reviewer/README.md
git commit -m "feat(reviewer): check-angles.cjs rejects unknown angle keys; docs stop advertising the nonexistent security angle"
```

---

### Task 3: Validator semantics — verdict consistency, non-empty strings, no `..` in run_dir

**Files:**
- Modify: `plugins/reviewer/mcp/schema.cjs` (ISSUE_SCHEMA `title/location/recommendation` get `minLength: 1`; `validateReport` after the shape check)
- Test: `plugins/reviewer/tests/schema.test.cjs`

**Interfaces:**
- Produces: new violation strings, exact text: `verdict: PASS but 1 CRITICAL/HIGH issue(s) reported`, `verdict: FAIL but no issues reported`, `run_dir: must not contain a .. segment`, `issues[0].title: must not be empty`.

- [ ] **Step 1: Write the failing tests**

```js
test('PASS with a CRITICAL or HIGH issue is rejected', () => { const r = good(); r.verdict = 'PASS'; assert.match(validateReport(r, FILES).join('\n'), /verdict: PASS but 1 CRITICAL\/HIGH/) })
test('FAIL with zero issues is rejected', () => { const r = good(); r.issues = []; r.files[0] = { path: 'src/a.py', verdict: 'clean', issue_count: 0 }; assert.match(validateReport(r, FILES).join('\n'), /verdict: FAIL but no issues/) })
test('FAIL with only LOW issues is valid', () => { const r = good(); r.issues[0].severity = 'LOW'; assert.deepEqual(validateReport(r, FILES), []) })
test('PASS with only MEDIUM issues is valid', () => { const r = good(); r.issues[0].severity = 'MEDIUM'; r.verdict = 'PASS'; assert.deepEqual(validateReport(r, FILES), []) })
test('empty title, location or recommendation is rejected', () => { for (const k of ['title', 'location', 'recommendation']) { const r = good(); r.issues[0][k] = ''; assert.match(validateReport(r, FILES).join('\n'), new RegExp(`issues\\[0\\]\\.${k}: must not be empty`)) } })
test('run_dir with a .. segment is rejected', () => { const r = good(); r.run_dir = '/tmp/x/.claude/reviewer/runs/../../etc'; assert.match(validateReport(r, FILES).join('\n'), /run_dir: must not contain a \.\. segment/) })
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/reviewer/tests/schema.test.cjs`
Expected: 5 failing (the two "valid" tests already pass).

- [ ] **Step 3: Implement in `mcp/schema.cjs`**

`checkShape` already walks `properties`; extend it to honour `minLength` on strings with the message `<at>: must not be empty` for `minLength: 1`. In `validateReport`, after `if (!shapeOk) return out`: count `report.issues` with severity CRITICAL or HIGH; push the two verdict violations; test `/(^|\/)\.\.(\/|$)/` on `run_dir` next to the existing RUNS_SEGMENT check (before the shape early-return).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test plugins/reviewer/tests/schema.test.cjs plugins/reviewer/tests/server.test.cjs`
Expected: PASS, previous count + 6

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/mcp/schema.cjs plugins/reviewer/tests/schema.test.cjs
git commit -m "fix(reviewer): report_review rejects PASS with critical/high issues, FAIL with none, empty strings, and .. in run_dir"
```

---

### Task 4: Setup script — base auto-detect order, missing-ref message, collision-proof run dir

**Files:**
- Modify: `plugins/reviewer/scripts/setup-result-review.sh:66-86` (base resolution), `:176-178` (run id)
- Test: `plugins/reviewer/tests/setup-result-review.test.sh` (new section 9)

**Interfaces:**
- Produces: auto-detect rule: `DEFAULT_BASE` = name of `refs/remotes/origin/HEAD`'s target if set and resolvable (local branch first, else `origin/<name>`), else the first of `develop`, `main`, `master` that `rev-parse --verify` resolves (same local-then-origin rule); on `DEFAULT_BASE` itself → `WORKTREE`, otherwise `<DEFAULT_BASE>...HEAD`. `--base <ref>` that does not resolve → exit 2 `setup-result-review: base ref '<ref>' does not exist`. Run dir `$(mktemp -d "$ROOT/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")`, `RUN_ID` = its basename (format `<ts>-<6 chars>`).

- [ ] **Step 1: Write the failing test section**

```bash
# 9. base auto-detect order, missing --base ref, run-dir uniqueness.
R="$(mktemp -d)"; mkrepo "$R/m"   # mkrepo() from section 8: git init -b main + empty commit
git -C "$R/m" branch -m main master; printf 'x\n' >"$R/m/x"; gc "$R/m" add -A; gc "$R/m" commit -q -m base; gc "$R/m" switch -q -c feat; printf 'y\n' >>"$R/m/x"; gc "$R/m" commit -q -am feat
[[ "$("$SCRIPT" --working-dir "$R/m" --auto-detect | jq -r .diff_strategy)" == "master...HEAD" ]] || fail "master repo auto-detects master"
gc "$R/m" switch -q master; [[ "$("$SCRIPT" --working-dir "$R/m" --auto-detect 2>&1 | jq -r .diff_strategy 2>/dev/null)" == "WORKTREE" || $? -ne 0 ]] || fail "on master → WORKTREE (empty diff exits 2 is fine)"
# origin/HEAD wins over develop
mkrepo "$R/o"; gc "$R/o" branch trunk; gc "$R/o" branch develop
git clone -q "$R/o" "$R/c"; git -C "$R/c" remote set-head origin trunk; gc "$R/c" switch -q -c feat; printf 'z\n' >"$R/c/z"; gc "$R/c" add -A; gc "$R/c" commit -q -m z
[[ "$("$SCRIPT" --working-dir "$R/c" --auto-detect | jq -r .diff_strategy)" == "trunk...HEAD" ]] || fail "origin/HEAD → trunk beats develop"
rc=0; "$SCRIPT" --working-dir "$R/c" --base nosuch >/dev/null 2>"$R/e.txt" || rc=$?
[[ "$rc" == 2 ]] && grep -q "base ref 'nosuch' does not exist" "$R/e.txt" || fail "missing --base ref names itself (rc=$rc: $(cat "$R/e.txt"))"
d1="$("$SCRIPT" --working-dir "$R/c" --base trunk | jq -r .run_dir)"; d2="$("$SCRIPT" --working-dir "$R/c" --base trunk | jq -r .run_dir)"
[[ "$d1" != "$d2" && -d "$d1" && -d "$d2" ]] || fail "two runs get distinct run dirs"
[[ "$(basename "$d1")" =~ ^[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9]{6}$ ]] || fail "run id format (got $(basename "$d1"))"
rm -rf "$R"
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash plugins/reviewer/tests/setup-result-review.test.sh`
Expected: `ASSERT FAIL: master repo auto-detects master` (today: exit 2 "no merge base between main and HEAD")

- [ ] **Step 3: Implement**

Add `resolve_ref() { g rev-parse --verify -q "$1" >/dev/null 2>&1 && echo "$1" || { g rev-parse --verify -q "origin/$1" >/dev/null 2>&1 && echo "origin/$1"; }; }` and `default_base()` per the Interfaces rule (`g symbolic-ref -q refs/remotes/origin/HEAD | sed 's|^refs/remotes/origin/||'`). In the `--base` branch: `BASE_REF="$(resolve_ref "$BASE")" || die2 "base ref '$BASE' does not exist"`. Display string keeps the user's or detected name (`trunk...HEAD`), the merge-base uses the resolved ref. Replace the RUN_ID/RUN_DIR lines with the mktemp form; `mkdir -p "$RUN_DIR"` becomes unnecessary. Keep section 3's expectation `main...HEAD` (no remote, no develop → main).

- [ ] **Step 4: Run to verify it passes**

Run: `bash plugins/reviewer/tests/setup-result-review.test.sh && node --test plugins/reviewer/tests/merge-findings.test.cjs plugins/reviewer/tests/recall/*.test.cjs`
Expected: `ok: … run-dir uniqueness, …`; node suites unchanged (confirm nothing parses the old 4-hex suffix: `grep -rn "\[0-9a-f\]{4}" plugins/reviewer` is empty).

- [ ] **Step 5: Commit**

```bash
git add plugins/reviewer/scripts/setup-result-review.sh plugins/reviewer/tests/setup-result-review.test.sh
git commit -m "fix(reviewer): base auto-detect honours origin/HEAD and master, names a missing --base ref, run dirs via mktemp"
```

---

### Task 5: Sweep uses the trimmed pattern

**Files:**
- Modify: `plugins/reviewer/scripts/merge-findings.cjs:246-250`
- Test: `plugins/reviewer/tests/merge-findings.test.cjs`

- [ ] **Step 1: Write the failing test**

```js
test('sweep matches on the trimmed pattern (trailing whitespace in pattern does not disable it)', () => {
  const man = { run_id: 'x', files: ['a.py', 'b.py'], working_directory: '/tmp/x' }
  const patch = ['diff --git a/a.py b/a.py', '+++ b/a.py', '@@ -0,0 +1 @@', '+x = int(raw)', 'diff --git a/b.py b/b.py', '+++ b/b.py', '@@ -0,0 +1 @@', '+y = int(raw)'].join('\n')
  const rep = { angle: 'correctness', via: 'report_review', verdict: 'FAIL', files: [{ path: 'a.py', verdict: 'issues', issue_count: 1 }, { path: 'b.py', verdict: 'clean', issue_count: 0 }],
    issues: [{ severity: 'HIGH', title: 't', location: 'a.py:f', category: 'c', pattern: 'int( ', expected: 'e', actual: 'a', impact: 'i', recommendation: 'r' }] }
  assert.deepEqual(merge(man, [rep], patch).issues[0].locations, ['a.py:f', 'b.py'])
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test plugins/reviewer/tests/merge-findings.test.cjs`
Expected: locations `['a.py:f']` only.

- [ ] **Step 3: Implement**

In the sweep, `const key = foldKey(pattern); if (key !== null) { … l.includes(key) … }`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test plugins/reviewer/tests/merge-findings.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit and full-suite check**

```bash
git add plugins/reviewer/scripts/merge-findings.cjs plugins/reviewer/tests/merge-findings.test.cjs
git commit -m "fix(reviewer): pattern sweep uses the trimmed pattern"
node --test plugins/reviewer/tests/*.test.cjs plugins/reviewer/tests/recall/*.test.cjs && node plugins/reviewer/tests/two-engine.harness.mjs && bash plugins/reviewer/tests/setup-result-review.test.sh && bash plugins/reviewer/tests/log-findings.test.sh && bash plugins/reviewer/tests/review-engines.test.sh && claude plugin validate ./plugins/reviewer
```
Expected: all green.
