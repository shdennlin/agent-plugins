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

## R5 tax (src/pricing.py, src/cart.py)
- \`TAX_RATE\` in src/pricing.py is a fraction (0.08 means 8%). Every price that applies tax multiplies by
  \`1 + TAX_RATE\`; the cart total in src/cart.py must agree with \`with_tax\` to the cent.

## R6 csv rows (src/export.py, src/api.py)
- A field may contain a comma inside double quotes (\`"Doe, Jane"\`). Row parsing must keep such a
  field whole; \`to_csv_row\` and the API's \`parse_csv_line\` must agree on the number of fields.

## R7 last_n_ids (src/legacy_big.py)
- \`last_n_ids(n)\` returns the \`n\` most recent ids, newest first; for \`n=3\` and ids 1..10 it returns
  \`[10, 9, 8]\`.
`

const FILLER = Array.from({ length: 189 }, (_, k) => `def helper_${String(k + 1).padStart(3, '0')}(x):\n    """legacy helper ${k + 1}: unchanged for years"""\n    return x + ${k + 1}\n`).join('\n')
// the filler lands in the FEATURE commit: the seed is buried inside a ~600-line hunk, not an 8-line diff
const BASE_BIG = `def last_n_ids(n):\n    raise NotImplementedError\n`
const FEAT_BIG = FILLER + `\n\ndef last_n_ids(n):\n    ids = list(range(1, 11))\n    return [ids[-i] for i in range(1, n)]\n`

const BASE = {
  'src/parse.py': `def parse_amount(s):\n    raise NotImplementedError\n`,
  'src/importer.py': `def parse_row(cells):\n    raise NotImplementedError\n`,
  'src/paginate.py': `def page(items, number, size):\n    raise NotImplementedError\n`,
  'src/report.py': `def build_report(items):\n    raise NotImplementedError\n`,
  'src/pricing.py': `TAX_RATE = 0.08\n\n\ndef with_tax(price):\n    raise NotImplementedError\n`,
  'src/cart.py': `def cart_total(items):\n    raise NotImplementedError\n`,
  'src/export.py': `def to_csv_row(fields):\n    raise NotImplementedError\n`,
  'src/api.py': `def parse_csv_line(line):\n    raise NotImplementedError\n`,
  'src/legacy_big.py': BASE_BIG,
  'docs/spec.md': SPEC,
}

const FEATURE = {
  // seed type-none: int(None) raises TypeError, not the ValueError R1 demands.
  // seed crossfile-cast (first site): the unchecked int(...) cast that parse_row repeats below
  'src/parse.py': `def parse_amount(s):\n    if isinstance(s, str):\n        s = s.strip()\n    return int(s)\n`,
  // seed crossfile-cast (second site): the same unchecked cast instead of calling parse_amount
  'src/importer.py': `AMOUNT = 2\n\n\ndef parse_row(cells):\n    raw = cells[AMOUNT]\n    return {"sku": cells[0], "qty": cells[1], "amount": int(raw)}\n`,
  // seed boundary-slice: one item short of size
  'src/paginate.py': `def page(items, number, size):\n    start = (number - 1) * size\n    return items[start:start + size - 1]\n`,
  // seed dataflow-stale: `total` is computed over `filtered` but the returned value sums the
  // unfiltered list (no crash: the expression is well-typed, the data flow is wrong)
  'src/report.py': `def build_report(items):\n    filtered = [i for i in items if not i.get("skip")]\n    count = len(filtered)\n    total = sum(i["amount"] for i in filtered)\n    return {"count": count, "total": sum(i["amount"] for i in items)}\n`,
  // seed crossfile-rate: pricing treats TAX_RATE as a fraction, cart treats it as a percent
  'src/pricing.py': `TAX_RATE = 0.08\n\n\ndef with_tax(price):\n    return round(price * (1 + TAX_RATE), 2)\n`,
  'src/cart.py': `from pricing import TAX_RATE\n\n\ndef cart_total(items):\n    subtotal = sum(i["price"] for i in items)\n    return round(subtotal + subtotal * TAX_RATE / 100, 2)\n`,
  // seed crossfile-split: both sides split on a bare comma, so a quoted "Doe, Jane" breaks the row
  'src/export.py': `def to_csv_row(fields):\n    return ",".join(fields)\n\n\ndef from_csv_row(row):\n    return row.split(",")\n`,
  'src/api.py': `def parse_csv_line(line):\n    cells = line.split(",")\n    return {"name": cells[0], "email": cells[1]}\n`,
  // seed buried-range: the only behavioural change in a 600-line legacy module, at its very end
  'src/legacy_big.py': FEAT_BIG,
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
