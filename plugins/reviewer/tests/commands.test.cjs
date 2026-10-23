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
