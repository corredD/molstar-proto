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

## Gate

## Open
