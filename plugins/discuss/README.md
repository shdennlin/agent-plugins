# discuss

Portable framing discussions — assumptions-first design conversations that converge on an
explicit decision. A CLI-free distillation of the `spectra-discuss` workflow for repos that
don't use Spectra.

## Usage

```
/discuss:discuss should search support fuzzy matching?
/discuss:discuss the auth module is getting unwieldy
```

The skill scouts the codebase, then either lists assumptions (enough related code found) or
interviews you one question at a time, compares 2-3 concrete options with a recommendation,
and always ends with an explicit `Decision / Rationale / Risks / Next step` conclusion.

Read-only by design: it never writes code or files.

## When NOT to use

In Spectra repos (`openspec/` exists), prefer `spectra-discuss` — it integrates with
artifact tracking and shared vocabulary.
