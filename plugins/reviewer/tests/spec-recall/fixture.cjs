'use strict'
// Builds the scratch Spectra repo the spec harness reviews: one change under openspec/changes/demo/
// with the six seeded defects of seeds.json. Every seed's `phrase` is a literal substring of its file,
// so fixture.test.cjs can assert the oracle and the fixture never drift apart.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const SEEDS = JSON.parse(fs.readFileSync(path.join(__dirname, 'seeds.json'), 'utf8'))
const CHANGE = 'openspec/changes/demo'

const CONFIG = `name: demo
rules:
  proposal:
    - Include a Non-goals section listing what is intentionally excluded
    - "Every decision that changes product behaviour, API shape or scope names at least one alternative that was considered and the reason it was rejected; a decision without alternatives is a finding"
  specs:
    - Cover all edge cases with explicit expected behavior
  design:
    - "Every architecture decision that changes behaviour (data flow, storage, failure handling, boundaries) records the alternatives considered, why they lost, and who decided; a design choice presented without alternatives is a finding"
  tasks:
    - Each task must have a clear done criterion that is verifiable without subjective judgment
`

const FILES = {
  // seed scope-no-nongoals: no Non-goals section anywhere in the proposal
  // seed consistency-contradiction (proposal side): "CSV only" vs the export spec's "JSON and CSV"
  'proposal.md': `# Proposal: numeric parsing service

## Why
Callers hand us raw amount strings from CSV imports and the current code crashes on blanks.

## What changes
- \`parse_amount(s)\` returns an int for numeric input and raises ValueError otherwise.
- Exports are CSV only.
- Imports are rate limited per caller.

## Impact
- src/parse.py, src/importer.py, src/export.py
`,
  // seed design-no-alternatives: §Storage picks SQLite with no alternative or reason
  // seed design-undefined-term: "the budget" is used in §Error handling and defined nowhere
  'design.md': `# Design

## Context
Amounts arrive as strings; some are None when the CSV cell is empty.

## Decisions
- Parsing uses \`int(s)\` directly. Non-numeric input raises ValueError. Alternative considered: a regex pre-check, rejected because int() already reports the offending value.

## Storage
Storage: SQLite, one file per import. The importer opens the file at start and closes it at the end.

## Error handling
Any failure is logged and the row is skipped. When the budget is exhausted the import stops and the caller is told to retry later.

## Rollback
Remove the import entry and delete the SQLite file.
`,
  // seed consistency-contradiction (spec side)
  'specs/export/spec.md': `# Spec: export

## Requirement: Exports are JSON and CSV
The system SHALL export each completed import as JSON and as CSV.

#### Scenario: both formats
- WHEN an import completes
- THEN a .json and a .csv file exist for it
`,
  // seed completeness-no-scenario: a requirement with no scenario at all
  'specs/limits/spec.md': `# Spec: limits

## Requirement: Numeric strings parse to int
The system SHALL return an int for a string of digits.

#### Scenario: plain digits
- WHEN "42" is parsed
- THEN 42 is returned

## Requirement: Imports are rate limited
The system SHALL limit each caller to a fixed number of imports per hour and reject the rest.

## Requirement: Blank cells
The system SHALL treat None as invalid input.

#### Scenario: blank cell
- WHEN None is parsed
- THEN ValueError is raised naming the empty cell
`,
  // seed tasks-no-done: task 3 (line 4) has no verifiable done criterion
  'tasks.md': `# Tasks
- [ ] 1. Implement parse_amount in src/parse.py; done when \`pytest tests/test_parse.py\` passes
- [ ] 2. Wire importer to parse_amount; done when a CSV with a blank cell imports with one skipped row logged
- [ ] 3. Add tests
- [ ] 4. Write the export module; done when both files appear for a completed import
`,
}

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })

function buildFixture(dir) {
  const repo = path.join(dir, 'repo')
  fs.mkdirSync(path.join(repo, 'openspec'), { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'harness@example.invalid')
  git(repo, 'config', 'user.name', 'harness')
  fs.writeFileSync(path.join(repo, 'openspec', 'config.yaml'), CONFIG)
  for (const [rel, text] of Object.entries(FILES)) {
    const p = path.join(repo, CHANGE, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, text)
  }
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'demo change with seeded spec defects')
  return { repo, change: CHANGE }
}

module.exports = { buildFixture, SEEDS, CHANGE }
