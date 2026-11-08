# Lane lipid-tiles (2026-11-08): procedural lipid membranes on the GPU

Brief approved by Ludo on 2026-11-08 ("just do the gpu, the idea is to scale up"). Lane `me/lipid-tiles` from
`origin/prism-me`, port 1353. The design and its sources: `~/prism-me-lanes/mesobuild/docs/lipids.md` (read it first:
§1 what cellPACKgpu and LipidWrapper do, §2 the tile idea, §6 the full-text reads, §7 the proposal).

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
   variant and an **affine** mat4 mapping the template triangle onto the actual one (both tiles of an edge map it through
   the same endpoints, so the bands line up exactly; distortion a few %). A per-lipid hide mask (protein exclusion) is
   lane C, not here.
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
