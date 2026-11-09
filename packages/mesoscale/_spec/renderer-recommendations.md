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

| #   | Finding                                                                                                        | Layer                        | Status                                                   | Impact on mesoscale workflows                                                            | Priority                  |
| --- | -------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------- |
| R1  | A per-type color or visibility edit costs O(copies)                                                            | renderer (looks / overpaint) | confirmed                                                | recoloring, hiding a population, look animation on 10⁶–10⁷ copies                        | **P1**                    |
| R3  | Memory per copy beyond the IR is not measured reliably (21–87 B a copy by the JS heap; GPU unknown)            | renderer (measurement)       | observed; a measurement gap                              | sets the ceiling on scene size                                                           | P2 (measure first)        |
| R4  | Sub-pixel copies alias into moiré                                                                              | renderer (impostors, LOD)    | observed                                                 | whole-cell and membrane views, where most copies are under a pixel                       | P2                        |
| R2  | A radius and a key are required per copy                                                                       | renderer / model API         | confirmed                                                | 8 B a copy, an O(N) pass at load                                                         | P2                        |
| R5  | One list and representation per placement set: ~36 ms and ~0.1 MB a list; looks rewritten on every list a step | renderer / plugin            | confirmed for commit and memory; frame time not measured | 1,000 lists: 39 s commit, ~6 GB peak; ≤ 100 lists: a remove ≤ 5 ms, a color edit ~105 ms | P3                        |
| R6  | In-memory data enter the state only through a side store                                                       | plugin API                   | confirmed                                                | sessions holding generated data cannot be saved or restored                              | P2 (plugin, not renderer) |
| R7  | (v0.2) No nested instancing: a particle list cannot target another list                                        | renderer / model API         | confirmed                                                | every superstructure (granules, virions, pores) is expanded instances × template         | **P1**                    |
| R8  | (v0.2) Looks select whole targets: no layer for a range of copies                                              | Prism layers / renderer      | confirmed                                                | an address that picks some copies (one granule, copies near the picks) cannot be colored | P2                        |

## R1. A per-type look edit costs O(copies) — confirmed

**Use case.**

- Recoloring one population of a large scene: "show catalase in red".
- Hiding the lipids, or changing a population's transparency.
- Animating looks: highlighting the populations an annotation cites.

These are view edits. The format guarantees they never touch placements, so the remaining cost is the renderer's.

**Observed.**

