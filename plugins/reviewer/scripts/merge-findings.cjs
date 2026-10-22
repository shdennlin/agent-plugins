#!/usr/bin/env node
'use strict'
// Deterministic merge of per-angle review reports in a result-review run directory.
//   node merge-findings.cjs <run_dir> --change <rel> [--round <N>] [--no-log] [--log-script <abs>]
// Writes <run_dir>/merged.json, prints it, then (unless --no-log) appends the merged issues to the
// review history through log-findings.sh. Logging is best-effort: a failure is reported, exit stays 0.

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { SEVERITIES, validateReport, normalizePath } = require('../mcp/schema.cjs')

// Loader-stamped metadata, kept off the report's own keys so validateReport is unaffected.
const ANGLE = Symbol('angle') // file basename; wins over report.angle
const PARSE_ERROR = Symbol('parseError') // "<angle>.json: invalid JSON: <message>"

const COVERAGE_RANK = { implemented: 0, partial: 1, missing: 2 }
const sevRank = (s) => {
  const i = SEVERITIES.indexOf(s)
  return i === -1 ? SEVERITIES.length : i
}
const arr = (v) => (Array.isArray(v) ? v : [])
const pathPart = (location) => {
  const s = String(location ?? '')
  const i = s.indexOf(':')
  return normalizePath(i === -1 ? s : s.slice(0, i))
}
const dedupKey = (location) => {
  const s = String(location ?? '')
  const i = s.indexOf(':')
  return i === -1 ? normalizePath(s) : normalizePath(s.slice(0, i)) + s.slice(i)
}
const hasPattern = (p) => typeof p === 'string' && p.trim() !== ''

// { normalizedPath -> addedLines[] } from `diff --git a/<x> b/<y>` sections; a file may repeat.
function addedLinesByFile(diffPatch) {
  const out = new Map()
  let cur = null
  for (const line of String(diffPatch || '').split('\n')) {
    const h = /^diff --git a\/.* b\/(.*)$/.exec(line)
    if (h) {
      cur = normalizePath(h[1])
      if (!out.has(cur)) out.set(cur, [])
    } else if (cur && line.startsWith('+') && !line.startsWith('+++')) {
      out.get(cur).push(line.slice(1))
    }
  }
  return out
}

function merge(manifest, reports, diffPatch) {
  const manifestFiles = arr(manifest && manifest.files)
  const entries = arr(reports)
    .map((r) => ({ r, angle: String((r && r[ANGLE]) ?? (r && r.angle) ?? '') }))
    .sort((a, b) => (a.angle < b.angle ? -1 : a.angle > b.angle ? 1 : 0))

  const angles = []
  const via = {}
  const invalid = []
  const fileReports = new Map() // angle -> Map(normalizedPath -> file entry)
  const byKey = new Map()
  const coverage = new Map()

  for (const { r, angle } of entries) {
    angles.push(angle)
    via[angle] = r && r.via === 'report_review' ? 'report_review' : 'file'
    const perFile = new Map()
    fileReports.set(angle, perFile)
    if (r && r[PARSE_ERROR]) {
      invalid.push({ angle, violations: [r[PARSE_ERROR]] })
      continue
    }
    const violations = validateReport(r, manifestFiles)
    if (violations.length) invalid.push({ angle, violations })
    if (!r || typeof r !== 'object') continue

    for (const f of arr(r.files)) {
      if (f && typeof f.path === 'string') perFile.set(normalizePath(f.path), f)
    }
    for (const issue of arr(r.issues)) {
      if (!issue || typeof issue !== 'object') continue
      const key = dedupKey(issue.location)
      const prev = byKey.get(key)
      if (!prev) {
        byKey.set(key, { worst: issue, recs: [issue.recommendation], patterns: [issue.pattern], angles: new Set([angle]) })
        continue
      }
      prev.angles.add(angle)
      prev.recs.push(issue.recommendation)
      prev.patterns.push(issue.pattern)
      if (sevRank(issue.severity) < sevRank(prev.worst.severity)) {
        prev.patterns.unshift(issue.pattern)
        prev.worst = issue
      }
    }
    for (const c of arr(r.coverage)) {
      if (!c || typeof c.requirement !== 'string') continue
      const prev = coverage.get(c.requirement)
      if (!prev) {
        coverage.set(c.requirement, { ...c })
        continue
      }
      if ((COVERAGE_RANK[c.status] ?? -1) > (COVERAGE_RANK[prev.status] ?? -1)) prev.status = c.status
      if (prev.location === undefined && c.location !== undefined) prev.location = c.location
    }
  }

  const added = addedLinesByFile(diffPatch)
  const issues = [...byKey.values()].map(({ worst, recs, patterns, angles: as }) => {
    const pattern = patterns.find(hasPattern)
    const issue = {
      severity: worst.severity,
      title: worst.title,
      location: worst.location,
      locations: [worst.location],
      category: worst.category,
      ...(pattern !== undefined && { pattern }),
      expected: worst.expected,
      actual: worst.actual,
      impact: worst.impact,
      recommendation: recs.filter((x) => typeof x === 'string' && x !== '').join('\n'),
      angles: [...as].sort(),
    }
    if (pattern !== undefined) {
      const own = pathPart(worst.location)
      for (const [file, lines] of added) {
        if (file === own || issue.locations.includes(file)) continue
        if (lines.some((l) => l.includes(pattern))) issue.locations.push(file)
      }
    }
    return issue
  })
  issues.sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || (a.location < b.location ? -1 : a.location > b.location ? 1 : 0))

  const files = manifestFiles.map((p) => {
    const np = normalizePath(p)
    const seen = angles.map((a) => fileReports.get(a).get(np))
    const notReviewedBy = angles.filter((_, i) => !seen[i])
    const reported = seen.filter(Boolean)
    const issueCount = reported.reduce((n, f) => n + (Number.isInteger(f.issue_count) ? f.issue_count : 0), 0)
    let verdict = 'clean'
    if (notReviewedBy.length) verdict = 'not_reviewed'
    else if (reported.some((f) => f.verdict === 'issues')) verdict = 'issues'
    else if (reported.length && reported.every((f) => f.verdict === 'skimmed')) verdict = 'skimmed'
    return { path: p, verdict, issue_count: issueCount, not_reviewed_by: notReviewedBy }
  })

  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]))
  for (const i of issues) if (i.severity in counts) counts[i.severity]++

  return {
    run_id: manifest && manifest.run_id,
    angles,
    via,
    invalid_reports: invalid,
    files,
    issues,
    coverage: [...coverage.values()],
    verdict: counts.CRITICAL + counts.HIGH > 0 ? 'FAIL' : 'PASS',
    counts,
  }
}

