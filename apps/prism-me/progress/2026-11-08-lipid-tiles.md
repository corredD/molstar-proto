# Lane lipid-tiles (2026-11-08): procedural lipid membranes on the GPU

Brief approved by Ludo on 2026-11-08 ("just do the gpu, the idea is to scale up"). Lane `me/lipid-tiles` from
`origin/prism-me`, port 1353. The design and its sources: `~/prism-me-lanes/mesobuild/docs/lipids.md` (read it first: §1
what cellPACKgpu and LipidWrapper do, §2 the tile idea, §6 the full-text reads, §7 the proposal).

## Asked (Ludo, 2026-11-08)

Bring cellPACKgpu's procedural LipidWrapper (Durrant's cookie cutter) into prism-me, improved, scaled to a whole cell:
real-time population after the mesh is made, loaded or taken from an SDF, parallel per triangle on the GPU. Composition
changes with an input ratio; a separate lipid library makes the patches at a ratio (keep several compositions in mind).

## Design

1. **Tile set (CPU, once per patch, a worker, cached per patch).** From a flat equilibrated bilayer patch (CHARMM-GUI
   patches are periodic: wrap coordinates, the source is unbounded), per leaflet: n = 1–2 oriented edge types (E / Ē:
   the same lipid band turned 180° in-plane), C = 2 vertex colours (a lipid disc per colour), and ≥ 2 interior variants
   per (vertex colours, edge types) combination; a tile = 3 corner discs + 3 edge bands + interior fill, on an
   equilateral template of edge ~200 Å (~265 lipids a leaflet). Each lipid is owned by the tile holding its headgroup
   (`P`, `O3` of cholesterol), so a seam lipid exists once. Clashes inside a tile (pieces meeting) are removed and holes
   refilled, once, here (Durrant's two passes, done per variant instead of per triangle). The tile set is a set of
   targets (one per variant, the lipids its residues, species = residue name).
2. **Mesh (CPU, once per mesh).** From a loaded OBJ/PLY/GLB or an isosurface (marching cubes exists in `gl/compute`);
   isotropic remesh to near-equilateral triangles of the tile's edge, one surface per leaflet (offset ± half the bilayer
   along the normal: the outer leaflet gets its extra area, asymmetric composition costs nothing).
