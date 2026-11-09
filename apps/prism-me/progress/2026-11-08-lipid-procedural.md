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
