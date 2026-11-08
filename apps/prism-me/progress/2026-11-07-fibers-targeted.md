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

## PR body (draft; not opened)

`gh pr create -R corredD/molstar-proto --base prism-me --head me/fibers-targeted --title "plugin: a cellPACK list's default visuals show its fibers whose points have a target" --body-file <this section>`

### What

A cellPACK file's fibres (entities below a `fibers` compartment) never showed as tubes: `complexVisuals` added the
fibers representation only where some particles had no target, and a cellPACK fibre's chain must have an atom in
`_atom_site` (the reader maps the chain to the fibre entity through it), so its points always have one.

### Changes

- `complexVisuals` (`packages/plugin/core/src/state/formats/particles/provider.ts`) adds the fibers representation
  wherever the list has fibres, its points targeted or not (still one representation).
- `features.md`: cellPACK fibres as tubes, Done. TODO: the master port; "fibre points drawn twice" (to decide).
- Changelog `.v6/changelogs/fibers-targeted.md`.

### Notes for review

- A library fix made on a prism-me lane; master has the same `hasUntargeted` guard: the port waits on Ludo.
- Fibre points keep their one-atom target under the tubes (the yeast slab: 2.3M extra instances): whether the reader
  should leave fibre points untargeted is open (TODO.md Backlog).

### Testing

- `visuals.test.ts`: a cellPACK CIF of two fibres and a protein, each chain one atom: `['target']` before the fix,
  `['target', 'fibers']` after; it asserts every fibre point's target is mapped (the case it guards).
- `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm format:check`, `pnpm check:workspace` (after
  `node scripts/workspace/assets.mjs`), quick lane of plugin/core, mesoscale, stage-tools (648) and apps/prism-me,
  cryoet, prism/viewer (1748).
- In the app: the yeast slab's fibres drawn (Ludo, 2026-11-07); a mesobuild exosome loads in prism-me's own composition
  (headless) with a target and a fibers representation.

### Review

Lane-reviewer (Opus): 0 must-fix, 2 should-fix, 3 nits, addressed in 00f941648 (above).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
