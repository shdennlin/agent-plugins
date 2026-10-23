#!/usr/bin/env node
'use strict'
// Deterministic merge of per-angle review reports in a result-review run directory.
//   node merge-findings.cjs <run_dir> --change <rel> [--round <N>] [--no-log] [--log-script <abs>]
//                           [--expect <angle1,angle2,...>]
// --expect names the angles that must have reported; one with no <angle>.json is recorded as an
// invalid report ("no report written") and marks every file not_reviewed.
// Issues dedup on normalized location + lowercased trimmed title; after the pattern sweep, every issue
// that shares a `pattern` (the construct at fault) folds into one, across titles and across files: the
// worst-severity entry survives, the others' titles go into `rationale`, locations are joined.
// merged.json `complete` is false when any report is invalid or any file is not_reviewed; `verdict`
// stays the severity verdict, so a caller must check `complete` before treating PASS as a pass.
// Writes <run_dir>/merged.json, prints it, then (unless --no-log) appends the merged issues to the
// review history through log-findings.cjs. Logging is best-effort: a failure is reported, exit stays 0.

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { SEVERITIES, validateReport, normalizePath } = require('../mcp/schema.cjs')

// Loader-stamped metadata, kept off the report's own keys so validateReport is unaffected.
const ANGLE = Symbol('angle') // file basename; wins over report.angle
const NO_REPORT = Symbol('noReport') // expected angle with no <angle>.json: it has no via
const PARSE_ERROR = Symbol('parseError') // sole violation of an unusable report, e.g. "<angle>.json: invalid JSON: <message>"

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
const normTitle = (t) => String(t ?? '').trim().toLowerCase()
const dedupKey = (location, title) => {
  const s = String(location ?? '')
  const i = s.indexOf(':')
  const loc = i === -1 ? normalizePath(s) : normalizePath(s.slice(0, i)) + s.slice(i)
  return JSON.stringify([loc, normTitle(title)])
}
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const byWorst = (a, b) => sevRank(a.severity) - sevRank(b.severity) || cmpStr(String(a.location), String(b.location))

// Ordered union of locations deduplicated by path part: a `file:function` entry replaces a bare
// swept path for the same file in place; the first entry seen for a path keeps its position.
function unionLocations(lists) {
  const out = []
  const at = new Map() // pathPart -> index in out
  for (const loc of lists.flat()) {
    const p = pathPart(loc)
    if (!at.has(p)) {
      at.set(p, out.length)
      out.push(loc)
    } else if (!String(out[at.get(p)]).includes(':') && String(loc).includes(':')) {
      out[at.get(p)] = loc
    }
  }
  return out
}

// One issue per pattern (the construct at fault), whatever the titles or files. Patterns shorter than
// MIN_PATTERN characters are too generic to identify a construct and never fold.
const MIN_PATTERN = 3
const foldKey = (p) => (typeof p === 'string' && p.trim().length >= MIN_PATTERN ? p.trim() : null)

