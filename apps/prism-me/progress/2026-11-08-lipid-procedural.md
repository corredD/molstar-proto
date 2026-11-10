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

## PR body (draft; rounds 4 to 6, the lane's PR)

**What.** Lipid membranes made per view, rounds 4 to 5 (Ludo, 2026-11-08: "completely procedural ... camera distance
dependant, and size on screen ... only do the full build at export time"; 2026-11-09: a billion lipids at interactive
rate). Wrap with lipids (the cutter, now the default) makes its lipids only where they are in view and large enough on
screen, nearest first within a pool (2 M by default), again in the renderer's frame when the view changes and never at
rest; a large triangle is cut by cells made in view only, nothing O(lipids) at the wrap (model_vertexcolor at x600, 1.4
G lipids: wrap 1.4 s, 0.8 GB). Far away each leaflet is the mesh's own triangles with the patch's top view as a
mipmapped texture mapped as the cutter maps the lipids, taking over from the spheres without a seam. Colours by zoom go
from the membrane's colour to species to atoms by element. The membrane is coloured and styled as a particle list, takes
Prism's clips, and is fully built only at export (STAR). Tiles stay whole, refused past 50 M lipids. Round 6 (the yeast
cell's nine membranes, 1.08 M triangles, ~0.7 G lipids): + Open reads the yeast cell viewer's
`organelle_meshes.bin(.gz)`, and right-click › Wrap all N meshes with lipids makes one membrane over them (one step, one
pool and budget nearest first across them; a membrane inside a closed one is skipped while the eye is outside it); the
selection descends a sphere tree (0.1-8 ms a view, from 87-600 ms); close on the PM 104 ms from 500-650.

**Changes.**

- Library (`packages/graphics`; to their own lane from `origin/master` on Ludo's word): a pool of GPU-written instances
  (live counts per segment, a writer's view hook in the culler's dispatch: `f99c9e0b1`, `a6d265ce8`); dead slots past
  any far plane (`2f9cbf270`, its test `1ed7faf2c`); a mesh's patch texture (`dPatchTexture`: planes, cells, a shift a
  vertex, colour variants only; `sLinearMipmapRepeat`: `835dffca8`, `9ad038804`, `d55a15ff2`; its Dawn test in
  plugin-headless, `f9526c7c6`).
