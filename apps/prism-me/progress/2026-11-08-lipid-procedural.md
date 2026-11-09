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

**Round 4b.** The far look as two welded surfaces at each leaflet's lowest head, in the species' colours where the
cutter puts them; the cutter cuts each region by cells under the patch's box (no period on a large triangle: copies 30 %
→ 0.01 % on the teddy ×100); a tiles membrane has the cutter's Look but Texture; Add clip… on a membrane, both methods,
spheres and surfaces cut alike. Notes for review: seams now at the cells' borders too (M2, Ludo's call); a membrane
wrapped before the clip change must be wrapped again. Review: "Round 4b, the gate" above.

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