// Every <run_dir>/*.json except manifest.json and merged.json, stamped with its basename as angle.
function loadReports(runDir) {
  return fs
    .readdirSync(runDir)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json' && f !== 'merged.json')
    .sort()
    .map((f) => {
      const angle = f.slice(0, -'.json'.length)
      let r
      try {
        r = JSON.parse(fs.readFileSync(path.join(runDir, f), 'utf8'))
      } catch (e) {
        return { [ANGLE]: angle, [PARSE_ERROR]: `${f}: invalid JSON: ${e.message}` }
      }
      if (!r || typeof r !== 'object' || Array.isArray(r)) {
        return { [ANGLE]: angle, [PARSE_ERROR]: `${f}: report must be a JSON object` }
      }
      r[ANGLE] = angle
      return r
    })
}

function parseArgs(argv) {
  const o = { runDir: null, change: null, round: '1', log: true, logScript: path.join(__dirname, 'log-findings.sh') }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--change') o.change = argv[++i]
    else if (a === '--round') o.round = argv[++i]
    else if (a === '--log-script') o.logScript = argv[++i]
    else if (a === '--no-log') o.log = false
    else if (a.startsWith('--')) throw new Error(`unknown argument: ${a}`)
    else if (o.runDir === null) o.runDir = a
    else throw new Error(`unexpected argument: ${a}`)
  }
  if (!o.runDir) throw new Error('<run_dir> is required')
  if (o.log && !o.change) throw new Error('--change is required unless --no-log')
  if (!o.round) throw new Error('--round needs a value')
  return o
}

function main(argv) {
  const die = (msg) => {
    process.stderr.write(`merge-findings: ${msg}\n`)
    process.exit(2)
  }
  let o, manifest, reports
  try {
    o = parseArgs(argv)
  } catch (e) {
    die(e.message)
  }
  const runDir = path.resolve(o.runDir)
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'))
    reports = loadReports(runDir)
  } catch (e) {
    die(`cannot read run dir ${runDir}: ${e.message}`)
  }
  let diff = ''
  try {
    diff = fs.readFileSync(path.join(runDir, 'diff.patch'), 'utf8')
  } catch {
    // no diff.patch: the pattern sweep simply finds nothing
  }

  const merged = merge(manifest, reports, diff)
  const json = JSON.stringify(merged, null, 2)
  fs.writeFileSync(path.join(runDir, 'merged.json'), json + '\n')
  process.stdout.write(json + '\n')
  if (!o.log) return

  const rows = merged.issues.map((i) => ({
    severity: i.severity,
    title: i.title,
    location: i.location,
    category: i.category,
    engine: '',
    locations: i.locations,
  }))
  const r = spawnSync(o.logScript, ['--change', o.change, '--source', 'result', '--round', String(o.round)], {
    input: JSON.stringify(rows),
    cwd: manifest.working_directory || runDir,
    encoding: 'utf8',
  })
  if (r.status === 0) {
    process.stdout.write(r.stdout.endsWith('\n') ? r.stdout : r.stdout + '\n')
  } else {
    const why = (r.error && r.error.message) || (r.stderr || '').trim() || `exit ${r.status}`
    process.stdout.write(`findings not logged: ${why}\n`)
  }
}

if (require.main === module) main(process.argv.slice(2))

module.exports = { merge, loadReports }
