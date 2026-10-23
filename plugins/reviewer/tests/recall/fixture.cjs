'use strict'
// Builds the scratch repo the recall harness reviews: a `main` commit with correct stubs and a
// `feat` commit whose implementation carries the seeded bugs listed in seeds.json. Every seed's
// `pattern` is a literal fragment of the feature-commit source, so fixture.test.cjs can assert
// the oracle and the fixture never drift apart.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const SEEDS = JSON.parse(fs.readFileSync(path.join(__dirname, 'seeds.json'), 'utf8'))

const SPEC = `# Spec: order amounts, pagination and reporting

## R1 parse_amount (src/parse.py)
- \`parse_amount(s)\` turns a raw amount into an \`int\`.
- The raw value may be a string, or \`None\` when the upstream field is empty.
- Any input that is not a numeric string (including \`None\`, floats written as text, or letters)
  MUST raise \`ValueError\` with a message naming the offending value. No other exception type
  may escape.

## R2 importer (src/importer.py)
- \`parse_row(cells)\` reads the amount cell with the same rules as R1: a non-numeric cell MUST
  raise \`ValueError\`; never let \`TypeError\` escape.

## R3 page (src/paginate.py)
- \`page(items, number, size)\` returns page \`number\` (1-based) holding exactly \`size\` items,
  except the last page which holds the remainder.

## R4 build_report (src/report.py)
- Items flagged \`skip=True\` are excluded from the report: they appear in neither \`count\` nor
  \`total\`.
`

const BASE = {
  'src/parse.py': `def parse_amount(s):\n    raise NotImplementedError\n`,
  'src/importer.py': `def parse_row(cells):\n    raise NotImplementedError\n`,
  'src/paginate.py': `def page(items, number, size):\n    raise NotImplementedError\n`,
  'src/report.py': `def build_report(items):\n    raise NotImplementedError\n`,
  'docs/spec.md': SPEC,
}

const FEATURE = {
  // seed type-none: int(None) raises TypeError, not the ValueError R1 demands
  'src/parse.py': `def parse_amount(s):\n    if isinstance(s, str):\n        s = s.strip()\n    return int(s)\n\n\ndef parse_amount_field(raw):\n    # seed crossfile-cast (first site)\n    return int(raw)\n`,
  // seed crossfile-cast (second site): the same unchecked cast
  'src/importer.py': `AMOUNT = 2\n\n\ndef parse_row(cells):\n    raw = cells[AMOUNT]\n    return {"sku": cells[0], "qty": cells[1], "amount": int(raw)}\n`,
  // seed boundary-slice: one item short of size
  'src/paginate.py': `def page(items, number, size):\n    start = (number - 1) * size\n    return items[start:start + size - 1]\n`,
  // seed dataflow-stale: filtered is computed, the unfiltered list is summed
  'src/report.py': `def build_report(items):\n    filtered = [i for i in items if not i.get("skip")]\n    count = len(filtered)\n    total = sum(i["amount"] for i in filtered)\n    return {"count": count, "total": sum(items)}\n`,
  'docs/spec.md': SPEC,
}

function writeAll(repo, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(repo, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
  }
}

const git = (repo, ...args) =>
  execFileSync('git', ['-C', repo, '-c', 'user.email=recall@test', '-c', 'user.name=recall', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function buildFixture(dir) {
  const repo = path.join(dir, 'repo')
  fs.mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  writeAll(repo, BASE)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'base: stubs and spec')
  git(repo, 'switch', '-q', '-c', 'feat')
  writeAll(repo, FEATURE)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'feat: implement parse, importer, paginate, report')
  return { repo, base: 'main', head: 'feat' }
}

module.exports = { buildFixture, SEEDS, SPEC }
