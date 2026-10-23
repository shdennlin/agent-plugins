#!/usr/bin/env node
// Resolve `/reviewer:result -c <token>` into the exact Skill invocation from templates/review-engines.yaml.
//   node resolve-engine.cjs --token <level|skill> --spec <path>... [--base <ref>] [--manifest <run_dir>/manifest.json]
// stdout JSON: { engine, level, skill, args, never_pass, findings_from, severity_map, notes, scope, scope_note,
//                base: { name, given }, change_name }
// The base comes from --base when given, else from the manifest the setup script wrote (base_name;
// WORKTREE when empty), so the engine reviews the same range the spec review did. Exit 1 + stderr for an
// unknown level, a level on a level-less engine, a level-required engine without one, or no base source.
'use strict'
const fs = require('fs')
const path = require('path')

// Line parser for the engines file: entries at 2 spaces, fields at 4, map entries at 6, list items at 6,
// folded scalars (`>`) continue on 6-space lines, inline arrays `[a, b]` or JSON.
function parseEngines(text) {
  const engines = {}
  let entry = null, field = null, mode = null
  const scalar = (v) => { const s = v.replace(/\s+#.*$/, '').trim(); const m = s.match(/^"(.*)"$/) || s.match(/^'(.*)'$/); return m ? m[1] : s }
  const inlineArray = (s) => { try { return JSON.parse(s) } catch { return s.slice(1, -1).split(',').map((x) => scalar(x)).filter(Boolean) } }
  for (const raw of text.split('\n')) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue
    let m
    if ((m = raw.match(/^  ([A-Za-z_-]+):\s*$/))) { entry = engines[m[1]] = {}; field = null; mode = null; continue }
    if (!entry) continue
    if ((m = raw.match(/^    ([A-Za-z_-]+):\s*(.*)$/))) {
      field = m[1]; const v = m[2].trim()
      if (v === '>' || v === '|') { entry[field] = ''; mode = 'folded' }
      else if (v === '') { entry[field] = null; mode = 'block' }
      else if (v.startsWith('[')) { entry[field] = inlineArray(v.replace(/\s+#.*$/, '')); mode = null }
      else { entry[field] = scalar(v); mode = null }
      continue
    }
    if ((m = raw.match(/^      - (.*)$/)) && mode === 'block') { if (!Array.isArray(entry[field])) entry[field] = []; entry[field].push(scalar(m[1])); continue }
    if ((m = raw.match(/^      ([^:\s][^:]*):\s*(.*)$/)) && mode === 'block') { if (entry[field] === null) entry[field] = {}; entry[field][m[1].trim()] = scalar(m[2]); continue }
    if (mode === 'folded' && /^      /.test(raw)) { entry[field] = (entry[field] ? entry[field] + ' ' : '') + raw.trim(); continue }
  }
  return engines
}

function changeNameOf(specPaths) {
  for (const p of specPaths) { const m = String(p).match(/(?:^|\/)openspec\/changes\/([^/]+)\/?/); if (m) return m[1] }
  return specPaths[0] ? String(specPaths[0]) : ''
}

function resolveEngine({ token, specPaths = [], base = null, manifest = null }, yamlText) {
  if (!token) throw new Error("-c needs an engine: a /code-review level or a review skill name (e.g. spectra-review)")
  const engines = parseEngines(yamlText)
  let key = null, level = null
  for (const [k, e] of Object.entries(engines)) if (Array.isArray(e.levels) && e.levels.includes(token)) { key = k; level = token; break }
  if (!key) {
    if (/^(low|medium|high|xhigh|max)$/.test(token)) throw new Error(`level '${token}' matches no engine that accepts levels`)
    key = token
  }
  const entry = engines[key] || { ...engines._default, skill: token }
  if (entry.level_required === 'true' && !level) throw new Error(`engine '${key}' needs a level: -c <${(entry.levels || []).join(' | ')}>`)
  const scope = entry.scope || 'base'
  let baseName = null, given = false, scopeNote = ''
  if (base) { baseName = base; given = true }
  else if (manifest && typeof manifest.base_name === 'string' && manifest.base_name) baseName = manifest.base_name
  else if (manifest && manifest.diff_strategy === 'WORKTREE') { baseName = null; scopeNote = 'the spec review diffed the working tree against HEAD (no base branch); the engine reviews HEAD' }
  else if (!manifest) throw new Error('no base: pass --base <ref> or --manifest <run_dir>/manifest.json')
  const changeName = changeNameOf(specPaths)
  const fill = (s) => String(s || '').replace(/<level>/g, level || '').replace(/<base>/g, baseName || 'HEAD').replace(/<change-name>/g, changeName).replace(/<spec-paths>/g, specPaths.join(' '))
  let args = fill(entry.args).replace(/\s{2,}/g, ' ').trim()
  if (given && entry.base_arg) args = (args + fill(entry.base_arg)).trim()
  return {
    engine: key, level, skill: entry.skill, args,
    never_pass: entry.never_pass || [], findings_from: entry.findings_from || '', severity_map: entry.severity_map || {}, notes: entry.notes || [],
    scope, scope_note: scopeNote, base: { name: baseName, given }, change_name: changeName,
  }
}

function main(argv) {
  const o = { token: null, spec: [], base: null, manifest: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--token') o.token = argv[++i]
    else if (a === '--spec') { while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) o.spec.push(argv[++i]) }
    else if (a === '--base') o.base = argv[++i]
    else if (a === '--manifest') o.manifest = argv[++i]
    else { process.stderr.write(`resolve-engine: unknown argument ${a}\n`); return 1 }
  }
  try {
    const yaml = fs.readFileSync(path.join(__dirname, '..', 'templates', 'review-engines.yaml'), 'utf8')
    const manifest = o.manifest ? JSON.parse(fs.readFileSync(o.manifest, 'utf8')) : null
    process.stdout.write(JSON.stringify(resolveEngine({ token: o.token, specPaths: o.spec, base: o.base, manifest }, yaml)) + '\n')
    return 0
  } catch (e) { process.stderr.write(`resolve-engine: ${e.message}\n`); return 1 }
}

if (require.main === module) process.exit(main(process.argv.slice(2)))
module.exports = { resolveEngine, parseEngines }
