# Seam check (Deep tier only)

Run this only when Step 0 classified the topic as **Deep** — it introduces a new seam
(new module, new public interface, new cross-layer flow, new storage format) or is hard
to reverse once shipped. Topics that only change copy, styling, or wording never run it.

Answer all four before finalizing output, and surface the answers in the mode's output
(assumptions, hypotheses, or interview questions) — not as an internal note.

1. **Location** — where does the new boundary belong? Name the module, file, or store
   that will own the contract.
2. **Adapter count** — is there one adapter on this path, or several thin wrappers
   stacked on each other?
3. **Depth** — what behaviour hides behind the interface? If the answer is "nothing, it
   forwards calls", the seam is too shallow.
4. **Deletion test** — if you deleted this module today, what would break? If nothing
   meaningful breaks, it is a pass-through and probably should not exist.

A Deep topic that fails the Depth or Deletion test is a signal to say so out loud: the
cheapest version of this decision may be not introducing the seam at all.
