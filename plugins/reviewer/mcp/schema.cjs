'use strict'
// report_review contract: the inputSchema the MCP server advertises, plus a
// dependency-free validator (no ajv; marketplace installs do not run npm install).

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
const FILE_VERDICTS = ['clean', 'skimmed', 'issues']
const COVERAGE_STATUSES = ['implemented', 'missing', 'partial']

const str = { type: 'string' }

const ISSUE_SCHEMA = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: SEVERITIES },
    title: { type: 'string', minLength: 1 },
    location: { type: 'string', minLength: 1 },
    category: { type: 'string', minLength: 1 },
    pattern: str,
    expected: str,
    actual: str,
    impact: str,
    recommendation: { type: 'string', minLength: 1 },
  },
  required: ['severity', 'title', 'location', 'category', 'expected', 'actual', 'impact', 'recommendation'],
  additionalProperties: false,
}

const FILE_SCHEMA = {
  type: 'object',
  properties: {
    path: str,
    verdict: { type: 'string', enum: FILE_VERDICTS },
    issue_count: { type: 'integer', minimum: 0 },
  },
  required: ['path', 'verdict', 'issue_count'],
  additionalProperties: false,
}

const COVERAGE_SCHEMA = {
  type: 'object',
  properties: {
    requirement: str,
    status: { type: 'string', enum: COVERAGE_STATUSES },
    location: str,
  },
  required: ['requirement', 'status'],
  additionalProperties: false,
}

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    run_dir: str,
    angle: str,
    files: { type: 'array', items: FILE_SCHEMA },
    issues: { type: 'array', items: ISSUE_SCHEMA },
    coverage: { type: 'array', items: COVERAGE_SCHEMA },
    via: str,
    reported_at: str,
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
  },
  required: ['run_dir', 'angle', 'files', 'issues', 'verdict'],
  additionalProperties: false,
}

const typeOk = (t, v) => {
  if (Array.isArray(t)) return t.some((x) => typeOk(x, v))
  switch (t) {
    case 'null': return v === null
    case 'string': return typeof v === 'string'
    case 'integer': return Number.isInteger(v)
    case 'array': return Array.isArray(v)
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v)
    default: return true
  }
}

// Structural check of `value` against `schema`, pushing "<path>: <problem>".
function checkShape(value, schema, path, out) {
  if (!typeOk(schema.type, value)) {
    out.push(`${path}: must be ${Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type}`)
    return
  }
  if (value === null) return
  if (schema.enum && !schema.enum.includes(value)) {
    out.push(`${path}: must be one of ${schema.enum.join(', ')} (got ${JSON.stringify(value)})`)
  }
  if (schema.minimum !== undefined && value < schema.minimum) {
    out.push(`${path}: must be >= ${schema.minimum}`)
  }
  if (schema.minLength !== undefined && typeof value === 'string' && value.length < schema.minLength) {
    out.push(schema.minLength === 1 ? `${path}: must not be empty` : `${path}: must be at least ${schema.minLength} characters`)
  }
  if (schema.minItems !== undefined && Array.isArray(value) && value.length < schema.minItems) {
    out.push(`${path}: must have at least ${schema.minItems} item(s)`)
  }
  if (schema.type === 'array' && schema.items) {
    value.forEach((v, i) => checkShape(v, schema.items, `${path}[${i}]`, out))
  }
  if (schema.type === 'object') {
    const join = (k) => (path ? `${path}.${k}` : k)
    for (const k of schema.required || []) {
      if (!(k in value)) out.push(`${join(k)}: required`)
    }
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties && schema.properties[k]) checkShape(v, schema.properties[k], join(k), out)
      else if (schema.additionalProperties === false) out.push(`${join(k)}: unknown property`)
    }
  }
}

const RUNS_SEGMENT = /\/(reviews|reviewer)\/runs\//