// The construct a pattern names, independent of the statement around it: `return int(s)`, `x = int(raw)`
// and `int(` all have the head `int(`. Operator/expression patterns are kept whole. Bare identifiers and
// keywords give null (a head sweep on them would spray locations).
const KEYWORDS = new Set(['self', 'none', 'if', 'for', 'return', 'true', 'false', 'null', 'nil', 'this', 'await', 'else', 'while', 'def', 'func', 'var', 'let', 'const'])
function constructHead(pattern) {
  const key = foldKey(pattern)
  if (key === null) return null
  let s = key.replace(/^(return|await|yield)\s+/, '').replace(/^[A-Za-z_][\w.]*\s*(:=|=|\+=|-=)\s*/, '').trim()
  const call = s.match(/^([A-Za-z_][\w.]*)\s*\(/)
  if (call) return `${call[1]}(`
  if (/^[A-Za-z_]\w*$/.test(s)) return KEYWORDS.has(s.toLowerCase()) || s.length < MIN_PATTERN ? null : null
  return s.length >= MIN_PATTERN ? s : null
}
const HEAD_CAP = 5   // a head found in more files than this is too generic to join on

// Fold key: the pattern with the statement around it stripped, whitespace removed, quotes unified, and a
// single call reduced to its head. Two angles describing one construct with different spacing, quoting or
// arguments fold on this key; null below MIN_PATTERN.
function normKey(pattern) {
  const key = foldKey(pattern)
  if (key === null) return null
  let s = key.replace(/^(return|await|yield)\s+/, '').replace(/^[A-Za-z_][\w.]*\s*(:=|=|\+=|-=)\s*/, '').trim()
  const call = s.match(/^([A-Za-z_][\w.]*)\s*\((?:[^()]|\([^()]*\))*\)$/)
  if (call) return `${call[1]}(`
  s = s.replace(/\s+/g, '').replace(/'/g, '"')
  return s.length >= MIN_PATTERN ? s : null
}
const recLines = (r) => String(r ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
function foldByPattern(issues) {
  const groups = new Map()
  const out = []
  for (const i of issues) {
    const k = normKey(i.pattern)
    if (k === null) {
      out.push({ ...i, folded: 0 })
      continue
    }
    if (!groups.has(k)) {
      groups.set(k, [])
      out.push(groups.get(k))
    }
    groups.get(k).push(i)
  }
  // Same-file containment: a group whose key contains a shorter group's key joins it when the two
  // groups share a file (`int(s)` and `int(` on a.py). Never across files on containment alone.
  const keys = [...groups.keys()].sort((x, y) => x.length - y.length)
  for (const longK of keys) {
    const longG = groups.get(longK)
    if (!longG || !longG.length) continue
    for (const shortK of keys) {
      if (shortK === longK || shortK.length >= longK.length || !longK.includes(shortK)) continue
      const shortG = groups.get(shortK)
      if (!shortG || !shortG.length) continue
      const shortFiles = new Set(shortG.map((i) => pathPart(i.location)))
      if (!longG.some((i) => shortFiles.has(pathPart(i.location)))) continue
      shortG.push(...longG.splice(0, longG.length))
      break
    }
  }
  return out.filter((g) => !Array.isArray(g) || g.length).map((g) => {
    if (!Array.isArray(g)) return g
    if (g.length === 1) return { ...g[0], folded: 0 }
    const sorted = [...g].sort(byWorst)
    const [survivor, ...rest] = sorted
    const seenTitles = new Set([normTitle(survivor.title)])
    const rationale = []
    for (const r of rest) {
      if (seenTitles.has(normTitle(r.title))) continue
      seenTitles.add(normTitle(r.title))
      rationale.push(`"${r.title}" (${(r.angles || []).join(', ')})`)
    }
    const recs = []
    for (const l of sorted.flatMap((i) => recLines(i.recommendation))) if (!recs.includes(l)) recs.push(l)
    return {
      ...survivor,
      locations: unionLocations(sorted.map((i) => i.locations)),
      angles: [...new Set(sorted.flatMap((i) => i.angles))].sort(),
      recommendation: recs.join('\n'),
      ...(rationale.length && { rationale: rationale.join('\n') }),
      folded: rest.length,
    }
  })
}
const hasPattern = (p) => typeof p === 'string' && p.trim() !== ''

// Undo git's C-style path quoting ("b/caf\303\251.py"): escapes and octal bytes, decoded as UTF-8.
const C_ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }
function unquoteGitPath(s) {
  if (!(s.length >= 2 && s.startsWith('"') && s.endsWith('"'))) return s
  const bytes = []
  const body = s.slice(1, -1)
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c !== '\\') {
      bytes.push(...Buffer.from(c, 'utf8'))
      continue
    }
    const oct = /^[0-7]{3}/.exec(body.slice(i + 1))
    if (oct) {
      bytes.push(parseInt(oct[0], 8))
      i += 3
    } else {
      const n = body[++i]
      bytes.push(n in C_ESCAPES ? C_ESCAPES[n] : n.charCodeAt(0))
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

// Post-image path from a `+++ ` header; null for `/dev/null` (deleted file) or an unknown shape.
// git appends a tab after a name containing a space; it is not part of the path.
function plusPath(line) {
  const raw = unquoteGitPath(line.slice(4).replace(/\t$/, ''))
  return raw.startsWith('b/') ? normalizePath(raw.slice(2)) : null
}

// { normalizedPath -> addedLines[] }. Each `diff --git ` line starts a section with no file; the file
// comes from its `+++ b/<path>` header (the `diff --git a/x b/y` header is ambiguous when a path holds
// ` b/`). Lines are collected only inside hunks, so a hunk's `+++content` line is an added line.
// A file may appear in several sections (WORKTREE: unstaged then staged diffs).
function addedLinesByFile(diffPatch) {
  const out = new Map()
  let cur = null
  let inHunk = false
  for (const line of String(diffPatch || '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = null
      inHunk = false
    } else if (!inHunk && line.startsWith('+++ ')) {
      cur = plusPath(line)
      if (cur && !out.has(cur)) out.set(cur, [])
    } else if (line.startsWith('@@')) {
      inHunk = true
    } else if (inHunk && cur && line.startsWith('+')) {
      out.get(cur).push(line.slice(1))
    }
  }
  return out
}

// opts.expect: angle names that must have reported; each one without a report becomes an
// invalid_reports entry ("no report written") and is not_reviewed_by on every manifest file.
function merge(manifest, reports, diffPatch, opts = {}) {
  const manifestFiles = arr(manifest && manifest.files)
  const given = arr(reports).map((r) => ({ r, angle: String((r && r[ANGLE]) ?? (r && r.angle) ?? '') }))
  const present = new Set(given.map((e) => e.angle))
  const missing = [...new Set(arr(opts.expect))]
    .filter((a) => typeof a === 'string' && a !== '' && !present.has(a))
    .map((angle) => ({ r: { [NO_REPORT]: true, [PARSE_ERROR]: 'no report written' }, angle }))
  const entries = given
    .concat(missing)
    .sort((a, b) => (a.angle < b.angle ? -1 : a.angle > b.angle ? 1 : 0))

  const angles = []
  const via = {}
  const invalid = []
  const fileReports = new Map() // angle -> Map(normalizedPath -> file entry)
  const byKey = new Map()
  const coverage = new Map()

  for (const { r, angle } of entries) {
    angles.push(angle)
    if (!(r && r[NO_REPORT])) via[angle] = r && r.via === 'report_review' ? 'report_review' : 'file'
    const perFile = new Map()
    fileReports.set(angle, perFile)
    if (r && r[PARSE_ERROR]) {
      invalid.push({ angle, violations: [r[PARSE_ERROR]] })
      continue
    }
    const violations = validateReport(r, manifestFiles, { verdictRule: false })
    if (violations.length) invalid.push({ angle, violations })
    if (!r || typeof r !== 'object') continue

    for (const f of arr(r.files)) {
      if (f && typeof f.path === 'string') perFile.set(normalizePath(f.path), f)
    }
    for (const issue of arr(r.issues)) {
      if (!issue || typeof issue !== 'object') continue
      const key = dedupKey(issue.location, issue.title)
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
    // the sweep uses the same threshold as the fold: a 1–2 char pattern would match every file
    const key = foldKey(pattern)
    if (key !== null) {
      const own = pathPart(worst.location)
      for (const [file, lines] of added) {
        if (file === own || issue.locations.includes(file)) continue
        if (lines.some((l) => l.includes(key))) issue.locations.push(file)
      }
      // second pass on the construct head (`int(` for `return int(s)`), word-bounded on the left and
      // capped: a head present in more than HEAD_CAP other files is too generic to be the same defect
      const head = constructHead(pattern)
      if (head !== null && head !== key) {
        const esc = head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = new RegExp(`(^|[^\\w.])${esc}`)
        const hits = []
        for (const [file, lines] of added) {
          if (file === own || issue.locations.includes(file)) continue
          if (lines.some((l) => re.test(l))) hits.push(file)
        }
        if (hits.length && hits.length <= HEAD_CAP) { issue.locations.push(...hits); issue.swept_by_head = hits }
      }
    }
    return issue
  })
  const folded = foldByPattern(issues).sort(byWorst)

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
  for (const i of folded) if (i.severity in counts) counts[i.severity]++

  return {
    run_id: manifest && manifest.run_id,
    angles,
    via,
    invalid_reports: invalid,
    files,
    issues: folded,
    coverage: [...coverage.values()],
    verdict: counts.CRITICAL + counts.HIGH > 0 ? 'FAIL' : 'PASS',
    complete: invalid.length === 0 && files.every((f) => f.verdict !== 'not_reviewed'),
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
  const o = { runDir: null, change: null, round: '1', expect: [], log: true, logScript: path.join(__dirname, 'log-findings.cjs') }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--change') o.change = argv[++i]
    else if (a === '--round') o.round = argv[++i]
    else if (a === '--log-script') o.logScript = argv[++i]
    else if (a === '--no-log') o.log = false
    else if (a === '--expect') o.expect = String(argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
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

  const merged = merge(manifest, reports, diff, { expect: o.expect })
  const json = JSON.stringify(merged, null, 2)
  fs.writeFileSync(path.join(runDir, 'merged.json'), json + '\n')
  process.stdout.write(json + '\n')
  if (!o.log) return

  // v2 rows: the merge is always the Claude engine's result review; pattern and run_id travel along
  const rows = merged.issues.map((i) => ({
    severity: i.severity,
    title: i.title,
    location: i.location,
    category: i.category,
    engine: 'claude',
    engines: ['claude'],
    locations: i.locations,
    pattern: typeof i.pattern === 'string' && i.pattern.trim() ? i.pattern : null,
  }))
  const isNode = /\.c?js$/.test(o.logScript)
  const logArgs = ['--change', o.change, '--source', 'result', '--round', String(o.round), ...(manifest.run_id ? ['--run-id', String(manifest.run_id)] : [])]
  const r = spawnSync(isNode ? process.execPath : o.logScript, isNode ? [o.logScript, ...logArgs] : logArgs, {
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

module.exports = { merge, loadReports, foldByPattern, constructHead, normKey }
