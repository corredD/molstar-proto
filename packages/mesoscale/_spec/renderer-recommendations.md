# Mol\* renderer: recommendations from the MesoViewSpec prototypes

What the MesoViewSpec prototypes showed about rendering mesoscale scenes in Mol\* through Prism. It is meant to be
shared with Alex to discuss priorities. The prototype changes nothing in the renderer: every finding below was observed
from outside it.

- **Context:** the design is in [design.md](design.md); §8 has every measurement and how it was taken.
- **Scenes:** placement sets as particle lists (`ParticleList`), one `spacefill` `ParticlesRepresentation3D` per list,
  and looks as Prism layers (`particles.look` → `ParticleRepresentation3DLayers`).
- **Labels:**
  - **confirmed**: reproduced by a test or story;
  - **observed**: seen, cause not established;
  - **hypothesis**: an explanation not yet tested.
- **Every finding is placed in a layer:** renderer, plugin API, adapter, IR, resolver, language. Only renderer findings
  get a recommendation here; the others are listed at the end so they are not mistaken for renderer limits.
- **Hardware:** Ludo's Mac (Apple M1 Pro). Node uses headless `gl`; the browser is Chromium, headed, via Playwright.

## Priorities

| #   | Finding                                                        | Layer                        | Status                             | Impact on mesoscale workflows                                           | Priority                  |
| --- | -------------------------------------------------------------- | ---------------------------- | ---------------------------------- | ----------------------------------------------------------------------- | ------------------------- |
| R1  | A per-type color or visibility edit costs O(copies)            | renderer (looks / overpaint) | confirmed                          | recoloring, hiding a population, look animation on 10⁶–10⁷ copies       | **P1**                    |
| R3  | About 87 B a copy held by the representation beyond its inputs | renderer                     | observed; attribution a hypothesis | sets the ceiling on scene size (10⁷ copies ≈ 0.9 GB more)               | **P1** (measure first)    |
| R4  | Sub-pixel copies alias into moiré                              | renderer (impostors, LOD)    | observed                           | whole-cell and membrane views, where most copies are under a pixel      | P2                        |
| R2  | A radius and a key are required per copy                       | renderer / model API         | confirmed                          | 8 B a copy, an O(N) pass at load                                        | P2                        |
| R5  | One list and representation per placement set                  | renderer / plugin            | hypothesis, untested               | tiled scenes (the yeast cell's 6,416 tiles) would be thousands of lists | P3                        |
| R6  | In-memory data enter the state only through a side store       | plugin API                   | confirmed                          | sessions holding generated data cannot be saved or restored             | P2 (plugin, not renderer) |

## R1. A per-type look edit costs O(copies) — confirmed

**Use case.**

- Recoloring one population of a large scene: "show catalase in red".
- Hiding the lipids, or changing a population's transparency.
- Animating looks: highlighting the populations an annotation cites.

These are view edits. The format guarantees they never touch placements, so the remaining cost is the renderer's.

**Observed.**

- The adapter writes one layer per type: one `particles.look` call, 1 to 14 layers.
- No list or representation object is replaced (checked by identity in the medium lane).
- The time still grows with the number of copies:

  | Scene   | Copies    | Look commit (state) | To the next image / frame | Where       |
  | ------- | --------- | ------------------- | ------------------------- | ----------- |
  | pack    | 50,000    | 9.4 ms              | 292 ms (image)            | Node + `gl` |
  | bilayer | 1,000,038 | 112 ms              | 1709 ms (image)           | Node + `gl` |
  | pack    | 50,000    | —                   | 16 ms (frame)             | Chromium    |
  | bilayer | 1,000,038 | —                   | **49 ms** (frame)         | Chromium    |

- In the same runs the runtime's own share of the edit is N-independent: `updateView` 0.1 ms and `planCommit` 0.1 ms at
  1M copies.
- At 1M copies a color edit therefore misses a 16 ms frame budget, entirely inside Mol\*/Prism.

**Reproduce.**

- Smallest: Storybook _MesoViewSpec › Performance › Probe_: _bilayer 1,000,000_; the _color edit_ column.
- Test: `packages/mesoscale/molstar/src/_test/perf.test.ts` (heavy lane).
- Both use one sphere and one population of lipids, and change one look.

**Hypothesis (untested).** A type's look is resolved into per-copy overpaint or transparency data, then uploaded: an
O(N) pass plus an O(N) texture upload. The Node "image after color" (1.7 s, against 2.4 s for the first image) suggests
much of the visual is rebuilt or re-uploaded, not just a lookup changed.

**Recommendation.** Look up a copy's look by its target (type) index on the GPU:

- a small per-representation texture holding color, transparency, emissive and visibility for each target;
- read in the shader through the copy's target id, which the instance data already carry (`ParticleList.targets`);
- per-copy overpaint stays for per-copy selections (a picked copy, a cut).

A type's look change becomes an O(types) upload.

**What it enables:**

- recoloring and hiding populations of 10⁷-copy scenes within a frame;
- look animation (MolViewSpec-style `interpolate` on colors) on mesoscale scenes;
- color legends that respond as one edits them.

## R2. Radius and key per copy are required — confirmed

**Use case.** Placement sets carry a radius per _type_: every catalase has the same encapsulating radius. Mol\* wants
one per _copy_.

**Observed.**

- `ParticleSizeTheme` reads `particles.radii[index]` and has no per-target radius
  (`packages/graphics/src/theme/size/particle-size.ts`).
- `ParticleList.keys` is a required Int32Array per copy (`packages/model/src/model/particles/particle-list.ts`).
- The adapter allocates and fills both: **8 B a copy, an O(N) pass**. At 1M copies that is **7.6 MB** (measured, exact).

**Reproduce.** `toParticleList` in `packages/mesoscale/molstar/src/particle-list.ts`. The quick test _a particle list
shares the placement buffers; it adds a radius and a key a copy_ checks the 8 B.

**Recommendation:**

- an optional per-target radius (`targetRadii`, or a `radius` in `targetInfo`), used when `radii` is absent;
- implicit keys: identity when `keys` is absent.

**What it enables:**

- zero-allocation hand-over of generated placements;
- the same for tiles streamed from disk.

## R3. Representation memory per copy — observed; attribution a hypothesis

**Use case:** M and L scenes (10⁶–2.5 × 10⁷ copies, design.md §8.1).

**Observed (Chromium, `performance.memory`, the probe's _bilayer 1,000,000_):**

| Item                                                           | Size                           |
| -------------------------------------------------------------- | ------------------------------ |
| JS heap Δ for the scene                                        | 129.2 MB                       |
| Placements                                                     | 34.3 MB                        |
| Adapter additions                                              | 7.6 MB                         |
| **Remainder, held by the plugin state and the representation** | **≈ 87 MB, about 87 B a copy** |

GPU memory was not measured.

**Hypothesis (untested).** Per-copy instance data are built on the CPU: a 4×4 Float32 transform per instance (64 B),
plus ids or flags, plus the size and color theme arrays. That would account for most of the 87 B.

**To confirm.** A heap snapshot of the probe's 1M scene, broken down by owning array, taken before any change.

**Recommendation, if confirmed.** Build instance transforms on the GPU from position and quaternion (28 B, already in
the list) instead of materializing 4×4 matrices, and keep per-instance theme data per target where possible (R1, R2).

**What it enables.** About 2.5× more copies in the same memory:

- the 10⁷ range in a browser;
- a realistic path to whole-cell scenes such as the yeast cell (21.6 M instances by its `MODEL.md`).

## R4. Sub-pixel copies alias into moiré — observed

**Use case.** Whole-cell and membrane overviews, where most copies cover less than a pixel.

**Observed.** One million lipids on a sphere about 340 pixels across, in a viewer panel about 420 pixels tall (probe,
_bilayer 1,000,000_, after the camera fix A2) show moiré bands across the whole sphere. The screenshot is not committed:
rerun the probe to see it.

**Reproduce.** Storybook _Performance › Probe_ → _bilayer 1,000,000_.

**Untested.**

- Whether the particle representation's `lodLevels` (one per representation, prism-me `_spec/architecture.md` §3) or
  `Spheres.LodPixelPresets` (as `apps/mesoscale-explorer/src/data/state.ts` sets them) remove it.
- Whether `pixelScale` and `postprocessing` settings do.

**Recommendation:**

- First, test the existing LOD presets on particle spacefill.
- If they do not remove the moiré, add a projected-size rule to sphere impostors: below a pixel, draw a
  coverage-weighted point, or fade into a per-target averaged color.

**What it enables.** Readable overviews at every zoom without per-scene tuning: the "zoom from the cell to the atom"
workflow.

## R5. One list per placement set — hypothesis, untested

**Use case.** Tiled scenes:

- the yeast viewer stores 6,416 tiles of 200 nm (`source/pipeline/webenc.py` in zoidpuff/yeast_cell_viewer);
- the open decision on L scenes (design.md §11.5).

**Observed.** Nothing yet. The prototype's largest scene has 3 lists.

**Hypothesis.** One state cell, list and representation per tile costs per-cell overhead (state, draw calls, culling)
that thousands of tiles would expose.

**To test.** A probe scene of 1M copies split into 1, 10, 100 and 1,000 sets.

**Recommendation (if confirmed).** A list that can grow by appending or swapping tiles, culled per tile on the GPU,
instead of one representation per tile.

## R6. In-memory data and the state — confirmed; plugin API, not renderer

**Observed.**

- A generated placement set enters `mol-state` through a transform whose param is a key into a module-level store
  (`MesoPlacements`, `MesoPlacementStore`).
- Transform params must be serializable, and arrays in params go through the watched-state JSON compare (known debt in
  prism-me's AGENTS.md).
- So a saved session holds the key and not the data, and cannot be restored without the generator.

**Recommendation.** A registered in-memory asset (typed arrays by id, with a serializer: an `mvsx`-style blob, or
recompute from a document) that a transform can reference.

**What it enables.**

- Saveable sessions of generated scenes.
- A clean place for a future `particle list` node in MolViewSpec.

## Not renderer findings

These are listed so that they are not mistaken for renderer limits.

| Finding                                                                                                                                                                                                                                        | Layer                                                                                        | Status                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| A1. Prism's particles feature is lazy: an in-memory list needs `extensions.load('particles')` before its transforms (`packages/prism/viewer/src/features/lazy/index.ts`). The first commit pays the load (97–243 ms in the probe)              | adapter / Prism                                                                              | worked around                                             |
| A2. The camera was set without the scene radius, so near and far planes from a smaller scene clipped a larger one (seen as a ring instead of a sphere at 1M lipids)                                                                            | adapter                                                                                      | **fixed**: the adapter passes the visible bounding radius |
| A3. Compiling to MolViewSpec costs 94 B of JSON a copy, and any change rewrites a type's instance list                                                                                                                                         | integration path (MVS has no particle node)                                                  | measured; an MVS proposal                                 |
| A4. Mesh inside tests are O(triangles) a test (300 ms of the exosome's 335 ms resolve)                                                                                                                                                         | resolver                                                                                     | a signed distance grid would fix it (mesobuild has one)   |
| A5. Random sequential addition stops at a give-up heuristic (354/506 catalase)                                                                                                                                                                 | resolver                                                                                     | relaxation would place more; the issue explains it        |
| A6. Helical lattices (microtubules) are not expressible                                                                                                                                                                                        | language                                                                                     | open                                                      |
| A8. Particle spacefill hides fiber particles by default (`excludeFibers: true`, `packages/graphics/src/repr/particles/representation/spacefill.ts`); the Fibers mock showed an empty view until the adapter turned it off for sets with fibers | adapter                                                                                      | **fixed**                                                 |
| A7. Prism viewer story typecheck error at `packages/prism/viewer/src/api/styles.ts:114`                                                                                                                                                        | Prism (pre-existing on `prism-me`; `apps/prism-viewer`'s story typecheck fails the same way) | not caused by this work                                   |
