#!/usr/bin/env node
// Append-only rules injection for `reviewer:init`: the template's rules that the target does not already
// hold are appended under the right artifact key, by line edits that leave every other byte alone
// (comments, unrelated keys, block scalars). No YAML library; the shapes are the ones init writes:
//   openspec  <git-root>/openspec/config.yaml   areas under a top-level `rules:` key (2/4-space indent)
//   portable  <git-root>/.claude/reviewer/rules.yaml   areas at the top level (0/2-space indent)
//
//   node apply-rules.cjs --template <yaml> --target <file> --kind <openspec|portable> [--dry-run]
// stdout: {"added":{"proposal":[..],...},"skipped":N,"written":bool,"target":"<file>"}
'use strict'
const fs = require('fs')
const path = require('path')
const { parseRulesYaml, AREAS } = require('./read-rules.cjs')

const quote = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const norm = (s) => s.trim()

// Pure: returns the new target text and what was added/skipped.
function applyRules({ templateText, targetText, kind }) {
  if (!['openspec', 'portable'].includes(kind)) throw new Error(`kind must be openspec or portable (got ${kind})`)
  const tpl = parseRulesYaml(templateText || '', { nested: false })
  const wanted = Object.fromEntries(AREAS.map((a) => [a, tpl[a] || []]))
  if (!AREAS.some((a) => wanted[a].length)) throw new Error('template holds no rules')
  const text = targetText || ''
  const existing = parseRulesYaml(text, { nested: kind === 'openspec' })
  const added = Object.fromEntries(AREAS.map((a) => [a, []]))
  let skipped = 0
  for (const a of AREAS) {
    const have = new Set((existing[a] || []).map(norm))
    for (const r of wanted[a]) { if (have.has(norm(r))) skipped++; else { added[a].push(r); have.add(norm(r)) } }
  }
  if (!AREAS.some((a) => added[a].length)) return { text, added, skipped }

  const lines = text.length ? text.replace(/\n$/, '').split('\n') : []
  const areaIndent = kind === 'openspec' ? '  ' : ''
  const itemIndent = kind === 'openspec' ? '    ' : '  '
  const areaLine = (a) => `${areaIndent}${a}:`
  const itemLines = (rs) => rs.map((r) => `${itemIndent}- ${quote(r)}`)

  // locate the block that holds the areas: [start, end) line indexes
  let blockStart = 0, blockEnd = lines.length
  if (kind === 'openspec') {
    const ri = lines.findIndex((l) => /^rules:\s*(#.*)?$/.test(l))
    if (ri === -1) {
      // no rules: section → append one at EOF with every added area
      const out = [...lines]
      if (out.length && out[out.length - 1].trim() !== '') out.push('')
      out.push('rules:')
      for (const a of AREAS) if (added[a].length) out.push(areaLine(a), ...itemLines(added[a]))
      return { text: out.join('\n') + '\n', added, skipped }
    }
    blockStart = ri + 1
    blockEnd = lines.findIndex((l, i) => i > ri && /^\S/.test(l))
    if (blockEnd === -1) blockEnd = lines.length
  }
  // trailing blank lines inside the block belong after our insertions
  let insertEnd = blockEnd
  while (insertEnd > blockStart && lines[insertEnd - 1].trim() === '') insertEnd--

  const out = [...lines]
  let shift = 0
  for (const a of AREAS) {
    if (!added[a].length) continue
    const re = new RegExp(`^${areaIndent}${a}:\\s*(#.*)?$`)
    const ai = out.findIndex((l, i) => i >= blockStart + shift && i < insertEnd + shift && re.test(l))
    if (ai === -1) {
      out.splice(insertEnd + shift, 0, areaLine(a), ...itemLines(added[a]))
      shift += 1 + added[a].length
      continue
    }
    // last list item of this area: items are lines starting with itemIndent + '- ' until the next area/key
    let last = ai
    for (let i = ai + 1; i < insertEnd + shift; i++) {
      const l = out[i]
      if (l.startsWith(`${itemIndent}- `)) { last = i; continue }
      if (l.trim() === '' || l.startsWith(`${itemIndent} `)) continue   // continuation / blank inside the list
      break
    }
    out.splice(last + 1, 0, ...itemLines(added[a]))
    shift += added[a].length
  }
  return { text: out.join('\n') + '\n', added, skipped }
}

function main(argv) {
  const o = { template: null, target: null, kind: null, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--template') o.template = argv[++i]
    else if (a === '--target') o.target = argv[++i]
    else if (a === '--kind') o.kind = argv[++i]
    else if (a === '--dry-run') o.dryRun = true
    else { process.stderr.write(`apply-rules: unknown argument ${a}\n`); return 1 }
  }
  if (!o.template || !o.target || !o.kind) { process.stderr.write('apply-rules: --template, --target and --kind are required\n'); return 1 }
  let templateText, targetText = ''
  try { templateText = fs.readFileSync(o.template, 'utf8') } catch (e) { process.stderr.write(`apply-rules: cannot read template: ${e.message}\n`); return 1 }
  if (fs.existsSync(o.target)) {
    try { targetText = fs.readFileSync(o.target, 'utf8') } catch (e) { process.stderr.write(`apply-rules: cannot read target: ${e.message}\n`); return 1 }
  }
  let res
  try { res = applyRules({ templateText, targetText, kind: o.kind }) } catch (e) { process.stderr.write(`apply-rules: ${e.message}\n`); return 1 }
  const changed = AREAS.some((a) => res.added[a].length)
  let written = false
  if (changed && !o.dryRun) {
    fs.mkdirSync(path.dirname(o.target), { recursive: true })
    fs.writeFileSync(o.target, res.text)
    written = true
  }
  process.stdout.write(JSON.stringify({ added: res.added, skipped: res.skipped, written, target: o.target }) + '\n')
  return 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))
module.exports = { applyRules }
