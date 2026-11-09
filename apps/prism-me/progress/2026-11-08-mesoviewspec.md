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

## Review gate (2026-11-08, on `origin/prism-me...me/mesoviewspec` at e7aaade87)

Four Opus reviewers by area (format; IR + runtime; resolvers; Mol\* adapter + stories), then a skeptic per area that
re-ran every probe. Each confirmed must-fix and should-fix was fixed in a branch of its own (`me/mvs-gate-<area>`, one
Opus fixer each, a test failing first, one commit a cause), merged back with `--no-ff`. 0 findings refuted outright; one
refuted in part (R9: the adapter does evict).

| Area              | Must-fix                                                                                            | Should-fix                                                                           | Nits                 | Fixed in                                             | Left open                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| format            | 5 (F1, F3, F4, FN1, FN6)                                                                            | 7 (F2, F5, F6, F8, F9, FN3, FN4)                                                     | F7, F10, F11, FN7    | merge 0874232cb (19 commits)                         | `:range` syntax; `(entity nil)`                                                                                                  |
| IR + runtime      | 2 (R1 `within` on parts throws, R2 nested looks)                                                    | 6 (R3 two refiners, R4 + RN1 frames and up, R5, R6 refine chains, R10 template sets) | R7, R8, R9, R12      | merge 4bdd76306 (14 commits); R3 in the format merge | RN2 (depth-2 expansions recomputed), R11, the view path skips validation, nested `part`                                          |
| resolvers         | 6 (S1 fiber carry, S3 mesh margin, S4 relax children, S5 150k throw, S6 + S7 lattice pole and seed) | 6 (S2, S8 obstacles, S9 persistence, S10 STAR origins, S11 scaling, SN1, SN2)        | S12                  | merge d7b79dbf0 (13 commits)                         | binder poses vs obstacles; a traced fiber through an obstacle is reported, not moved                                             |
| adapter + stories | 1 (A1 overlapping edits orphan a list)                                                              | 4 (AN1 Prism undo, A2 + A3 MVS export, A4 first camera)                              | A5, A7, A9, A10, AN2 | merge 7e8df92a3 (11 commits)                         | A6 story dispose, A8 fov, AN3 shared store; `typecheck:storybook` fails at prism/viewer styles.ts:114 (pre-existing on prism-me) |

Notable: the shipped exosome had 35 ALB copies inside the vesicle's membrane margin (S3) and relax reported them as
inside (S4); the β-cell `v.docked` camera looked along its own up (RN1); `within` on a `part` crashed `compile` (R1).
Spec changes from the fixes are in design.md §3.7-3.9, §4.5, §5.1, §6.1, §6.3, §6.7 (relax 0.77 → 0.78 Å).

After the merges: quick 147, medium 8 (+1 skipped: no `gl`), heavy 6, `test:scaling` 2 (relax n vs 4n: ×2.9 time, ×4.0
allocation; was ×13.3); `tsc -b`, the app's tsc, lint, format:check, check:workspace pass. Findings and verdicts in
full: the reviewers' and skeptics' reports (session scratchpad `gate/*.md`).

## Next

- Streaming as its own lane (`mesoviewspec-streaming`, from `me/mesoviewspec`): manifest of tiles and levels (level 0
  statistical, 1 copies, 2 atoms), provider, budget, camera-driven coarse-first; heavy-lane R5 measurement.
- The Claude doc from rev 38; the memory note.
