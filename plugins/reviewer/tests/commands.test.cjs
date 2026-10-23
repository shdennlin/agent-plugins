// node --test plugins/reviewer/tests/commands.test.cjs — contracts the command/skill/doc files must keep
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const CMDS = fs.readdirSync(path.join(ROOT, 'commands')).filter((f) => f.endsWith('.md'))
const body = (cmd) => read(path.join('commands', cmd))

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  const fm = m ? m[1] : ''
  const tools = []
  let inTools = false
  for (const line of fm.split('\n')) {
    if (/^allowed-tools:/.test(line)) { inTools = true; continue }
    if (inTools && /^\s+-\s+/.test(line)) tools.push(line.replace(/^\s+-\s+/, '').trim())
    else if (inTools && /^\S/.test(line)) inTools = false
  }
  return { allowedTools: tools }
}

// 2-space keys under a top-level section of templates/review-angles.yaml (same rule read-rules.cjs uses)
function angleKeys(section) {
  const lines = read('templates/review-angles.yaml').split('\n')
  const keys = []
  let inSection = false
  for (const line of lines) {
    if (/^[a-z]+:\s*$/.test(line)) { inSection = line.startsWith(section + ':'); continue }
    const m = inSection && line.match(/^  ([a-z-]+):\s*$/)
    if (m) keys.push(m[1])
  }
  return keys
}
const specAngleKeys = () => angleKeys('spec')

test('every command that runs node or a script lists Bash in allowed-tools', () => {
  for (const f of CMDS) {
    const text = body(f)
    const runsShell = /node "\$\{CLAUDE_PLUGIN_ROOT\}|\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\//.test(text)
    if (runsShell) assert.ok(frontmatter(text).allowedTools.includes('Bash'), `${f} runs a script but has no Bash`)
  }
})

test('spec.md default-angle sentence lists every spec angle except composition', () => {
  const keys = specAngleKeys()
  assert.ok(keys.length >= 6, 'template parse found the spec angles')
  const sentence = body('spec.md').match(/built-in angles \(([^)]*)\)/)[1]
  for (const k of keys.filter((k) => k !== 'composition')) assert.match(sentence, new RegExp(`\\b${k}\\b`), `spec.md default sentence lacks ${k}`)
})

test('spec.md explorer step has the Explore fallback spec-dual has', () => {
  assert.match(body('spec.md'), /built-in `Explore` agent/)
})

const resultAngleKeys = () => angleKeys('result')

test('no doc advertises an angle the template lacks', () => {
  const keys = new Set([...specAngleKeys(), ...resultAngleKeys()])
  const docs = [...CMDS.map((c) => 'commands/' + c), 'skills/result/SKILL.md', 'skills/spec/SKILL.md', 'README.md']
  for (const f of docs) {
    // only example lists (two or more comma-joined keys); prose like `--angles flag` or `--angles list` is not an example
    for (const m of read(f).matchAll(/--angles ([a-z-]+(?:,[a-z-]+)+)/g)) {
      for (const k of m[1].split(',')) assert.ok(keys.has(k), `${f} advertises --angles ${k}`)
    }
  }
})

test('the -c route takes the base from the Run dir line, not a second auto-detect', () => {
  assert.ok(!read('commands/result.md').includes('git rev-parse --verify develop'), 'result.md still re-derives the base')
  assert.match(read('commands/result.md'), /--manifest "<run_dir>\/manifest\.json"/, 'the -c route reads the base from the run manifest via resolve-engine')
  assert.match(read('agents/result-fix-orchestrator.md'), /Run dir: \{run_dir\} \(angles: [^)]*; base: /)
  assert.match(read('skills/result/result-reviewer.md'), /Run dir: \{run_dir\} \(angles: [^)]*; base: /)
})

