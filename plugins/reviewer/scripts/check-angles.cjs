#!/usr/bin/env node
// Validate --angles against templates/review-angles.yaml.
//   node check-angles.cjs --section <spec|result> --angles <csv|default>
// stdout: {"section":"result","angles":[...]}   exit 1 + stderr line on any unknown key.
// "default" = every key of the section; for spec, composition is left to the orchestrator's judgment.
'use strict'
const fs = require('fs')
const path = require('path')

const SECTIONS = ['spec', 'result']
const JUDGMENT_ONLY = { spec: ['composition'] }

// 2-space keys under a top-level section; same line rule read-rules.cjs uses, no YAML library.
function sectionKeys(yamlText, section) {
  const keys = []
  let inSection = false
  for (const line of yamlText.split('\n')) {
    if (/^[a-z]+:\s*$/.test(line)) { inSection = line.startsWith(section + ':'); continue }
    const m = inSection && line.match(/^  ([a-z-]+):\s*$/)
    if (m) keys.push(m[1])
  }
  return keys
}

function checkAngles(section, csv, yamlText) {
  if (!SECTIONS.includes(section)) throw new Error(`unknown section '${section}'; valid: ${SECTIONS.join(', ')}`)
  const valid = sectionKeys(yamlText, section)
  const value = String(csv == null ? 'default' : csv).trim()
  if (value === '' || value === 'default') {
    const skip = new Set(JUDGMENT_ONLY[section] || [])
    return { section, angles: valid.filter((k) => !skip.has(k)) }
  }
  const angles = value.split(',').map((s) => s.trim()).filter(Boolean)
  if (angles.length === 0) throw new Error(`no angle given for ${section}; valid: ${valid.join(', ')}`)
  for (const a of angles) {
    if (!valid.includes(a)) throw new Error(`unknown angle '${a}' for ${section}; valid: ${valid.join(', ')}`)
  }
  return { section, angles }
}

function main(argv) {
  const o = { section: null, angles: 'default' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--section') o.section = argv[++i]
    else if (argv[i] === '--angles') o.angles = argv[++i]
    else { process.stderr.write(`check-angles: unexpected argument ${argv[i]}\n`); return 1 }
  }
  if (!o.section) { process.stderr.write('check-angles: --section <spec|result> is required\n'); return 1 }
  const yaml = fs.readFileSync(path.join(__dirname, '..', 'templates', 'review-angles.yaml'), 'utf8')
  try {
    process.stdout.write(JSON.stringify(checkAngles(o.section, o.angles, yaml)) + '\n')
    return 0
  } catch (e) {
    process.stderr.write(`check-angles: ${e.message}\n`)
    return 1
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)))
module.exports = { checkAngles, sectionKeys }
