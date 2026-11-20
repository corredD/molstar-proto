# LOD bands: evaluators, structures per entity, silhouettes (2026-11-20, lane `mvs-lod-bands`)

## Brief

Ludo (2026-11-20): "goal here is to have a branch that work on the LOD / BAND spec. spec can call different (e.g.
david's comment …). and we can test with the current Spheres LOD and the draft silhouette imposter." Then: "write the
band spec draft for me, and go with A since we want to test we actually need the data."

David's comment, as Ludo relayed it: conditionals evaluated from the camera position and the scene state, fast to
evaluate, possibly a reference to some runtime, as `(Band :evaluator xxx :params (…))`.

- **Branch** `me/mvs-lod-bands` from `me/mesoviewspec` (`a60c0fd95`), with `origin/prism-me` (`ecd830ae0`: lod-impostor,
  the silhouettes) merged in (`4a3ed96ce`). Worktree `~/prism-me-lanes/mvs-lod-bands`.
- **The spec** (proposed v0.6, for Ludo, then David): `_spec/bands.md`. A band names an evaluator from a registry, with
  params the validator checks; evaluators are pure and run either per copy (on the GPU, where the renderer can switch
  per copy) or per scene (on the camera's rest); a band may blend into the next. `silhouette` becomes a representation
  hint. The named bands decided on 2026-11-11 stay valid (`:size` is shorthand).
- **Scope A** (Ludo): a document's entities are drawn from their structures, so the sphere levels and the silhouettes
  have atoms to work on. An entity's `structure` resource (a PDB accession today) is loaded through Mol\*'s loader and
  becomes its target in the list (`ParticleList.targetMapping`); without one, or while loading, the copy stays a sphere.
- **Bands drive what core has, no core change:** a population whose near rule is `structure` and whose far rule is
  `silhouette` on a `meso.size` or `meso.distance` boundary gets prism-me's `lodImpostor` with `lodImpostorBy` and the
  threshold; otherwise `lodImpostor` off (the sphere levels alone). A blend other than prism-me's 0.5 octave is drawn at
  0.5 and said (`bands.blend`). Scene evaluators (the eye inside a compartment, the view shown) are evaluated on the
  camera's rest and change those params out of History (view state, as streamed tiles).
- **Not in this lane:** a core change (the blend width as a param; per-copy switches for other representations);
  `envelope` and `detail` per band; `source` per band; clocks.
- **First fixture:** exosome (one entity with a structure: catalase, 8CAT). Not yeast's 4V88 (a ribosome, large).
- **Tests first**, the gate (Opus reviewer, Opus skeptic), app check through the API (no WebGL here: params read as the
  camera moves), then Ludo's check by eye.

## Log

- `4a3ed96ce`: `origin/prism-me` (`ecd830ae0`) merged in. Conflicts: mesoscale `operations.ts` (git aligned prism-me's
  new grow code against colors-by-zoom; prism-me's side taken and the owned list's redraw re-applied in colors-by-zoom),
  explorer `operations.ts` (prism-me's list data as drawn; a document's list still no row), explorer `ui.tsx` (both),
  `features.md` (prism-me's rows and the five MesoViewSpec rows), `TODO.md` and `current.md` (prism-me's). Types clean;
  the failures left are the base's (below).
- `43584ea22`: the spec draft, `_spec/bands.md`; pointers in views.md, README.md, design.md (decision 15; 14 is the
  placement proposal's).
- `dd7c6587a` (tests) `dc1ed359b`: entities drawn from their structures. Decided: the structures load inside the step
  that makes the list (an open waits for them: about 1 s for 8CAT), so Undo restores lists with their targets; a type
  without one, or one that fails, stays a sphere.
- `7f01bce51` (tests) `21c35fbd8`: bands, evaluators, scale rules, `silhouette`; the references regenerated (through a
  one-off vitest run of `generateReference`: `pnpm spec` does not run on Windows). `runtime/index.ts` is rewritten LF
  (it was CRLF, one of the base's "no Mol\* header" misses).
- `20ee41366` (tests) `5c0cb0e18`: the band plan and the adapter. Found on the way: the adapter drew document lists with
  `spacefill`, which draws one sphere a copy and ignores targets; a list with structures now has a `target`
  representation beside its spheres (`excludeTargets`), as prism-me draws a painted structure. And the app's tests
  opening exosome reached RCSB (8CAT); `fetchBinary` now carries structure fetches, and a host that gives `fetchText`
  without it fetches none (the tests' harnesses), so the tests stay off the network.
- The `exosome-bands` example (`mesoviewspec.open {example: 'exosome-bands'}`), its fixtures given as files.
- Checks: types clean; mesoscale molstar, extension and prism-me medium suites 189 pass. Unit failures are the base's 15
  on Windows: `cli.test` (8) and `spec.test` (5) (ESM `c:` URLs, CRLF headers, `symbol.unknown` unregistered),
  `one-look-writer` (path separator), `paint-mode` "Place Auto keeps the mesh…" (fails on `origin/prism-me` alone too).

- Gate fixes: `c060a4acf` (validation, view edits, partial rules), `faac7dbb0` (the band plan), `8b0ccfc6b` (loading),
  `dd6d16265` (the adapter). Medium suites 195 pass; unit failures the base's 15.
- App check through the API (port 1390, `mesoviewspec.open {example: 'exosome-bands'}`, after the fixes): opens in 1.5
  s, 8CAT from RCSB; both catalase lists drawn by a `target` representation beside their spheres, silhouettes by size
  below 12 px; the lumen view turns them off, the overview on again; `mesoscale.impostors {pixels: 30}` on them, then
  the camera moved and left to rest (the pane hidden: a draw signalled by hand), 12 px again; no console error. Not seen
  on a GPU (no WebGL here): Ludo's check.

## Gate

Reviewer (Opus) and skeptic (Opus), read-only, on `4a3ed96ce..587595586`. R = reviewer, S = skeptic.

| Finding                                                                                                                  | Verdict              | Fix                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------ |
| R1, S10: a camera rest's write races a commit (a stale plan, a write to a list deleted)                                  | confirmed (reading)  | a commit waits for a rest's write in flight; a rest writes nothing while a commit runs; no throw |
| S2, R4: a list the bands wrote keeps its silhouettes when no rule that holds targets it                                  | confirmed (S ran it) | what it had is kept and put back                                                                 |
| S3, R3: a distance band from 0 gives `lodImpostorDistance: 0`, prism-me's automatic distance                             | confirmed (S ran it) | silhouettes everywhere: a tiny distance                                                          |
| S1: `validate` throws on an evaluator that is no string                                                                  | confirmed (S ran it) | refused (`bands.shape`)                                                                          |
| S4, R9: a view's bands not checked (another evaluator, overlaps as the view has them, not a list, an id twice)           | confirmed (S ran it) | all checked, at the view's entry                                                                 |
| R2: an Undo or a person's toggle not drawn over until a scene band flips                                                 | confirmed            | a rest writes wherever the params differ; bands.md: the bands own them                           |
| R5: two commits at once load a structure twice, one never disposed                                                       | confirmed (reading)  | the load is kept, shared                                                                         |
| R6, S8: an abort, or a network failure, kept as a failure for the adapter's life                                         | confirmed (reading)  | neither kept; the structures let go when the owner is disposed                                   |
| R7: the declared format not passed; a query in the address                                                               | confirmed            | the format passed; the file named without its query                                              |
| R8: an edit that gives a kept list's entity another structure is not loaded                                              | confirmed            | not fixed: said in bands.md (a kept list's data is its owner's, kept for Undo); taken at re-pack |
| R10: an edit to bands or rules classified as a model edit (a full compile)                                               | confirmed            | `classifyEdit` strips `bands` and `scales`                                                       |
| R11: no test of the camera rest, Undo, view overlaps, distance 0, a retry                                                | confirmed            | tests for each                                                                                   |
| S5, R13: `spheres` on a structure type drawn as atoms unsaid; `fade` drawn as dither unsaid                              | confirmed (S ran it) | said (`representation.fallback`, `bands.blend`)                                                  |
| S6: later rules do not always win (a surface-only rule skipped; a held scene rule and gaps; a scene rule and a distance) | confirmed (S ran it) | hints painted on the measure's line in rule order                                                |
| S7: a rule on part of a type dropped unsaid                                                                              | confirmed (S ran it) | `scales.partial`                                                                                 |
| S9: `adopt` keeps stale band state; a fresh-page restore fills lists without structures                                  | confirmed (reading)  | `adopt` loads the structures and takes the restored view's bands; `forget`, `clear` drop them    |
| S11: a re-pack loses the `target` representation's params; a stripped one not redrawn                                    | confirmed (reading)  | kept on re-pack; a list missing it is drawn again                                                |
| S12: size with a range; overlap only between neighbours; a blend wider than its band                                     | confirmed (S ran it) | refused                                                                                          |
| R12: the plan throws on a copy band without a range                                                                      | confirmed            | filtered                                                                                         |
| S15: a superstructure's entities never drawn from structures                                                             | confirmed            | looked up there too                                                                              |
| R14, S15: two doc comments above one function                                                                            | confirmed            | moved back                                                                                       |
| R15: `runtime/index.ts` rewritten LF                                                                                     | confirmed            | CRLF as it was, the exports added                                                                |
| R16: the viewport in drawing-buffer pixels                                                                               | confirmed            | over the pixel ratio                                                                             |
| R16: a rest's issues never shown                                                                                         | confirmed            | not fixed: said in bands.md (said at the next commit)                                            |
| R17: `bands.overlap` without ids                                                                                         | confirmed            | both bands' ids                                                                                  |
| R7: a `selection` ignored, not in the key                                                                                | confirmed            | in the key; not applied, said                                                                    |
| S13: `IRView.scales` rebuilt each view edit                                                                              | confirmed, harmless  | none (the adapter diffs the params)                                                              |
| S14: the CPU measures differ from the GPU's (Euclidean distance, full radius)                                            | plausible            | none yet: only scene tests run on the CPU                                                        |

## Open

- Ludo's check by eye (GPU): `exosome-bands` on 1390, zoom out on the catalase (atoms, then silhouettes below 12 px with
  the dither), the lumen view (atoms at every size).
- David reads `_spec/bands.md` (its four open questions).
- Not built (bands.md "Not yet"): a switch between other representations, `envelope`, `detail`, `source` per band; CPU
  copy measures; evaluators from extensions; `bands` in the S-expression spelling; a selection applied; a kept list
  given another structure by an edit.
- The paint lane `mvs-paint-docs` merges prism-me too: both lanes resolve the same conflicts; whichever merges second
  into `me/mesoviewspec` takes the other's resolutions.