// --- batch C: one source for each prompt
const SHARED = {
  batching: 'read it in slices of 10–15 files',
  neverSkip: 'Do NOT skip files as "unrelated to the spec"',
  submodule: 'belongs to that sub-repository',
  patternRule: 'smallest literal substring that identifies the construct',
}
test('the angle brief lives only in templates/result-angle-prompt.md', () => {
  const tpl = read('templates/result-angle-prompt.md')
  for (const s of Object.values(SHARED)) assert.ok(tpl.includes(s), `template lacks: ${s}`)
  for (const f of ['agents/result-fix-orchestrator.md', 'agents/result-reviewer.md', 'skills/result/result-reviewer.md'])
    for (const [k, s] of Object.entries(SHARED)) assert.ok(!read(f).includes(s), `${f} still carries the ${k} sentence`)
  for (const p of ['{angle_label}', '{angle_focus}', '{angle_key}', '{spec_summary}', '{run_dir}', '{size_class}', '{working_directory}', '{file_list}'])
    assert.ok(tpl.includes(p), `template lacks ${p}`)
})
test('orchestrators dispatch plugin agents by type and fill the template', () => {
  assert.match(read('agents/result-fix-orchestrator.md'), /subagent_type: "reviewer:result-reviewer"/)
  assert.match(read('agents/result-fix-orchestrator.md'), /subagent_type: "reviewer:result-fixer"/)
  assert.match(read('agents/spec-orchestrator.md'), /subagent_type: "reviewer:spec-fixer"/)
  assert.match(read('agents/result-fix-orchestrator.md'), /templates\/result-angle-prompt\.md/)
  assert.match(read('skills/result/result-reviewer.md'), /templates\/result-angle-prompt\.md/)
})

test('INSTALL.md states per-command Codex support', () => {
  const t = read('.codex/INSTALL.md')
  for (const row of ['| `init` |', '| `result` |', '| `spec` |', '| `spec-dual` |']) assert.ok(t.includes(row), `INSTALL lacks ${row}`)
  assert.match(t, /spec-dual.*Workflow tool/)
})

test('SKILL.md files are pointer stubs, not flag copies', () => {
  for (const n of ['init', 'result', 'spec', 'spec-dual']) {
    const t = read(`skills/${n}/SKILL.md`).replace(/^---[\s\S]*?---\n/, '')
    const lines = t.split('\n').filter((l) => l.trim())
    assert.ok(lines.length <= 15, `${n}/SKILL.md body has ${lines.length} lines`)
    assert.ok(t.includes(`commands/${n}.md`), `${n}/SKILL.md does not point at commands/${n}.md`)
    assert.ok(!/^\s*--[a-z]/m.test(t), `${n}/SKILL.md restates flags`)
  }
})

test('the spec-dual workflow carries the command name', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'workflows', 'spec-dual.workflow.js')), 'workflows/spec-dual.workflow.js missing')
  const wf = read('workflows/spec-dual.workflow.js').match(/name: '([a-z-]+)'/)[1]
  assert.notEqual(wf, 'spec-dual', 'a workflow named like the command shadows the slash command')
  assert.ok(read('commands/spec-dual.md').includes(`name: "reviewer:${wf}"`), 'command calls the workflow by its meta.name')
  for (const f of ['commands/spec-dual.md', 'skills/spec-dual/SKILL.md', 'README.md']) assert.ok(!read(f).includes('two-engine-spec-review'), `${f} still names two-engine-spec-review`)
})

// --- batch C review fixes
test('result-reviewer is an internal brief-receiver, not a self-contained reviewer', () => {
  const t = read('agents/result-reviewer.md')
  assert.match(t, /Not directly invocable/)
  for (const bad of ['log_script_path', '## Log Findings', '## Input Parameters']) assert.ok(!t.includes(bad), `result-reviewer.md still has ${bad}`)
})
test('result-fixer keeps the Write tool it had as an untyped agent', () => {
  assert.match(read('agents/result-fixer.md'), /^tools:\n(?:  - .*\n)*  - Write\n/m)
})
test('the Codex companion continues past the brief and resolves the template from the plugin root', () => {
  const t = read('skills/result/result-reviewer.md')
  assert.match(t, /do not apply[^.]*continue to Step 5d/)
  assert.ok(!t.includes('<physical>/../../templates'), 'template path must use the plugin root variable')
  assert.match(t, /Which functions\/classes were changed/)
})
test('the template keeps the spec-silent defect examples and the test-file rule', () => {
  const t = read('templates/result-angle-prompt.md')
  assert.match(t, /I\/O in a constructor/)
  assert.match(t, /do not triage them by grep/)
})
test('INSTALL.md does not overclaim spec under Codex', () => {
  assert.match(read('.codex/INSTALL.md'), /\| `spec` \| untested/)
})

