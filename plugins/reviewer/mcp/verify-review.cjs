'use strict'
// verify_review tool handler: validate one verifier's verdicts against the ids in <run_dir>/merged.json,
// then persist them as <run_dir>/verify/<batch>.json. Never throws; failures are isError results.

const fs = require('node:fs')
const path = require('node:path')
const { validateVerify } = require('./schema.cjs')

const fail = (text) => ({ content: [{ type: 'text', text }], isError: true })
const ok = (text) => ({ content: [{ type: 'text', text }] })

function handle(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return fail('verify_review rejected: arguments must be an object')
  const { run_dir: runDir } = args
  if (typeof runDir !== 'string' || !path.isAbsolute(runDir)) return fail('verify_review rejected: run_dir must be an absolute path string')
  const mergedPath = path.join(runDir, 'merged.json')
  if (!fs.existsSync(mergedPath)) return fail(`verify_review rejected: ${mergedPath} not found (run the merge before verifying)`)
  let merged
  try { merged = JSON.parse(fs.readFileSync(mergedPath, 'utf8')) } catch (e) { return fail(`verify_review rejected: ${mergedPath} is not JSON: ${e.message}`) }
  const ids = Array.isArray(merged.issues) ? merged.issues.map((i) => i.id).filter((x) => typeof x === 'string') : []
  const violations = validateVerify(args, ids)
  if (violations.length) return fail(`verify_review rejected (${violations.length} violation(s)), fix and call again:\n${violations.join('\n')}`)
  const realDir = fs.realpathSync(runDir)
  if (!/\/(reviews|reviewer)\/runs\//.test(realDir + '/')) return fail('verify_review rejected: run_dir resolves outside a /reviews/runs/ or /reviewer/runs/ directory')
  const dir = path.join(realDir, 'verify')
  // verify/ must be a real directory inside the run dir: a symlinked verify/ would make this a write
  // anywhere the link points
  try { if (fs.lstatSync(dir).isSymbolicLink()) return fail(`verify_review rejected: ${dir} is a symlink`) } catch (e) { if (e.code !== 'ENOENT') throw e }
  fs.mkdirSync(dir, { recursive: true })
  if (fs.realpathSync(dir) !== dir) return fail(`verify_review rejected: ${dir} resolves outside the run dir`)
  const target = path.join(dir, `${args.batch}.json`)
  try { if (fs.lstatSync(target).isSymbolicLink()) return fail(`verify_review rejected: ${target} is a symlink`) } catch (e) { if (e.code !== 'ENOENT') throw e }
  const out = { ...args, via: 'verify_review', reported_at: new Date().toISOString() }
  fs.writeFileSync(target, JSON.stringify(out, null, 2))
  const n = (st) => args.verdicts.filter((v) => v.status === st).length
  return ok(`wrote verify/${args.batch}.json: confirmed ${n('confirmed')}, refuted ${n('refuted')}, unverified ${n('unverified')}`)
}

function handleVerifyReview(args) {
  try { return handle(args) } catch (err) { return fail(`verify_review failed: ${err && err.message ? err.message : String(err)}`) }
}

module.exports = { handleVerifyReview }
