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

// Lines the editor understands, per kind. Anything else in the rules block is refused (exit 1) rather
// than edited around: a line edit that guesses wrong produces YAML OpenSpec cannot load.
function checkShape(lines, kind, blockStart, blockEnd, areaIndent, itemIndent, what) {
  const area = new RegExp(`^${areaIndent}[A-Za-z0-9_-]+:\\s*(#.*)?$`)
  const item = new RegExp(`^${itemIndent}- (.*)$`)
  for (let i = blockStart; i < blockEnd; i++) {
    const l = lines[i]
    if (!l.trim() || /^\s*#/.test(l)) continue
    if (area.test(l)) continue
    const m = l.match(item)
    if (m && !/^[>|]/.test(m[1].trim()) && !/^[\[{]/.test(m[1].trim())) continue
    throw new Error(`${what} has a line apply-rules does not understand (line ${i + 1}: ${l.trim()}); edit it by hand`)
  }
}

// Pure: returns the new target text and what was added/skipped.
function applyRules({ templateText, targetText, kind }) {
  if (!['openspec', 'portable'].includes(kind)) throw new Error(`kind must be openspec or portable (got ${kind})`)
  const tpl = parseRulesYaml(templateText || '', { nested: false })
  if (tpl.warnings.length) throw new Error(`template has lines apply-rules does not understand: ${tpl.warnings.join('; ')}`)
  const wanted = Object.fromEntries(AREAS.map((a) => [a, tpl[a] || []]))
  if (!AREAS.some((a) => wanted[a].length)) throw new Error('template holds no rules')
  const text = targetText || ''
  const existing = parseRulesYaml(text, { nested: kind === 'openspec' })
  if (existing.warnings.length) throw new Error(`target has lines apply-rules does not understand: ${existing.warnings.join('; ')}; edit it by hand`)
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

  // the block that holds the areas: [blockStart, blockEnd)
  let blockStart = 0, blockEnd = lines.length
  if (kind === 'openspec') {
    if (lines.some((l) => /^rules:\s*\S/.test(l) && !/^rules:\s*#/.test(l))) throw new Error('target has an inline `rules:` value apply-rules does not understand; edit it by hand')
    const ri = lines.findIndex((l) => /^rules:\s*(#.*)?$/.test(l))
    if (ri === -1) {
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
  checkShape(lines, kind, blockStart, blockEnd, areaIndent, itemIndent, 'target')
  let insertEnd = blockEnd
  while (insertEnd > blockStart && lines[insertEnd - 1].trim() === '') insertEnd--

  const out = [...lines]
  let end = insertEnd   // end of the block in `out`, moves with every insertion
  for (const a of AREAS) {
    if (!added[a].length) continue
    const re = new RegExp(`^${areaIndent}${a}:\\s*(#.*)?$`)
    let ai = -1
    for (let i = blockStart; i < end; i++) if (re.test(out[i])) { ai = i; break }   // the whole block, every time
    if (ai === -1) {
      out.splice(end, 0, areaLine(a), ...itemLines(added[a]))
      end += 1 + added[a].length
      continue
    }
    let last = ai
    for (let i = ai + 1; i < end; i++) {
      const l = out[i]
      if (l.startsWith(`${itemIndent}- `)) { last = i; continue }
      if (l.trim() === '' || /^\s*#/.test(l)) continue
      break
    }
    out.splice(last + 1, 0, ...itemLines(added[a]))
    end += added[a].length
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
