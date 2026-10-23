#!/usr/bin/env node
'use strict'
// Resolve the project's harvested review rules the same way `reviewer:init` writes them:
//   <git-root>/openspec/config.yaml  -> its top-level `rules:` section   (Spectra / OpenSpec repos)
//   <git-root>/.claude/reviewer/rules.yaml -> its top level              (portable fallback)
// and print ONE JSON object: { source, proposal: [], specs: [], design: [], tasks: [] }.
//
//   node read-rules.cjs [--root <abs>]            rules
//   node read-rules.cjs --paths [--root <abs>]    { git_root, rules_kind, rules_target, rules_exists, history_path }
//
// Missing files are not errors (exit 0, empty arrays, source null). Exit 2 only when a file
// exists but cannot be read. Accepts only the YAML subset init writes: artifact keys holding
// block sequences of quoted or plain scalars; anything else is skipped with a stderr warning.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const AREAS = ['proposal', 'specs', 'design', 'tasks']
const CONFIG = 'openspec/config.yaml'
const FALLBACK = '.claude/reviewer/rules.yaml'

const emptyRules = () => Object.fromEntries(AREAS.map(a => [a, []]))

// Strip surrounding quotes (double: unescape \" and \\; single: '' -> '); plain: cut at " #".
function unquote(raw) {
  const s = raw.trim()
  // quoted scalar, optionally followed by a trailing comment
  const dq = s.match(/^"((?:[^"\\]|\\.)*)"\s*(#.*)?$/)
  if (dq) return dq[1].replace(/\\(["\\])/g, '$1')
  const sq = s.match(/^'((?:[^']|'')*)'\s*(#.*)?$/)
  if (sq) return sq[1].replace(/''/g, "'")
  const hash = s.search(/\s#/)
  return (hash === -1 ? s : s.slice(0, hash)).trim()
}

// Line-based parser for the init-written shape. nested=true: keys live under a top-level
// `rules:` block (keys at 2 spaces, items at 4); nested=false: keys at column 0, items at 2.
function parseRulesYaml(text, { nested }) {
  const out = emptyRules()
  const warnings = []
  const keyIndent = nested ? 2 : 0
  const itemIndent = nested ? 4 : 2
  let inRules = !nested
  let area = null        // current artifact key, or null
  let skipping = false   // under an unknown artifact key: its items are ignored silently
  const lines = String(text).split(/\r?\n/)
  lines.forEach((line, i) => {
    const n = i + 1
    if (!line.trim() || /^\s*#/.test(line)) return
    const indent = line.match(/^ */)[0].length
    const body = line.trim()
    if (nested && indent === 0) {
      // a column-0 key: enters `rules:` or ends it
      inRules = /^rules:\s*(#.*)?$/.test(body)
      area = null; skipping = false
      return
    }
    if (!inRules) return
    const keyM = body.match(/^([A-Za-z_][\w-]*):\s*(#.*)?$/)
    if (indent === keyIndent && keyM) {
      area = AREAS.includes(keyM[1]) ? keyM[1] : null   // unknown artifact key: ignored
      skipping = area === null
      return
    }
    const itemM = body.match(/^-\s+(.*)$/)
    if (indent === itemIndent && itemM && skipping) return
    if (indent === itemIndent && itemM && area) {
      const raw = itemM[1].trim()
      if (/^[\[{]/.test(raw)) { warnings.push(`line ${n}: unsupported flow syntax skipped: ${raw}`); return }
      const v = unquote(raw)
      if (v) out[area].push(v)
      return
    }
    if (area || indent >= keyIndent) warnings.push(`line ${n}: unrecognised line skipped: ${body}`)
  })
  return { ...out, warnings }
}

function gitRoot() {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return process.cwd() }
}

function readRules(root = gitRoot()) {
  const result = { source: null, ...emptyRules() }
  const config = path.join(root, CONFIG)
  const fallback = path.join(root, FALLBACK)
  let file = null, nested = false
  if (fs.existsSync(config)) { file = config; nested = true; result.source = CONFIG }
  else if (fs.existsSync(fallback)) { file = fallback; nested = false; result.source = FALLBACK }
  if (!file) return result
  let text
  try { text = fs.readFileSync(file, 'utf8') }
  catch (e) { const err = new Error(`read-rules: cannot read ${result.source}: ${e.message}`); err.exitCode = 2; throw err }
  const parsed = parseRulesYaml(text, { nested })
  for (const w of parsed.warnings) process.stderr.write(`read-rules: ${result.source} ${w}\n`)
  for (const a of AREAS) result[a] = parsed[a]
  return result
}

// Where this project's rules target and review history live. The ONE place that knows the
// precedence rule (openspec/config.yaml when openspec/ exists, else the portable fallback).
const HISTORY_OPENSPEC = 'openspec/reviews/history.jsonl'
const HISTORY_PORTABLE = '.claude/reviewer/history.jsonl'
function resolvePaths(root = gitRoot()) {
  const openspec = fs.existsSync(path.join(root, 'openspec'))
  const target = path.join(root, openspec ? CONFIG : FALLBACK)
  return {
    git_root: root,
    rules_kind: openspec ? 'openspec' : 'portable',
    rules_target: target,
    rules_exists: fs.existsSync(target),
    history_path: path.join(root, openspec ? HISTORY_OPENSPEC : HISTORY_PORTABLE),
  }
}

module.exports = { readRules, parseRulesYaml, resolvePaths, AREAS }

if (require.main === module) {
  const argv = process.argv.slice(2)
  let root, paths = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i]
    else if (argv[i] === '--paths') paths = true
    else if (argv[i] === '--quiet') { /* reserved */ }
    else { process.stderr.write(`read-rules: unknown argument: ${argv[i]}\n`); process.exit(1) }
  }
  try {
    process.stdout.write(JSON.stringify(paths ? resolvePaths(root || gitRoot()) : readRules(root || gitRoot())) + '\n')
  } catch (e) {
    process.stderr.write(`${e.message}\n`)
    process.exit(e.exitCode || 2)
  }
}