3. **Assignment on the GPU (WGSL, one thread per triangle).** Vertex colour = hash(vertex id), edge type and its
   orientation = hash(the edge's two ids), variant = hash(triangle id): no global pass. Output per triangle: the tile
   variant and an **affine** mat4 mapping the template triangle onto the actual one (both tiles of an edge map it
   through the same endpoints, so the bands line up exactly; distortion a few %). A per-lipid hide mask (protein
   exclusion) is lane C, not here.
4. **Draw.** Instance = tile, group = lipid (pick a lipid as tile + group: the 24-bit pick id counts tiles). The tile
   transforms stay on the GPU: the renderer's instances for the membrane come from the assignment kernel's buffer
   (indirect, no CPU round trip), and the GPU culler culls them like any merged instance (bounds from the affine map).
   This is the library part: find how `gl/renderable/merged*.ts` and the culler take instance data and add a path that
   takes a GPU buffer; keep it a separate commit (an upstream candidate, Ludo decides).
5. **Operation** `mesoscale.wrapMembrane { mesh, patch, leaflets, tileEdge }`: one history step; a membrane entity in
   the scene tree with its species; colour by residue name works.
6. **WebGL2:** no compute in prism-me's WebGL2 path, so no membrane there in this lane: the operation reports it on the
   status line (Ludo may want a CPU fallback later).

## Tests and numbers (each failing first where it guards a bug)

- Tile set: every lipid owned once; atom pairs < 2 Å across every edge and at every vertex of a tiled test mesh (an
  icosphere) = 0 on a flat mesh, measured on curved; hole area; composition realised against the patch's, per leaflet.
- Assignment: the WGSL kernel equals a TypeScript reference of the same per-triangle function, tile for tile (Dawn,
  headless WebGPU suite); determinism (same mesh, same output).
- Scaling guard (`*.scaling.ts`): tiles n and 4n, time and allocation ≈ linear.
- Numbers for the progress file: the exosome-size vesicle (R 500 Å) and a 1 µm sphere, then the largest that runs:
  lipids, tiles, bytes a lipid on the GPU, assignment time, frame time (WebGPU, the M1).

## What Ludo checks in the app

Load `exosome_plasma.bcif`, or open an OBJ sphere; right-click the membrane compartment (or + Open a mesh) → Wrap with
lipids (patch: the CHARMM-GUI 14-species one); a bilayer appears, no seams visible, colour by residue name shows the
species; zoom far out on a 1 µm sphere and it stays smooth.

## Size and models

About 1,300–1,800 production lines (tile set ~500, remesh ~250, kernel + reference ~250, renderer GPU-instance path
~300, operation + representation ~300). Design, the kernel and the renderer path: Opus. Review gate before the PR.
Library commits apart and listed.

## Test data

- Patches: `~/Dev/lipidwrapper/examples/files/step4_lipid.pdb` (CHARMM-GUI, ~240 Å, ~1,380 lipids, 14 species),
  `~/Dev/cellpackgpu/Data/membranes/lipid_example_noh.pdb` (621 Å, 12,125 lipids, 5 species),
  `~/prism-me-lanes/mesobuild/exosome/cache/pdb/pope.pdb`. Committed tests use data made in memory or a small patch
  committed under the repo's test data (no files outside the repo).
- Meshes: icosphere in memory; `~/Dev/lipidwrapper/examples/files/*.dae` (HIV envelope, concave model).

## Design (as found, 2026-11-08, before code)

**What the renderer takes.** A merged object (`gl/renderable/merged.ts`) copies each member's CPU `aTransform`,
`aInstance` into merged arrays (`writeMemberInstances`); its GPU culler (`merged-culler.ts`) packs them into the
`instanceData` storage buffer (`packInstanceData`: 5 vec4 an instance, the affine rows then instance and segment) and
into the identity region of its compacted attributes (`identityBase`); `instance-copy` (`cell-cull.wgsl.ts`) tests each
instance by its segment's invariant sphere times the affine (radius by the largest axis scale: a stretched tile is not
culled early) and copies it into per-(level, segment) regions drawn indirectly. With a culler every view draws from the
culler's attributes (the GPU lists, or the CPU lists shifted to the identity region): no pass reads the merged
`aTransform` buffer. The CPU reads a member's transforms only for its grid (`calcInstanceGrid`, `splitCell`); a gridless
member (`instanceGrid.cellSize <= 1`) is one cell, its `boundingSphere`, and each of its instances is still culled on
the GPU by `instance-copy`.

**The GPU-instance path (library commit, `packages/graphics`, ~100 lines).** A member may carry `gpuInstances`, a writer
`(compute, target) => void` that dispatches its own kernel to write the affine rows of its instances into the culler's
`instanceData` (at its instance base) and the identity region of `aTransform` (at `identityBase` + base). The culler
calls it after every CPU write over the member's range (`syncInstances`, `syncInstanceRange`): a write lands before the
commands of its submission, the kernel after, so the GPU's rows win; a layout change (bases moving) calls it again. The
member keeps a zeroed `aTransform` of its instance count on the CPU (the merged object's arrays and versions unchanged:
no other code learns of it; 64 B a tile, twice, a TODO to drop) and is gridless with its bounds from the mesh. The
culler's invariants hold: instances per segment known on the CPU, cells from the CPU, the kernels unchanged. Without a
culler (WebGL2, no `indirect-first-instance`, GPU culling off) the representation draws nothing and says so on the
status line; it forces `gpuCulling: true`.

