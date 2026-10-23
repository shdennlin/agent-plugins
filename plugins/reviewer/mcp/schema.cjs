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
    category: str,
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
  switch (t) {
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
    out.push(`${path}: must be ${schema.type}`)
    return
  }
  if (schema.enum && !schema.enum.includes(value)) {
    out.push(`${path}: must be one of ${schema.enum.join(', ')} (got ${JSON.stringify(value)})`)
  }
  if (schema.minimum !== undefined && value < schema.minimum) {
    out.push(`${path}: must be >= ${schema.minimum}`)
  }
  if (schema.minLength !== undefined && typeof value === 'string' && value.length < schema.minLength) {
    out.push(schema.minLength === 1 ? `${path}: must not be empty` : `${path}: must be at least ${schema.minLength} characters`)
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

// An issue location is `<path>` or `<path>:<detail>`; only the path part is normalized.
const issueAt = (location, p) => {
  if (typeof location !== 'string') return false
  const i = location.indexOf(':')
  return normalizePath(i === -1 ? location : location.slice(0, i)) === p
}

// opts.verdictRule (default true): reject a verdict that contradicts the issues. The report_review
// tool keeps it (the agent can retry); the merge turns it off because it recomputes the verdict from
// the issues and a file-written report must not become "invalid" over a label.
function validateReport(report, manifestFiles, opts = {}) {
  const verdictRule = opts.verdictRule !== false
  const out = []
  if (!typeOk('object', report)) return [': report must be an object']
  checkShape(report, REPORT_SCHEMA, '', out)
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
    const n = report.issues.filter((x) => issueAt(x.location, normalizePath(f.path))).length
    if (f.issue_count !== n) {
      out.push(`${at}: ${f.path} issue_count ${f.issue_count} but ${n} issue(s) point at it`)
    }
  })
  return out
}

module.exports = { REPORT_SCHEMA, SEVERITIES, validateReport, normalizePath }
