# Lane fibers-targeted (2026-11-07)

Branch `me/fibers-targeted` (from `origin/prism-me`, worktree `~/prism-me-lanes/fibers-targeted`).

## Asked

Ludo: no fibers in the yeast slab (a full-atom cellPACK BinaryCIF of zoidpuff.github.io/yeast_cell_viewer, 211k mRNA,
linker DNA, pre-rRNA and FG strands as `<compartment>.fibers.<name>` entities, every 5th nucleotide a point).

## Built

- Test first (`plugin/core/src/state/formats/particles/_test/visuals.test.ts`): a cellPACK file of two fibers and a
  protein, each chain with an atom; red with `['target']` for `['target', 'fibers']`.
- `complexVisuals` (`provider.ts`) adds the fibers representation where the list has fibers, not only where some
  particles are untargeted. The reader needs the fiber's chain in `_atom_site` (the chain → entity map comes from it),
  so a cellPACK fiber's points always have a target: the tubes were never made.

## Open

- The fiber points are still drawn as their target too (one atom each: 2.3M instances in the slab). Whether a fiber
  entity's points should be untargeted in the reader (lighter, the tubes alone) is Ludo's call.
- Master has the same `hasUntargeted` guard: the fix goes there when Ludo says.

## Checks

`npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm format:check`; quick lane of plugin/core,
mesoscale, stage-tools (648 passed), apps/prism-me, cryoet, prism/viewer (1748 passed).

## Review (2026-11-08, lane-reviewer, Opus)

Must-fix 0, should-fix 2, nits 3 (one reported as fine: headers):

1. Should-fix, a library fix on a prism-me lane: recorded in TODO.md "Library fixes ready for upstream" (master has the
   same guard; port when Ludo says) — the PR body's Notes will say so.
2. Should-fix, open items only in this file: "fibre points drawn twice" added to TODO.md Backlog (to decide).
3. Nit, features.md had no line for fibres as tubes: added (Done).
4. Nit, the test did not pin that the fibre points are targeted: it now asserts every fibre point's target is mapped.
   Skeptic pass not run (the two should-fixes are bookkeeping, not behaviour).