// Canonical spelling of a diff path. The rule order is a contract (the Task 4 setup script's
// sed must match it; pinned by tests/fixtures/normalize-cases.json):
//   1. collapse runs of `/`   2. `{a => b}` segment -> b (b may be empty)   3. whole-path `a => b` -> b
//   4. strip leading `./` repeatedly   5. strip trailing `/`   6. strip one leading `/` left by an empty-target brace
// Runs of `/` are collapsed again after step 2, since an empty target can leave `src//f.py`.
function normalizePath(p) {
  if (typeof p !== 'string') return p
  return p
    .replace(/\/{2,}/g, '/')
    .replace(/\{[^{}]* => ([^{}]*)\}/g, '$1')
    .replace(/\/{2,}/g, '/')
    .replace(/^.* => /, '')
    .replace(/^(\.\/)+/, '')
    .replace(/\/$/, '')
    .replace(/^\//, '')
}

// An issue location is `<path>` or `<path>:<detail>`; in spec mode also `<path> §<section>`.
// Only the path part is normalized.
const locationPath = (location, mode) => {
  let s = location
  if (mode === 'spec') { const j = s.indexOf(' §'); if (j !== -1) s = s.slice(0, j) }
  const i = s.indexOf(':')
  return i === -1 ? s : s.slice(0, i)
}
const issueAt = (location, p, mode) => typeof location === 'string' && normalizePath(locationPath(location, mode)) === p

// opts.verdictRule (default true): reject a verdict that contradicts the issues. The report_review
// tool keeps it (the agent can retry); the merge turns it off because it recomputes the verdict from
// the issues and a file-written report must not become "invalid" over a label.
// opts.mode: 'spec' (from manifest.mode) reviews spec documents — `coverage` is not allowed and a
// location may be `<path> §<section>`; anything else is the result mode.
function validateReport(report, manifestFiles, opts = {}) {
  const verdictRule = opts.verdictRule !== false
  const mode = opts.mode === 'spec' ? 'spec' : 'result'
  const out = []
  if (!typeOk('object', report)) return [': report must be an object']
  checkShape(report, REPORT_SCHEMA, '', out)
  if (mode === 'spec' && report.coverage !== undefined) out.push('coverage: not allowed in spec mode (spec files have no requirement coverage)')
  const shapeOk = out.length === 0 // manifest rules assume a well-formed shape

  if (typeof report.run_dir === 'string' && !(report.run_dir.startsWith('/') && RUNS_SEGMENT.test(report.run_dir + '/'))) {
    out.push('run_dir: must be an absolute path inside a /reviews/runs/ or /reviewer/runs/ directory')
  }
  if (typeof report.run_dir === 'string' && /(^|\/)\.\.(\/|$)/.test(report.run_dir)) {
    out.push('run_dir: must not contain a .. segment')
  }
  if (!shapeOk) return out

  // verdict must agree with the issues: PASS cannot carry a CRITICAL/HIGH issue, FAIL needs at least one issue
  const blocking = report.issues.filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH').length
  if (verdictRule && report.verdict === 'PASS' && blocking > 0) out.push(`verdict: PASS but ${blocking} CRITICAL/HIGH issue(s) reported`)
  if (verdictRule && report.verdict === 'FAIL' && report.issues.length === 0) out.push('verdict: FAIL but no issues reported')

  const manifest = new Set(manifestFiles.map(normalizePath))
  const reported = new Set(report.files.map((f) => normalizePath(f.path)))
  for (const p of manifestFiles) {
    if (!reported.has(normalizePath(p))) out.push(`files: ${p} missing (every manifest path must be reported)`)
  }
  report.files.forEach((f, i) => {
    const at = `files[${i}]`
    if (!manifest.has(normalizePath(f.path))) out.push(`${at}: ${f.path} not in manifest`)
    if (f.verdict !== 'issues' && f.issue_count > 0) {
      out.push(`${at}: ${f.path} is ${f.verdict} but issue_count ${f.issue_count}`)
      return
    }
    if (f.verdict === 'issues' && f.issue_count < 1) {
      out.push(`${at}: ${f.path} verdict issues but issue_count ${f.issue_count}`)
      return
    }
    const n = report.issues.filter((x) => issueAt(x.location, normalizePath(f.path), mode)).length
    if (f.issue_count !== n) {
      out.push(`${at}: ${f.path} issue_count ${f.issue_count} but ${n} issue(s) point at it`)
    }
  })
  return out
}

// --- history.jsonl row, schema version 3 (written only by scripts/log-findings.cjs)
const ENGINES = ['claude', 'codex', 'code-review', 'spectra-review']
const OTHER_ENGINE = /^other:[a-z0-9][a-z0-9:_-]*$/
const nonEmpty = { type: 'string', minLength: 1 }
// A structured location: the path plus whichever detail the reviewer gave; `raw` keeps the original
// string when it could not be parsed into one of the forms (see log-findings.cjs parseLocation).
const HISTORY_LOCATION = {
  type: 'object',
  properties: {
    path: nonEmpty,
    line: { type: 'integer', minimum: 1 },
    endLine: { type: 'integer', minimum: 1 },
    symbol: nonEmpty,
    section: nonEmpty,
    raw: nonEmpty,
  },
  required: ['path'],
  additionalProperties: false,
}
// What became of the finding: open (reported, not acted on), fixed (the fixer applied it), escalated
// (handed to a human), dismissed (judged not real / out of scope), residual (still open when the loop
// ended), unknown (migrated or logged without a fix loop's result).
const OUTCOMES = ['open', 'fixed', 'escalated', 'dismissed', 'residual', 'unknown']
const HISTORY_ROW = {
  type: 'object',
  properties: {
    v: { type: 'integer', enum: [3] },
    ts: nonEmpty,
    change: nonEmpty,
    source: { type: 'string', enum: ['spec', 'spec-dual', 'result'] },
    round: { type: 'integer', minimum: 1 },
    run_id: { type: ['string', 'null'] },
    engine: nonEmpty,                                   // vocabulary checked in validateHistoryRow
    engines: { type: 'array', items: nonEmpty, minItems: 1 },
    severity: { type: 'string', enum: SEVERITIES },
    category: nonEmpty,
    title: nonEmpty,
    location: nonEmpty,
    locations: { type: 'array', items: HISTORY_LOCATION, minItems: 1 },
    pattern: { type: ['string', 'null'] },
    outcome: { type: 'string', enum: OUTCOMES },
  },
  required: ['v', 'ts', 'change', 'source', 'round', 'run_id', 'engine', 'engines', 'severity', 'category', 'title', 'location', 'locations', 'pattern', 'outcome'],
  additionalProperties: false,
}

// change id as stored: no leading ./, no doubled or trailing slashes, trimmed
function normalizeChange(s) {
  return String(s ?? '').trim().replace(/^(\.\/)+/, '').replace(/\/{2,}/g, '/').replace(/\/+$/, '')
}

const engineOk = (e) => ENGINES.includes(e) || OTHER_ENGINE.test(e)

function validateHistoryRow(row) {
  const out = []
  if (!typeOk('object', row)) return [': row must be an object']
  checkShape(row, HISTORY_ROW, '', out)
  if (typeof row.engine === 'string' && row.engine && !engineOk(row.engine)) {
    out.push(`engine: must be one of ${ENGINES.join(', ')} or other:<skill> (got ${JSON.stringify(row.engine)})`)
  }
  if (Array.isArray(row.engines)) row.engines.forEach((e, i) => { if (typeof e === 'string' && e && !engineOk(e)) out.push(`engines[${i}]: must be one of ${ENGINES.join(', ')} or other:<skill>`) })
  return out
}

module.exports = { REPORT_SCHEMA, SEVERITIES, validateReport, normalizePath, HISTORY_ROW, HISTORY_LOCATION, OUTCOMES, ENGINES, validateHistoryRow, normalizeChange }