- The adapter writes one layer per type: one `particles.look` call, 1 to 14 layers.
- No list or representation object is replaced (checked by identity in the medium lane).
- The time still grows with the number of copies (the image column is headless `gl`'s draw, the same for any frame):

  | Scene   | Copies    | Look commit (state) | To the next image / frame      | Where       |
  | ------- | --------- | ------------------- | ------------------------------ | ----------- |
  | pack    | 50,000    | 9.4 ms              | 292 ms (image)                 | Node + `gl` |
  | bilayer | 1,000,038 | 112 ms              | 1709 ms (image)                | Node + `gl` |
  | pack    | 50,000    | —                   | 16 ms (frame)                  | Chromium    |
  | bilayer | 1,000,038 | —                   | **49–81 ms** (frame, two runs) | Chromium    |

- In the same runs the runtime's own share of the edit is N-independent: `updateView` 0.1 ms and `planCommit` 0.1 ms at
  1M copies.
- At 1M copies a color edit therefore misses a 16 ms frame budget, entirely inside Mol\*/Prism.

**Reproduce.**

- Smallest: Storybook _MesoViewSpec › Performance › Probe_: _bilayer 1,000,000_; the _color edit_ column.
- Test: `packages/mesoscale/molstar/src/_test/perf.test.ts` (heavy lane).
- Both use one sphere and one population of lipids, and change one look.

**Where the time goes (confirmed by a CPU profile).** A `node:inspector` profile of the 1M color commit (107 ms; `look`
107.2 ms of it) puts essentially all of it in Mol\* graphics, not in Prism or the state:

| Where                                                                                                                               | Self time | What                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------- |
| `packages/graphics/src/repr/visual.ts:211` (`apply`)                                                                                | 29 ms     | the visual applying the layer's loci                     |
| `packages/core/src/data/int/*` (`OrderedSet.forEach`, `Interval.ofSingleton`, `ofRange`)                                            | ~46 ms    | per-copy loci: one singleton interval per copy           |
| `packages/graphics/src/repr/particles/representation/spacefill.ts:172`, `geo/geometry/overpaint-data.ts:22` (`applyOverpaintColor`) | ~14 ms    | the particle visual's loci and the per-element overpaint |
| `packages/core/src/state`, Prism's `particles.look`, the adapter                                                                    | < 1.5 ms  |                                                          |

So the per-type selector (`targets: [t]`) is expanded into one loci element per copy and painted copy by copy. The image
that follows (1.5 s in Node) is headless `gl` drawing a frame (`gl/webgl/render-item.ts:543` `render`), the same as any
frame; the color edit adds no GPU work worth measuring there.

**Recommendation.** Look up a copy's look by its target (type) index on the GPU:

- a small per-representation texture holding color, transparency, emissive and visibility for each target;
- read in the shader through the copy's target id, which the instance data already carry (`ParticleList.targets`);
- per-copy overpaint stays for per-copy selections (a picked copy, a cut).

A type's look change becomes an O(types) upload.

**A cheaper first step.** Build a target selector's loci as intervals, not singletons. Copies of one target are often
contiguous: every resolver in this prototype emits each type's copies in one run, and cellPACK and STAR lists are
usually grouped too. That would make the loci and marker work O(runs); the overpaint write stays O(copies) but becomes a
fill.

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

## R3. Memory per copy is not yet measured well — observed; a measurement gap

**Use case:** M and L scenes (10⁶–2.5 × 10⁷ copies, design.md §8.1). Whether the 10⁷ range fits in a browser depends on
how many bytes a copy costs beyond the 36 B of the IR.

**Observed (Chromium, `performance.memory.usedJSHeapSize`, the probe's _bilayer 1,000,000_):**

| Run                                                        | JS heap Δ | Minus placements (34.3 MB) and adapter (7.6 MB) |
| ---------------------------------------------------------- | --------- | ----------------------------------------------- |
| without a GC before reading                                | 129.2 MB  | ≈ 87 MB, 87 B a copy                            |
| with `gc()` before each reading (`--js-flags=--expose-gc`) | 62.8 MB   | ≈ 21 MB, 21 B a copy                            |

The first figure was mostly uncollected garbage. The second is within the design's 64 B budget, but this method cannot
attribute memory: `usedJSHeapSize` may not count ArrayBuffer backing stores, and GPU memory is not measured at all.

**To do before any renderer change.** A heap snapshot of the probe's 1M scene broken down by owning array, plus the
WebGL buffer and texture sizes the representation allocates.

**Hypothesis (untested), to check with that snapshot.** Per-copy instance data are built on the CPU (a 4×4 transform is
64 B a copy) and uploaded. If so, building transforms on the GPU from position and quaternion (28 B, already in the
list) would cut both CPU and GPU memory.

**What it would enable.** A memory budget per copy that one can plan whole-cell scenes against: the yeast cell is 21.6 M
instances by its `MODEL.md`.

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

## R5. One list per placement set — confirmed for commit and memory; frame time not measured

**Use case.** Tiled scenes:

- the yeast viewer stores 6,416 tiles of 200 nm (`source/pipeline/webenc.py` in zoidpuff/yeast_cell_viewer);
- the open decision on L scenes (design.md §11.5).

**Hypothesis tested.** One state cell, list and representation per tile costs per-cell overhead (state, draw calls,
culling) that thousands of tiles would expose.

**Measured (headless Prism, Node, M1 Pro; no GL context, so no frame was drawn).** 1M copies of one population split
into 1, 10, 100 and 1,000 equal tiles, the whole scene committed through `PrismMesoAdapter`. A stream step is one set
removed, then the same set added back; each commit includes the looks rewrite. Heap Δ after `gc()` (`--expose-gc`). Two
runs agree within about 15%.

| Sets  | Commit ms | ms a set | Remove 1 ms | Add 1 ms | Color edit ms | Heap Δ MB | Looks written (remove + add) |
| ----- | --------- | -------- | ----------- | -------- | ------------- | --------- | ---------------------------- |
| 1     | 772       | 772      | 2.2         | 707      | 105           | 4.6       | 8                            |
| 10    | 1,540     | 154      | 2.1         | 154      | 100           | −5.3      | 44                           |
| 100   | 5,586     | 56       | 5.3         | 60       | 111           | 10.4      | 404                          |
| 1,000 | 39,443    | 39       | **163**     | 108      | **218**       | **103**   | 4,004                        |

- Placements are 34.3 MB (32 B a copy) and the adapter 7.6 MB (8 B a copy, R2) at every split: the split adds no
  per-copy bytes.
- **Per list:** about 36 ms of commit and about 0.1 MB of heap.
- **Peak process RSS:** about 6 GB for the 1,000-set case alone (7.3 GB with the Vitest parent). Run after the other
  cases in one worker, it was killed (SIGKILL); the cases now run in files of their own (`molstar/src/_test/r5-*.ts`).
- **Browser, the _Streaming_ story** (budget 3,000 copies, 32 tiles of 400): 7 tiles resident; each tour step commits
  only its arrivals and evictions; no console errors.

**Why (from `molstar/src/prism-adapter.ts`).**

- Each new set is a state cell and a `ParticleList` (one `updateTree`) plus a spacefill representation: the per-list
  commit cost above.
- Looks are written in one `particles.look` call over **every** list whenever a set is added (`planCommit`'s
  `looksChanged`): 4 layers for each of the n + 1 lists (the tiles and the fixture's instance list), 4,004 at 1,000
  sets. The looks rewrite is O(sets) a step, not O(changed sets). A color edit pays the same rewrite: 218 ms at 1,000
  sets against about 105 ms up to 100.
- The looks written (remove + add) come to 4 layers for each of the lists, 4,004 at 1,000 sets, which is what a rewrite
  on the add alone gives (`planCommit` rewrites looks when a set is added). The table sums the two commits; the case now
  records them apart (`stream_remove_looks_written`, `stream_add_looks_written`). The remove takes 163 ms at 1,000 sets.
  Each commit also walks every kept list (a state cell lookup and a representation check, to repair what Prism's undo
  stripped), and the delete updates a state tree of 1,000 cells. Which of the two dominates was not profiled.

**Conclusion.** The hypothesis holds for commit and memory, and for a step only at 1,000 lists:

- **Whole commit:** 51× for 1,000× the lists. The cost a set falls only because the 1-set case pays for one 34 MB list;
  the per-list overhead (~36 ms) dominates from 100 sets on.
- **A stream step stays small up to 100 sets** (remove 5 ms, add 60 ms, color 111 ms) and grows at 1,000 (remove 163 ms,
  color 218 ms), because the looks are rewritten on every list and every kept list is checked.
- **Memory is the real limit:** about 0.1 MB a list and a ~6 GB peak at 1,000 lists, enough to kill a worker.
- **Not measured: frame time.** There was no GL context, so draw calls and culling per list, the part of the hypothesis
  that concerns the renderer most, are untested. **To measure on a machine with GL:** first and steady frame at each
  split, the draw calls a frame, and how many lists are culled when the camera sees one tile.

**Recommendation for Mol\*:**

- a list that grows and shrinks by appending or swapping tiles: one representation, culled per tile on the GPU, instead
  of one cell, list and representation per tile;
- per-set looks written only for the sets that changed (a layer update per list, not one call over every list).

**For the prototype now:** keep the resident lists at 100 or fewer, i.e. size tiles so the budget holds at most about
100 of them. The _Streaming_ story holds 7 (budget 3,000, tiles of 400). The adapter could also write looks only for the
added lists when the view's looks are unchanged; that is an adapter fix, not a renderer one.

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

## R7. No nested instancing — confirmed (v0.2)

**Use case.** A superstructure placed many times: insulin granules in a β-cell, virions in plasma, nuclear pores in an
envelope. The format keeps it once (its template sets) and its copies as poses (design.md §3.9).

**Observed.** `ParticleList.targetMapping` maps a target to a structure, a shape or a volume
(`packages/model/src/model/particles/particle-list.ts`, `ParticleTarget`), not to another particle list. So the adapter
expands every instance × template into world-frame copies (`flattenInstances`, `runtime/instancing.ts`), cached by key.

| Scene                                                                | Template     | Instances | Expanded copies | Expanded | Held by the IR |
| -------------------------------------------------------------------- | ------------ | --------- | --------------- | -------- | -------------- |
| β-cell slice (Storybook _Superstructures and addresses › Beta cell_) | 2,229 copies | 120       | 267,480         | 9.2 MB   | 83 kB          |

The expansion grows as instances × template. The full ISG recipe asks for 2,138,813 copies a granule (its `nbMol`
summed), so even 100 full granules would be over 2 × 10⁸ copies expanded: out of reach this way, while the IR would hold
one template and 100 poses.

**Reproduce.** The story above, or `_test/superstructure.test.ts` ("flattened for a renderer without nested
instancing").

**Recommendation.** A particle target that is itself a particle list (with its own targets): the instance transform
composed on the GPU with the template's per-copy transforms, two levels at least. Looks on template targets then apply
to every instance at once, as they already do in the IR.

**What it enables.** Whole-cell scenes with organelle-scale reuse at template memory, not product memory; a level of
detail per superstructure (one body far away, parts near).

## R8. Looks select whole targets only — confirmed (v0.2)

**Use case.** A look on an address that picks some copies of a population: one granule's Vamp2, the copies within 15 nm
of the picked catalase, a selection made by a click.

**Observed.** Prism's layer selector is `{entities, compartments, targets}` (`ParticleLookSelector`,
`packages/prism/viewer/src/sources/particles/look.ts`). MesoQL materializes such an address as runs of copy indices; the
adapter cannot pass them on and reports `look.partial` (the exosome's _Near the picked catalase_ view).

**Recommendation.** A layer selector that takes copy-index runs (the MesoLoci form), applied after the target layers.
Runs keep it compact: an address over a population is one run.

**What it enables.** Every MesoQL address drawable as a look; selections and annotations drawn on the copies they name.

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
