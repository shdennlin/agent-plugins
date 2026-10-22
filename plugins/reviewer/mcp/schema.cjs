'use strict'
// report_review contract: the inputSchema the MCP server advertises, plus a
// dependency-free validator (no ajv; marketplace installs do not run npm install).

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
const FILE_VERDICTS = ['clean', 'issues']
const COVERAGE_STATUSES = ['implemented', 'missing', 'partial']

const str = { type: 'string' }

const ISSUE_SCHEMA = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: SEVERITIES },
    title: str,
    location: str,
    category: str,
    pattern: str,
    expected: str,
    actual: str,
    impact: str,
    recommendation: str,
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
const issueAt = (location, p) => typeof location === 'string' && (location === p || location.startsWith(p + ':'))

function validateReport(report, manifestFiles) {
  const out = []
  checkShape(report, REPORT_SCHEMA, '', out)
  const shapeOk = out.length === 0 // manifest rules assume a well-formed shape

  if (typeof report.run_dir === 'string' && !(report.run_dir.startsWith('/') && RUNS_SEGMENT.test(report.run_dir + '/'))) {
    out.push('run_dir: must be an absolute path inside a /reviews/runs/ or /reviewer/runs/ directory')
  }
  if (!shapeOk) return out

  const manifest = new Set(manifestFiles)
  const reported = new Set(report.files.map((f) => f.path))
  for (const p of manifestFiles) {
    if (!reported.has(p)) out.push(`files: ${p} missing (every manifest path must be reported)`)
  }
  report.files.forEach((f, i) => {
    const at = `files[${i}]`
    if (!manifest.has(f.path)) out.push(`${at}: ${f.path} not in manifest`)
    if (f.verdict === 'clean' && f.issue_count > 0) {
      out.push(`${at}: ${f.path} is clean but issue_count ${f.issue_count}`)
      return
    }
    const n = report.issues.filter((x) => issueAt(x.location, f.path)).length
    if (f.issue_count !== n) {
      out.push(`${at}: ${f.path} issue_count ${f.issue_count} but ${n} issue(s) point at it`)
    }
  })
  return out
}

module.exports = { REPORT_SCHEMA, SEVERITIES, validateReport }
