# MesoViewSpec (lane `mesoviewspec`, branch `me/mesoviewspec`)

Started 2026-11-06 by Ludo (pasted brief); written up 2026-11-08, after the fact: the lane ran as one long session, not
as lanes (no progress file, no review gate until now). Ludo, 2026-11-08: "did you use the lane approach?"; yes to
bringing it in line.

## Brief

Design **MesoViewSpec**, a declarative meta-format for mesoscale science (populations, compartments, superstructures,
relations, evidence, views), with its IR and a small runtime prototype, tested in Storybook.

- Deliverables: a design doc for David (`packages/mesoscale/_spec/design.md`), Mol\* renderer recommendations for Alex
  (`_spec/renderer-recommendations.md`), paired MesoViewSpec/IR examples, Storybook prototypes, three test lanes (quick,
  medium, heavy), references cited.
- Packages: `packages/mesoscale/spec` (`@molstar/meso-spec`, no Mol\* imports, a Biome rule enforces it) and
  `packages/mesoscale/molstar` (`@molstar/meso-molstar`: the Prism adapter, session, stories under "MesoViewSpec").
- Ludo checks: the stories in Storybook (port 6006, `storybook/`), the design doc (also a Claude doc, rev 38).
- Size: not sized up front (it was a design prototype). Now ~11k production lines, ~1.6k test lines, ~1.5k doc lines.
- Model: Opus throughout (no Sonnet steps). Not split into lanes.

## Built

| Version | Commits                         | What                                                                                                                                                                       |
| ------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.1    | 0882d83c9 … 96e11d255           | format, validation, IR (placement sets, keyed resolution), runtime, resolvers (meso.pack, bilayer, lattice, fiber, precomputed, cellPACKgpu), Prism adapter, stories, docs |
| v0.2    | 9629980d6 … db76a1eaf           | S-expression spelling, MesoQL + MesoLoci, superstructures (β-cell ISG), relations with sites (HU on DNA), refine stages (meso.relax), MesoCraft mapped, design.md v0.2     |
| v0.3    | ef295653b, 68f059814, 185107024 | the semantic camera (focus by address, framing, from outside, cutaway, tours), instances (copies stated one by one, stable ids), design.md §3.13, §5.1, decision 12        |

Tests at 185107024: quick 85, medium 4 (+1 skipped), heavy 6.

## Decided

- Ludo: a new prism-me lane (not master); never pushed before he signs off.
- Ludo: the S-expression spelling in the UI (v0.2).
- David (Slack, after v0.1): MesoQL, superstructures, relations with bends, application composition; then "the semantic
  layer to control the camera", "streaming concepts", "a population is just how we do things now". Refinements and the
  S-expression spelling were already in v0.2.
- Claude, open for David (design.md §11, decisions 1-12): among them, whether to restructure the top level around the
  organization (12), tiles (5).

## Learned

- Keyed resolution by projection carried superstructures, relations, refine stages, the camera and instances without a
  new mechanism.
- An ordinal (`(copies p.granules 12)`) is not an identity: a repack makes it another copy. Instances are.
- Relax overclaimed until the final exact-mesh check (advisor): 0.77 Å, 0 outside.

## Review gate (2026-11-08, on `origin/prism-me...me/mesoviewspec`)

Pending: reviewers by area (format; IR + runtime; resolvers; Mol\* adapter + stories), then skeptics.

## Next

- The gate's fixes.
- Streaming as its own lane (`mesoviewspec-streaming`, from `me/mesoviewspec`): manifest of tiles and levels (level 0
  statistical, 1 copies, 2 atoms), provider, budget, camera-driven coarse-first; heavy-lane R5 measurement.
- The Claude doc from rev 38; the memory note.
