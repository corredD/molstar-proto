# Lane lipid-procedural (2026-11-08): view-dependent procedural lipid membranes

Round 4 of the lipid membranes, its own lane from `me/lipid-tiles` at 1727ae414 (rounds 1-3, still being tested by Ludo
on port 1353; their record: `2026-11-08-lipid-tiles.md`). Branch `me/lipid-procedural`, worktree
`~/prism-me-lanes/lipid-procedural`, port 1354. Ludo, 2026-11-08: "run round 4 when round 3 is ready".

Carried from round 3 (open): the mesh still drawn after a wrap in Ludo's path (S2, not reproduced headless: Ludo's
console dump will tell), X2 (a wrap in flight across a context change), S4, the bake's yield (a worker), clashes at
region borders, the library commits 4ac0c0de8 and bde208175 (their own lane from master).

## Brief (Ludo, 2026-11-08): procedural, view-dependent membranes

**Asked.** Ludo: "could this be completely procedural so we dont build the full lipids for all triangle all the time. It
should be camera distance dependant, and size on screen. [...] show the lipids only on visible triangle, and at certain
pixel size. [...] only do the full build at export time"; "this will help scale to cell size".

**Decided (Ludo, 2026-11-08, asked one by one).** Generator: the cutter with region offsets (round 3, item 7), not the
tiles. Far look: the mesh drawn with a bump texture of lipid heads (procedural in the shader, coloured by the
composition). Switch: a lipid about 2 px on screen (atoms near, bump surface below). **Both far looks, to test (Ludo,
2026-11-08: "make sure round 4 get both spheres LOD + texture and we can test").** The sphere levels (round 3: sparser
levels, each sphere grown, the levels and distances in the membrane's Look) and the bump-textured surface are both
built, and the membrane's Look switches between them live: `far: 'spheres' | 'texture' | 'both'` (both: the sphere
levels to their last level, then the textured surface), with the distances of each switch editable as round 3's levels
are, so Ludo compares and sets the defaults. Default 'both' until he picks.

**Design to settle at a checkpoint (before code; stop and report if it breaks the stop line).**

