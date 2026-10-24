'use strict'
// Shared by tests/recall/run.mjs and tests/spec-recall/run.mjs: aggregate per-run scores into a summary
// and render the console table. Both runners' per-run objects have the same shape (score.cjs output
// plus run/ok/file/seconds).
function summarize(runs, seeds) {
  const ok = runs.filter((r) => r.ok)
  const perSeed = Object.fromEntries(seeds.map((s) => [s.id, { kind: s.kind, hits: 0, partial: 0, matched: 0, outOf: ok.length }]))
  for (const r of ok) {
    for (const id of r.hits) perSeed[id].hits++
    for (const id of r.partial || []) perSeed[id].partial++
    for (const [id, n] of Object.entries(r.matched || {})) perSeed[id].matched += n
  }
  const recall = (r) => r.hits.length / seeds.length
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  return {
    seeds: seeds.length, runs, okRuns: ok.length,
    meanRecall: mean(ok.map(recall)), meanExtra: mean(ok.map((r) => r.extra)), perSeed,
    meanExtraBefore: mean(ok.filter((r) => r.before).map((r) => r.before.extra)),
    refuted: ok.reduce((a, r) => a + (r.refuted || 0), 0),
    falseRefutation: ok.reduce((a, r) => a + (r.false_refutation || []).length, 0),
    severity: ok.reduce((acc, r) => ({ exact: acc.exact + (r.severity?.exact || 0), within1: acc.within1 + (r.severity?.within1 || 0), n: acc.n + (r.severity?.n || 0) }), { exact: 0, within1: 0, n: 0 }),
  }
}

function table(summary) {
  const lines = ['run | ok | recall | hits | partial | extra (before → after) | refuted | false refutation | complete | verdict | seconds']
  for (const r of summary.runs) {
    const extra = r.ok ? (r.before ? `${r.before.extra} → ${r.extra}` : String(r.extra)) : '-'
    lines.push(r.ok
      ? `${r.run} | yes | ${(r.hits.length / summary.seeds).toFixed(2)} | ${r.hits.join(',') || '-'} | ${(r.partial || []).join(',') || '-'} | ${extra} | ${r.refuted || 0} | ${(r.false_refutation || []).join(',') || '-'} | ${r.complete} | ${r.verdict}${r.seconds ? ` | ${r.seconds}s` : ''}`
      : `${r.run} | NO | - | - | - | - | - | - | - | ${r.error}`)
  }
  lines.push('', 'seed | kind | hits/outOf | partial | issues per hit')
  for (const [id, s] of Object.entries(summary.perSeed)) lines.push(`${id} | ${s.kind} | ${s.hits}/${s.outOf} | ${s.partial} | ${s.hits ? (s.matched / s.hits).toFixed(1) : '-'}`)
  lines.push('', `mean recall ${summary.meanRecall === null ? '-' : summary.meanRecall.toFixed(2)} over ${summary.okRuns} ok run(s); mean extra ${summary.meanExtra === null ? '-' : summary.meanExtra.toFixed(1)}`)
  const sv = summary.severity || { exact: 0, within1: 0, n: 0 }
  lines.push(`severity match over ${sv.n} hit seed(s): exact ${sv.n ? (sv.exact / sv.n).toFixed(2) : '-'}, within one level ${sv.n ? (sv.within1 / sv.n).toFixed(2) : '-'}`)
  lines.push(`verification: refuted ${summary.refuted || 0} issue(s); false refutation ${summary.falseRefutation || 0}; mean extra before ${summary.meanExtraBefore === null || summary.meanExtraBefore === undefined ? '-' : summary.meanExtraBefore.toFixed(1)} → after ${summary.meanExtra === null ? '-' : summary.meanExtra.toFixed(1)}`)
  return lines.join('\n')
}

// exit code for a finished summary: 1 when recall is under the gate or verification refuted a seed hit
function gate(summary, runs, minRecall) {
  if (minRecall !== null && (summary.meanRecall === null || summary.meanRecall < minRecall)) return `mean recall below --min-recall ${minRecall}`
  if (summary.falseRefutation > 0) {
    const names = [...new Set(runs.flatMap((r) => r.false_refutation || []))]
    return `verification refuted ${summary.falseRefutation} seed hit(s): ${names.join(', ')} — recall lost to the verifier`
  }
  return null
}

module.exports = { summarize, table, gate }