- `packages/extensions/mesoscale`: `lipids/procedural.ts` (the selection: whole triangles and cells, the facing leaflet,
  a pool a member), `cutter.ts` (cells, kinds' counts), `cutter-kernel.ts` (write pass by units, dead slots),
  `far-surface.ts` (the patch surface and raster), `membrane.ts` (pool, surfaces, textures' lifetime, colours by zoom,
  clips), `export.ts`; operations `membraneDetail`, `membraneSpecies`, `exportMembrane`, `graphics`, and the particle
  list's `style`, `colors`, `colorLevels` on a membrane; a `test:perf` tier (`lipid-selection.quick.ts`).
- Round 6, `mesoscale`: `lipids/triangle-tree.ts` (the tree, the parity test, enclosures), `procedural.ts` (the descent,
  the parts shown), `membrane.ts` (`meshes`, `concatMeshes`, a part's surfaces), `organelle-meshes.ts` (the reader and
  its transform), `wrapMembrane { meshes }`; `apps/prism-me`: rows named by their shape's label, Wrap all.
- `apps/prism-me`: Wrap with lipids = the cutter (tiles: small objects); Export lipids; the membrane's Look; ui.md,
  features.md, TODO, the changelog `.v6/changelogs/lipid-procedural.md`.

**Notes for review.** Defaults for Ludo to tune: far both, lipids from 2 px, budget 2 M. Close frames are bound by the
lipids drawn at atom detail (8-16 px): about 130-240 ms on the M1 under Dawn at x20 and x600 alike (M5: a lighter close
level is the next lever, Ludo's call after Chrome on 1354). The cutter refuses meshes past 2^21 triangles. A view's
selection allocates 80 B (core's sort). Species live in the Look (no tree rows); no lipid picking; spheres are
budget-clamped; the spheres themselves are not dithered at the switch (a graphics change). Public API: the graphics
additions above (`MeshSchema.dPatchTexture` and its values, `GpuInstanceWriter.view`, live counts).

**Testing.** Quick (selection and cells, the patch surface's map to each lipid, the shader's map pinned to the cutter's,
export, UI), Dawn quick (camera paths whole → close → whole, nothing at rest, determinism; properties drawn; clips; a
clip with a still camera; the patch textures' lifetime; the patch texture's pixels and shifts), Dawn medium (a billion
lipids' camera path, the switch's colour at x600), `test:perf` (a view's selection), scaling (selection over n and 4n
triangles; the wrap flat at x20 and x80 with an O(lipids) control). Images and numbers: the rounds' sections above.

**Round 6 notes.** One Look for the whole cell (a membrane's own colour or hide: Ludo's call); one patch for every
membrane; wrap ~9.6 s; the selection's perf baseline 79.6 → 95.6 B a view. Testing round 6: the reader and its open
guard (n/4n meshes), wrap all one step, enclosures and one budget (`lipid-cell.test.ts`), the close view's scaling guard
with parts (n/4n, a scan control), the Dawn nested cell (medium), prism-me's open and menu; the yeast data never
committed (probes outside the tree).

**Review.** Round 6: "Round 6, the gate" (M1, M2, S2, S4, S6 fixed after failing tests; S1 refuted). Rounds 4, 4b, 4c:
their gates above. Round 5: an Opus reviewer (5 must-fix, 7 should-fix, 9 nits), the skeptic, then a failing test and a
fix each: "Round 5, the gate closed". Open: M5 (Ludo), N4, X4, X5, N1-N9 (TODO).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## Checks (2026-11-08, after the review's fixes)

`npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm format:check`, `pnpm check:workspace`, mesoscale
`styles:check` pass. Quick lane with Dawn (mesoscale, cryoet, stage-tools, prism-me, the culler, `webgpu-gpu-instances`,
`webgpu-gpu-culling`): 78 files, 543 passed. Medium (mesoscale) passes. Scaling: the selection guard passes.
`typecheck:storybook` (prism-viewer) fails on `src/api/styles.ts:114`, a file this lane does not touch (a base error).

## Round 4b brief (Ludo, 2026-11-08, on the teddy at 1354: `lipid-tiles-shots/ludo-r4-teddy.png`)

**Asked.** "the bump should be colored like the spheres. And also, the spheres head are above and below the membrane, so
the texture should be there as well. not below. And I am not sure what is this colored layer between the bump and the
spheres at the level of the mesh". His settings then: Both, Lipids down to 3.6 px, Lipids at most 457,000, custom levels
`0 Å ×1 b1 · 4000 Å ×8 b2 · 8000 Å ×64 b2`.

1. **The far surface coloured like the spheres.** Today one mean colour (`meanColor`, a brown). Wanted: a head-scale
   pattern in the species' own colours, in their proportions, following the species rows (colour, eye) and colorBy.
   Design at a checkpoint (e.g. the patch's heads, seen from above, baked into a tileable colour + bump texture mapped
   by each region's cutter plane, so the far look is the near look blurred; or per-vertex colours on a finer surface).
   Must be invisible-cheap at rest and add no per-frame allocation. A test: the surface's colours are the species' (not
   one), a hidden species leaves it.
2. **Two surfaces, at the heads.** One per leaflet, offset along the normal to that leaflet's head plane (outer +, inner
   −, from the cutter table's offsets), single-sided facing out of its leaflet, not one double-sided surface at the
   mid-plane. A test: each surface's distance from the mesh equals its leaflet's head offset.
3. **The coloured layer at the mesh.** Find what it is before changing it (an image close on a silhouette and the draw's
   objects): the bilayer's tails seen edge-on between the heads and the mid-plane surface, the coarse sphere levels
   (stride 8/64, grown) poking through, or the hysteresis band. Report the cause; fix if it is a defect (with 2. the
   surfaces no longer cut through the tails).

**Ludo checks.** The teddy at 1354, Both: from far the surface reads as the same colours as the spheres, the switch
hardly visible; at a silhouette heads above and below, no stray layer between.

**Size and model.** ~250 production lines; Opus (shader/texture design). Gate on the round's diff.

## Round 4b design (as found, 2026-11-08, before code)

1. **Colours like the spheres: vertex colours on a finer surface, from the patch itself.** A head-scale pattern per
   fragment needs a shader change (Mol*'s grid colours are read per vertex, `varyings.wgsl.ts`; its bump is value
   noise): a library change, over this round. Instead, the far surface is the mesh subdivided to about two lipid
   spacings (capped at 1 M vertices a surface, the spacing growing past it), and each vertex coloured by the species of
   the nearest head in the patch at the point the cutter maps it to (its triangle's region frame: the same plane, spin
   and offset as the lipids): the far look is the near look blurred, in the species' proportions, deterministic. A
   per-patch grid (≈2 Å cells, nearest shown head) makes each vertex O(1); hidden species leave the grid; colorBy
   uniform keeps one colour. Built once a look (never per frame), extension only, ~200 lines. At rest: no work.
2. **Two surfaces at the heads.** One per cut leaflet, offset along the mesh's vertex normals by that leaflet's head
   plane (the mean over its conformers of their outermost atom's z: + outer, − inner), single-sided facing out of its
   leaflet (the inner one's winding flipped).
3. **The layer at the mesh: diagnosed before a change** (below, with images).

**More from Ludo, same try (2026-11-08):** "membrane and membrane with tiling are different now. And the wrap with
lipids (the first one) I assumed use the cookie cutter, but its highly regular. the one with tiles, doesnt have the
color, and the texture approach. And cant use clip on it".

4. **The cutter looks highly regular.** "Wrap with lipids" is the cutter (c692673e6). Find why it reads regular before
   changing it: regions larger than the 232 Å patch repeat it at its period inside a region; only 4 conformers a species
   (`cutterTable(…, conformers = 4)`, `i % k` in cutter.ts:74); the same offset or spin across neighbouring regions.
   Measure (e.g. the autocorrelation of head positions in a big region, or the count of distinct neighbourhoods) and fix
   so no period or tiling shows at any distance; compare with cellPACKgpu's per-triangle random offset and spin. A test
   that fails on today's regularity.
5. **One membrane, two generators.** Whatever the method, a membrane has the same properties and looks: the species rows
   (eye, colour), colorBy, the far surface (1, 2), Levels. The tiles membrane gets them, or say at the checkpoint what
   cannot hold for tiles and why.
6. **Clip on a membrane.** The right-click and properties offer the same clipping as on a particle list or mesh (menu.ts
   ~475 excludes a membrane from `moveItems`; clipping must not be excluded with it), for both methods, near spheres and
   far surface alike. A test: a clip applied to a membrane removes what it cuts in both looks.

Size now ~450 production lines; checkpoint if over ~600.

## Round 4b, status (2026-11-08; stopped for context, precise next steps below)

**Built.** `ef6b46fea` design checkpoint; `c09e71076` (its failing test first) items 1 and 2: `lipids/far-surface.ts` (a
surface a cut leaflet at its head plane, `headOffset`, single-sided out of its leaflet; the mesh subdivided to two lipid
spacings, capped at 1 M vertices; each vertex the species of the patch's nearest shown head where the cutter maps it),
its quick test, and the Dawn test failing first (one mean-brown surface → two coloured surfaces; the whole view's
colours many). About 230 production lines.

**Item 3, diagnosed (images `lipid-tiles-shots/r4b-diag-*.png`, looked at).** Not the hysteresis and not the coarse
levels poking through: the band is the bilayer's own edge where generation stops at a triangle border, seen at a slant
between the outer heads (≈20 Å above the mesh) and the old mid-plane surface (at the mesh): the tails and the inner
leaflet's heads in cross-section. With the surfaces at each leaflet's heads (item 2) the outer surface is level with the
heads, so the edge sits under it. Not reproduced at Ludo's exact view (the teddy is not here); headless the camera is
orthographic by default (all triangles one size on screen: everything or nothing switches), so the probes set
perspective.

**Seen in the images (`r4b-model-x20-<close|middle|whole>-<both|spheres|surface>.png`).** The surface now speckles in
the species' colours; it reads darker and more purple than the lipids, whose coarse levels draw a stride of each
conformer's atoms (greens dominate). Matching the surface to what the levels draw is open.

**Not done (next steps, in order).**

1. Item 4, the cutter's regularity: measure first. (a) region size against the patch box: `RegionCell` 200 Å vs the
   CHARMM box 232 Å, but a region is a cell × 96 normal bins, so a flat face's region can span many cells? check
   `cutterRegions` (a region is per cell and bin: at most ~200 Å, so the patch should not repeat inside one); (b) 4
   conformers a species (`cutterTable(leaflet, 4)`, `i % k` in `cutter.ts:74`): every lipid of a species drawn as one of
   4 shapes, turned: likely the regularity; measure distinct shapes per 1000 lipids; fix by more conformers (each a
   member: render objects and records grow) or a per-lipid spin about the normal from a hash; (c) neighbouring regions'
   offsets/spins: `cutterRegions` hashes cell and bin, check correlation. Test failing first: a statistic over a flat
   plane's lipids (e.g. the pair distribution's peak sharpness, or repeats of identical (conformer, azimuth) pairs).
2. Item 5, tiles = cutter properties: species rows and hide (tiles' variants mix species: hide needs a per-lipid mask in
   the assign kernel), colours, the far surface (`farSurface` takes a cut leaflet: a tiles leaflet's remeshed surface
   and its tile set's heads would do), Levels (shared already). Say at a checkpoint which tiles cannot.
3. Item 6, clip on a membrane: `apps/prism-me/src/explorer/menu.ts` ~475 skips `moveItems` for a membrane, which also
   drops Clip; offer the clip items alone; the culler culls clipped instances (`syncClip`), the surfaces are meshes:
   check both looks and both methods in Dawn.
4. The gate on `541038d31...HEAD` (lane-reviewer, lane-skeptic), the checks, `r4b` images for the cow, the report.

## Round 4b, items 4–6 (2026-11-08, second session)

**Item 4, the cutter's regularity: the cause, measured before the fix** (the CHARMM-GUI patch; a probe over the meshes
in `~/Downloads/3D-Models`, not committed). The patch's box is **154 Å**, not the 232 Å the brief assumed. A copy: a hit
of the same patch lipid, turned the same way, in one region.

| Mesh       | triangles across (median / max) | triangles over the box | copies before | copies after (`a37397aea`) |
| ---------- | ------------------------------- | ---------------------- | ------------- | -------------------------- |
| teddy ×100 | 168 / 746 Å                     | 1,768 of 3,192         | 30.3 %        | 0.01 %                     |
| model ×20  | 250 / 407 Å                     | 2,880 of 2,880         | 29.3 %        | 0.06 %                     |
| cow ×100   | 24 / 98 Å                       | 0                      | 1.5 %         | 0.04 %                     |

The patch repeated at its period inside a region, and inside one triangle (a smaller `RegionCell` cannot help: single
triangles exceed the period). The other suspects, measured: conformers (40 members for 442 outer lipids, 13 lipids a
conformer at the median, each lipid at its own head and azimuth: left as they are, the images do not read regular after
the fix); neighbouring regions' offsets and spins (3 of 9,126 pairs alike on the teddy, the chance level: not a cause).
Lipids a leaflet unchanged (teddy 594,817 → 594,768).

**Fix (`9562891fe` failing, `a37397aea`):** each region is cut by cells in the patch's plane (p = offset + Rz(θ) q,
before the wrap, so each region's grid is turned and moved), a side of 0.99 × box / √2 (a cell at any spin holds one
image of a lipid at most); each cell takes the patch at one of 4,096 spins and offsets by a hash of its region and index
(`cellEntry`, the same u32 arithmetic in WGSL). The kernel the same: equal counts and affines on Dawn, the fixture's
triangles over several cells (asserted); the cells' table after the regions in one buffer, the write pass being at the
stage's 10 storage buffers (an 11th made it write nothing). The far surface maps its points through the cell
(`0f58da6eb` failing, `f55d5c821`): a point's colour the species of the nearest cut head, 90 % and up.

**Decided (this session, for Ludo to confirm):** seams now lie at the cells' borders too (about every 108 Å inside a
large region), not only at region borders as Ludo had them (2026-11-08): with a 154 Å patch and triangles up to 746 Å,
no seam inside a region means the period. The flat-plane test reads "no seams inside a cell".

**Item 5, one membrane, two generators (`d5e802216` failing, `5c2c7f614`).** A tiles membrane now has: species rows (eye
and colour; a hidden species' lipids taken out of every tile's atoms, `shownLipids`, the assigner unchanged: a tile
mixes species), colorBy (it had it), Levels (it had it), the far surfaces at its heads (Far: Both or Spheres). **What
tiles cannot do, and why:** Texture and the pool's switches (Lipids from / down to / at most): tiles are built whole,
every tile drawn, nothing dropped by its size on screen (the per-view selection is the cutter's); the operation refuses
Texture on tiles. Their far surfaces are coloured as the cutter would cut the patch on the tiles' surface: the species'
proportions and grain, not each tile's own lipids. Export stays the cutter's (a tiles membrane would export its tiles,
not built here). ~70 production lines.

**Item 6, Clip (`b53fbd70c` failing, `ae86ffed4`).** The membrane's params carry `clip` (Prism's cuts reach it, as
`RepresentationClip.isClippable`); its spheres and surfaces are made with it; a clip alone updates the drawn objects'
clip values (`BaseGeometry.updateValues` with the props they were made with), nothing built again, so a handle's preview
does not rebuild 1 M-vertex surfaces a frame. The right-click offers Add clip… on a membrane. Dawn: a plane through the
center removes one half of the image in all four looks (cutter spheres, cutter texture, tiles spheres, tiles both), the
other half kept. Headless without WebGPU a membrane draws nothing, so `clipping.add` refuses it there ("draws nothing
yet"); the app's test checks the menu item and that the cell is clippable.

**Item 6 end to end (`3cbb1d081`).** Ludo at 1354, after the 4c note: "we still cant cut away". Reproduced through the
viewer's own `clipping.add` on the membrane's node on Dawn (`lipid-clip.webgpu.test.ts`): before `ae86ffed4` it fails
("No representation draws it"), after it the near half is cut away (Prism's new plane faces the camera: the inside is
seen, with its cap), both methods. A membrane wrapped by a page built before `ae86ffed4` has no `clip` in its params:
reload 1354 and wrap again.

**Gate finding of this session (images, before the reviewer's): Both close up hid half the lipids.** The far surface at
the mean of the conformers' tops lay above 23 of the CHARMM-GUI patch's 40 outer conformers' tops; drawn beneath in Both
it hid them (`r4b-cow-x100-cutter-both-close.png` before, sparse heads poking through; the same view with Spheres
dense). Test `e95ec84a3` (failing), fix `deb51ee83`: the surface at the lowest top (5.6 Å under the mean, still at the
heads).

## Round 4b, the gate (2026-11-08)

An Opus reviewer read `541038d31...b25246e5f` (2 must-fix, 6 should-fix, 5 nits); an Opus skeptic re-ran or re-read each
(12 confirmed in whole or part, M1 already fixed, S1's RangeError refuted, S2 and S5 lowered to nits; 3 new).

| Finding                                                                                                                                                                                                            | Outcome                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 the far surface at the tops' mean hid half the lipids in Both close up                                                                                                                                          | found by this session's images first; test `e95ec84a3` (failing), fix `deb51ee83` (the lowest head); ui.md `6b8d4887c`                        |
| M2 cells put seams and clashes inside every region (145 atom pairs under 2 Å on the flat-plane fixture, none before)                                                                                               | open for Ludo: the trade-off of item 4 (no seams inside a region means the period); the seams bounded in the test `ea4c2a693` so a rise shows |
| S1 the far surface's 1 M vertex cap not held (3 vertices a triangle)                                                                                                                                               | test `248604d91` (failing), fix `ebae633e4` (welded, n lowered until the cap holds; the mesh's own vertices at n = 1)                         |
| S2 far surfaces rebuilt on every look change (one rebuild a committed change)                                                                                                                                      | nit, open (TODO: cache the geometry by leaflet and hidden species, recolour only)                                                             |
| S3 no scaling guard for farSurface and shownLipids                                                                                                                                                                 | guards added `248604d91` (far surface over N triangles and N patch lipids; a tile of N lipids); pass after `ebae633e4`                        |
| S4 a clip preview during a redraw left members with the old clip                                                                                                                                                   | fix `a02e61c97` by reading; its guard test passes before the fix too (the window did not open headless)                                       |
| S5 members kept past a release                                                                                                                                                                                     | nit, fixed `a02e61c97`                                                                                                                        |
| S6 cracks at T-junctions (35,118 edges of a bumpy sphere's surface used once)                                                                                                                                      | test `248604d91` (failing), fix `ebae633e4` (one n, edge points shared)                                                                       |
| N1 headGrid quadratic in the patch (×25 at 4× the patch)                                                                                                                                                           | guard `248604d91` (failing), fix `ebae633e4` (heads bucketed, ring search)                                                                    |
| N2 onlyClip: a no-op update rebuilds                                                                                                                                                                               | nit, open                                                                                                                                     |
| N3 ui.md did not say where the surface sits                                                                                                                                                                        | fixed `6b8d4887c`                                                                                                                             |
| Nits: Texture refusal read the data; setClip allocates per member per preview step; all species hidden leaves a grey surface; membranes wrapped before `ae86ffed4` have no clip (wrap again); ui.md's whole stages | refusal `2a8cd493c`, stages `6b8d4887c`; the rest open                                                                                        |

A shared far-surface edge point takes its first triangle's colour: the colour test's bound went from 0.9 to 0.85.

## Round 4b, checks (2026-11-08, after the gate's fixes)

`npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm format:check`, `pnpm check:workspace`, mesoscale
and prism-me `styles:check`, prism-me `typecheck:storybook` pass. Quick lane with Dawn (mesoscale, cryoet, stage-tools,
prism-me): 77 files, 535 passed, 1 skipped. Scaling (mesoscale, the new guards and the positive control): pass.

## Round 4b, images (headless Dawn, M1, 900×600, perspective, CHARMM-GUI patch; looked at)

`~/prism-me-lanes/lipid-tiles-shots/r4b-<cow-x100|model-x20>-<cutter|tiles>-both-<whole|middle|close>.png`, the cow's
`-middle-clipped` (a plane through its center: the top half cut away, both methods) and `-spheres-*` for comparison.
Seen: no period at any distance (the model ×20 at its 250 Å triangles); close up Both now as dense as Spheres, the
surface under the heads; the clip cuts lipids and surfaces alike; the far surface shows its triangles' facets in light
and smooth colour streaks between vertices (open: 4c's smooth switch). Built: cow cutter 0.26 s, tiles 1.4 s; model ×20
cutter 1.3 s (1,507,049 lipids), tiles 13.2 s (1,552,198 lipids, 6,008 tiles).

## Round 4b, end

**Built.** Items 1–3 (first session); item 4 the cutter's cells (`9562891fe`, `a37397aea`, `0f58da6eb`, `f55d5c821`);
item 5 tiles with the cutter's Look but Texture (`d5e802216`, `5c2c7f614`); item 6 Clip on a membrane (`b53fbd70c`,
`ae86ffed4`, end to end `3cbb1d081`); the gate's fixes above.

**Decided.** This session: seams at the cells' borders (Ludo to confirm, M2); the far surface at the lowest head; tiles
without Texture or the pool's switches (built whole); a tiles far surface coloured as the cutter would cut the patch
there. Ludo (earlier): the round's brief.

**Learned.** The CHARMM-GUI box is 154 Å, not 232: most triangles of a scaled model are larger than the period. A
compute pass is limited to 10 storage buffers: an 11th made the write pass write nothing, silently. Prism's preview
calls a representation's `createOrUpdate` outside the state, at the pointer's rate: a clip must be a values update. A
membrane drawn beneath its lipids must sit under the lowest head, not at the heads' mean.

**Size.** About 590 production lines this session (+588 −195: cutter and kernel ~170, far surface ~180 with the gate's
rewrite, membrane ~100, ops and controls ~30, app ~10) against the brief's ~450 for items 4–6; the gate's far-surface
rewrite (S1, S6, N1) took the room. Round 4b in all: about 745 lines added.

**How Ludo checks it (1354, reload first: a membrane wrapped by an older build has no clip).** Open the teddy or the
cow, Scale ×100, right-click › Wrap with lipids: no repeated patch close up (item 4). Right-click › Add clip… › New
plane on the membrane: its spheres and surfaces cut away, the handle moving the cut live (item 6). Wrap with lipids
(tiles): the Look has the species' eyes and colours, Far Both or Spheres (item 5). Both, close: the heads dense above
the surface.

## Round 4c brief (Ludo, 2026-11-08, after trying 4b items 1–3; queued after 4b's gate)

**Asked.** "the transition texture / spheres is not smooth yet, finally we still cant cut away, and color quickly (all
residues / the object) it should follow same coloring as particles (by zoom, etc..)".

7. **A smooth switch between spheres and surface.** Today the triangle set changes at `spheresPx` and the surface colour
   (vertex colours) differs from the coarse sphere levels' look. Wanted: no visible line or pop. Options for the
   checkpoint: a screen-door/dither fade over a px band (both drawn, each at its share), the surface's colours matched
   to the spheres at the switch (the same species weights the coarse levels draw), the coarse levels' sizes matched to
   the surface's head height. A test or an image metric: the mean colour and luminance across the switch band within a
   bound.
8. **Colouring as a particle list.** The quick colour actions on a membrane (the object's colour, all at once) and the
   particle colour schemes (by entity = species, uniform, palettes, colours by zoom `ZoomColors`) apply to a membrane
   through the same operations and controls as a particle list (prism-me AGENTS.md: particles for everything mesoscale;
   ui.md the four places), spheres and far surfaces alike. A test per operation: applied to a membrane it changes what
   is drawn in both looks. (Cut away = 4b item 6, Clip on a membrane: must land in 4b.)

**Size and model.** ~300 production lines; Opus. Gate on the round's diff.

## Round 4c, item 7: the cause, measured (2026-11-08, before code)

Probe (not committed): model_vertexcolor ×20, cutter, CHARMM-GUI patch, Dawn, perspective, 900×600; the same view as
Spheres, as the surface (Texture, from 16 px) and as Both; Oklab means over the 6 px either side of where the spheres
stop (`lipid-tiles-shots/r4c-diag-*`, looked at).

| at the same pixels        | L     | a      | b      |
| ------------------------- | ----- | ------ | ------ |
| the spheres               | 0.674 | −0.064 | 0.079  |
| the surface               | 0.524 | 0.043  | −0.008 |
| the surface without bumps | 0.528 | 0.043  | −0.008 |

**The cause: the surface weights each species by its lipids, the spheres show the species on top.** The surface's vertex
is the species of the nearest head (by count: CHL1 26 %, maroon; DLPC and POPC purples). Near the switch the spheres are
the coarsest level (balanced: stride 64, one atom a lipid, grown about 7×, a 14 Å sphere), and the species whose head
sits highest covers its neighbours: DSM's top is at 26.8 Å, CHL1's at 17.7 Å. A top-view raster of the patch
(`zz-r4c-top`, the outer leaflet) gives DSM 17 % with atoms (2 Å), 34 % at stride 8, 73 % at stride 64 (green): what the
image shows. The bumps are not it (ΔL 0.004). The hard cut along triangle borders shows because of this mismatch.

**Design checkpoint.** (1) The surface's colours from the spheres it replaces: each vertex the species on top in a
top-view raster of the patch drawn as the switch's level draws it (that level's atoms, `orderPositionGroup`'s order, its
grown radius), the nearest head where no sphere covers. Built once a look, as the surface; nothing per frame. (2) The
luminance measured again after (1), matched in the surface's material if it still differs. (3) A dithered fade over a px
band needs the graphics library: the object dither (`fadeLod`) is off for objects with levels (`uLod.w`), and the
pixel-mode levels' last range is open (`getLodLevelsValue`: Infinity). A library change, Ludo's call: proposed, not
built. Test (Dawn): a patch whose rare species stands tallest, a perspective view across the switch (spheresPx just
under and just over the lipids' size on screen), the mean Oklab of the membrane's pixels within a bound.

## Round 4c, built (2026-11-08)

**Item 7, the switch.** (1) Colour: `2d8aa6e42` failing (Oklab a, b off by 0.050 across the switch, bound 0.02), fix
`5309e53d6`: the far surface's points are the species on top in a top-view raster of the patch drawn as the switch's
level draws it (`switchSpheres`: the level Mol*'s levels pick at the switch's size on screen, its atoms in
`orderLodLevels`' order, its grown radius; `topGrid`), the nearest head where no sphere covers; after: 0.0025. Model ×20
with the app's look: a, b across the switch (−0.064, 0.079) | (0.043, −0.008) before, (−0.040, 0.060) | (−0.031, 0.052)
after. (2) The step: with the app's look the 20 Å step from the sphere tops down to the surface drew a line along the
triangles (outline, shadows). `01ed9b2c0` failing, `4b8189177`: the far surface at the switch level's mean top, dithered
in by distance with Mol*'s object fade (`lod`, `fadeSurface`) from a lipid at twice the switch's px to the switch, not
drawn nearer; set when the size on screen changes (a resize), not per move; orthographic: drawn or not. (3) That opened
the gaps between close lipids to the background (`r4c-model-x20-zoom2`, first render): `0bb6814c8` a second, coarser
surface a cut leaflet (four lipid spacings) at the lowest head, drawn to the selection's hysteresis.

**Item 8, colouring as a particle list.** `003b84626`: `mesoscale.style` (color, visible, reset), `mesoscale.colors`
(generate, uniform, theme) and `mesoscale.colorLevels` take a membrane as `particles`, its species its entities, one
writer (`updateMembrane`, `membraneSpecies` too), one step each; colours by zoom on the members and the surfaces (far:
the membrane's colour; near: its species'; no chain or atom colours: a lipid is one group; off for one colour, as a
list's). Dawn (`lipid-colors.webgpu.test.ts`): each operation changes the spheres close up and the cutter's far surface,
both methods; the theme back draws as at first. `fff9bfb79`: right-click › Color… (swatches, Generate colors) and the
Look (a colour for all, By zoom, Generate colors, Reset). Specs `0c89e7be8`, `50a27f267`; changelog `1656174b0`.

**Not built (Ludo's call).** A dither of the spheres themselves: the object dither is off for objects with levels
(`uLod.w`) and the pixel-mode levels' last range is open (`getLodLevelsValue`): a graphics library change. The surface
dithers in over them instead.

**Colour speed.** A colour on all species redraws the membrane (S2 open: every surface rebuilt): cow ×100 60 ms, model
×20 0.95 s (four 1 M-vertex-capped surfaces). A colour-only update path is the next step if Ludo finds it slow.

## Round 4c, the gate (2026-11-08)

An Opus reviewer read `1859f56ea...1270d26c1` (1 must-fix, 2 should-fix, 7 nits); an Opus skeptic re-ran or re-read
each: all confirmed, M1 lowered to should-fix (wrong only past about 3 px a lipid, the sliders' defaults pick the
coarsest level rightly), S1 live at the defaults (CHARMM-GUI's species have 28 to 52 heavy atoms, under stride 64).

| Finding                                                                                      | Outcome                                                                                         |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| M1 `switchSpheres` always the coarsest level (no radius: every pixel boundary 0)             | test `7cbb1507f` (failing), fix `6a0ce0938`; the switch test at a second size `d6a46537d`       |
| S1 one radius for every member (the last one's)                                              | test `55ae49fb2`/`3dacc16d5` (failing), fix `8c0b6892c`                                         |
| S2 By zoom's far colour never the one set (only `speciesColors` written)                     | test `bc54c3b63` (failing), fix `92808fe96`: one colour on all species is the membrane's colour |
| N1 the first-frame comment                                                                   | fixed `9d05f62d9`                                                                               |
| N2 a membrane by its ref only, not its label                                                 | open (the agent gets a clear failure)                                                           |
| N3 a list's group ignored on a membrane; ref untrimmed                                       | fixed `053f63f8b`, in the S2 test                                                               |
| N4 validation before the list's lookup (an unknown entity with nothing to change)            | open, nit                                                                                       |
| N5 `tColorFar` at the pool's capacity (8 MB at 2 M); the near surface at the same vertex cap | open (TODO: colour-only updates)                                                                |
| N6 `topGrid`'s seam off by under a cell                                                      | open, as `headGrid`                                                                             |
| N7 TODO stale, ui.md wording, no test of visible and reset                                   | fixed `199c9a407`, `a99ef68ae`; the S2 test covers visible and reset                            |

## Round 4c, checks (2026-11-08, after the gate's fixes)

`npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm format:check`, `pnpm check:workspace`, mesoscale
and prism-me `styles:check`, prism-me `typecheck:storybook` pass. Quick lane with Dawn (mesoscale, cryoet, stage-tools,
prism-me): 80 files, 541 passed, 1 skipped.

## Round 4c, images (headless Dawn, M1, 900×600, perspective, the app's look, CHARMM-GUI patch; looked at)

`~/prism-me-lanes/lipid-tiles-shots/`: `r4c-<cow-x100|model-x20>-zoom0..4.png` (close to whole), `-byzoom-whole`,
`-byzoom-close`; `r4c-diag-*` and `r4c-after-spx2-*` / `r4c-fade-spx2-*` (the switch mid-object at 2 px: before, colour
fixed, faded); `r4c-switch-<2300|200>-<spheres|surface>.png` (the test's two sides). Seen: the surface now green as the
spheres (DSM on top), no line along the triangles where the spheres stop, the dither band soft; the gaps between close
lipids filled again. The cow ×100 is too small for a lipid to fall under 0.5 px at these zooms: its images show spheres
only. Open: close up the finest level (atoms) reads darker and sparser than the next (a levels matter, not the switch).

## Round 4c, end

**Built.** Item 7: the far surface coloured as the switch's spheres show the patch, at their tops, dithered in by
distance, a coarser one beneath close lipids. Item 8: a membrane coloured through a list's operations, its Look and
Color…, colours by zoom on spheres and surfaces. The gate's fixes above.

**Decided (this session, for Ludo to confirm).** The switch's cause was colour (the species standing highest cover their
neighbours at the coarse levels), then the step (the outline and shadows drew it). The spheres themselves are not
dithered (a graphics change: Ludo's call); the surface dithers over them. One colour on all of a membrane is its own
colour, By zoom's far colour. A membrane takes no opacity or glow (its spheres merged by species).

**Learned.** A surface beneath sub-pixel spheres must be coloured by what they show from above, not by their count: a
tall species wins. An object fade (`lod`) works on Mol*'s meshes per fragment, and its distance follows the selection's
switch exactly in perspective (`size / (depthScale · px)`), so it can be set per resize. Removing a surface that hid
gaps uncovers what tests compared by pixel (the selection's hysteresis).

**Size.** About 330 production lines (membrane ~150, far surface ~70, operations ~110, app ~60, less the moved lines)
against the brief's ~300; the gate's fixes and the near surface took the room. A colour change on model ×20 still takes
about 1 s (every surface rebuilt): the next step if Ludo finds colouring slow.

**How Ludo checks it (1354, reload first).** Wrap a mesh with lipids (the cutter), zoom out slowly: no line or colour
pop where lipids give way to the surface (Look › Lipids down to raises the switch to see it nearer: 2 px). Right-click
the membrane › Color… › a swatch: every species that colour, spheres and far surface; Look › Generate colors, Reset, By
zoom (far the membrane's colour, its species close).

## Round 5 brief (Ludo, 2026-11-09): a billion lipids at interactive rate

**Asked.** "model_vertexcolor.obj scale at 600, we want interactive viewing at that scale. find a way that it looks
good, accurate as possible. color by zoom from compartment (the object color, down to chain/residue colors then atom
colors). the texture does not appear on membrane per tiles. At 600 scale, its a lot of triangles, but it only matter at
a certain distance. figure this out. /goal render procedurally at interactive rate lipids membrane for that big object
with billions of lipids."

**The numbers.** `~/Downloads/3D-Models/model_vertexcolor.obj`: 2,880 triangles. ×100 was 27.7 M lipids full; ×600 is
36× the area, about 1.0 G lipids, about 5–6 M cells of ~108 Å. Nothing O(lipids) or O(cells) may be built or held at
wrap or per view: only O(triangles) at wrap and O(budget) per view.

**Goal.** Wrap at ×600 in about the time of ×20 (memory flat in the lipid count); fly whole → middle → close at ≥ 30 fps
on the M1 (≤ 33 ms frames, headless Dawn as the proxy, then Ludo in Chrome), no holes, no visible switch, nothing at
rest; accurate: what is drawn near is exactly what export would give there (same lipids, same cells).

**Design to settle at a checkpoint (before code; stop and report if a library change is over ~600 lines).**

1. **Hierarchical selection.** Today a triangle is taken whole. At ×600 one triangle holds ~350 k lipids, so select
   below the triangle: cells (the 4b cells, ~108 Å) enumerated on the fly inside the frustum and the px band, near
   first, into the fixed pool; a cell's contents generated on the GPU from (triangle, cell) alone (deterministic, as
   today). Measure the CPU cost of the selection per camera change at ×600 (target ≤ 4 ms) and move it to the GPU if
   needed.
2. **A scale-free far look.** Vertex colours (capped 1 M vertices, ~2 lipid spacings) cannot hold at ×600. The head
   pattern in the shader instead: per fragment, the point mapped by its cutter plane and cell (spin, offset) into the
   patch's top-view raster of 4c (colour = the species on top, normal = the head bump), as a texture, mipmapped so it
   blurs to the true mean far away. Exactly the near look at the switch, any scale. This is the "texture" Ludo asked for
   at the start (round 4 decision: bump texture of heads). Likely a `packages/graphics` change (a mesh material reading
   a texture by a per-vertex plane frame): size it at the checkpoint.
3. **Colour by zoom, three levels.** Far: the compartment's colour (the object's / membrane's). Middle: per species
   (chain/residue = lipid species). Close: per atom (element colours of the lipid's atoms, as a particle list's last
   zoom level). Through `mesoscale.colorLevels` and the same Look controls as a particle list; spheres and far surface
   alike.
4. **Tiles.** The tiles membrane shows no texture (4b: refused). Give tiles the far texture surface (Far: Texture and
   Both) where cheap; tiles are built whole, so they are not for ×600: refuse tiles above a lipid count with a message
   that names the cutter. Say so in the menu label or the error.
5. **Budget and LOD at scale.** The pool budget sized to the device (2 M default; measure 4 M), the sphere levels'
   distances in px not Å so they hold at any scale (state the defaults chosen and why), the switch px of 4c.

**Tests.** Wrap-time and memory scaling guard at ×20, ×100, ×600 (flat in lipids, linear in triangles); the camera path
at ×600 headless (frame ms, lipids in pool, cells selected, selection ms, 0 at rest); determinism (a cell's lipids the
same from two views and from export of that cell); the far texture's colour equals the spheres' at the switch (4c's
metric) at ×20 and ×600; colour by zoom three levels each changes what is drawn; tiles refused at ×600. Images r5-*.png
(×600: whole, middle, close, and a zoom sequence; colour by zoom).

**Machine care, changed for this round (Ludo asked for ×600).** The per-view cutter wrap may run at ×100 and ×600 (it
builds no lipids); never export, tiles or any full build above ×20 in a test. Watch the process: abort a run whose node
RSS passes 8 GB, run one heavy job at a time, wait while load > 12.

**Ludo checks.** Chrome on 1354: open model_vertexcolor, Look › Scale 600, right-click › Wrap with lipids: done in a
second or two. Zoom from whole to a few lipids: smooth (fans calm), no holes, no visible switch; colour by zoom: the
object's colour, then species, then atoms. Tiles at 600: refused with a message.

**Size and model.** ~900 production lines (selection 250, far texture + library material 350, colour levels 150, tiles
and budget 150); Opus. Gate on the round's diff.

## Round 5, measured before code (2026-11-09)

Probe (not committed: `lipid-scale-probe.webgpu.test.ts`, `LIPID_PROBE=<obj>`): model_vertexcolor at a scale, the
cutter, CHARMM-GUI patch, headless Dawn, M1, 900×600, default look, budget 2 M; whole (reset), middle (0.3 R above the
vertex nearest the camera), close (400 Å above it); frame ms the four frames at each view (the first selects and
writes), the machine at load 12–16 (another session's gates). Images `lipid-tiles-shots/r5-probe/`.

| Scale            | lipids (full) | wrap ms (repr) | RSS after wrap | empty frame | whole ms, live | middle ms, live         | close ms, live, triangles taken / in view |
| ---------------- | ------------- | -------------- | -------------- | ----------- | -------------- | ----------------------- | ----------------------------------------- |
| ×20              | 1.51 M        | 1,020          | 0.66 GB        | 10          | 400, 1.51 M    | 600, 0.40 M             | 500, 0.27 M, 1,166 / 1,166                |
| ×20, budget 50 k |               | 417            |                |             | 38, 43 k       | 95, 44 k                | 104, 44 k                                 |
| ×100             | 37.7 M        | 2,566          | 1.06 GB        | 10          | 62, 0          | 400 (first 811), 2.15 M | 450 (first 891), 1.22 M, 186 / 186        |
| ×600             | 1,357 M       | 7,676          | 1.42 GB        | 10          | 62, 0          | 62, 0                   | 89 (first **4,079**), 1.81 M, **4 / 76**  |

What breaks at ×600, by cause:

1. **The unit is the triangle.** A triangle holds ~470 k lipids: the close view's pool (2 M) holds 4 of the 76 triangles
   in view; the rest show the surface (`probe-x600-close.png`: a lipid triangle's corner on a smear). The first frame
   takes 4.1 s: the write pass is a thread a (triangle, member), each writing ~10 k lipids in a row.
2. **The wrap is O(lipids).** The count pass (a thread a triangle over its cells' patch lipids) is 7.7 s at ×600, linear
   in the lipids (1.0 s at ×20); its counts are what the pool and selection read.
3. **The far look is vertex colours capped at 1 M vertices.** At ×600 a vertex is ~10 lipid spacings: speckles at middle
   (`probe-x600-middle.png`), a rainbow smear close, nothing of the head pattern; and the four 1 M-vertex surfaces cost
   ~50 ms a frame (whole and middle: 62 ms with no lipid drawn, the empty scene 10 ms).
4. **A frame costs what is drawn, ~1–2 µs a lipid in view at the fine levels** (×20 close: 0.27 M → 500 ms, 44 k → 104
   ms; whole at the coarse levels 0.27 µs a lipid). The selection is not the cost (taken views are 0–1 ms of CPU in the
   culler's hook; the frames at rest are as slow as the first). So ≤ 33 ms needs the pool to hold what is seen, tens of
   thousands of lipids near, and the far look to take over at a few px a lipid, cheaply.

## Round 5, design (checkpoint, 2026-11-09, before code)

**1. Cells, not triangles (selection below the triangle; extension only).** The 4b cells already make a cell's lipids a
function of its kind: cell (cx, cy) of region r draws kind `cellEntry(r, cx, cy)` (4,096 kinds: offset, spin), its
lipids those of the patch whose image falls in the cell square. So per kind and member the count is known from the patch
alone (4,096 × the patch's lipids, once a patch, ~20 ms), and a triangle's cell holds at most that many: a cell on the
triangle's edge writes the lipids the triangle does not own as dead slots (the culler skips them). The work unit is a
(triangle, cell): per view the CPU tests triangles (frustum, px) as now, then the cells of each triangle it keeps, only
those within the distance where a lipid is ≥ the enter px (the disc of the triangle's plane inside that ball), nearest
first into the pool (its capacities: the budget shared by the members' mean count a cell). The bases are a prefix of the
kinds' counts over the selected cells (CPU, O(selected cells × members), uploaded with the list on a new selection). The
write pass: a thread a (selected cell, member), ~20 lipids × 4 images each. The count pass and its readback go: nothing
O(lipids) at wrap; the label's count is the area's estimate (cells × the kinds' mean), exact only by export.
Determinism: a cell's lipids are `eachHit`'s restricted to that cell (export's), whatever the view. Tiles' lost parts
use the same path (enter 0, budget unbounded).

**2. The far look: the patch's top view as a texture, mapped per fragment (library: `packages/graphics`, WGSL only).** A
mesh option (`dPatchTexture`): per vertex its point in its region's plane and its region (flat); per fragment the
cutter's own map (cell, kind by the same hash, offset and spin, the box's period) into a texture of the patch's top view
(4c's `topGrid` raster at the switch's level: the species on top, shaded by its height), sampled with `textureGrad` by
the rotated derivatives of the plane point (mipmapped, repeat): exactly the spheres' pattern at the switch, the true
mean far away, any scale. The mesh is the triangles themselves (2,880 × 3 vertices a surface, not 1 M), each vertex
lifted along the smooth normal to the leaflet's head height. Colour by zoom folds in per fragment (far colour → texture
by the lipid's px, the levels' edges). A colour change re-uploads the texture (a few hundred kB), not the surfaces.
Size: WGSL ~120, TS plumbing (values, attribute, texture with mips, sampler) ~150: ~270, under 600.

**3. Colour by zoom, three levels** with Mol*'s `ColorLevels` (far, entity, atom): far the membrane's colour
(`tColorFar`), middle each species' (the theme), close each atom's element (`tColorNear` by group: a cutter member's
groups become its atoms). Surfaces: far colour → texture (2). Through `mesoscale.colorLevels` and the Look as now.

**4. Tiles.** The tiles' leaflets get the texture surface (their regions exist: `cutterRegions` on the remesh). Tiles
are built whole: refused above `MaxTileLipids` (estimated from the area, 50 M) with a message naming Wrap with lipids
(the cutter); the menu label says "(small objects)".

**5. Budget and LOD in px.** The levels' distances are already in px (`lodPixelSize`, `membraneLevels`); the enter px
default goes from 0.5 (both) to where the texture now matches (measured: the frame at 2, 3, 4 px; the default the
smallest under 33 ms close and middle on the M1); budget 2 M stays the cap, what is selected is what is in view.

**Tests (each failing first where it is a fix):** the cell selection's reference (a cell's lipids = export's in that
cell; two views, the same cell, the same lipids); the camera path at ×600 on a synthetic mesh of the model's size (2,880
triangles, ~1 G lipids: an icosphere), frame ms, pool, cells, selection ms, 0 at rest, no hole close (the covered
fraction); the wrap's scaling guard ×20/×100/×600 (time and memory flat in lipids); the far texture's colour equals the
spheres' at the switch (4c's metric) at ×20 and ×600; colour by zoom's three levels each change the image; tiles refused
at ×600.

**Stop lines.** Library ~270 (< 600). If the per-fragment hash or `textureGrad` across cell seams shows seams or costs
more than ~5 ms at 900×600, the fallback is the region map alone (no cells: the patch repeats at its period far away,
exact only where lipids are drawn).

## Round 5, built (2026-11-09)

- `7f1fc2916` cells below the triangle (procedural.ts, cutter.ts `eachCellHit`/`kindCounts`, kernel's write pass by
  units, the count pass over small triangles only), the leaflet facing the camera (off under a clip).
- `835dffca8` graphics: `dPatchTexture` (mesh WGSL, ~105 lines with the `sLinearMipmapRepeat` sampler).
- `b657932c1` the far surfaces: the mesh's triangles with the patch texture (`patchSurface`, `patchRaster`).
- `2d240dfa2` the near surface off the mid-plane (at the lowest head it stood over the coarser levels' lipids in bands:
  `r5-probe/probe-x20-box-z200.png` before, `probe-x20-drop15-z200.png` after); a cell culled by its box; a no-hole
  test.
- `90dc0062c` spheres down to 2 px by default.

Numbers after (probe, x600, M1 Dawn, load 13-20): wrap 1.5 s (repr), RSS 0.8 GB; whole 10 ms, middle 11-14 ms; zoom
z200/z400/z800 (Å from the surface): 205/169/142 ms with 41 k/120 k/393 k lipids (selection 2-9 ms both leaflets); z1600
and past: 11 ms (texture). Close frames are bound by drawing the visible lipids at atom detail, the same at x20 (z200
236 ms): not the scale any more.

Later commits: `e1b427405` colours by zoom to atoms by element; tiles refused past 50 M (`MaxTileLipids`, menu "tiles,
small objects"); tests: the wrap's scaling guard x20/x600 (flat), the x600 camera path (Dawn), the switch's colour at
x600, the patch surface and texture, the three colour levels (failing without element colours). Specs, TODO, changelog.

## Round 5, the gate (2026-11-09)

An Opus reviewer read `8ad314736...HEAD`: 5 must-fix, 7 should-fix, 9 nits. The skeptic was not run (context); the
must-fixes were fixed directly, each confirmed by reading.

| Finding                                                                           | Outcome                                                                                                                                |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| M1 tiles estimate `\| 0` overflows past 2^31: refusal off                         | test `450e090d9` (90 000 Å sphere; not run against the bug: it would build billions), fix `d8ab52057`                                  |
| M2 patch textures leaked on destroy and a new context                             | fixed `d8ab52057` (`releaseTextures`); no test (mock context: open)                                                                    |
| M3 a non-reuse rebuild destroyed the textures still drawn                         | fixed `d8ab52057` (release no longer rotates); no test                                                                                 |
| M4 a clip added with a still camera does not reselect (facing)                    | partly `d8ab52057`: selections reset where clips come or go; the reselect waits for the culler's next view hook (a still camera: open) |
| M5 goals not met: close frames 130-240 ms, selection 2-9 ms (> 4), bands unpinned | stated here and in the PR body; Ludo's call                                                                                            |
| S1 no test pins the WGSL map to the cutter's                                      | open (port the s-chain to TS against hitAffine heads)                                                                                  |
| S2 texture slides near creases (lift along vertex normal, not rn)                 | open (~10 Å at a 30° crease)                                                                                                           |
| S3 closures and subarrays per select / upload                                     | open (header claim to soften or hoist)                                                                                                 |
| S4 x600 scaling guard has no positive control                                     | open                                                                                                                                   |
| S5 slow Dawn tests untagged                                                       | open (as the earlier Dawn files)                                                                                                       |
| S6 graphics change without its own test; upstream?                                | open (Ludo's call)                                                                                                                     |
| S7 unitKey wrong at 2^21 triangles                                                | open (guard T)                                                                                                                         |
| N1-N9                                                                             | open, nits (N4: `farSurface`, `cutterBases` now test-only)                                                                             |

### Round 5, the gate closed (2026-11-09, second session)

The lane-skeptic ran on the reviewer's findings (`8ad314736...b2e0db7b0`); each confirmed or plausible must-fix and
should-fix got a test that fails on the code before its fix (or, where the fix was in, with the fix reverted locally,
not committed), then its fix.

| Finding                                         | Skeptic                       | Test                                                                                                   | Fix                                                                                                                      |
| ----------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| M1 tiles estimate wraps past 2^31               | confirmed (should-fix)        | `a4f462718`: the first step's answer (`.next()`); int32 restored: not done                             | `d8ab52057`                                                                                                              |
| M2 patch textures leaked on destroy             | confirmed                     | `d062cb902` (Dawn): destroy without `releaseTextures`: B's and C's left                                | `d8ab52057`                                                                                                              |
| M3 a rebuild destroyed the textures still drawn | confirmed                     | `d062cb902` (Dawn): `release()` rotating again: A's gone at B's end                                    | `d8ab52057`                                                                                                              |
| M4 a clip with a still camera                   | partial: refuted, fix whole   | `cf3a0c92d` (Dawn): the reset reverted: selects 4 → 4                                                  | `d8ab52057` (the culler's `syncClip` bumps its data version: the view hook runs on a clip change; the TODO comment went) |
| M5 goals not met close                          | Ludo's call                   |                                                                                                        | open (TODO; the lighter close level)                                                                                     |
| S1 shader map vs the cutter's                   | refuted as a defect           | `2786a07a3`: drift guard, the WGSL chain ported in f32 (constants asserted): within 0.05 Å at x600     | none needed                                                                                                              |
| S2 the texture slides                           | confirmed                     | `9ad038804`: a head followed up its normal reads its own point: median 1.92 Å before                   | `9ad038804` (a shift a vertex, −h P(n), in the table after the cells; < 0.05 Å)                                          |
| S3 allocation per select and upload             | confirmed                     | `0feb66e1f` (`test:perf`, new for mesoscale): 10,472 B a view                                          | `e6ff07e11`: 79.6 B (core's `sortArrayRange` pair; the upload's subarrays: TODO)                                         |
| S4 the scaling guard is no wrap, no control     | confirmed                     | `595de5175`: the wrap's CPU half at x20 and x80, 381 → 56 ms; the old count pass caught (×10.4)        | the guard itself                                                                                                         |
| S5 slow Dawn tests untagged                     | confirmed                     | `e038a3540`: medium (the switch split, its sphere quick)                                               |                                                                                                                          |
| S6 graphics change without its test             | confirmed                     | `f9526c7c6` (plugin-headless, Dawn): quadrants and shifts drawn; fails with the shader's shift dropped | upstream lane: Ludo's call                                                                                               |
| S7 unit key wrong past 2^21 triangles           | plausible                     | `68f2213bb`: the wrap goes on                                                                          | `2977cf6b4` (`MaxCutterTriangles`, refused at the first step)                                                            |
| X1 reset keeps live[] and version               | plausible (latent should-fix) | `5766b1881`                                                                                            | `306323c3f`                                                                                                              |
| X2 patchColor in depth, pick, marking           | nit                           | `d55a15ff2` (WGSL preprocessed: HEAD's read it in all)                                                 | `d55a15ff2`                                                                                                              |
| X3 textures kept without compute                | nit                           | none (no compute-less context in the quick lane)                                                       | `790360bde`                                                                                                              |
| N4 `farSurface`, `cutterBases` test-only        | nit                           |                                                                                                        | open (not trivial: their tests and guards go with them; TODO)                                                            |
| X4, X5, N1–N3, N5–N9                            | nits                          |                                                                                                        | open (TODO)                                                                                                              |

Decided this session: the S2 shift lives in each surface's table (two tables a leaflet, one patch texture); the S6 test
in plugin-headless (graphics has no Dawn context of its own); S4 at x20/x80, not x600 (the control there would count
billions); the cutter's cap 2^21 triangles. Checked after: the shift is read by `vertex_index`; a standalone mesh draw
binds each attribute's page by offset and draws with no base vertex (`render-item.ts`), and the patch surfaces are not
merged: the index is the surface's own (the S6 test now draws a plain mesh first). S2 and X2 are a test and its fix in
one commit each: their failures were shown on the code before (S2 through a local shim of the old call, X2 against
HEAD's shader). Learned: a closure that is passed or writes doubles allocates a heap number each (the selection's 10 kB
a view were that, not its arrays); `performance.now()` too.

## Round 5, checks (2026-11-09, after the gate closed)

`npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm format:check`, `pnpm check:workspace`, mesoscale
and prism-me `styles:check`, prism-me `typecheck:storybook` pass. Quick lane with Dawn (mesoscale, cryoet, stage-tools,
prism-me): 81 files, 554 passed, 3 skipped (the medium x600 ones). Medium with Dawn (the two x600 tests): pass, 2.0 GB
RSS. Graphics quick lane with Dawn plus the new plugin-headless test: 148 files, 1,754 passed. Mesoscale `test:perf`
(new) and the scaling guards touched (selection, wrap, control) pass.

## Round 5, checks (2026-11-09, after the must-fixes)

`npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm check:workspace`, mesoscale and prism-me
`styles:check`, prism-me `typecheck:storybook` pass; `pnpm format:check` passes after this file's prettier. Quick lane
with Dawn (mesoscale, cryoet, stage-tools, prism-me): 81 files, 549 passed, 1 skipped. Graphics quick lane with Dawn
(after the library commit): 146 files, 1,745 passed.

## Round 5, images (headless Dawn, M1, 900x600, perspective, the app's look; looked at)

`~/prism-me-lanes/lipid-tiles-shots/r5/`: `r5-x600-{whole,middle,close}.png`, `r5-x600-zoom-z{200..12800}.png` and
`r5-x600-zoom-sheet.png`, `r5-x600-byzoom-*.png` and `-sheet` (colours by zoom: the membrane's beige far, species,
lipids close), `r5-x20-tiles-texture-whole.png`. Diagnostics in `r5-probe/` (before: `probe-x600-close.png` the
half-drawn triangle, `probe-x600-middle.png` speckles; the bands `probe-x20-box-z200.png`, gone
`probe-x20-drop15-z200.png`). Seen: whole and middle a smooth species-mean texture, no speckle; close covered, a dark
seam line at region creases (the look's AO and outline); shadows draw dark wedges inside the knot's loop (also with
tiles: the look's, not the texture).

## Round 5, end

**Measured before.** Whole triangles (~470 k lipids each at x600): the close view's pool held 4 of 76 triangles in view,
a 4.1 s first frame; a 7.7 s O(lipids) count pass at wrap; four 1 M-vertex vertex-coloured surfaces (speckle, ~50 ms a
frame).

**Built.** Cells below the triangle (kinds' counts from the patch, dead slots on edge cells, the facing leaflet), the
patch texture in the mesh shader (library, ~105 lines), the far surfaces as the mesh's triangles, colours by zoom to
atoms, tiles refused past 50 M, the switch at 2 px.

**Numbers after (x600, M1 Dawn, app look, load 3-9).** Wrap 1.4 s (repr; 0.95 s for the synthetic sphere), RSS 0.83 GB.
Frames: whole 18 ms, middle 21 ms, close (400 Å) 137 ms with 93 k lipids; zoom z200/400/800/1600/3200/6400/12800:
128/138/105/45/49/34/23 ms. Selection 2-6 ms for both leaflets. Without the look: whole 10, middle 11-14 ms.

**Decided (this session, for Ludo).** Small triangles stay whole (`WholeCells` 8 cells); the near surface off the
mid-plane; spheres to 2 px by default; tiles past 50 M refused.

**Learned.** Past the texture the frame is what the lipids in view cost at their size (8-16 px lipids at atom detail,
depth-writing impostors: ~130-240 ms on the M1 at x20 and x600 alike): the scale no longer matters, the close level
does. A cell's lipids depend on its kind only, so slots are known from the patch alone.

**Size.** About 1,000 production lines (selection ~420, kernel ~150, membrane ~200, far surface ~120, library ~105)
against ~900; the selection's clipping and the texture plumbing took the room.

**Next (precise).** 1. Run the lane-skeptic on the reviewer's findings above (diff `8ad314736...HEAD`). 2. M4 fully:
have the culler call the pool's view hook once after a clip flip (or bump the LodView version). 3. S1 test (TS port of
`patchColor`'s s-chain vs `hitAffine` heads), S7 guard, S4 control, S3 hoist. 4. A lighter close level for 8-16 px
lipids (Ludo's call after Chrome on 1354).

**Next (after the gate, 2026-11-09).** The gate is closed ("Round 5, the gate closed"): Ludo's calls are M5 (a lighter
close level) and whether the graphics commits (pool, dead slots, patch texture) go to their own lane from master now;
left in TODO: N4, X4, X5, N1-N9.

## Round 6 brief (Ludo, 2026-11-09): the yeast cell's membranes

**Asked.** "now that this is ready add the membrane to the yeast model." Ludo chose the whole cell of
zoidpuff.github.io/yeast_cell_viewer, its compartment meshes only (download approved: ~9.2 MB, outside the repo, no
licence file in that repo, so nothing of it is committed; MODEL.md cites EMPIAR-11416 (CC0) for the real shapes).

**The data.** `~/prism-me-lanes/yeast-data/`: `organelle_meshes.bin.gz` (format: u32 count, then count × (membrane id,
nV, nT) u32, then per mesh nV×3 f32 and nT×3 u32, as the viewer's `renderer.ts` `uploadOrganelleMeshes`),
`geometry.json.gz`-in-name (gzip; `mem_names`), MODEL.md. Decoded by the coordinator to `yeast-data/obj/NN-<name>.obj`,
units nm (the cell ~4.1 µm across: Scale 10 to Å):

| mesh                               | triangles | area (nm²)               |
| ---------------------------------- | --------- | ------------------------ |
| PM                                 | 124,060   | 5.43e7                   |
| ER (cortical + perinuclear sheets) | 247,664   | 5.42e7                   |
| NE                                 | 105,140   | 2.25e7                   |
| VAC                                | 63,930    | 2.92e7                   |
| MITO_OM                            | 54,940    | 1.17e7                   |
| MITO_IM                            | 318,466   | 2.78e7                   |
| GOLGI                              | 146,898   | 9.34e6                   |
| PEROX                              | 6,890     | 1.47e6                   |
| LD (a monolayer in life)           | 14,146    | 3.02e6                   |
| total                              | 1.08 M    | 2.1e8 nm² ≈ 6–7e8 lipids |

**What is new against round 5.** Round 5 ran 2,880 triangles; here 1.08 M triangles in 9 membranes, a lipid count half
of ×600's. So:

1. **Selection over many triangles.** Per view the selection must not scan every triangle (at 318 k, one mesh): a
   hierarchy (BVH or the culler's cells) over triangles, frustum and px band tested per node; measure first.
2. **One budget across membranes.** Nine membranes share the device's pool budget, nearest first across them, not 2 M
   each (18 M would not fit).
3. **Load the cell.** A way to open the nine meshes at once in prism-me at the right scale (nm → Å), named by membrane,
   then wrap all (one operation, one history step: "bulk operations are one change") with a progress pill. Prefer
   reading the viewer's .bin.gz directly (a cryoet/mesoscale reader through + Open) over OBJ, if small; else the OBJs.
   Never commit the data; a test uses a synthetic mesh of the same format.
4. **Per-membrane composition (stated, not built unless cheap).** One CHARMM-GUI patch for all today; yeast PM, mito IM
   (cardiolipin), LD (monolayer) differ. Record what a per-membrane patch would need.
5. **Alignment with the slab.** The 600 nm slab Ludo loaded on 11-07 came from the same model: check whether its frame
   matches these meshes (Å = nm × 10, same origin) on a few particles near the PM if the slab is found; else state it.

**Tests.** The format reader on a synthetic two-mesh buffer; the selection's cost per view at 300 k triangles (a scaling
guard n and 4n triangles: per-view time sublinear); one budget across membranes (sum of pools ≤ budget, nearest first);
wrap all = one history step; camera path on a synthetic many-mesh cell (frame ms, 0 at rest). Images r6-*.png: the whole
cell, a slice through it (clip), close on the PM, NE with the ER, mitochondria.

**Ludo checks.** In Chrome on 1354: + Open the yeast cell's membranes (or the nine OBJs), Wrap all with lipids: a few
seconds; fly whole → close: interactive, no holes, by zoom colours; clip through the cell to see the inner membranes.

**Machine care.** The per-view wrap of the nine meshes may run (it builds no lipids); no full build or export above ~2 M
lipids; abort a run past 8 GB RSS; one heavy job at a time, wait while load > 12.

**Size and model.** ~600 production lines (selection hierarchy 250, shared budget 120, reader and wrap-all 180, docs
50); Opus. Gate on the round's diff.

## Round 6, measured before code (2026-11-09)

Probe (not committed; `lipid-yeast-probe.webgpu.test.ts`, kept outside the tree): the nine OBJs of `yeast-data/obj` at
×10 (nm → Å), each wrapped by the cutter as its own `LipidMembrane` (what Wrap with lipids makes, nine times),
CHARMM-GUI patch, budget 2 M, headless Dawn, M1, 900×600, perspective; whole (reset), middle (0.3 R above the PM's
vertex nearest the camera), close (400 Å above it); frame ms the four frames at each view. Load 4–5.

| what                               | measured                                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| wrap, nine membranes one by one    | 15.5 s (repr 1.1–2.6 s each: 6,890-triangle PEROX 1.1 s, of it 0.76 s its ~100 members' sphere objects); RSS 3.0 GB; first frame 5.1 s |
| selection a view, all 18 leaflets  | 87–600 ms (whole, nothing taken: 87–360 ms; ER alone 26–136 ms): every triangle tested every view                                      |
| whole / middle frame, nothing live | 50–65 ms; 10 ms with `far: spheres`: the 36 patch surfaces (4 a membrane, 1.08 M triangles each set) cost ~45 ms                       |
| close frame (PM 400 Å)             | 500 ms (650 ms with the app's look, Hi-Z on or off); PM alone 49 ms. Of 502 k live lipids 447 k are VAC's, behind the opaque PM        |
| pools                              | nine pools of 2.2 M slots (2 M budget each): ~20 M slots, ~4 GB of culler buffers at four levels                                       |

All nine meshes are closed (no border edge; MITO_IM 20 non-manifold edges); VAC, MITO, GOLGI, PEROX and LD are many
components each. The 11-07 slab's file was not found (not in `~/Downloads` or the lanes): its alignment is not checked.

## Round 6, design (checkpoint, 2026-11-09, before code)

1. **One membrane over many meshes** (answers the per-representation floor, the nine pools, and "one budget"). Wrap all
   makes one `LipidMembrane` whose surface is the meshes concatenated (`parts`: each mesh's triangle range and name):
   one cutter a leaflet, one selection a leaflet, one pool a member, so the budget is one (`poolCapacities` over the two
   leaflets, as now) and the fill is nearest first across every membrane (one candidate list). The member objects are
   made once, not nine times. Costs: one far colour and one Look for the whole cell; a membrane's lipids are not hidden
   alone (the meshes stay as nodes; Ludo clips through the cell). Rejected: nine cells and a coordinator (nine floors,
   nine pools, a cross-cell fill).
2. **A sphere tree over the triangles** (`procedural.ts`): per part, a bounding-sphere hierarchy (median split, leaves
   of 8), built once a mesh and shared by its leaflets; a view descends it and prunes a node outside the frustum (its
   sphere grown by a cell) or past the reach (`keepDepth`). A view's cost is the nodes it visits and the triangles in
   reach, not T: whole and middle about nothing. Guard: n and 4n triangles, the close view's time about flat.
3. **Enclosed membranes skipped** (new, answers the 447 k hidden VAC lipids): at the wrap, which part encloses which
   (one vertex of B, a ray's crossings of A, odd: inside); per view, which closed parts hold the eye (the same test
   through the sphere tree). A part enclosed by a part that does not hold the eye takes no cells and its far surfaces
   are not drawn; off under a clip (as `facing`). Parts of many components over-include (the eye inside one
   mitochondrion shows every IM): safe.
4. **The far surfaces a part** (answers ~45 ms whole): each part's surfaces their own objects, so an enclosed part's are
   hidden with its lipids. Outside the cell only the PM's draw. Under a clip all show (~45 ms: stated, open).
5. **The reader** (`mesoscale`): + Open of the yeast viewer's `organelle_meshes.bin` (and `.bin.gz`, inflated by Mol*'s
   open): u32 count, count × (membrane id, nV, nT) u32, then per mesh nV×3 f32 and nT×3 u32; each mesh an OBJ-like shape
   (the existing `ShapeFromObj`) named by membrane (`mem_names` of the viewer's `geometry.json`), ×10 (nm → Å). Wrap all
   with lipids: the right-click of the file's row (or any meshes), one operation, one commit.
6. **Per-membrane composition** (stated, not built): a part's own patch would need a cutter (table) a part and leaflet,
   its pools its own members: the floor again per composition, not per mesh.

Size: selection tree and enclosure ~250, parts through the membrane ~120, reader and wrap all ~180, docs ~50: ~600.

## Round 6, built (2026-11-09)

- `ecb170f4c` the close view's selection scaling guard at n and 4n triangles (failed: ×4.3); `79889da78` a sphere tree
  over the triangles a part (`triangle-tree.ts`: median split, leaves of 8, cached by the mesh's indices), a view
  descending it, a node out of view or past the reach pruned whole (×1 after); `e09acb72e` its frustum test inline.
- Enclosure: at the wrap a part is enclosed by another when 16 of its vertices are inside it (a ray's crossings, odd);
  per view a part whose encloser does not hold the viewer takes no cell and its surfaces are hidden; off under a clip.
  `24163e7c5` (Dawn, failing: the headless camera's frustum had no apex, the eye read outside) and `a133f1960` the
  viewer is the near plane's center (perspective and orthographic).
- `fc31b8f40`, `9461992ca` + Open of the yeast viewer's `organelle_meshes.bin(.gz)`: a mesh a membrane, named, ×10.
- `d6476d770` Wrap all: `mesoscale.wrapMembrane { meshes }`, one `LipidMembrane` over the meshes concatenated
  (`concatMeshes`, a part each), one step; far surfaces a part (`partOfSurface`), shown with their part (`showParts`).
  `b668439cb` prism-me: rows named by their mesh, right-click › Wrap all N meshes with lipids (one membrane).
- Tests: `organelle-meshes.test.ts` (reader, errors, open, wrap all one step with the enclosures), `lipid-cell.test.ts`
  (enclosures, hidden/inside/clipped, one budget nearest first across parts), the Dawn nested cell (medium), prism-me's
  open-and-menu test. `044282d1e` the selection's perf baseline 79.6 → 95.6 B a view (one boxed number a select).

**Decided.** One membrane over the nine meshes (not nine and a coordinator): one pool, one budget, one member set; the
cost is one Look for the cell (Ludo's call whether a per-part colour or hide is wanted). Enclosure needs all 16 samples
inside (a stray vertex of the cortical ER near the NE does not make the ER enclosed by it). Wrap all takes every mesh
not wrapped yet in the scene.

## Round 6, numbers (the app's path: + Open of the .bin.gz, Wrap all, the app's look, perspective; Dawn, M1, 900×600)

| what                   | before (nine membranes)                | after (one over nine)                                                 |
| ---------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| open                   | (OBJs by hand)                         | 0.5 s                                                                 |
| wrap                   | 15.5 s, RSS 3.0 GB                     | 9.2–9.4 s (load 9–15), RSS 1.1–2.3 GB                                 |
| pools                  | 9 × 2.2 M slots                        | 2.2 M slots                                                           |
| selection a view       | 87–600 ms                              | 0.1–1.6 ms far, 5 ms close on the PM, 13 ms on a mitochondrion inside |
| frame whole / middle   | 55–65 / 50–72 ms                       | 33–37 / 42–49 ms                                                      |
| frame close (PM 400 Å) | 500–650 ms (VAC's 447 k hidden lipids) | 106–114 ms, 73 k lipids, the PM's alone                               |
| frame inside, a mito   |                                        | 198–224 ms, 145 k lipids                                              |
| clipped slice, whole   |                                        | 75–84 ms                                                              |

Images `lipid-tiles-shots/r6/`: `r6-whole.png` (the PM's texture), `r6-slice.png` (Prism's clip through the cell: NE
with its pores, VAC, mitochondria, ER), `r6-pm-close.png` (lipids by species), `r6-ne-er.png` (through the clip, closer:
the NE's pores, the ER sheets), `r6-mito.png` (inside the cell: a mitochondrion's lipids, the others' textures),
`r6-middle.png`. Looked at: no hole close, the inner membranes only through the clip or from inside.

**Learned.** The cost was not the triangles but what the selection could not see: every triangle tested every view, and
every hidden membrane drawn. Close frames are what the lipids in view cost (round 5's M5): 73 k at atom detail ~110 ms.
The headless camera's frustum is orthographic-like (parallel side planes): an eye from the apex fails there.

**Size.** About 700 production lines against ~600 (tree and enclosure 290, selection 80, membrane parts 120, reader 170,
operation and menu 60); the reader's response handling and the near-plane viewer took the room.

## Round 6, the gate (2026-11-09)

An Opus reviewer read `dbd4ac8bb...6f81e7a20` (2 must-fix, 7 should-fix, 4 nits); the lane-skeptic re-ran or re-read
each (10 confirmed, 1 plausible, 2 refuted; 2 new nits).

| Finding                                                      | Skeptic                           | Test (fails first)                           | Fix                                  |
| ------------------------------------------------------------ | --------------------------------- | -------------------------------------------- | ------------------------------------ |
| M1 Wrap all took meshes already wrapped                      | confirmed, must-fix               | `a243fb958` (counted 3 with the PM wrapped)  | `30fd7f1ed` (a membrane row's wraps) |
| M2 the reader decoded the file once a mesh                   | confirmed, should-fix             | `b592cb758` (scaling guard, ×18)             | `325e86959` (header read once)       |
| S1 enclosed surfaces shown after a rebuild at rest           | refuted (new selections reselect) | `d47da3805` coverage only (passes before)    | `d47da3805` `showParts` at build end |
| S2 a small component outside unsampled: part called enclosed | confirmed, should-fix             | `cbd0d1d5c`-era test in `lipid-cell.test.ts` | `110b8dc55` (a vertex a component)   |
| S3 tree cache keyed by indices only                          | confirmed latent, nit             |                                              | open (TODO)                          |
| S4 VTP rows lost their file name                             | confirmed, should-fix             | `4578f10d7`                                  | `14f550fe6`                          |
| S5 one cell-state notification a wrapped mesh                | confirmed, nit                    |                                              | open (the single-mesh path's too)    |
| S6 the selection guard: no control, no alloc, no parts       | confirmed, should-fix             | the guard itself                             | `03d49c4fc`                          |
| S7 enclosures over P² pairs                                  | confirmed, nit (34 ms at 800)     |                                              | open                                 |
| N1 inclusive edges in the parity test                        | plausible, nit                    |                                              | open                                 |
| N2 a degenerate near plane hides enclosed parts              | confirmed, unreachable            |                                              | open                                 |
| N3 stack overflow drops a subtree                            | refuted                           |                                              |                                      |
| N4 `meshes` description silent on the cutter                 | confirmed, nit                    |                                              | `a9be31c55`                          |
| X1 the operation accepts wrapped meshes (agents)             | new, nit                          |                                              | open (as the single-mesh path)       |

Numbers after the gate (load 9-43): wrap 9.6 s, RSS 1.1 GB; enclosures on the yeast meshes unchanged (every part in the
PM); frames whole 32-37, middle 45-48, PM close 104 ms (73 k lipids), a mitochondrion inside 206 ms (145 k), the slice
75 ms; selection 0.1-1.3 ms far, 8-20 ms close (load 43).

## Round 6, checks (2026-11-09, after the gate)

`npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm format:check`, `pnpm check:workspace`, mesoscale
and prism-me `styles:check`, prism-me `typecheck:storybook` pass. Quick lane with Dawn (mesoscale, cryoet, stage-tools,
prism-me): 83 files, 564 passed, 4 skipped. Medium Dawn (`lipid-procedural.webgpu.test.ts`): pass. Mesoscale `test:perf`
and the round 6 scaling guards pass. Graphics untouched.

## Round 6, end

**Measured before.** Nine membranes wrapped one by one: 15.5 s and nine 2.2 M pools; every triangle tested every view
(87-600 ms); the hidden inner membranes selected and drawn (close on the PM 500-650 ms, 447 k of 502 k lipids VAC's); 36
patch surfaces ~45 ms a frame.

**Built.** Wrap all as one membrane (a part a mesh, one budget nearest first across them), a sphere tree a part for the
selection, enclosed parts skipped (cells and surfaces) while the viewer is outside, the reader of the yeast viewer's
file, the right-click. **Open, Ludo's call:** one Look for the whole cell (a membrane's own colour, hiding one
membrane's lipids); a per-membrane composition; close frames bound by the lipids drawn (round 5's M5); wrap ~9 s (the
surfaces and the cutters over 1.08 M triangles).

**Next (precise).** Per-part far colour (a part's surfaces take their mesh's colour); patch surfaces built a part at a
time (no whole-then-slice copy); a `test:perf` case with parts and enclosures; S3, S5, S7, N1 (TODO).

## Round 7 brief (Ludo, 2026-11-09, after round 6)

**Decided (Ludo, 2026-11-09).** No lighter close level (round 5's M5: close frames stay as they are). Yes to a colour
and a hide per membrane; yes to a lipid mix per membrane. The 11-07 slab is `~/Downloads/yeast_slab_z600nm.bcif` (409
MB; the whole cell `~/Downloads/yeast_cell_atoms.bcif`, 1.17 GB). The raised `test:perf` baseline (79.6 → 95.6 B a view,
round 6) goes back: find the allocation and remove it (the repo's rule: never raise a budget to quiet a run).

**Asked.** "we need a smoother transition between texture and sphere. the mesh should be duplicated to reproduce the
bilayer, so that its texture inside and outside, and the transition will be smooth and almost not visible."

1. **A bilayer far look.** The far surface is the mesh duplicated per leaflet: one copy at the outer leaflet's head
   height (normal out), one at the inner leaflet's (normal in), each textured with its own leaflet's patch top view (the
   inner one seen from below), so from outside one sees the outer heads, from inside (a clip, or flying inside a
   compartment) the inner heads; at the switch each copy sits where its spheres' heads are, so the spheres appear on
   their own surface. Check what round 5/6 draw today (round 4b had two surfaces; round 5 moved the texture onto the
   mesh's own triangles) and say what changes. Smoothness: measure across the switch from outside and from inside (4c's
   Oklab metric and an image diff of a zoom sequence; no line, no pop, no step), both on the cow ×100 and the yeast PM;
   a test that fails on today's code.
2. **A colour and a hide per membrane** of a wrapped cell (round 6's one membrane over parts): each part as a row under
   the membrane in the tree (eye, colour), its lipids and its surfaces following, through the operations a particle list
   uses (`mesoscale.style`, `mesoscale.colors`; one history step each). By zoom keeps working per part.
3. **A lipid mix per membrane.** Per part a composition: at least PM (ergosterol-rich, PS/PE inner), mito IM
   (cardiolipin), mito OM, ER/NE, vacuole, LD (a monolayer: one leaflet only). Built from the CHARMM-GUI patch's species
   where it has them (state what is missing; no new download without Ludo's OK), recorded with a source per number
   (Delphine may be asked for the yeast compositions with citations). The patch per part feeds the cutter and the
   top-view texture.
4. **The slab in the same frame.** Open `yeast_slab_z600nm.bcif` with the nine meshes (+ Open both): check whether the
   slab's particles sit on the meshes (Å = nm × 10, same origin?), measure an offset or scale if not, and fix the
   reader's transform or record what the user must do. Memory: the slab is 409 MB, 4.6 M instances: open it at most once
   per run, never the 1.17 GB whole cell in a test.
5. **The baseline back to 79.6 B.**

**Ludo checks.** 1354: + Open the yeast meshes and the slab; wrap all; the slab sits on the membranes; zoom onto the PM
from outside and from inside: the switch nearly invisible; each membrane its row, its colour, its eye; the mito IM shows
cardiolipin, the LD one leaflet.

**Machine care.** The slab at most once per run (≤ 8 GB RSS, abort past it); never the whole-cell bcif; per-view wraps
as before; one heavy job at a time, wait while load > 12.

**Size and model.** ~650 production lines (bilayer surfaces 200, parts as rows 200, mixes 150, slab frame 50, perf 50);
Opus. Gate on the round's diff.

## Round 7, item 1: measured before code (2026-11-09)

Probe (not committed; `lipid-tiles-shots/r7/probe/zz-r7-probe.webgpu.test.ts`, `run.sh`, `sum.py`): the cutter, the
CHARMM-GUI patch, both leaflets, the app's look (occlusion, shadows, outline), perspective, headless Dawn, M1, 900×600.
The cow ×100 (`cow-nonormals.obj`) and the yeast PM (`00-PM.obj` ×10). A ray from the mesh's box centre (+z) gives a
point and its outward normal; a zoom sequence of 25 steps (ratio 1.08) from about 5 px a lipid to 0.8 px, outside (the
camera along +n) and inside (along −n). Per step: the mean Oklab of the membrane's pixels in the middle third, `dE` the
Oklab distance of that mean to the step before, `diff` the mean luminance change of 12 px blocks. And 4c's metric at the
switch (the same camera, `spheresPx` ×1/1.3 and ×1.3). Load 3–8. Images `r7/probe/r7-<tag>-<cow|pm>-<side>-NN.png`.

**What is drawn today.** Already a bilayer far look: per cut leaflet two `patchSurface`s, the outer one lifted out
(normals out), the inner one lifted in (normals and winding flipped), each textured with its own leaflet's
`patchRaster`: a near one at ±2 Å drawn while lipids are (`lod` 0 → d/keep), a far one at the switch level's mean top,
dithered in from d/2 to d (the probe reads their `uLod`: four meshes). From inside the PM the inner copy is what shows
(L 0.62 inside against 0.57 outside). Duplicating the mesh per leaflet, as the brief asks, is what rounds 4b–5 built.

| sequence (largest step `dE`; the bound to aim at ~0.03) | outside                          | inside                               | 4c metric at the switch, out / in (dL, dab) |
| ------------------------------------------------------- | -------------------------------- | ------------------------------------ | ------------------------------------------- |
| PM, today (`both`, 2 px)                                | **0.120 at 3.16 px**; 2 px 0.002 | **0.129 at 3.16 px**; 2 px 0.000     | 0.012, 0.002 / 0.028, 0.003                 |
| PM, spheres only (no surface)                           | 0.122 at 3.16 px (then gaps)     | 0.118 at 3.16 px                     | (no surface)                                |
| PM, switch at 3.5 px                                    | 0.051 at 3.24 px                 | 0.080 at 3.24 px                     | 0.154, 0.010 / 0.098, 0.025                 |
| cow ×100, today                                         | 0.042 at 3.16 px                 | (never under 6 px inside: see below) | −0.006, 0.001                               |
| cow ×100, switch at 3.5 px                              | 0.036 at 8 px                    |                                      | 0.059, 0.031                                |

**The cause, measured.** (1) **The pop is not the texture switch but the spheres' level change** at about 3.2 px a lipid
(balanced: stride 8 → stride 64, grown ×8 with scale bias 2): the mean luminance jumps 0.46 → 0.57 in one 8 % zoom step,
outside and inside, with or without the far surface (`sheet-pm.png`: mixed small heads, then large green DSM and orange
spheres; 4c's cause, the species standing highest covering their neighbours, now between two sphere levels). The switch
to the texture at 2 px is smooth by colour (step dE ≤ 0.002; 4c's metric inside its bounds). Moving the switch above the
level (3.5 px) halves the pop but does not remove it: the selection keeps lipids down to 0.8 × the switch (2.8 px), so
the coarse level still draws from 3.2 to 2.8 px, and the texture then matches less well (dL 0.15). (2) **On the cow the
far surfaces crumple on thin parts** (`zoom-cow-head.png`, `cow-both-vs-spheres-k14.png`): past the switch, black
strokes along the face, ears, eyes and legs, absent with spheres only. The far copies are lifted ~20 Å along the vertex
normals; on features thinner than twice that (legs 20–35 Å across) the inner copy crosses the axis and comes out facing
out, and the outline draws the folds. (3) The cow ×100 is too small to reach the switch from inside (inside it a lipid
stays over 6 px at 900×600); its inside steps past k21 are the camera leaving the body. (4) Motion's pixel scale does
not move the level or the switch (`LodView` is in CSS pixels).

## Round 7, item 1: design checkpoint (2026-11-09; stopped: the design differs from the brief)

The brief's design (a mesh per leaflet, at its heads, textured with its own leaflet) is already what is drawn, so no
test can fail on it. What Ludo sees as the texture/sphere transition is, by the numbers, the coarse sphere level coming
in at ~3.2 px, and on thin shapes the far copies folding. Options, Ludo's call:

- **(A) The switch above the coarse level**: `spheresPx` past the stride-64 boundary over the hysteresis (~4 px), the
  texture rastered from the stride-8 level. One default, no graphics. Measured at 3.5 px: the pop halves (0.051/0.080)
  and the texture matches less well (dL 0.15): needs (A) at ~4 px with the raster's shade matched; fewer lipids drawn.
- **(B) The coarse level made to look as the finer one**: stride 64's spheres chosen or sized so its top view's species
  shares and luminance match stride 8's (4c's fix, between levels: e.g. a smaller grow, or the members' atoms ordered so
  the head atoms are kept). Extension only, ~100 lines.
- **(C) A dithered cross-fade between levels** over a px band: a graphics change (the levels' ranges have no overlap
  with pixel presets; 4c already flagged the object dither off for objects with levels). Ludo's call, sized at a later
  checkpoint.
- **(D) The far lift clamped on thin features**: each vertex's lift bounded by the local thickness (a ray along −n to
  the mesh's other side, half of it), or the inner copy dropped where it would invert. Extension only, ~80 lines.

Proposed test (fails today): the PM zoom sequence's largest step dE under 0.03 outside and inside; and for (D) the cow's
far surfaces with no triangle whose inner copy faces out (a pure test on `patchSurface` over the thin-limbed fixture).

**Decided (Ludo, 2026-11-09, on this checkpoint).** Item 1: option B only, the coarse level showing the finer one's top
view (4c's fix between levels); not A, C or D: the cow's thin-part strokes stay open (TODO). The test as proposed: the
PM zoom sequence's largest step dE under 0.03, outside and inside, failing on today's code. Items 2–5 as briefed. Mixes
with today's CHARMM-GUI patch and labelled stand-ins (ergosterol → CHL1, CL → 2 × DOPA renormalized, IPC → SSM), LD a
monolayer; no download, no Zinser scans; the real ERG/TOCL patch later (TODO). A conflict takes the most recent source,
the others recorded beside it.

## Round 7, item 3: groundwork (2026-11-09; Delphine, not built)

The compositions for a mix per membrane, from Delphine. The tables were read in the full text unless a source is marked
"abstract"; her source notes are in Ludo's vault, `Library/Mesoscale-Modeling/`. **The brief's premise is partly
wrong:** about 80 % of the PM's ergosterol sits in the inner (cytoplasmic) leaflet, where sterol reaches about 45 % of
the lipids (Solanko 2018, abstract). That the sphingolipids sit in the outer leaflet is assumed by analogy with
mammalian cells, not measured in yeast.

Recommended mixes (mol %, summing to 100; ERG ergosterol, SL the inositol sphingolipids):

| membrane  | ERG  | PC   | PE   | PI   | PS   | PA  | CL  | SL   |
| --------- | ---- | ---- | ---- | ---- | ---- | --- | --- | ---- |
| PM, inner | 47.3 | 0    | 14.2 | 10.5 | 25.7 | 2.3 |     | 0    |
| PM, outer | 13.5 | 28.9 | 4.6  | 3.4  | 5.2  | 0.5 |     | 44.0 |
| mito IM   | 11.4 | 43.1 | 21.5 | 12.2 | 3.2  | 2.4 | 6.2 |      |
| mito OM   | 3.0  | 43.8 | 33.8 | 13.9 | 1.5  | 1.5 | 2.5 |      |
| ER / NE   | 9.7  | 47.2 | 23.6 | 13.4 | 3.5  | 2.6 |     |      |
| vacuole   | 11.7 | 47.5 | 23.7 | 13.5 | 3.5  | 0   |     |      |
| LD (mono) | 19.4 | 46.6 | 13.5 | 17.4 | 1.7  | 1.5 |     |      |

The measured numbers and their sources:

- **Schneiter 1999** (J Cell Biol 146:741, doi:10.1083/jcb.146.4.741): ergosterol/PL by membrane (T3): PM 0.46, IM 0.12,
  OM 0.02, microsomes 0.18, vacuole 0.07, LD 0.24. Thickness (T2): PM 9.2 nm, LD monolayer 4.5 nm.
- **Zinser 1991** (J Bacteriol 173:2026), as Schneiter quotes it: PM PS 33.6 and PE 20.3 % of glycerophospholipids.
- **Patton & Lester 1991** (abstract): PM sphingolipids about 30 % of the phospholipid phosphorus.
- **Cerbón & Calderón 1991** (abstract): PS, PI and PE mostly in the PM's inner leaflet.
- **Sperka-Gottlieb 1988** (abstract): IM cardiolipin 13 % of the PL; OM PC 44, PE 34, PI 14, CL 5 %.
- **Reinhard 2024** (EMBO J 43:1653): ergosterol in the ER 9.7 % and in the vacuole 11.7 %.
- **Grillitsch 2011** (BBA 1811:1165, T4): the LD's PC 57.5, PI 21.5, PE 16.6 %.
- **van 't Klooster 2020**: PM ergosterol 25–30 %.
- **Surma 2011**, as Reinhard quotes it: PM ergosterol over 44 %.

Assumptions:

- **Whole-cell proxies:** the PC/PE/PI/PS/PA splits of the ER, the vacuole and the IM, and the PM's PI and PA, are
  whole-cell values from Grillitsch's homogenate.
- **Ergosterol:** a ratio r becomes r/(1+r) mol %.
- **Cardiolipin:** its PL % is halved, since CL carries 2 P.
- **PM leaflets:** the split follows Cerbón's and Solanko's fractions. All PC is put outer to balance the leaflets, with
  no data behind it.

Conflicts left open:

- PM sterol: 31.5, 25–30 or over 44 %.
- ER sterol: 15.3 or 9.7 %.
- Vacuole sterol: 6.5 or 11.7 %.
- LD PC: 57.5 or 36.4 % (Leber 1994).

The per-organelle class tables of Zinser 1991 are only page scans; reading them would replace the whole-cell proxies
(Ludo's OK needed).

**Stand-ins from the CHARMM-GUI patch's species:**

| class        | stand-in                         | what is lost                                           |
| ------------ | -------------------------------- | ------------------------------------------------------ |
| ergosterol   | CHL1                             |                                                        |
| CL           | 2 × DOPA a CL, then renormalized | otherwise the IM's CL doubles to about 12 %            |
| IPC and MIPC | SSM                              | the inositol-phosphate charge (POPI if charge matters) |
| PC           | DOPC, POPC in the PM             |                                                        |
| PE           | POPE in the PM, PLPE elsewhere   |                                                        |
| PS           | POPS                             |                                                        |
| PI           | POPI                             |                                                        |
| PA           | DOPA                             |                                                        |

CHARMM-GUI's archive has ergosterol (ERG) and cardiolipins (TOCL, TLCL): using the real species needs a new patch, which
is a download and Ludo's OK. Building item 3 needs, as round 6 said, a cutter (table) a part and leaflet and its own
members; round 7 stopped before it.

## Round 7, item 5 (2026-11-09, before the merge)

`bfb1faee3` the baseline back to 79.6 B (failing: 95.6 B); `b8338293f` a view's keys sorted in place by a heap sort
(`sortKeys`, `procedural.ts`): core's `sortArrayRange` allocated its partition pair a call and boxed a comparator's
difference through `medianPivotIndex`; `42231f0f7` the baseline recorded at the move, **15.6 B a view** (from 95.6).

## The merge of origin/prism-me (2026-11-09, `b0f6c2e64`)

Ludo: "merge with the parent, then finish round 7". `origin/prism-me` at ad4d5aae0 (master v6 #2069 through PR #62), 88
commits ahead. Seven files conflicted, as `merge-tree` predicted. The rule: prism-me's side (master's culler: compaction
by index, `CulledData`, `MergedCullerLimits`, segmented transforms, the ghost region, `CullBatch`), the lane's graphics
ported onto it. Lockfile prism-me's, then `pnpm install` (re-adds the lane's `rxjs` and `plugin-headless` dev dependency
of mesoscale).

| file                                                 | kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | why                                                                                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gl/renderable/merged-culler.ts`                     | master's whole, then the lane's: `GpuInstanceTarget` now `{ data, instanceBase, count }` (rows at vec4 `(instanceBase + i) * 3` of `CulledData`), `DeadInstanceTranslation`, `GpuInstanceView`, `GpuInstanceWriter`; `liveCounts` (reset in `syncLayout`, word 6 of the segment row in `writeSegmentRow`); `writeGpuInstances` after `writeCulledData` (`syncInstances`) and after `writeMemberData` (`syncMembers`); `viewGpuInstances` in `dispatch` where the view changed, before `restoreRecords`; `isDispatched`/`setDispatched` keyed by the `LodView`'s scales; `drawnLodLevels` in `writeRecord` and `writeSegmentRow`. Master's `memberChanged(s)` gains the writer's version (`splitWriters`, set in `writeMemberCells`), and `isLayoutMoved` is false where it changed (else a new writer would be moved, not written). | master has no identity copy of `aTransform` and no `instanceData`: the identity region is indices into the same rows, so one write serves both views |
| `gl/webgpu/shader/cell-cull.wgsl.ts`                 | both: master's ghost bits, then the lane's live-count test, which clears `bits` too                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | a dead slot must not reach the ghost's region either                                                                                                 |
| `gl/webgpu/shader/mesh.wgsl.ts`                      | `assign_material`, the lane's `patchColor` (colour variants only), master's `apply_occlusion`, `check_transparency`; locations 10 and 11 are free on master                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | occlusion must fade the patch's colour, not the plain material                                                                                       |
| `geo/geometry/mesh/mesh.ts`, `gl/renderable/mesh.ts` | union: the lane's `dPatchTexture`, `tPatch`, `tPatchTable`, `uPatch`, `uPatchLevels` and master's `uDepthOffset`, `uScreenSize`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | independent values                                                                                                                                   |
| `.v6/plans/gl/merged-render-objects.md`              | master's Fallback; the lane's two items rewritten for `CulledData` and the batch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | the spec says what the code does                                                                                                                     |
| `apps/prism-me/_spec/ui.md`                          | master's table, the lane's Representation line (a lipid membrane's Levels)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | master changed the Position line (no On top, ghosts); the lane the Representation line                                                               |

Merged clean and checked: `merged.ts` (`drawnLodLevels` in `writeSegmentLod`), `context.ts` (`sLinearMipmapRepeat`),
`wgsl-declarations.ts`, the lane's `merged-culler.test.ts` cases. Silent-drop check (every name the lane declared in
`packages/graphics` since 0f8235dfc, grepped in the result): one missing, `MemberKeyLength` (master's `memberChanged`
replaces the key array). The writer's kernels run in `dispatch` before a `CullBatch`'s clears and dispatches are
recorded, so they are encoded first.

**Adaptations.** `9d16271ff` the lipid kernels (`assign-kernel.ts`, `cutter-kernel.ts`) write their rows into
`CulledData` (one write; `workgroupRows` and `ComputeContext.maxWorkgroupsPerDimension` are gone: `dispatchRows` over
`getDispatchSize` and `MergedCullerLimits`), their Dawn tests and the headless `webgpu-gpu-instances` writer with them;
`e31d53beb` format. `4c01547d0` and `0cadec122` (test first): since one buffer holds the rows both views read, a CPU
write of the member's placeholders (zeros) left a pool's dead slots at the origin where the cutter thought them written;
the target carries `cpuWrites`, and the cutter writes its dead slots again after one.

## Round 7, after the merge (2026-11-09)

**Merge follow-ups (test first each).** `eb1e42174`/`5dcb0d7f0` a replaced writer was never written (the layout key had
no writer version: `getLayoutKey` now has it); `GpuInstanceTarget.cpuWrites` per segment, an epoch never seen again
(`e32d53bfa`/`546e27771`; one count for the culler made every pool write all its dead slots again on any member's
update); the selection's comment says what a view measures (15.6 B). `shader-parity.test.ts` (master's, new) lists the
mesh's patch texture as WGSL only.

**Item 4, the slab's frame (measured, nothing to fix).** `~/Downloads/yeast_slab_z600nm.bcif` opened once, outside the
viewer: a Node script over Mol*'s BinaryCIF decoder (`lipid-tiles-shots/r7/slab/frame.mjs`, kept outside the tree), RSS
1.25 GB. The file (`yc2bcif_atoms` 0.3.0, block `cellpack_yeast_atoms_-999_999_-999_999_-1_1`) holds 5,457 entities,
19.7 M template atoms (centred, ±625 Å), 6.89 M operators (`_pdbx_struct_oper_list`) and 216 k assembly rows. The
operators' translations span x −20,030..22,641, y −20,610..19,675, z −2,102..4,109 Å; the PM mesh × 10 spans x
−19,398..21,600, y −19,588..18,878 Å. Of 186 k sampled instances (every 37th), 7,272 lie within 400 Å of a PM vertex,
their mean offset from it (−1.1, 4.8, 3.4) Å: no shift. The instances reach 630–1,000 Å past the PM on both sides of x
and y alike (the cell wall's proteins; a scale error would grow with the coordinate), so no scale either. **The slab is
in the meshes' frame: Å = nm × 10, the same origin.** The reader's ×10 is right; the user opens both with + Open,
nothing to set. (The PM's vertices are about 420 Å apart, so a vertex distance is not a surface distance: the histogram
has no peak at 0, and is not evidence either way.)

**Item 3, the mixes (data built; not yet wired into the view).** `lipids/mixes.ts`: `YeastMixes` by part name (PM,
MITO_IM, MITO_OM, ER, VAC, LD; NE, GOLGI and PEROX take the ER's), `standIns` (ERG → CHL1, SL → SSM, CL → 2 DOPA
renormalized, PC POPC in the PM / DOPC elsewhere, PE POPE / PLPE), `mixTable` (a leaflet's table with each patch place
given a species: exact counts by largest remainder, a seeded shuffle, the places and turns kept; a species the leaflet
lacks takes the other leaflet's conformers mirrored through the centre). **Conflicts, by the measurement's publication
(one reading, applied to all):** PM sterol van 't Klooster 2020 (25–30, taken 27.5; inner 44.0, outer 11.0 by Solanko's
80 %) over Schneiter 1999's 31.5 and Surma 2011's > 44 (as Reinhard 2024 quotes it); ER 9.7 and vacuole 11.7 (Reinhard
2024); LD PC Grillitsch 2011 over Leber 1994. Delphine's rows kept as she gave them (the vacuole's sums to 99.9). Test:
`lipid-mixes.test.ts`.

### Items 2 and 3, the design to build (decided here, 2026-11-09; changes round 6's "one candidate list")

- **A cut leaflet per (part, leaflet)**, each on the part's own triangles: `indices.subarray(start * 3, end * 3)` over
  the shared positions, its regions the whole mesh's (`regionOf.subarray(start, end)`, the table and cells shared: the
  same seams as today), its table `mixTable(getCutterTable(patch, leaflet), other, standIns(mix…), seed)` where the part
  has a mix, the patch's table otherwise; the LD's inner none. Memory as today (the per-triangle arrays sum to the same
  T), member objects about 9× (measure wrap time and RSS against 9.2 s and 1.1–2.3 GB).
- **Enclosure once a view:** the whole-mesh tree and `enclosedBy` stay built at the wrap; a shared `PartVisibility`
  (`procedural.ts`) computes `partShown` once per frustum (keyed by its planes), each part's selection reads its part's
  bit. Today's multi-part selection path stays for the tests that use it, or is retired with them.
- **Budget:** `poolCapacities` over all ~17 leaflets (one budget still, its sum ≤ budget); round 6's "nearest first
  across parts" becomes a share per pool: update `lipid-cell.test.ts`'s budget case openly and check the PM's and a
  mitochondrion's capacities against round 6's live counts (73 k PM close, 145 k inside a mito).
- **Far surfaces:** each cut leaflet's own (`partOfSurface` per part already), its texture from its mix table.
- **Item 2 on it:** repr params `hiddenParts: string[]`, `partColors: Record<string, number>` (hidden, auto-update); a
  hidden part's selections take nothing and its objects are hidden; a part's colour its surfaces' and its members' far
  level (review D1: `colorBy: 'uniform'` turns By zoom off for the whole representation, `membrane.ts` ~781 and ~817; a
  part's colour must keep By zoom's species and atom colours close, so it tints the far level and the surfaces only, a
  per-member `colorLevels` far colour). Operations:
  `mesoscale.style { particles: membrane, parts: 'PM,ER', visible?, color? }` (one `updateMembrane`), the explorer's
  rows `mp:${ref}:${name}` (kind `part`, under the membrane's mesh row, rows.ts `objectRows`, `rowKeysOf`; a membrane's
  parts state `api.mesoscale.membranePartsState(ref)` beside `membraneSpeciesState`); the eye through `setEyes` (one
  `api.group`), the colour through `colorItems`' part case. Tests as `tree-eyes.test.tsx` (an eye one step, one undo;
  the colour dot) and `lipid-membrane.test.ts`.

## Round 7, the gate (2026-11-09; on the merge's resolutions and the lane's commits after da59ff832)

Reviewer (Opus, read only) on `git show --remerge-diff b0f6c2e64` and the lane's commits; skeptic (Opus) re-ran or
re-read each: 9 confirmed (one in part), 0 refuted, 2 new. The merge's port: checked item by item, no finding.

| Finding                                                                  | Skeptic                        | Test (fails first) | Fix                           |
| ------------------------------------------------------------------------ | ------------------------------ | ------------------ | ----------------------------- |
| M1 `mixTable` reorders a cached table's elements in place                | confirmed, must-fix (latent)   | `b405e6ecf`        | `bf6236da0` (copies)          |
| S1 a borrowed species levelled to its own height (item 1's pop again)    | confirmed, should-fix (latent) | `b405e6ecf`        | `bf6236da0` (levelled as one) |
| X2 a second call scrambles again                                         | new, confirmed                 | `b405e6ecf`        | `bf6236da0`                   |
| S2 the culler's `setLiveCount` allocates a view where a live count moves | confirmed, pre-existing (nit)  |                    | open (TODO)                   |
| S3 TODO's stale 80 B                                                     | confirmed, nit                 |                    | `412f4cb6b`                   |
| N1 escaped backticks in a comment                                        | confirmed, nit                 |                    | `412f4cb6b`                   |
| N2 the spec lacks the writer's `cpuWrites` contract                      | partly, nit                    |                    | `412f4cb6b`                   |
| N3 a mirrored conformer is the enantiomer                                | confirmed, nit                 |                    | `bf6236da0` (180° about x)    |
| N4 the heap sort's time not measured                                     | confirmed, nit                 |                    | open (TODO)                   |
| D1 the design's part colour would turn By zoom off                       | confirmed, should-fix (design) |                    | `a8dee4473` (design)          |
| X1 a species with no members dealt to member 0                           | new, plausible                 |                    | `bf6236da0` (throws)          |

## Round 7, checks (2026-11-09, after the gate)

`npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm format:check`, `pnpm check:workspace` (after
removing five stale `lib/` outputs of files the merge deleted), prism-me `styles:check` and `typecheck:storybook`: pass.
Quick lane with Dawn: graphics 160 files, 1,894 passed (99 skipped); mesoscale, cryoet, stage-tools, prism-me 82 files,
569 passed (4 skipped); medium mesoscale with Dawn 4 passed (item 1's zoom test passes after the merge). Plugin-headless
with Dawn: 186 passed, two inherited failures (`webgpu-points` "picks a ring point", failing alone too here;
`webgpu-device-listener` SIGSEGV), as on origin/prism-me; `webgpu-gpu-culling`'s 4 skips are `it.skip`, the same on
origin/prism-me. Mesoscale `test:perf`: 15.62 B a view against 15.6 (after `test:perf` and `test:scaling` were moved to
`@molstar/test-harness`: master moved the harness and neither started). `test:scaling`: 19 of 20 passed; the worker of
`color-levels.scaling.ts` (not the lane's) was killed (SIGKILL) twice while the machine's load reached 150–180 (another
session): to rerun at rest.

## Round 7, end (2026-11-09; stopped for context)

**Built.** The merge of origin/prism-me (master v6 #2069) with the lane's graphics ported onto master's culler, and its
follow-ups (a CPU write tells a pool to write its dead slots again, per segment; a replaced writer is written; the
harness move). Item 5: 15.6 B a view (from 95.6). Item 1 (option B, before): its test passes after the merge. Item 4:
the slab is in the meshes' frame, nothing to fix. Item 3: the mixes and the mix tables, tested, **not wired** into a
membrane. Item 2: **not built** (the design above).

**Decided.** Conflicts by the measurement's publication date (PM sterol 27.5 %, van 't Klooster 2020); a cut leaflet per
(part, leaflet) on the part's own triangles (changes round 6's one candidate list into a budget share per pool); a
part's colour tints its surfaces and its far level, By zoom kept.

**Learned.** Master's culler serves both views from one rows buffer: a GPU writer's dead slots must be in it, and any
CPU write of placeholders undoes them. `coarseLevelOrder` levels in place: anything built from cached tables copies
first.

**Size.** About 330 production lines against ~650 (the merge's port ~150, item 5 ~30, mixes ~200 minus wiring); the
merge took the room: items 2 (~200) and 3's wiring (~150) remain.

**Next (precise).** (1) `buildMembraneSteps` cutter path with parts: a `CutLeaflet` per (part, leaflet) on
`indices.subarray`, `regionOf.subarray`, its table by `mixOf(part.name)`
(`mixTable(own, other, standIns(mix.outer|inner, mix.plasma), seed)`, the LD's inner none). (2) `procedural.ts`: a
shared `PartVisibility` (tree, `enclosedBy`) computed once a frustum, each part selection reading its bit;
`poolCapacities` over all leaflets; update `lipid-cell.test.ts`'s budget case openly; measure wrap time and RSS on the
yeast meshes and the PM's and a mito's capacities. (3) Far surfaces per cut leaflet from its table. (4) Item 2 as
designed (`hiddenParts`, `partColors`, `mesoscale.style { parts }`, rows `mp:${ref}:${name}`, tests as
`tree-eyes.test.tsx`). (5) r7 images (`lipid-tiles-shots/r7/`): the PM outside and inside across the switch, the mito
IM's cardiolipin, the LD's one leaflet, the slab over the meshes. (6) Gate on that diff; then the PR body below gets
items 2 and 3's lines.

## PR body (draft; rounds 4 to 7)

Superseded by "PR body (draft; rounds 4 to 7, after the gate)" at the end of this file.

## Round 7, items 2 and 3 built (2026-11-09, third session)

`a08cb62e5` mesoscale: a cut leaflet a part and leaflet on the part's own triangles (`partMesh`: its vertex range
copied, indices rebased, the whole mesh's regions sliced: the same seams), its table the part's mix (`mixTable` over
`standIns`, a seed a part and leaflet; the LD its outer leaflet alone; the patch as it is where it lacks a species,
`data.unmixed`, warned at the wrap); `createPartVisibility` (the enclosure test once a view for every selection, keyed
by the frustum); `hiddenParts`, `partColors` look params (no re-cut: `sourceData` kept); `mesoscale.style` and
`mesoscale.colors` take `parts` (one step each). `26fcbdc88` prism-me: a row a part under the membrane (`mp:`), its eye
and colour; a drag's eyes one write a membrane.

**The budget (decided here; Ludo to be told).** A share per pool, water-filled across the pools (`poolCapacities`): a
leaflet under the level whole, the others the level each (+10 %). Nearest first across parts is gone: a part's colour is
its objects' far colour, and a mix has its own members, so a part needs its own pools; one pool across parts would need
several GPU writers into one pool (the graphics writer contract), not a modest cost. Water-filling over a share by area
because a share by area starves the small membranes (yeast, 2 M: LD ~31 k, PEROX ~15 k lipids, a close view of either a
disc of spheres); water-filled, each of the 17 leaflets ~129 k (2 M / 17 × 1.1), against round 6's live counts (73 k the
PM close, one leaflet; 145 k inside a mito, over the IM's and OM's inner leaflets): both held.

**Next (if this session stops).** Dawn test `lipid-parts.webgpu.test.ts` (hide a part: its lipids and surfaces gone; a
part's colour changes the image with By zoom off (close) and on (far), close species kept; the LD's two surfaces); gate
on `git diff 89c4f13aa...HEAD`; checks; r7 images; write-up.

## Round 7 finish and item 6 brief (Ludo, 2026-11-09)

**Goal (Ludo, restated).** "the best lipid wrapper capable of scaling up to human cell size, and looking great at the
same time with and without cut."

**How (Ludo).** "we need to use the lane system with architect, skeptic etc." From here each piece goes: an architect
(Opus, read-only) designs it into this file; a builder implements it with tests failing first; the lane-reviewer, then
the lane-skeptic, gate it; confirmed findings fixed test-first. The coordinator runs each step as its own agent. No
images ("we dont need picture"): the checks are tests and numbers.

**Item 6: colour control and colours by zoom on three levels.** "we want to have more control on color, and the dynamic
color should show the atomic color and residues color and membrane colors."

- By zoom on a membrane shows three levels, as a particle list does (`color-levels.md`): far the membrane's colour (the
  part's, for a cell's part), middle the species' (= the lipid's residue / entity colour), close each atom's colour by
  element (the patch's atoms carry their element). Today `membraneColorLevels` stops at species ("a lipid is one group,
  so no chain or atom colours past them"): lift that. The far surfaces follow the far and middle levels.
- More control: the membrane's and each part's colour, each species' colour, the element colours (or a scheme for the
  close level), the levels' distances (`ColorLevels.Params`), the palettes and Generate colors, from the same controls
  as a particle list (properties, right-click), one history step each.
- Tests (failing first): at three distances a membrane draws its colour, then its species', then its atoms' element
  colours (Dawn pixel reads on a known patch); a part's colour, a species' colour and the element scheme each change
  only their level; one history step each.

**Then the rest of round 7's gate.** On `git diff 89c4f13aa...HEAD` (items 2, 3, 6 and the review fixes): reviewer,
skeptic, fixes test-first, the table here and in the PR body; the lane checks; the progress end; the PR body for rounds
4–7.

**Then round 8** (its brief below): a second rendering for the middle distance to compare and pick from.

## Round 8 brief (Ludo, 2026-11-09): shell-textured heads in the middle distance, to compare and pick

**Asked.** "can we get some improvement using something like https://samdauwe.github.io/webgpu-native-examples/fur.html"
(shell fur: the mesh drawn as ~20 instanced shells along its normals, each alpha-tested against a noise texture), then
"yes" to a round 8 after round 7; "start lane 8, so we can have an additional rendering test to compare and pick from."

**Idea.** The lipid heads as shells: the far surface drawn as N shells (6–10) through the head layer (its base to the
heads' top, ~10 Å), both leaflets; each shell reads the patch top-view texture, which gains a height channel (the heads'
top per texel, from the patch's head atoms); a fragment is kept where the heads reach that shell's height, its normal
from the head's profile, its colour the species' (and by zoom, item 6's levels). Far away the shells blur to today's
texture; closer the heads read as relief with parallax; near, the real atoms.

**To compare and pick (Ludo).** The middle distance gets a choice in the Look, live:
`middle: coarse spheres | shells | parallax` (today's coarse sphere levels; shells; parallax occlusion mapping, one pass
ray-marching the same height channel, flat silhouettes). Ludo flies each and picks the default; no images, the
comparison is the live switch plus the metrics.

**Design at the architect's checkpoint (measure first; stop and report if the graphics change passes ~600 lines).**

- Shells: one instanced draw of each far surface (instance = shell), offset per shell along the leaflet's normal (the
  far surface's lift and per-vertex shift kept), alpha-tested in the mesh shader from `dPatchTexture`'s height channel;
  faded by view angle at grazing and by distance into the flat texture.
- Parallax: the same texture, ray-marched in the fragment shader of the existing far surface.
- With the app's look: outline, SSAO, shadows (shells write depth: no banding), picking (a shell picks its membrane),
  clipping and graded cuts (a cut through a shell stack must look right: Ludo's "with and without cut").
- Levels: where atoms stop, where the middle look starts and ends, with hysteresis.
- Scale: the cost at the yeast cell (1.08 M triangles × N shells) and at `model_vertexcolor` ×600; the path to a human
  cell (~1e10 lipids): what bounds the cost (triangles in view × shells, not lipids).

**Tests.** The height channel equals the patch's head tops (TS, quick); a shell keeps exactly the texels whose height
passes it (Dawn, a 2-triangle mesh, pixel reads); the zoom sequence's largest step dE across all switches under 0.03
from outside and inside (round 7's metric), for each middle look; frame time and drawn lipids at whole/middle/close on
×600 and the yeast cell, each middle look against the coarse spheres; a cut through the middle look; 0 frames at rest.

**Ludo checks.** 1354: the yeast cell and model_vertexcolor ×600, Look › middle: switch coarse spheres / shells /
parallax while flying in from far, with and without a clip; pick the default.

**Steps (Ludo: the lane system).** Architect (Opus, read-only) → builder (Opus) → lane-reviewer → lane-skeptic → fixes
test-first; the coordinator runs each.

**Machine care.** The machine restarted three times on 2026-11-09 under load (128–540, several sessions building at
once): one heavy job at a time, wait while load > 12, abort past 8 GB RSS.

**Size and model.** ~600 production lines (graphics: instanced shells, the height channel, parallax ~350; extension:
bake, levels, the Look's switch ~250); Opus. The graphics part is a library change: its own lane from master later, on
Ludo's word.

## Round 7, item 6: architect's design (2026-11-09, read-only, at 481102c20)

**Correction to the brief.** The three levels already exist for the cutter (round 5, e1b427405): `memberObject`
(membrane.ts:1018) makes a cut member's atoms its groups (`byAtom` :1034, `instanceGranularity` :1068);
`membraneColorLevels` (:873) writes `elementColor` (:862) per atom into `tColorNear`, the species in `tColor`, the
membrane's or part's colour in `tColorFar` (chain offset 0: chain = species). The far surfaces go far → species
(`patchObject` :812–858, `uPatchLevels`, mesh.wgsl.ts:96–101); they never need atoms (lipids cover them first).
`lipid-colors.webgpu.test.ts:129` reads the three levels by moving the edges, not the camera. Stale comments
(membrane.ts:669–670, operations.ts:1016) say otherwise. So item 6 is: tiles' atom level, an element scheme, a far-only
colour, an edges fast path, the UI, and parity gaps.

1. **Tiles' close level.** Pass `tile.elements` (tiles.ts:61) to the tiles' `memberObject` (:1385), atoms as groups, an
   `atomSpecies: Uint16Array` per variant from `lipidAtomStart`; `tColorNear` O(atoms of a variant). Per-lipid markers
   lost (unused: `getLoci` is `EmptyLoci` :1535). Fix the stale comments.
2. **Controls (each one `updateMembrane` commit, operations.ts:1852).**
   - Far-only colour: `far?: PD.Text` on `mesoscale.colorLevels` (:997), membrane only, writes `props.color` alone.
     `style {particles, color}` keeps its semantics (every species and the far colour, review S2).
   - Part colour: exists (far-only). Species colour: exists (`membraneSpecies` :481); a species' right-click Color… only
     if cheap.
   - Element scheme: repr param `atomColors: 'element' | 'carbon-species'` (carbons take the species' colour,
     heteroatoms their element's: the classic lipid look), via `colorLevels {atoms}`;
     `elementColor(code, scheme, speciesColor)` in `membraneColorLevels`' `colorOf`.
   - Edges fast path: `onlyColorEdges(before, props)` when only the levels' params move: `ColorLevels.setProps` on
     members and render objects (as `setClip` :1503–1504), `uPatchLevels` rewritten on every patch object (keep their
     `{values, size}`), no rebuild (today ~1 s on model ×20). On/off still rebuilds.
   - Palettes/Generate: check by a test first whether `mesoscale.theme` (rows.ts:505–524; operations.ts :1204–1300, no
     membrane branch) handles a membrane; if not, a membrane plan (uniform/object, generate, zoom).
   - UI: `MembraneLook` gains a Far `ColorField` (By zoom on) and an Atoms `Select`; `ZoomColors` (controls.tsx:116–160)
     gains `membrane?: boolean`: Chain hidden, edges labelled Species and Atoms; the operation clamps `chain` to the
     geometric mean of entity and atom so `entity < chain < atom` (:1020) holds.
3. **Tests (Dawn, `syntheticPatchPdb`, perspective, 128², `lipid-colors.webgpu.test.ts`), failing on HEAD.** Three
   camera distances with fixed default edges, far blue via `{far}`, species green: far blue > 0.6, middle green
   > 0.6, close P/O > 0.1 and carbon grey > 0.3, both methods. Each control changes only its level (`changed(a, b)`):
   > far, a species, `atoms: carbon-species`, a part (extend `lipid-parts.webgpu.test.ts:56`). Edges without a rebuild
   > (same render objects, image changed). One history step each (undo restores). TS quick: `elementColor` per scheme,
   > the clamp, the theme on a membrane. A close view with a clip plane keeps the element share.
4. **Size.** ~170 production lines, no `packages/graphics` change. Optional library lanes (Ludo's word): `atomColors`
   for particle lists (~60), a uniform far colour instead of per-instance `tColorFar` (~30, saves up to 8 MB at 2 M).
5. **Risks.** Nothing per frame; every colour buffer bounded by budget or patch, never by lipids; colour changes other
   than edges still rebuild (~1 s on model ×20; the colour-only path stays TODO N5); `onlyColorEdges` and `onlyClip`
   exclusive; colours applied before the clip.

**Defaults taken by the coordinator (Ludo may change):** tiles get the atom level (not left at species); the element
scheme offers `carbon-species`; `style`'s one colour keeps setting the far colour too.

## Round 7, item 6: built (2026-11-09)

**Commits** (from 72f8647b7): e3b5ff994 the tests first (failing); e412d4766 the tiles' atom level and the stale
comments; 83360a32c `colorLevels {far}`; 65c1d4eaa `atomColors` through `colorLevels {atoms}` (and
`elementColor(code, scheme, species)`, `graphicsState` gives `far` and `atomColors`); dfed4e45f the edges fast path
(`onlyColorEdges`, `setColorEdges`, `patchLevels`; also run at a build's end); a821c96db `mesoscale.theme` on a membrane
(the gap was real: "There is no object to color"); fcd57780a the chain clamp; a967a1936 the UI (`ZoomColors {membrane}`,
Look's Far and Atoms); 61e16cb84 specs (ui.md §4, features.md, color-levels.md, the changelog).

**Red before, green after.** Dawn (`lipid-colors.webgpu.test.ts`, a describe of its own, both methods): far blue via
`{far}` ("Unknown value 'far'"); species in the middle and atoms close (tiles: close `heads 0, green 1`); each control
its level, one step (the species step a guard, green on HEAD; far and atoms red on their param); edges without a rebuild
("object 0 kept" false). Quick (`lipid-membrane.test.ts`): far, atoms ("Unknown value"), the clamp ("The edges go entity
< chain < atom"), the theme ("no object"); `elementColor` per scheme added with its fix. `lipid-parts`: a part's colour
keeps the species level (a guard, green on HEAD). UI (`zoom-colors.test.tsx`): timed out waiting for the Species edge,
then green.

**Deviations from the design.**

- The close view at default edges: an atom must be over 40.7 px, so within ~13 Å of the camera; from above only the
  heads are that close, the carbons lie 1.5–16 Å under them at the species level. So "close" asserts P/O > 0.1 (over the
  heads, 120 px) and the carbon grey > 0.3 is read from a fourth view, `tails`, along the mid-plane among the tails.
- The middle view at 6 px an atom (not ~0.8): a patch surface's level is per fragment, its foreshortened limbs go far;
  closer, the surface fills the view. A membrane's chain level is its species', so 6 px is still the species.
- "Each control its level" checks the levels each control must keep, not all: a species' colour also changes the atoms
  deeper than the close view's first ones (they are at the species level).
- `far` does not turn the levels on or off: given alone it writes `color` only.
- Not done: the clip-plane close test (optional in the design); a species' right-click Color… (exists through
  `membraneSpecies`); a Storybook story for the membrane's Look.

**Checks.** `tsc -b`, `tsc -p apps/prism-me`, lint, check:workspace, styles:check (prism-me, mesoscale),
typecheck:storybook, quick lane with Dawn (cryoet 138, stage-tools 58, prism-me 208 pass; mesoscale 190 pass, 1 fail),
mesoscale test:perf: pass. Inherited, not item 6: `lipid-procedural.test.ts:56` (`poolCapacities` expectation from
before round 7's water-filling: `[[69,207],[275]]` vs `[[55,165],[330]]`, fails alone too) and format:check on
`import-colors.scaling.ts` and this progress file (neither touched by item 6's code commits).

**Size.** ~242 production lines added (membrane.ts 108, operations.ts 93, properties.tsx 27, controls.tsx 14) against
~170: the theme's membrane plan (~38, conditional in the brief) and the comments took the room.

**Ludo checks on 1354.** Wrap a sphere (either method), select it, Look › By zoom: edges Species and Atoms (no Chain),
Far and Atoms below. Far a colour: only the far view changes. Zoom in on a tiles membrane: atoms by element. Atoms ›
Carbons by species: tails take the species' colours. Drag Species or Atoms: no rebuild (instant). The Meshes category's
Color… now colours the membrane.

## Round 7, the gate (remaining) (2026-11-09; on `git diff 89c4f13aa...b2ffca85c`: items 2, 3, 6 and their fixes)

Reviewer and skeptic: `~/prism-me-lanes/gate/r7-review.md`. Ludo's decisions (2026-11-09, asked by the coordinator): S2
"Keep fixed shares", S5 "Neither touches parts".

| Finding                                                                         | Verdict                    | Test (fails first)                                                                                             | Fix                                                                       |
| ------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| M1 `poolCapacities`' test expects the old split                                 | confirmed, must-fix        | the test itself, red on HEAD                                                                                   | `31f61ed50` ([[69, 207], [275]], the level 250)                           |
| M2 `format:check` fails (progress file, `import-colors.scaling.ts`)             | confirmed, must-fix        | `pnpm format:check`                                                                                            | `ecb46a1fb`                                                               |
| M3 no story for the part row, the Look's Far and Atoms, `ZoomColors {membrane}` | confirmed, must-fix        | no committed test; `typecheck:storybook` passes; rendered once in jsdom (four frames each, no Chain), not kept | `728ce57ae` (Explorer › Membrane; the look is Ludo's check)               |
| S1 a view's cost O(P²) in parts (`showParts` and the fade per selection)        | confirmed, should-fix      | `d08e411f3` (×9.9 at 256 → 1024 parts; `9ccb09554` moved the code, unchanged)                                  | `4404bf727` (×1.3)                                                        |
| S2 the budget over every leaflet, not those in view                             | confirmed, Ludo's decision |                                                                                                                | kept (fixed shares); the ceiling in TODO and the PR's Notes (`5d915a112`) |
| S3 no clip close-view colour test (lowered to nit)                              | nit                        | `c360d0280` (a guard, green on HEAD)                                                                           |                                                                           |
| S4 `mesoscale.theme` on a membrane: a failed redraw returned ok, a no-op step   | confirmed, should-fix      | `35edc5fbc` (ok true on HEAD)                                                                                  | `9b00266ec` (the committed cells' errors roll back)                       |
| S5 Reset and the theme leave `partColors`, `hiddenParts`                        | confirmed, Ludo's decision | `b9fa56eb5` (a guard: today's behaviour)                                                                       | `b9fa56eb5` (ui.md §4)                                                    |
| S6 TODO's round 7 items stale                                                   | confirmed, low             |                                                                                                                | `5d915a112`                                                               |
| N1 the loop over roots                                                          | confirmed, nit             |                                                                                                                | `209d7d20d`                                                               |
| N2 the triangle tree built twice                                                | refuted (cached)           |                                                                                                                |                                                                           |
| N3 the edges error names Chain                                                  | confirmed, nit             |                                                                                                                | `e0c0f0679`                                                               |
| N4 a scan of the objects per mesh row                                           | confirmed, nit             |                                                                                                                | `ac9bd6039`                                                               |
| N5 a part row picked shows empty properties                                     | confirmed, nit             |                                                                                                                | open (TODO)                                                               |
| X1 a part uploads the whole mesh's region table, three times a leaflet          | new, plausible → confirmed | `321bd9813` (340 regions of 340 on HEAD)                                                                       | `4300e6a0d` (688 → 105 MB on a synthetic cell)                            |

**X1, how.** `partMesh` keeps a part's regions alone, renumbered, each with its key in the cells' hash
(`CutterRegions.keys`: its index among the whole mesh's). Every reader hashes the key, not the index: the TS cutter
(`TriangleCut.key`), the selection, the far surface, the kernel (the keys after the triangles' regions in one buffer:
the write pass is at the stage's storage-buffer limit) and the mesh shader (the key over the patch table's normal x,
which it never read; `patchTableArray`). The same lipids a triangle: `lipid-parts.test.ts`'s rows of a split cut equal
the whole mesh's; the Dawn cutter equals the reference on a cell's second part (its keys not its indices). Measured (a
30,000 Å sphere and eight of 3,000 Å, 254,160 triangles, 190,388 regions, both leaflets): the region tables uploaded 658
→ 73 MB; with the triangles' regions, the cells and the patch tables' shifts, 688 → 105 MB. The cells' table (64 KB)
stays copied three times a leaflet (3.5 MB here).

**S4, the mixed case** (particles and a membrane in one theme, the membrane failing) rolls back as one by construction
(one transaction) but is tested on a membrane alone: TODO.

**Checks (2026-11-09, after the gate).** `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`,
`pnpm format:check`, `pnpm check:workspace`, `styles:check` (mesoscale, prism-me), prism-me `typecheck:storybook`: pass.
Quick lane with Dawn: graphics 160 files, 1,894 passed (99 skipped); mesoscale 30 files, 196 passed (4 skipped); cryoet
138; stage-tools 58; prism-me 208: pass. Mesoscale `test:perf`: 15.62 B a select (15.6), the parts' shown 0.
`lipid-parts.scaling.ts`: ×1.3 at 256 → 1024 parts, its quadratic control caught. The stories rendered in jsdom only:
light and dark, wide and narrow are Ludo's look in Storybook (Explorer › Membrane).

**Size.** About 190 production lines (X1 ~90 across seven files, S1's views.ts ~110 moved and ~20 new, S4 ~15, nits
~25), the stories ~150.

## PR body (draft; rounds 4 to 7, after the gate)

**What.** Lipid membranes made per view on the GPU (prism-me's Mesoscale Explorer): a mesh or the yeast cell's nine
membranes wrapped with lipids cut from a CHARMM-GUI patch where they are seen, a textured far surface past them, one
budget across membranes; each of a cell's membranes a part (its eye, its colour, its own lipid mix); colours by zoom on
three levels (the membrane's, its species', its atoms' by element); master v6 #2069 merged in.

**Changes.**

- Rounds 4–6:

  - Library (`packages/graphics`; to their own lane from `origin/master` on Ludo's word): a pool of GPU-written
    instances (live counts per segment, a writer's view hook in the culler's dispatch: `f99c9e0b1`, `a6d265ce8`); dead
    slots past any far plane (`2f9cbf270`, its test `1ed7faf2c`); a mesh's patch texture (`dPatchTexture`: planes,
    cells, a shift a vertex, colour variants only; `sLinearMipmapRepeat`: `835dffca8`, `9ad038804`, `d55a15ff2`; its
    Dawn test in plugin-headless, `f9526c7c6`).
  - `packages/extensions/mesoscale`: `lipids/procedural.ts` (the selection: whole triangles and cells, the facing
    leaflet, a pool a member), `cutter.ts` (cells, kinds' counts), `cutter-kernel.ts` (write pass by units, dead slots),
    `far-surface.ts` (the patch surface and raster), `membrane.ts` (pool, surfaces, textures' lifetime, colours by zoom,
    clips), `export.ts`; operations `membraneDetail`, `membraneSpecies`, `exportMembrane`, `graphics`, and the particle
    list's `style`, `colors`, `colorLevels` on a membrane; a `test:perf` tier (`lipid-selection.quick.ts`).
  - Round 6, `mesoscale`: `lipids/triangle-tree.ts` (the tree, the parity test, enclosures), `procedural.ts` (the
    descent, the parts shown), `membrane.ts` (`meshes`, `concatMeshes`, a part's surfaces), `organelle-meshes.ts` (the
    reader and its transform), `wrapMembrane { meshes }`; `apps/prism-me`: rows named by their shape's label, Wrap all.
  - `apps/prism-me`: Wrap with lipids = the cutter (tiles: small objects); Export lipids; the membrane's Look; ui.md,
    features.md, TODO, the changelog `.v6/changelogs/lipid-procedural.md`.

- Round 7: the merge of origin/prism-me, the lane's GPU instance writer, live counts, dead slots, per-level scales and
  patch texture ported onto master's culler; a CPU write tells a pool's writer (`GpuInstanceTarget.cpuWrites`); the
  coarse sphere level shows the finer one's top view; the selection's keys sorted in place (15.6 B a view, from 95.6).
- Items 2 and 3: a cut leaflet a part and leaflet on its own triangles (`partMesh`), its table its membrane's mix
  (`mixes.ts`, the LD a monolayer); a part's row in the tree, its eye and colour (`mesoscale.style`/`colors {parts}`,
  one step each, never cut again); the budget water-filled over the pools.
- Item 6: tiles get the atom level; `colorLevels {far, atoms}` (`element`, `carbon-species`); an edges-only path with no
  rebuild; `mesoscale.theme` colours a membrane; the Look's Far and Atoms, `ZoomColors {membrane}`.
- The gate: a part uploads its own regions only, keyed as the whole mesh's (688 → 105 MB on a cell of nine membranes;
  graphics: the mesh shader hashes the key over the patch table's normal x); a view fades the surfaces and shows the
  parts once (×9.9 → ×1.3 at 4× the parts); a theme whose redraw fails fails cleanly; Reset and a theme leave the parts;
  Storybook's Explorer › Membrane.

**Notes for review.**

- Graphics changes in a library package (`merged-culler.ts`, `cell-cull.wgsl.ts`, `mesh.wgsl.ts`, `mesh.ts`): the writer
  contract (`GpuInstanceWriter`, `merged-render-objects.md`); the patch table's fourth texel's x is now a region's key
  (MeshSchema's doc). The patch texture is WebGPU only (`shader-parity.test.ts`).
- **The budget's ceiling (Ludo's decision, 2026-11-09: keep fixed shares).** The budget is shared over every leaflet at
  the wrap, not those in view: about 1.1 × budget / L a leaflet. At 2 M, the PM's outer leaflet holds 122 k lipids with
  9 parts, 37 k at 30, 11 k at 100, 1.1 k at 1,000. A close view takes about 73 k a leaflet: about 15 membranes (30
  leaflets) is the ceiling for a close view. A middle view of the PM wants about 2 M: already about 15× short at yeast
  (far parts empty). About 1,700 member objects on yeast. In TODO.md.
- Reset and a category's theme leave a membrane's parts (Ludo's decision, ui.md §4).
- Open: the stories' look (light, dark, wide, narrow) for Ludo in Storybook; a part row's empty properties (N5); the
  yeast wrap's time and RSS since the pools a part; the theme's mixed case; the TODO items.

**Testing.** Quick lane with Dawn (graphics, mesoscale, cryoet, stage-tools, prism-me), `tsc -b`, prism-me's `tsc`,
lint, format, `check:workspace`, `styles:check`, `typecheck:storybook`; mesoscale `test:perf` (15.62 B); the new scaling
guard `lipid-parts.scaling.ts`; Dawn parity of the cutter on a part's renumbered regions; the X1 bytes by a measurement
over a synthetic cell. Earlier rounds: plugin-headless with Dawn (two inherited failures, `webgpu-points`,
`webgpu-device-listener`), `test:scaling` 19/20 (one killed under load, not the lane's).

**Review.** Round 7's first gate (the merge, items 1, 4, 5; reviewer and skeptic, Opus):

| Finding                                                                  | Skeptic                        | Test (fails first) | Fix                           |
| ------------------------------------------------------------------------ | ------------------------------ | ------------------ | ----------------------------- |
| M1 `mixTable` reorders a cached table's elements in place                | confirmed, must-fix (latent)   | `b405e6ecf`        | `bf6236da0` (copies)          |
| S1 a borrowed species levelled to its own height (item 1's pop again)    | confirmed, should-fix (latent) | `b405e6ecf`        | `bf6236da0` (levelled as one) |
| X2 a second call scrambles again                                         | new, confirmed                 | `b405e6ecf`        | `bf6236da0`                   |
| S2 the culler's `setLiveCount` allocates a view where a live count moves | confirmed, pre-existing (nit)  |                    | open (TODO)                   |
| S3 TODO's stale 80 B                                                     | confirmed, nit                 |                    | `412f4cb6b`                   |
| N1 escaped backticks in a comment                                        | confirmed, nit                 |                    | `412f4cb6b`                   |
| N2 the spec lacks the writer's `cpuWrites` contract                      | partly, nit                    |                    | `412f4cb6b`                   |
| N3 a mirrored conformer is the enantiomer                                | confirmed, nit                 |                    | `bf6236da0` (180° about x)    |
| N4 the heap sort's time not measured                                     | confirmed, nit                 |                    | open (TODO)                   |
| D1 the design's part colour would turn By zoom off                       | confirmed, should-fix (design) |                    | `a8dee4473` (design)          |
| X1 a species with no members dealt to member 0                           | new, plausible                 |                    | `bf6236da0` (throws)          |

Round 7's remaining gate (items 2, 3, 6; `~/prism-me-lanes/gate/r7-review.md`):

| Finding                                                                         | Verdict                    | Test (fails first)                                                                                             | Fix                                                                       |
| ------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| M1 `poolCapacities`' test expects the old split                                 | confirmed, must-fix        | the test itself, red on HEAD                                                                                   | `31f61ed50` ([[69, 207], [275]], the level 250)                           |
| M2 `format:check` fails (progress file, `import-colors.scaling.ts`)             | confirmed, must-fix        | `pnpm format:check`                                                                                            | `ecb46a1fb`                                                               |
| M3 no story for the part row, the Look's Far and Atoms, `ZoomColors {membrane}` | confirmed, must-fix        | no committed test; `typecheck:storybook` passes; rendered once in jsdom (four frames each, no Chain), not kept | `728ce57ae` (Explorer › Membrane; the look is Ludo's check)               |
| S1 a view's cost O(P²) in parts (`showParts` and the fade per selection)        | confirmed, should-fix      | `d08e411f3` (×9.9 at 256 → 1024 parts; `9ccb09554` moved the code, unchanged)                                  | `4404bf727` (×1.3)                                                        |
| S2 the budget over every leaflet, not those in view                             | confirmed, Ludo's decision |                                                                                                                | kept (fixed shares); the ceiling in TODO and the PR's Notes (`5d915a112`) |
| S3 no clip close-view colour test (lowered to nit)                              | nit                        | `c360d0280` (a guard, green on HEAD)                                                                           |                                                                           |
| S4 `mesoscale.theme` on a membrane: a failed redraw returned ok, a no-op step   | confirmed, should-fix      | `35edc5fbc` (ok true on HEAD)                                                                                  | `9b00266ec` (the committed cells' errors roll back)                       |
| S5 Reset and the theme leave `partColors`, `hiddenParts`                        | confirmed, Ludo's decision | `b9fa56eb5` (a guard: today's behaviour)                                                                       | `b9fa56eb5` (ui.md §4)                                                    |
| S6 TODO's round 7 items stale                                                   | confirmed, low             |                                                                                                                | `5d915a112`                                                               |
| N1 the loop over roots                                                          | confirmed, nit             |                                                                                                                | `209d7d20d`                                                               |
| N2 the triangle tree built twice                                                | refuted (cached)           |                                                                                                                |                                                                           |
| N3 the edges error names Chain                                                  | confirmed, nit             |                                                                                                                | `e0c0f0679`                                                               |
| N4 a scan of the objects per mesh row                                           | confirmed, nit             |                                                                                                                | `ac9bd6039`                                                               |
| N5 a part row picked shows empty properties                                     | confirmed, nit             |                                                                                                                | open (TODO)                                                               |
| X1 a part uploads the whole mesh's region table, three times a leaflet          | new, plausible → confirmed | `321bd9813` (340 regions of 340 on HEAD)                                                                       | `4300e6a0d` (688 → 105 MB on a synthetic cell)                            |

Earlier rounds' gates: their tables in the progress file (`apps/prism-me/progress/2026-11-08-lipid-procedural.md`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## Round 8: architect's design (2026-11-09, read-only, at ecc2ae79b)

**Verdict.** Shells work with the app's look if (a) they are drawn only on the triangles in the middle band, never on
the whole far surface (round 6: the 36 patch surfaces ~45 ms; ×N over 1.08 M triangles would cost hundreds of ms), and
(b) their alpha test runs in every render variant. Parallax is one fragment pass on the far surface. Graphics ~165 lines
(stop ~600), extension ~270. No GLSL twin (WebGPU only; add the names to `shader-parity.test.ts:28,46`).

1. **Height channel** (`far-surface.ts`): `patchHeights(table, shown, side, sizeFactor)` = `topGrid` (:129) over all
   atoms at radius `sizeFactor`; lo = max(min, hi − 12 Å), hi, mean returned with the raster; stored in `tPatch`'s free
   alpha (A = 255 today, `patchRaster` :494), RGBA8 256², mips by `patch.mipmap()` (membrane.ts:1082) give the mean
   height far away. Coarse keeps its shaded RGB (option B); shells/parallax bake flat RGB
   (`patchRaster(..., shade=false)`) from the stride-1 top view (`switchSpheres(table, props, middlePx)`).
2. **Shells.**
   - A band object per cut leaflet, `shellBand`, `instanceCount = N` (8; 6–10): only the band's triangles, copied per
     view change from the far surface's CPU arrays into grow-only arrays, its own small `tPatchTable` (band regions
     renumbered with their keys as `partMesh` :460; the 4,096 cells; the vertices' shifts), uploaded with
     `updateGPUData` (render-item.ts:230). Never a duplicate of the whole far surface (~130 MB on yeast).
   - The band: per view, walk the part's `triangleTree` (triangle-tree.ts:44, preallocated stack) for triangles in the
     frustum with nearest px ≥ 0.8·mergePx and farthest px ≤ 2·middlePx; cap 256 k; from the view hook
     (`createMembraneViews({fade})`, membrane.ts:1232): nothing at rest.
   - Offsets (WGSL vertex, `dPatchMiddle == shells`): shell k at d_k along +baseNormal (both leaflets: inner normals
     already negated, far-surface.ts:440); d = (mean − L) + j·Δ, Δ = (hi − lo)/(N − 1); instance 0 the opaque base;
     drawn top-down; shift_k = shift·(L + d_k)/L (far-surface.ts:445). Uniforms `uPatchShells: v4` (N, d_lo, d_hi,
     d_mean), `uPatchLift: f`.
   - Alpha test: `patchFrame()` split out of `patchColor` (mesh.wgsl.ts:70–103); shell k (k ≥ 1) kept where H(s) ≥ (h_k
     − Δ/2 − lo)/(hi − lo); **outside the colour-variant guard (mesh.wgsl.ts:331)**: depth, pick, marking, emissive,
     tracing and colour alike (deterministic, so the passes agree); the colour stays guarded.
   - Normal (colour variants): central differences of A at ±1 texel, back through the cell's spin and region turn onto
     e1/e2, into view space; flat at coarse mips.
   - Fades: distance by the mip (H → mean); grazing by scaling the gradients by 1/max(|n·v|, 0.25); per-fragment handoff
     by lipid px (`patchColor` :101): band discards px < mergePx, far surface discards px ≥ mergePx (shells only),
     coplanar at the mean: exact complements. Lipids' fade: `fadeSurface` (membrane.ts:817), enter = middlePx.
   - Depth/look: opaque, alpha-tested, depth written; outline, SSAO, shadows read `tDepth` and see the relief.
   - Picking: the pick variant runs the alpha test; ids within groups × N. A far surface picks nothing today
     (`getLoci: EmptyLoci`, membrane.ts:1639): shells keep that parity; "picks its membrane" (~25 lines) is Ludo's call.
   - Clipping: per fragment and per instance (`clip_pixel_wgsl` :283), `setClip` on the band too. The cut band:
     triangles within 2 lipid sizes of a clip boundary keep the coarse rule (enter = `spheresPx`, option B), so a
     cross-section shows lipids with tails, cost by the cut's length.
3. **Parallax** (`dPatchMiddle == parallax`): one pass on the far surface at the mean; the view ray in patch space
   marched hi → lo (entry moved back by (hi − mean)·v/v_n), steps mix(16, 6, |n·v|) plus one secant; the cell hashed
   again per step; only where px ≥ mergePx; colour and normal at the hit. No `frag_depth` (keeps early-z, depth = colour
   pass): flat depth and silhouettes, the look's known limit. A cut: the plane plus the cut band's lipids.
4. **Levels (lipid px).** coarse: today. shells/parallax: atoms ≥ `middlePx` (kept to 0.8×); middle look from 2·middlePx
   (dither) to `mergePx` (2); flat far below. `middlePx` = the stride-1 → 8 boundary on CHARMM-GUI ÷ Keep (~11 px,
   measure first), so no coarse level is reached: shells/parallax replace the coarse sphere levels. Colour levels
   unchanged (species on the middle look, atoms only on lipids, far below the entity edge). Option B stays for coarse
   and the cut band. Tiles: `middle` ignored, UI disabled.
5. **The Look's switch.** Params (membrane.ts:671): `middle: 'coarse'|'shells'|'parallax'` ('coarse' until Ludo picks),
   `middlePx`, `shells` (8), `mergePx` (2, hidden). `mesoscale.membraneDetail` (operations.ts:397) takes them, one
   history step; `membraneDetailState` (:367) returns them. Fast path `onlyMiddle(before, props)` beside
   `onlyClip`/`onlyColorEdges` (membrane.ts:980–990, dispatch :1603): re-raster into the existing `tPatch`, set the
   uniforms, create/release band objects, bump the selection's `enterPx` (:1243); nothing re-cut. UI controls.tsx:286
   under Far: Middle (Coarse spheres / Shells / Parallax), Middle px slider (one commit); hidden when Far = Spheres.
6. **Scale.** Band vertices tiny (yeast PM middle ~1 k triangles × 8 × 3); fragments: shells ~5–15 ms full screen
   900×600, parallax ~3–8 ms; the coarse lipids between middlePx and 2 px are gone, so middle frames at or below coarse,
   drawn lipids several times lower. Toward a human cell: cost = band triangles (bounded by screen) × N plus screen area
   × N fragments, not lipids or cell triangles. Open bottleneck (today's): far and near surfaces drawn whole (2.16 M
   triangles each on yeast): per-chunk culling or a decimated far mesh, a later round. Nothing per frame (grow-only
   arrays, preallocated stack); nothing at rest.
7. **Tests, failing first.** (1) TS: A = brute-force max of z + √(r² − d²) normalised, within 1/255 (fails: A is 255).
   (2) Dawn graphics `plugin/headless/src/_test/webgpu-patch-shells.test.ts`: a 2-triangle quad, 8×8 patch with A in {0,
   64, 128, 192, 255}, N = 4, ortho from above: depth per texel = the top passing level; per `instanceCount`, exactly
   the texels with A ≥ t_k; depth and pick variants discard the same pixels. (3) Zoom-step dE
   (`lipid-switch.webgpu.test.ts:151`) per `middle`, 16 → 0.8 px, outside and inside the PM, under 0.03 (fails: unknown
   'shells'). (4) Frame and drawn lipids per look, whole/middle/close on ×600 and the yeast PM: middle ≤ coarse ×1.1,
   lipids ≤ coarse/2, whole ≤ +10 %; numbers here. (5) Cut (`lipid-clip.webgpu.test.ts`): a clip plane through the
   middle view per look: coverage in the cross-section band ≥ coarse − 5 %, mean Oklab within 0.05, band lipids > 0 near
   the plane. (6) At rest per look: no selection, no band write, no frame.
8. **Size.** Graphics ~165 (renderable/mesh.ts:61–72 ~14; geometry/mesh/mesh.ts:875 ~3; mesh.wgsl.ts ~145; parity +1),
   its own library lane from master on Ludo's word. Extension ~270. Fallback if the band object is hard: parallax only
   (~70 WGSL + ~60 extension).

**Risks.** Mid-mip H may speckle the outline (bias +1 mip near mergePx if tests show it); the extra lift worsens the
cow's thin-part folding (round 7 option D, open); the band is triangle-granular.

## Round 8: built (2026-11-10, builder; in progress)

Steps done so far (commits on me/lipid-procedural):

1. Height channel, `a50f94daf`. Test 1 (`lipid-patch-texture.test.ts`, alpha = brute-force top normalised within 1/255):
   failed (A was 255, no lo/hi), passes. `patchRaster(..., shade)`, `HeightSpan` 12 Å.
2. Graphics, `03625d096` (+ `6cb4e25b8`, the profile normal at every px). `patchAt`/`patchFrame`/`patchRead` split out
   of `patchColor`; `dPatchMiddle` off | shells | beneath | parallax (a define: coarse compiles as before),
   `uPatchShells` (N, lo, hi, mean), `uPatchMiddle` (mergePx, end px). Test 2 (`webgpu-patch-shells.test.ts`): failed
   (no `uPatchShells`), passes: colour, pick and depth per column; parallax and beneath draw with no error. Parity lists
   `uPatchShells`, `uPatchMiddle`, `uCameraPosition`, `uCameraDir` (the last two on texture-mesh too: one source).
3. Parallax, `9acb54a54`. Params `middle` (coarse default), `middlePx` 11 (measured: Balanced stride 1 from 8.83 px a
   7.44 Å lipid; ÷ Keep), `shells` 8, `mergePx` 2 hidden; operation and UI (Far › Middle: Coarse / Shells / Parallax,
   Atoms down to, Shells). Test 3 (zoom 16 → 0.8 px, parallax): failed (no parallax surface), then 0.043 at 6.3 px (the
   selection keeps lipids below middlePx·Keep, at the stride-8 level), fixed by drawing a cut leaflet's lipids as atoms
   with a middle look (deviation: the design relied on middlePx alone), now 0.007. UI test failed on HEAD (timed out),
   passes. Tests 5 (cut: coverage and Oklab vs coarse; parallax 0.709 vs 0.661, dE 0.028) and 6 (at rest) per look pass,
   but would pass on HEAD too (guards, not failing-first).