- The crux: `gpuInstances` (b08d2d574) needs each segment's instance count on the CPU before dispatch; view-dependent
  generation changes counts with the camera. Option A (proposed first): a fixed-capacity pool per species member, counts
  written by the GPU into the indirect draw records (a library change to the merged culler's layout: check it against
  the brief's ~600-line renderer stop line). Option B (fallback): count pass read back asynchronously, regenerate when
  the camera rests (fits today's invariants; a frame of lag, possible popping).
- Which triangles: frustum-visible (the culler's tests) and lipid size on screen ≥ ~2 px (distance × projection), with
  hysteresis so the set does not flicker; a budget of lipids in the pool (default sized to the device, e.g. 4–8 M);
  nearest first when over budget.
- Deterministic: the same triangle, region and patch always give the same lipids (regeneration invisible, export equal
  to the view, picks stable: a pick names triangle + lipid index, not the pool slot).
- Prism's rules: idle is idle (regeneration triggered by camera changes through the one frame tick, nothing at rest);
  nothing allocated per frame (pool preallocated); no `requestAnimationFrame` of its own.
- Far surface: the mesh itself, a membrane material (bump/normal from a procedural head pattern in its tangent frame,
  colour by species fractions), blended or dithered against the atoms at the switch distance; its own representation so
  its eye and the membrane's agree.
- Export: the existing TS reference over every triangle (full build), behind an explicit export action.

**A membrane is a particle system (Ludo, 2026-11-08: "lipids membrane should be like particle system and have the same
properties, so we can control how the lipids atoms are rendered").** The membrane shows and obeys the same properties as
a particle list or a mesoscale model, through the same operations and the same controls in the explorer's properties
(ui.md: the four places), not a look of its own: Object graphics (quality, LOD and motion, the `ObjectGraphics`
control), colours (by species = entity, uniform, the palettes; colours by zoom, `ZoomColors`), the style
(`mesoscale.style`: size, ghosts, outlines, transparency, hide/show per species), clipping and graded cuts, picking and
labels per lipid. Read first how a particle list's properties are built (`apps/prism-me/src/explorer/properties.tsx`:
`GraphicsKinds`, the particle-list sections; `packages/extensions/mesoscale` operations they call) and make the membrane
one of those kinds: its species as entities in the tree (one row per species, eye and colour), its representations
driven by the same props. Where a property cannot hold for a procedural pool (e.g. a per-instance transparency layer
needs stable instance ids: a pick names triangle + lipid, so layers must key on that), say so at the design checkpoint.
The far bump surface follows the same colours and the species shown.

**Tests.** The membrane's properties are the particle list's (a test lists the sections for both kinds and compares);
each operation applied to a membrane changes what is drawn (colour by species, a species hidden, a style size); the
pool's slot accounting and the visible-set selection (TS, quick); WGSL = TS reference for the generated set (Dawn); a
camera path headless (whole → close → whole): triangles generated vs visible, lipids in the pool, frame time, zero
frames requested and no regeneration at rest (`frames.quick.ts` style), determinism (same view twice, same lipids); a
scaling guard on mesh size (n and 4n triangles: wrap time and memory flat in the mesh's lipid count). Scale targets:
model_vertexcolor ×100 (27.7 M lipids full) and a 1 µm sphere without device loss; then a cell-sized surface.

**Ludo checks.** Open the cow or model_vertexcolor, Scale 100, right-click › Wrap with lipids: wrap is instant; zoomed
out the bump surface, zooming in atoms appear where they are ≥ 2 px, no holes, no popping that stands out; fly around:
smooth; at rest the fans stop. In the membrane's Look, switch far between spheres, texture and both, and move the switch
distances: each shows at once, no re-cut. Pick the membrane: its properties are a particle list's (Object graphics,
colours, style); one row per species in the tree; hide a species, colour by species, change the atoms' size or quality:
the atoms and the far surface follow.

**Size and model.** ~950 production lines (pool + selection 250, library culler change 150, far surface 200, the
membrane as a particle system: kinds, species rows, operations 250, wiring and export 100). Opus (renderer and WGSL hot
paths); mechanical steps to Sonnet. Gate before the PR draft.

## Design (as found, 2026-11-08, before code)

**The crux dissolves into a smaller one.** The counts the merged layout needs are _capacities_: the culler already
writes each record's drawn count on the GPU (`instance-copy` counts what it copies, `cull-args` writes the indirect
records), so the CPU only sizes each segment's regions. And the cutter's counts per (member, triangle) do not depend on
the view: the count pass already runs once at the wrap and is read back (round 2). So a view changes only _which
triangles_ are generated, and the CPU knows each member's live count exactly (a prefix sum over the selected triangles):
no per-view readback at all.

- **Option A (chosen): a fixed-capacity pool, live counts per segment.** Each member's instance count is its capacity (a
  share of the budget), never its full total. Library (`packages/graphics`): (1) the segment row's free word 6 holds the
  member's live count; `instance-copy` skips a local index at or past it (~6 WGSL lines); (2) a writer may carry a
  `view` hook the culler calls in `dispatch` before the culling pass, once per frame for the frame's first view (as
  `prepareCull`), only where the view changed; it returns the member's new live count (or nothing: unchanged), the
  culler writes that row word (16 B) and advances `dataVersion`; no layout, no CPU instance write. (3) the writer's
  plain call may return the live count too. About 60 production lines, against the brief's 150 and the 600 stop line.
  The culler's invariants hold: the CPU knows each segment's capacity, the cells (one, gridless) and records are the
  CPU's, the kernels' structure unchanged. A new invariant: an instance below the capacity may be dead (past the live
  count). Dead slots are zeroed by the writer for the identity region (views not culled on the GPU draw zero-scale
  spheres: nothing; checked for NaN).
- **Option B (rejected): counts as instance counts, regenerated at rest.** Nothing to read back (counts are known), but
  every new selection changes `instanceCounts`: a full `syncLayout` and `syncInstances` and the merged object's
  re-merge, O(capacity) arrays allocated and uploaded each time (about 200 B a lipid: 400 MB at 2 M), so only at rest,
  with a visible lag and pops. 0 library lines, ~40 extension lines more than A, and it breaks "nothing allocated per
  frame".

