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

## Gate

## Open
