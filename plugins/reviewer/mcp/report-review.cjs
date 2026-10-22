'use strict'
// report_review tool handler: validate a review report against the run manifest,
// then persist it as <run_dir>/<angle>.json. Never throws; failures are isError results.

const fs = require('node:fs')
const path = require('node:path')
const { validateReport } = require('./schema.cjs')

const fail = (text) => ({ content: [{ type: 'text', text }], isError: true })
const ok = (text) => ({ content: [{ type: 'text', text }] })

function handle(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return fail('report_review rejected: arguments must be an object')
  }
  const { run_dir: runDir } = args
  if (typeof runDir !== 'string' || !path.isAbsolute(runDir)) {
    return fail('report_review rejected: run_dir must be an absolute path string')
  }
  const manifestPath = path.join(runDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    return fail(`report_review rejected: ${manifestPath} not found (run_dir must contain manifest.json)`)
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (!manifest || !Array.isArray(manifest.files)) {
    return fail(`report_review rejected: ${manifestPath} has no "files" array`)
  }

  const violations = validateReport(args, manifest.files)
  if (violations.length > 0) {
    return fail(`report_review rejected (${violations.length} violation(s)), fix and call again:\n${violations.join('\n')}`)
  }

  // angle becomes a filename: restrict it to a plain slug and protect orchestrator-owned files.
  if (!/^[a-z][a-z0-9_-]*$/i.test(args.angle) || args.angle.toLowerCase() === 'manifest') {
    return fail('report_review rejected: angle must match [a-z][a-z0-9_-]* and must not be "manifest"')
  }
  // Resolve symlinks in run_dir and keep the write inside a runs directory.
  const realDir = fs.realpathSync(runDir)
  if (!/\/(reviews|reviewer)\/runs\//.test(realDir + '/')) {
    return fail('report_review rejected: run_dir resolves outside a /reviews/runs/ or /reviewer/runs/ directory')
  }
  const target = path.join(realDir, `${args.angle}.json`)
  try {
    if (fs.lstatSync(target).isSymbolicLink()) return fail(`report_review rejected: ${target} is a symlink`)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  const out = { ...args, via: 'report_review', reported_at: new Date().toISOString() }
  fs.writeFileSync(target, JSON.stringify(out, null, 2))
  return ok(`wrote ${args.angle}.json: ${args.files.length} file(s), ${args.issues.length} issue(s), verdict ${args.verdict}`)
}

function handleReportReview(args) {
  try {
    return handle(args)
  } catch (err) {
    return fail(`report_review failed: ${err && err.message ? err.message : String(err)}`)
  }
}

module.exports = { handleReportReview }