**Pool and selection (extension, `lipids/procedural.ts`, pure TS).** Capacity: a budget split across members by their
share of the full totals (+10 %), each member's capacity at most its full total (the cow fits whole); `checkInstances`
on the capacity. Default budget 2 M lipids: a 1920×1080 view at 2 px a lipid shows ~0.5 M a leaflet, ×2 leaflets, ×2
depths (front and back of a closed body); at about 270 B an instance in the culler (3 levels) 0.55 GB, under the M1's
buffers; capped by the device's largest buffer. Selection per view: a triangle's sphere (precomputed) against the
frustum, its nearest view depth `d`, a lipid's size on screen `D / (depthScale · d)` (`LodView`; orthographic:
`D / pixelSize`), D = √(area a lipid) from the patch (~8 Å). Taken where its size is at least the far mode's threshold
(enter) and kept down to 0.8× (hysteresis); nearest first while every member's live count fits its capacity (candidates
sorted by `d` in a preallocated index array). Regions first, triangles of the regions in view next, so the cost follows
what is visible (the scaling guard on mesh size). Preallocated: nothing allocated per view. The view key is the planes
and `LodView` (and the props' version): a dispatch of the same view (pyramid rounds) selects nothing again.

**Generation (WGSL, `cutter-kernel.ts`).** The write pass over the selected list (`selected[i]` triangle ids,
`bases[m · S + i]`, uploaded per new selection: 4 B a selected triangle and member); dead slots `[live, previous live)`
zeroed. A triangle's hits are the same function as now (determinism: a triangle, its region and the patch give the same
lipids; only slots move). Thinning for the far levels: a triangle in a band with `thin = k` keeps every k-th hit of each
member (count `ceil(n / k)`, exact on the CPU), its level's sphere scale √(stride · k) (bias 2): the bands are the
levels' distances, the triangle's nearest point picks its band (denser where it straddles: overlap, never a hole).

**Far looks (`far: 'spheres' | 'texture' | 'both'`, default both; one source for the thresholds).**

- texture: lipids where a lipid is ≥ `atomsPx` (default 2 px); the textured surface everywhere beneath.
- both: lipids (at their levels, thinned) down to `spheresPx` (default 0.5 px); the surface beneath.
- spheres: as both, no surface; budget-clamped: past the budget the far parts stay empty (said in the Look).
- The surface: the mesh itself (both leaflets' midplane, double-sided), its own render object in the membrane's
  representation (one eye), Mol\*'s material bump (`bumpFrequency`, `bumpAmplitude`, `bumpiness`: value noise, standing
  in for a head pattern, at the lipid spacing), coloured by the shown species' colours weighted by their fractions.
  Drawn always beneath: the outer leaflet's atoms (20 Å above) hide it where generated, so there is no gap at any
  distance by construction (a quick test per mode); no fade needed; popping is atoms appearing on a surface of their own
  colour. Risk: the bump aliases where heads are under a pixel (Mol\*'s bump has no distance fade; a fade would be a
  shader change): checked in the images.

**The membrane as a particle-system kind (not a `ParticleList`: its keys and targets at full count are the full
build).** A `membrane` kind in the explorer, its sections the particle list's, each mapped onto the membrane's
representation props, through the same operations (`mesoscale.graphics`, `mesoscale.style`, `mesoscale.colors`,
`mesoscale.entities`) which branch on a membrane ref:

| Section                                    | For a membrane                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| Object graphics: Quality                   | the levels' preset (quality / balanced / performance = round 3's `detail`)        |
| Object graphics: Motion (wiggle, tumble)   | not held: no motion of lipids (section without its motion rows, as a volume's)    |
| Look: colours by species, uniform, palette | held (a species = an entity; the far surface follows)                             |
| Look: colours by zoom (`ZoomColors`)       | not held this round (color levels are the particle repr's)                        |
| Style: size                                | held (`sizeFactor`)                                                               |
| Style: hide/show per species               | held (a hidden species' live count 0: nothing generated; the surface's mean too)  |
| Style: ghosts, outlines, transparency      | per species at most (per member); not per lipid: a slot is not a lipid            |
| Clipping                                   | held (the merged object's clip objects, culled on the GPU)                        |
| Picks and labels                           | a pick's slot mapped to (triangle, lipid) by the selection's bases: stable labels |
| Per-lipid layers                           | not held: layers key on species only (a pool slot changes with the view)          |
| Tree                                       | one row per species (eye, colour) under the membrane                              |

**Export.** An explicit action (`mesoscale.exportMembrane`): the TypeScript reference over every triangle, streamed a
chunk of triangles at a time into a RELION STAR particle list (Mol\* reads STAR: species, conformer, position, ZYZ
angles, triangle, lipid): never the whole build in memory. A file of ~100 B a lipid (27.7 M: ~2.8 GB, streamed).

**Wiring.** Right-click › Wrap with lipids becomes the procedural cutter; the tiles stay as Wrap with lipids (tiles).
Regeneration only in the renderer's frame (the culler's dispatch), nothing at rest, no frame of its own.

**Determinism test.** The same path from the same start gives the same (triangle, lipid, affine) sets; slot buffers are
not compared; a view reached by different paths may differ inside the hysteresis band.

**Noted while in the culler (not blocking).** `segmentScale` reads the CPU placeholder's zeros for GPU-written members:
with the raster on, `predictRecords` sends every level to the raster (the M1 has none: unseen here). Recorded, TODO.

**Size.** Library ~60; pool and selection ~250; kernel's selected list and thinning ~80; far surface and switch ~150;
the membrane kind ~300 (likeliest to overrun); export ~100. About 950, the brief's.

**Changed at build (this session):** no thinning at generation (option one above): the spheres shader sizes a sphere by
the model scale only, not its instance's, so 1-in-k lipids cannot be grown to cover; `spheres` is budget-clamped (far
parts empty past the budget), said in TODO.md. The surface needs no fade (drawn beneath always).

## Built

- Library (`packages/graphics`): `f99c9e0b1` (+ `a6d265ce8` lint) a pool of GPU-written instances: live counts per
  segment (row word 6, skipped by `instance-copy`), a writer's `view` hook in `dispatch` where the view changed (the
  `LodView`'s scales in the view key); quick test and Dawn test, each failing first (the Dawn one against the WGSL skip
  removed). Plan: `ae2ca9321` (merged-render-objects.md).