**Why the CPU still knows the variant of each triangle.** A variant is a target, a member, a segment: the merged layout
(`instanceBases`, the indirect records, `structureChanged`) needs each segment's instance count before any dispatch, and
sizing every variant for every triangle costs variants × T × 80 B. The worker that remeshes runs the same hash (the
TypeScript reference) per triangle: the counts per variant and a slot per triangle (u32), 4 B a triangle; the WGSL
kernel recomputes the variant (checked against the CPU's in the Dawn test) and writes the affine at its slot. Slots keep
the output deterministic (no atomics), so the Dawn test is tile for tile. This follows from the merged layout; the
transforms (the 64 B a tile the brief wanted off the CPU) stay on the GPU.

**Tiles (the baker, pure TS).** One leaflet a tile set: oriented edges E/Ē (n types, default 1), C vertex colours
(default 2), V interior variants (default 2): C³ × (2n)³ × V variants (128 by default), each a member. A strip per edge
type (length L, width 2w, cut once): E takes the half on its side by headgroup, Ē the other half (the strip turned 180°
in-plane about the edge's midpoint): an edge's lipids exist once and both sides come from one piece. A corner disc per
colour: lipids wholly inside the corner's 60° sector (1 Å off both edges) and within r_v − 1 Å of the corner; band
lipids wholly beyond r_v + 1 Å from both ends; interior lipids wholly inside the triangle 1 Å off the edges; r_v ≥ twice
a lipid's lateral reach + 2 Å, so outer band halves of two edges never meet. A variant's own lipids are cleaned against
the full strips of its three edges (both halves) and each other (worst first, Durrant), then holes refilled by trial
placements (patch lipids, random spin) that keep those rules. Hence on a flat tiling no pair < 2 Å across edges or at
vertices by construction (the corner sectors' content never straddles an edge); the cost is a hole wedge along each edge
near each vertex, measured.

**Assignment (TS reference + WGSL, one thread a triangle).** Vertex colour = hash(vertex id) mod C; edge k (corners k →
k+1) type = hash(min id, max id) mod n, E where the triangle runs it from the smaller id; variant index = hash(triangle
id) mod V; affine M = [P1−P0, P2−P0, n̂] · [B−A, C−A, ẑ]⁻¹, translation P0 (template A at the origin): both tiles of an
edge map it through the same endpoints. The kernel lives in the extension (`KernelCode(name, size, { wgsl })`, runtime
source: no registry change).

**Commits.** Library (`packages/graphics`): the `gpuInstances` hook in the culler and its Dawn test (a fake writer, the
identity region and drawn counts read back). Extension (`packages/extensions/mesoscale`): `lipids/` (patch reading,
baker, remesh, assignment + WGSL, the membrane representation), the `mesoscale.wrapMembrane` operation, its menu entry.
App: `features.md`, TODO, changelog.

**Representation and operation.** A state transform from a mesh (a shape in the scene, or a sphere: a compartment's
membrane particles fitted, or a radius) and a patch to a membrane object (the tile set, the remeshed leaflets, the
slots; built in a worker-able pure function); its representation makes one spheres render object per variant (groups =
lipids, colour by residue name or uniform), merged with `gpuCulling: true` and the writer bound;
`mesoscale.wrapMembrane` adds both in one state update (one history step). The kernel runs whenever the culler asks
(layout change), never per frame.

## Built

- **Library (`packages/graphics`, `b08d2d574`):** a merged render object's member may carry `gpuInstances`, a writer
  `(compute, target)` the GPU culler calls after each CPU write over the member's range (`syncInstances`,
  `syncInstanceRange`) and after a layout change; it writes the member's affine rows into `instanceData` (at its base)
  and the identity region of the compacted `aTransform`. Dawn test in `plugin/headless` (`webgpu-gpu-instances`).
- **Remesh (`lipids/remesh.ts`):** icosphere at a target edge, offset surfaces (one per leaflet), an isotropic remesh
  (split, collapse, flip, tangential smoothing, projection on the input through a surface grid) and mesh statistics.
- **Tiles (`lipids/patch.ts`, `lipids/tiles.ts`):** a PDB bilayer patch read per leaflet (waters, ions and hydrogens
  out; periodic box), the baker as designed: oriented edge strips, heads own lipids, clash removal and hole fill once a
  variant.
- **Assignment (`lipids/assign.ts`, `lipids/assign-kernel.ts`):** the TypeScript reference (hashes, variant, slots, the
  affine), the WGSL kernel writing into the culler's buffers; the Dawn test checks them tile for tile.
- **Membrane (`lipids/membrane.ts`):** the state transform (a mesh by ref, or a sphere), the representation (a spheres
  object per (leaflet, variant), merged with GPU culling, the writer bound), `mesoscale.wrapMembrane` (one history step,
  a mesh, a compartment's fitted sphere or a radius; a patch by name or `patchPdb`), its command.
- **App:** right-click › Wrap with lipids on a mesh or a compartment's group (ui.md §5); features.md (Partial), TODO.md,
  the changelog.
- **Guards:** `lipid-membrane.scaling.ts` (the assignment over N triangles and a sphere of N tiles built, n and 4n, the
  quadratic control caught; passes).

Size: about 2,870 production lines against the brief's 1,300–1,800 (tests 860). What took the room: the remesh, 1,081
against ~250 (an isotropic remesh with projection on the input surface, its own half-edge structure and surface grid:
nothing in `@molstar/core` or `graphics` remeshes); the baker 547 + patch 250 against ~500; the membrane and its
operation 540 against ~300. The renderer path came under (45 against ~300): the culler already took GPU-side data.

## Decided

- **Transforms stay on the GPU, counts on the CPU** (as found, see the design): the merged layout needs each variant's
  instance count before any dispatch, so the CPU runs the same hash for counts and slots (4 B a triangle); the kernel
  writes the affines. Kept.
- **One vertex colour by default** (the previous session, reason not recorded): the transform makes `vertexColors: 1`
  (16 variants a leaflet), the brief had two (128). The bake is 8× shorter (5 s against 42 s for CHARMM-GUI's patch).
  For Ludo to decide (TODO.md).
- **The bake on the main thread** for now (the brief said a worker): TODO.md.
- **Gridless member:** the membrane is one cell (its bounding sphere) for the CPU; each tile is culled on the GPU by
  `instance-copy`.

## Learned

- Dawn's Node bindings segfault when the GPU instance (`webgpu.create([])`) is collected while work is in flight: a test
  holds it (`d1063d12a`).
- The spheres' levels of detail (`Spheres.LodPixelPresets.balanced` on the membrane's params) changed nothing on a 1 µm
  sphere (380 ms → 390 ms a frame): the merged GPU-culled path with GPU-written instances does not take them as is.

## Checks (2026-11-08, after `0d5fbb48c`)

`npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm check:workspace` pass; `pnpm format:check` passes
after this file's formatting. Quick lane: `pnpm test:unit packages/extensions/mesoscale apps/prism-me` (44 files, 287
tests), `packages/graphics/src/gl/_test/merged-culler.test.ts merged.test.ts`. Dawn (`pnpm native:run`):
`plugin/headless/src/_test/webgpu*` and `mesoscale/src/_test` (63 files, 239 tests), the three lipid and gpuInstances
tests among them. Scaling: `vitest.scaling.config.ts lipid-membrane` (3 tests).

## Numbers (headless Dawn on the M1 Pro, 2026-11-08)

CHARMM-GUI's `step4_lipid.pdb` (14 species, heavy atoms only), tile edge 200 Å, both leaflets, one edge type, two
variants. Lipid counts with two vertex colours (the app's one colour gives about the same).

| Surface                  | Tiles   | Lipids     | CPU build (remesh, offsets, slots) | Assignment (GPU)¹ | Frame²   | First image³ |
| ------------------------ | ------- | ---------- | ---------------------------------- | ----------------- | -------- | ------------ |
| Exosome vesicle, R 500 Å | 360     | 78,660     | 1 ms                               | 3.4 ms            | 26 ms    | 2.6 s        |
| 1 µm sphere, R 5,000 Å   | 36,000  | 7,866,000  | 35 ms                              | 4.0 ms            | 384 ms   | 13.5 s       |
| 2 µm sphere, R 10,000 Å  | 144,000 | 31,464,000 | 105 ms                             | 5.0 ms            | 1,268 ms | 44 s         |

¹ every variant of both leaflets dispatched and waited for: mostly submit and wait (3.4 → 5.0 ms over 400× the tiles),
not the kernel. ² `tick` and a GPU wait at 512², the whole sphere in view. ³ the first `getImageRaw` (pipelines, the
first culling, readback).

- **GPU bytes**, marginal between R 5,000 and R 10,000: storage 250 B a tile (the culler's instance data and transform
  regions), about 470 B a tile in all, 2.1 B a lipid; the tile templates are shared. A texture grows too (8.4 → 32 MB):
  the spheres' markers are per group and instance, 1 B a lipid (TODO.md).
- **Bake:** 42 s for both leaflets of CHARMM-GUI's patch at two vertex colours (128 variants a leaflet), about 5 s at
  one (the app's); the synthetic patch 2.4 s.
- **Largest that ran:** R 10,000 Å (31 M lipids), stopped by time (its first image 44 s), not memory (about 1 GB RSS).
- **Not met:** the brief's "zoom far out on a 1 µm sphere and it stays smooth": 384 ms a frame (TODO.md).