// --- batch B: one engine vocabulary
test('no prompt or doc uses the legacy engine names claude-result / both', () => {
  const files = [...CMDS.map((c) => 'commands/' + c), ...fs.readdirSync(path.join(ROOT, 'agents')).map((a) => 'agents/' + a),
    'skills/result/result-reviewer.md', 'skills/init/init-reviewer.md', 'README.md', 'templates/review-engines.yaml']
  for (const f of files) {
    const t = read(f)
    assert.ok(!t.includes('claude-result'), `${f} still says claude-result`)
    assert.ok(!/engine: both|`both`|\(both\/|both\/claude\/codex/.test(t), `${f} still uses the engine value both`)
  }
  assert.match(read('commands/result.md'), /`engines`/)
})

test('spec-dual logs every round from the workflow history; spec rows name the engine', () => {
  const sd = read('commands/spec-dual.md')
  assert.match(sd, /history\[\]/); assert.match(sd, /--round <n>/); assert.match(sd, /engines/)
  assert.match(read('agents/spec-orchestrator.md'), /`source: spec`, `engine: claude`/)
})

test('spec-dual retains history (not findings) for logging; result -c maps unknown engines to other:', () => {
  const sd = read('commands/spec-dual.md')
  assert.ok(!/Retain `findings` for Step 6/.test(sd), 'spec-dual Step 5 still retains findings for Step 6')
  assert.match(sd, /Retain `history` for Step 6/)
  assert.ok(!/jq missing/.test(sd))
  assert.match(read("commands/result.md"), /other:<engine key>/)
})

// --- batch D: deterministic prep in scripts
test('rules/history paths come from read-rules --paths, not prose', () => {
  for (const f of ['commands/init.md', 'skills/init/init-reviewer.md', 'agents/init-reviewer.md', 'commands/spec-dual.md']) {
    const t = read(f)
    assert.match(t, /read-rules\.cjs" --paths/, `${f} does not call read-rules --paths`)
    assert.ok(!/openspec\/config\.yaml` (if|when) (it )?(exists|present)/.test(t), `${f} still spells out the precedence rule`)
  }
})

test('init prompts delegate the rules delta to apply-rules.cjs', () => {
  for (const f of ['skills/init/init-reviewer.md', 'agents/init-reviewer.md']) {
    const t = read(f)
    assert.match(t, /apply-rules\.cjs/, `${f} does not call apply-rules.cjs`)
    assert.ok(!/Compute Delta|exact string match\)/.test(t), `${f} still describes the delta computation`)
  }
  assert.match(read('commands/init.md'), /template_path/)
})

test('the -c route resolves the engine through resolve-engine.cjs; level words live in the YAML', () => {
  const t = read('commands/result.md')
  assert.match(t, /resolve-engine\.cjs/)
  assert.ok(!t.includes('If it is one of `low`, `medium`, `high`, `xhigh`, `max`'), 'result.md still hardcodes the level words in the parse step')
  assert.ok(!t.includes('auto-detect exactly as the agent does'), 'result.md still re-derives the base in prose')
  assert.match(read('templates/review-engines.yaml'), /^    levels: \[low, medium, high, xhigh, max\]$/m)
})

test('batch D review fixes: -c is checked up front, init passes plugin_root, no stale Step 6', () => {
  const r = read('commands/result.md')
  assert.match(r, /resolve-engine\.cjs" --token "<token>" --check/)
  assert.match(read('commands/init.md'), /plugin_root: /)
  for (const f of ['agents/init-reviewer.md', 'skills/init/init-reviewer.md']) {
    assert.ok(!read(f).includes('${CLAUDE_PLUGIN_ROOT}'), `${f} uses the env var inside an agent body; use {plugin_root}`)
    assert.ok(!/in Step 6/.test(read(f)), `${f} still points at a Step 6`)
  }
  assert.ok(!read('commands/init.md').includes('Store the full content'), 'init.md Step 2 still stores the template inline')
})

// --- batch F: spec on the structured pipeline
test('the spec angle brief is a template with the shared sentences once; spec-reviewer is a typed brief-receiver', () => {
  const t = read('templates/spec-angle-prompt.md')
  for (const ph of ['{angle_label}', '{angle_focus}', '{angle_key}', '{run_dir}', '{file_list}', '{working_directory}', '{codebase_context}', '{project_rules}']) assert.ok(t.includes(ph), `template lacks ${ph}`)
  assert.match(t, /mcp__plugin_reviewer_review__report_review/)
  assert.match(t, /§/)
  assert.ok(!t.includes('`coverage`'), 'spec brief must not ask for a coverage field')
  const a = read('agents/spec-reviewer.md')
  assert.match(a, /Not directly invocable/)
  assert.match(a, /^tools:\n(?:  - .*\n)*  - mcp__plugin_reviewer_review__\*\n/m)
  assert.match(a, /templates\/spec-angle-prompt\.md/)
})
test('spec-orchestrator runs setup, dispatches typed spec-reviewers with the template, and merges with merge-findings.cjs', () => {
  const o = read('agents/spec-orchestrator.md')
  assert.match(o, /setup-spec-review\.sh/)
  assert.match(o, /subagent_type: "reviewer:spec-reviewer"/)
  assert.match(o, /templates\/spec-angle-prompt\.md/)
  assert.match(o, /merge-findings\.cjs/)
  assert.match(o, /--no-log/)
  assert.ok(!o.includes('Deduplicate — if two issues have the same topic'), 'LLM dedup prose must be gone')
  assert.ok(!o.includes('Output EXACTLY this structure'), 'inline brief must be gone')
  assert.ok(!o.includes('log-findings.sh'))
  const c = body('spec.md')
  assert.match(c, /plugin_root/)
  assert.match(c, /log-findings\.cjs/)
  assert.ok(!c.includes('log-findings.sh'))
})
test('both fixers end with the FIXER-RESULT block; the spec fix loop runs on merged.json', () => {
  for (const f of ['agents/spec-fixer.md', 'agents/result-fixer.md']) {
    const t = read(f)
    assert.match(t, /FIXER-RESULT/, f); assert.match(t, /APPLIED: <n>/, f); assert.match(t, /SKIPPED: <n>/, f)
    assert.match(t, /@ <location>/, f)
  }
  const o = read('agents/spec-orchestrator.md')
  assert.match(o, /merged\.verdict/); assert.match(o, /merged\.complete/)
  assert.match(o, /--parse-fixer/)
  assert.match(o, /`locations`/)
  assert.ok(!o.includes('For each issue in the merged report, decide'), 'triage reads merged.issues')
  assert.match(read('agents/result-fix-orchestrator.md'), /--parse-fixer/)
})
test('spec-dual folds each round through fold-findings.cjs before logging with log-findings.cjs', () => {
  const sd = read('commands/spec-dual.md')
  assert.match(sd, /fold-findings\.cjs/); assert.match(sd, /log-findings\.cjs/); assert.ok(!sd.includes('log-findings.sh'))
})
test('history v3: orchestrators write outcomes.json from the fixer result and log with --outcomes; -c route and spec-dual carry outcome', () => {
  for (const f of ['agents/spec-orchestrator.md', 'agents/result-fix-orchestrator.md']) {
    const t = read(f); assert.match(t, /outcomes\.json/, f); assert.match(t, /--outcomes/, f); assert.match(t, /escalated/, f)
  }
  assert.match(body('result.md'), /`outcome`/)
  const sd = body('spec-dual.md'); assert.match(sd, /--outcome residual/); assert.match(sd, /--outcome fixed/); assert.match(sd, /escalated/)
  assert.match(read('README.md'), /schema v3/)
})
test('1.21.0: the log-findings.sh wrapper is gone and no prompt or doc names it', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'scripts', 'log-findings.sh')), 'wrapper still on disk')
  const files = ['commands', 'agents', 'skills', 'templates'].flatMap((d) => fs.readdirSync(path.join(ROOT, d), { recursive: true }).map((f) => path.join(d, String(f)))).filter((f) => f.endsWith('.md') || f.endsWith('.yaml'))
  for (const f of [...files, 'README.md', '.codex/INSTALL.md']) assert.ok(!read(f).includes('log-findings.sh'), `${f} still names log-findings.sh`)
})
test('fix loops log every round with that round\'s outcomes, so fixed and escalated reach history', () => {
  for (const f of ['agents/spec-orchestrator.md', 'agents/result-fix-orchestrator.md']) {
    const t = read(f)
    const log = t.slice(t.indexOf('## Log Findings'))
    assert.match(log, /every round/i, f)
    assert.ok(!/Only the FINAL round is logged/.test(log), `${f} still logs only the final round`)
    assert.match(log, /--outcomes/, f)
  }
})