- `31c292d41` the selection (`lipids/procedural.ts`: regions then triangles, size on screen with hysteresis, nearest
  first by a counting sort within capacities, slots in triangle order, `lipidAt`); `1e2cdce94` the membrane as a pool
  (capacities from the budget, the write pass over a view's triangles, dead slots cleared); `b3d5bb21d` the camera path
  on Dawn; `21f545f9e` the far surface; `d895f0977` the far switch in the Look; `c692673e6` Wrap with lipids = the
  cutter; `16da1679f`, `cac2b13e3`, `0e5108d81` species as entities, Object graphics, the sections compared;
  `4839ca337`, `276654af3` export; `dba63a0e3` the scaling guard; docs `3607d6fb5`.

## Decided

- Option A as above (this session, at the checkpoint, within the brief's stop line); option B rejected.
- Default budget 2 M (a 1080p view at 2 px), far `both`, `atomsPx` 2, `spheresPx` 0.5: for Ludo to tune.
- The surface drawn always beneath, no fade (this session): no gap by construction.
- Species in the Look rather than tree rows this round (this session, for size); tree rows in TODO.

## Learned

- The counts per (member, triangle) do not depend on the view: the crux was capacities, not counts.
- A headless "close" view must keep the whole view's clipping radius; a `getFocus` of a small radius clips the nearest
  lipids (grey interiors), not a selection bug.
- Mol*'s spheres ignore an instance's scale: lipids cannot be thinned and grown per instance without a shader change.

## Numbers (headless Dawn, M1, 900×600, CHARMM-GUI patch; machine shared with another lane's tests)

| Case, far, view                        | ms (best of 3)  | live lipids           | triangles generated / in view |
| -------------------------------------- | --------------- | --------------------- | ----------------------------- |
| cow ×100 (36,454 full), any far, whole | 52–75           | 36,454                | 11,608 / 11,608               |
| model ×20 (1,506,849 full), both whole | 302             | 1,506,849             | 5,760 / 5,760                 |
| model ×20, both middle / close         | 455 / 372       | 480,353 / 271,575     | 2,028 / 1,166 (all in view)   |
| model ×20, spheres whole/middle/close  | 121 / 212 / 131 | as both               | as both                       |
| model ×20, texture whole/middle/close  | 18 / 266 / 171  | 0 / 480,353 / 271,575 | 0 of 5,760 whole              |

At rest: 0 selections, 0 regenerations in every case. Wrap: cow 144 ms, model ×20 777 ms (no full build). model ×100
(27.7 M full) estimated, not run (Ludo's rule): the pool caps it at 2 M lipids, about 0.55 GB in the culler; whole in
texture mode 0 lipids (as ×20). Images (looked at):
`~/prism-me-lanes/lipid-tiles-shots/r4-<cow-x100|model-x20>-<both|spheres|texture>-<whole|middle|close>.png`. Seen: the
surface's mean colour is muddier than the lipids (a pop at the switch); both and texture look the same where lipids
cover.

## Size against the brief

About 1,070 production lines (−61) against ~950: the selection 277 (vs 250), library 94 (vs 150), membrane 205,
operations 169 (species, export, graphics), controls 109, kernel 59, export 88, app 36.

## Review (2026-11-08)

An Opus reviewer read `1727ae414...7e2fc2306` (5 must-fix, 6 should-fix, 7 nits); an Opus skeptic re-read and re-ran
each (9 confirmed, 3 by a run; 2 plausible; 0 refuted; S3 down to a nit; N1 plausible, N2 confirmed, new).

| Finding                                                                                                                                                      | Outcome                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| M1 dead slots (zero rows) drew their spheres at the origin on the CPU's lists                                                                                | test `1ed7faf2c` (failing), library `2f9cbf270`, extension `f9174a81f` |
| N2 the pool's Dawn test could not see M1 (camera unchanged, a member over the origin)                                                                        | test made to fail, then pass (graphics commits above)                  |
| M2 old selections kept across a reused build                                                                                                                 | fixed `2639c363c` (weak keys)                                          |
| M3 the species' colour committed a step per pointer move                                                                                                     | fixed `6ea4f8f32` (previewed, Apply once; UI test)                     |
| M4 a tiles membrane exported its lost limbs alone                                                                                                            | fixed `66a21205a`                                                      |
| M5 RELION angles wrong at tilt 180                                                                                                                           | test `bb2148c8e` (failing), fix `d0b235ae8`                            |
| S1 the selection passed over every triangle per view                                                                                                         | fixed `230359421` (O(regions) + O(taken); regions left in TODO)        |
| S2 the sphere raster drops a GPU-written member's level records (pre-existing)                                                                               | open, TODO (library lane; no raster on the M1)                         |
| S3 the whole dead range cleared per regeneration                                                                                                             | fixed `869752af5` (only what was live)                                 |
| S4 Object graphics shows no active Quality for a membrane                                                                                                    | open, TODO                                                             |
| S5 the species swatch blank, the picker at white                                                                                                             | fixed `6ea4f8f32`                                                      |
| S6 a tiles membrane's lost limbs got the pool, the surface, species hide                                                                                     | fixed `41eb1c37d`                                                      |
| N1 solid-interior caps draw the pool's full capacity                                                                                                         | covered by M1's fix (dead slots past any far plane)                    |
| Nits: capacities 1.1 × budget, grey surface with all hidden, `find` per species row, reset's version, `lipidAt` unused, export's row count, camera test gaps | reset fixed `230359421`; the rest open (TODO or here)                  |

## PR body (draft)

**What.** Round 4 of the lipid membranes (Ludo, 2026-11-08: "completely procedural ... camera distance dependant, and
size on screen ... only do the full build at export time"). Wrap with lipids (the cutter, now the default) generates its
lipids per view: only on the triangles in view whose lipids are large enough on screen, nearest first within a pool (2 M
by default), regenerated in the renderer's frame when the view changes and never at rest. Far away the membrane is its
mesh with a bump in the species' colours. The far look is switchable live (both, spheres, texture) with its switches; a
membrane's species are a particle system's entities (shown, coloured); the full build is only at export (STAR).

**Changes.**

- Library (`packages/graphics`, to move to their own lane from `origin/master`): `f99c9e0b1` (+ `a6d265ce8`) a pool of
  GPU-written instances (live counts per segment, a writer's view hook in the culler's dispatch); `2f9cbf270` dead slots
  past any far plane (`DeadInstanceTranslation`; its failing test `1ed7faf2c`). Plan: `ae2ca9321`.
- `packages/extensions/mesoscale`: `lipids/procedural.ts` (selection), `cutter-kernel.ts` (write pass over a view's
  triangles, dead-slot kernel), `membrane.ts` (pool, far surface, species), `export.ts`, operations (`membraneDetail`
  far params, `membraneSpecies`, `exportMembrane`, `graphics` on a membrane), controls (Far, species).
- `apps/prism-me`: Wrap with lipids = the cutter, the tiles second; Export lipids; the membrane's Look and Object
  graphics; ui.md, features.md, TODO, the changelog.

**Notes for review.** Defaults for Ludo to tune: far both, lipids from 2 px (texture), down to 0.5 px (spheres), budget
2 M. Spheres is budget-clamped (thinning needs per-instance sphere sizes: a shader change). The surface's mean colour is
muddier than the lipids. Species live in the Look (no tree rows yet); no lipid picking yet. The STAR export is held as
Blob chunks by the browser.

**Testing.** Quick (selection, export, UI, sections compared), Dawn (pool live counts and dead slots, camera path whole
→ close → whole with determinism and nothing at rest, properties drawn, the far surface's coverage), scaling (selection
over n and 4n triangles). Images and numbers: Numbers above. Not tried in Chrome by this session.

**Review.** The table above.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## Checks (2026-11-08, after the review's fixes)

`npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm format:check`, `pnpm check:workspace`, mesoscale
`styles:check` pass. Quick lane with Dawn (mesoscale, cryoet, stage-tools, prism-me, the culler, `webgpu-gpu-instances`,
`webgpu-gpu-culling`): 78 files, 543 passed. Medium (mesoscale) passes. Scaling: the selection guard passes.
`typecheck:storybook` (prism-viewer) fails on `src/api/styles.ts:114`, a file this lane does not touch (a base error).
