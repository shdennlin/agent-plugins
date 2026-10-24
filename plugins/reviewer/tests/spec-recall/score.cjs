'use strict'
// Scores one /reviewer:spec merged.json against seeds.json. A seed hits when an issue sits in the seed's
// file (the change prefix stripped), one of its titleHints matches the issue's text, and the issue is at
// the seed: its location names the seed's section or line, or its pattern/title contains the seed's phrase,
// or the location has no detail at all. Verification fields mirror tests/recall/score.cjs.
const ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

function splitLocation(loc, change) {
  let s = String(loc ?? '').trim()
  if (change && s.startsWith(change + '/')) s = s.slice(change.length + 1)
  let section = null, line = null
  const j = s.indexOf(' §')
  if (j !== -1) { section = s.slice(j + 2).trim(); s = s.slice(0, j) }
  const i = s.indexOf(':')
  if (i !== -1) { const d = s.slice(i + 1); if (/^\d+/.test(d)) line = Number(d.match(/^\d+/)[0]); s = s.slice(0, i) }
  return { file: s.replace(/^\.\//, ''), section, line }
}
const issueText = (issue) => [issue.title, issue.expected, issue.actual, issue.impact, issue.recommendation].filter((v) => typeof v === 'string').join('\n')
const hintMatches = (seed, issue) => (seed.titleHints || []).some((h) => new RegExp(h, 'i').test(issueText(issue)))
const locationsOf = (issue) => (Array.isArray(issue.locations) && issue.locations.length ? issue.locations : [issue.location]).filter((l) => typeof l === 'string' && l.trim())

function atSeed(seed, issue, change) {
  const phraseIn = [issue.pattern, issue.title].some((v) => typeof v === 'string' && v.includes(seed.phrase))
  for (const loc of locationsOf(issue)) {
    const { file, section, line } = splitLocation(loc, change)
    if (file !== seed.file) continue
    if (seed.section && section && section.toLowerCase().includes(seed.section.toLowerCase())) return true
    if (seed.line && line === seed.line) return true
    if (phraseIn) return true
    if (!section && line === null) return true
  }
  return false
}

function scoreIssues(merged, seeds, change) {
  const issues = Array.isArray(merged?.issues) ? merged.issues : []
  const status = new Map(seeds.map((s) => [s.id, 'miss']))
  const matched = Object.fromEntries(seeds.map((s) => [s.id, 0]))
  const matchedIssues = new Set()
  for (const seed of seeds) for (const issue of issues) {
    if (!hintMatches(seed, issue) || !atSeed(seed, issue, change)) continue
    matchedIssues.add(issue); matched[seed.id]++; status.set(seed.id, 'hit')
  }
  const severity = { exact: 0, within1: 0, n: 0 }
  for (const seed of seeds) {
    if (status.get(seed.id) !== 'hit' || !ORDER.includes(seed.expectedSeverity)) continue
    const got = Math.max(...issues.filter((i) => matchedIssues.has(i) && hintMatches(seed, i) && atSeed(seed, i, change)).map((i) => ORDER.indexOf(String(i.severity || '').toUpperCase())).filter((x) => x >= 0), -1)
    if (got < 0) continue
    const want = ORDER.indexOf(seed.expectedSeverity)
    severity.n++; if (got === want) severity.exact++; if (Math.abs(got - want) <= 1) severity.within1++
  }
  const by = (k) => seeds.filter((s) => status.get(s.id) === k).map((s) => s.id)
  return { hits: by('hit'), partial: [], misses: by('miss'), matched, severity, extra: issues.filter((i) => !matchedIssues.has(i)).length }
}

function scoreRun(merged, seeds, change, opts = {}) {
  const after = scoreIssues(merged, seeds, change)
  const pre = opts.preVerify && Array.isArray(opts.preVerify.issues) ? scoreIssues(opts.preVerify, seeds, change) : null
  return {
    ...after,
    before: pre ? { hits: pre.hits, extra: pre.extra } : null,
    refuted: Array.isArray(merged?.refuted) ? merged.refuted.length : 0,
    false_refutation: pre ? pre.hits.filter((id) => !after.hits.includes(id)) : [],
    complete: merged?.complete, verdict: merged?.verdict, counts: merged?.counts,
  }
}

module.exports = { scoreRun, splitLocation }
