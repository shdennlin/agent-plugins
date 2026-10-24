'use strict'
// Scores one merged.json (from scripts/merge-findings.cjs) against the seed oracle.
// Match rule: an issue hits a seed when its text matches one of the seed's titleHints AND one of
// its locations (fallback: location) has the seed's file as path part AND (the location names the
// seed's function OR the location has no function). A crossFile seed additionally needs ONE issue
// whose locations cover every listed file; a hinted issue covering some of them makes it `partial`.
// The hint is always required: an unrelated remark about the seeded function is not a hit.
// Each seed counts once (`matched` says how many issues hit it); issues matching no seed are `extra`.
const { normalizePath } = require('../../mcp/schema.cjs')

function pathPart(location) {
  const s = String(location ?? '')
  const i = s.indexOf(':')
  return normalizePath(i === -1 ? s : s.slice(0, i))
}
function funcPart(location) {
  const s = String(location ?? '')
  const i = s.indexOf(':')
  if (i === -1) return null
  const f = s.slice(i + 1).trim()
  return f && !/^\d+$/.test(f) ? f : null   // a bare line number is not a function
}

const issueLocations = (issue) => {
  const locs = Array.isArray(issue.locations) && issue.locations.length ? issue.locations : [issue.location]
  return locs.filter(l => typeof l === 'string' && l.trim())
}
const issueText = (issue) => [issue.title, issue.expected, issue.actual, issue.impact, issue.recommendation]
  .filter(v => typeof v === 'string').join('\n')
const hintMatches = (seed, issue) => {
  const text = issueText(issue)
  return (seed.titleHints || []).some(h => new RegExp(h, 'i').test(text))
}

// plain seed: does this issue hit it?
function plainMatch(seed, issue) {
  if (!hintMatches(seed, issue)) return false
  for (const loc of issueLocations(issue)) {
    if (pathPart(loc) !== normalizePath(seed.file)) continue
    const fn = funcPart(loc)
    if (!fn || fn === seed.function) return true
  }
  return false
}

// crossFile seed: 'hit' when one issue covers every file, 'partial' when it covers some, else null
function crossMatch(seed, issue) {
  if (!hintMatches(seed, issue)) return null
  const files = new Set(issueLocations(issue).map(pathPart))
  const covered = seed.crossFile.filter(f => files.has(normalizePath(f)))
  if (covered.length === seed.crossFile.length) return 'hit'
  return covered.length ? 'partial' : null
}

// opts.preVerify: the merge before `--apply-verify` (merged.pre-verify.json). With it, the score also
// reports what verification did: hits/extra before, how many issues it refuted, and the seeds that were
// hit before and are not hit after (false refutations — recall lost to the verifier).
function scoreRun(merged, seeds, opts = {}) {
  const after = scoreIssues(merged, seeds)
  const pre = opts.preVerify && Array.isArray(opts.preVerify.issues) ? scoreIssues(opts.preVerify, seeds) : null
  return {
    ...after,
    before: pre ? { hits: pre.hits, extra: pre.extra } : null,
    refuted: Array.isArray(merged?.refuted) ? merged.refuted.length : 0,
    false_refutation: pre ? pre.hits.filter((id) => !after.hits.includes(id)) : [],
    complete: merged?.complete,
    verdict: merged?.verdict,
    counts: merged?.counts,
  }
}

function scoreIssues(merged, seeds) {
  const issues = Array.isArray(merged?.issues) ? merged.issues : []
  const status = new Map(seeds.map(s => [s.id, 'miss']))
  const matched = Object.fromEntries(seeds.map(s => [s.id, 0]))
  const matchedIssues = new Set()
  for (const seed of seeds) {
    for (const issue of issues) {
      const m = Array.isArray(seed.crossFile) ? crossMatch(seed, issue) : (plainMatch(seed, issue) ? 'hit' : null)
      if (!m) continue
      matchedIssues.add(issue)
      if (m === 'hit') matched[seed.id]++
      if (m === 'hit') status.set(seed.id, 'hit')
      else if (status.get(seed.id) !== 'hit') status.set(seed.id, 'partial')
    }
  }
  const by = (k) => seeds.filter(s => status.get(s.id) === k).map(s => s.id)
  // severity-match rate over hit seeds with an expectedSeverity: the worst severity among the issues
  // that hit the seed is compared with the expected one (exact, or within one level)
  const ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
  const severity = { exact: 0, within1: 0, n: 0 }
  for (const seed of seeds) {
    if (status.get(seed.id) !== 'hit' || !ORDER.includes(seed.expectedSeverity)) continue
    const worst = issues.filter(i => matchedIssues.has(i) && (Array.isArray(seed.crossFile) ? crossMatch(seed, i) === 'hit' : plainMatch(seed, i)))
      .map(i => ORDER.indexOf(String(i.severity || '').toUpperCase())).filter(x => x >= 0)
    if (!worst.length) continue
    const got = Math.max(...worst), want = ORDER.indexOf(seed.expectedSeverity)
    severity.n++
    if (got === want) severity.exact++
    if (Math.abs(got - want) <= 1) severity.within1++
  }
  return {
    hits: by('hit'),
    severity,
    partial: by('partial'),
    misses: by('miss'),
    extra: issues.filter(i => !matchedIssues.has(i)).length,
    matched,
  }
}

module.exports = { scoreRun, pathPart, funcPart }
