# prism-me's changes to the Mol* core and Prism

This file lists every change the `prism-me` branch makes outside `apps/prism-me` and the three app extensions
(`extensions/mesoscale`, `extensions/cryoet`, `extensions/stage-tools`): in the Mol\* packages (core, model, io,
graphics, plugin, mvs), in Prism (`packages/prism/*`) and in two other extensions (geo-export, command-language). It is
the one place to test these changes together, and the list to cherry-pick from when Ludo says some go upstream. Each
lane that adds such a change adds an entry here.

- **Merge-base:** `dabbf29f9` (origin/master, "Merge pull request #2069 from molstar/gl-gizmos-clip-ghosts-mesoscale",
  2026-11-09 00:37 -0800). The branch tip when this was written: `98110f7b2`.
- **The file list** (without `_generated` files, which follow their `.css`):

  ```
  git diff $(git merge-base origin/master prism-me) prism-me -- packages \
    ':!packages/extensions/mesoscale' ':!packages/extensions/cryoet' ':!packages/extensions/stage-tools'
  ```

  Add `--numstat` for the sizes. Commits of one path: `git log --oneline dabbf29f9..prism-me -- <path>`.
- **Paths** below are under `packages/`; inside an entry, a path that starts at a folder of the package's `src` (such as
  `gl/...` or `sources/...`) is under the `src` of the first full path of that entry. Hashes are short commit ids; "main" ones only. Tests are in `_test/` folders
  next to the code unless a path is given. Dawn (WebGPU native) tests are in `plugin/headless/src/_test/`.
- **The diff is against the merge-base, so it is what is left after the master merges.** Two earlier prism-me features
  (the outline ghost of a clip, the on-top layer) were removed when master's own (#2069) replaced them; they are not
  entries. Files with only an `@author` line added (`core/src/util/clip.ts`) are not entries.
- **Upstream:** `candidate` = a general fix or feature master would want; `prism-me only` = an app-specific hook;
  `needs work` = would need cleanup first; `unknown`. **Mixed** = the commit also has app hunks (matters for
  cherry-picking).
- Counts are of source files (tests, fixtures and `.md` specs apart). Numbers: `git diff --numstat`.

## Summary

| Package                     | Entries | Source files | +/- lines (source) | Test files (+lines) |
| --------------------------- | ------: | -----------: | -----------------: | ------------------: |
| core                        |       4 |            6 |           +74 / -9 |          3 (+112)   |
| model                       |       6 |            9 |         +514 / -20 |          7 (+752)   |
| io                          |       5 |           12 |        +1449 / -6  |   8 (+1059) + fixtures |
| graphics                    |      25 |           93 |       +4595 / -564 |         40 (+4873)  |
| plugin (core, headless)     |       7 |           16 |       +1180 / -79  |         14 (+3811)  |
| mvs                         |       1 |            1 |            +2 / -1 |           2 (+43)   |
| prism/viewer                |       9 |           55 |       +1881 / -354 |         26 (+2103)  |
| prism/ui                    |       7 |           53 |       +1048 / -425 |          12 (+643)  |
| prism/assistant, stories    |       1 |            9 |          +87 / -72 |                  0  |
| extensions/geo-export       |       1 |            1 |          +16 / -15 |           1 (+23)   |
| extensions/command-language |       1 |            1 |          +17 / -17 |                  0  |
| **Total**                   |  **64** |      **256** |                    |                     |

Most `prism/ui` and `prism/viewer` source lines are CSS modules touched by the UI scale (px to size tokens). The
specs (`.md`) these changes added are listed in the entries.

## core

- **Weak dependencies** — a transformer with `weakDependencies` has its deleted or absent dependencies waited for, not
  put in error; `apply` and `update` get the ones that have objects. Why: mesh-volume-color (a mesh's color read from a
  volume must stay when the volume is deleted; 2026-11-14 morning note). Files: `core/src/state/state.ts`,
  `core/src/state/transformer.ts`, spec `core/src/state/_spec/dependencies.md`. Commits: `f4c63ad44`, `0b4053046`.
  Tests: `core/src/state/_test/dependencies.test.ts`. Upstream: candidate. Not mixed. The progress note asks Ludo
  whether it goes here or in a master lane.
- **`Ray3D.intersectTriangle`** — Moller-Trumbore, either side, barycentric weights and distance. Why: picking a
  triangle of a mesh (mesh-measure). Files: `core/src/math/geometry/primitives/ray3d.ts`. Commit: `ae323fe5a`. Tests:
  `core/src/math/geometry/_test/ray3d.test.ts`. Upstream: candidate. Not mixed.
- **`Color.linearToSRGBNormalized`** — the float sRGB conversion the glTF vertex-color bake had a copy of. Why: the
  glTF reader (cryoet-portal GLB). Files: `core/src/util/color/color.ts`. Commit: `520033cc1`. Tests: through the glTF
  tests (`io/src/reader/_test/gltf.test.ts`). Upstream: candidate. Not mixed.
- **`fetchData` HTTP errors tell their status** (`DownloadStatusError`) — why: the CryoET Data Portal and OME-Zarr
  reads must tell a 404 from a network failure (stated in the zarr store's use of it). Files:
  `core/src/util/data-source.ts`. Commit: `3b6b18021`. Tests: `core/src/util/_test/data-source.test.ts`. Upstream:
  candidate. Not mixed.

## model

- **Triangles in `ShapeGroup.Loci`** — a loci of a mesh shape may hold triangles: equality, bounds (`getTriangleBoundingSphere`)
  and a label by triangle ("Triangle 12"). Why: measurements on meshes, per triangle (mesh-measure). Files:
  `model/src/model/shape/shape.ts`, `model/src/model/loci.ts`, `model/src/model/label.ts`. Commit: `ebe4913d0`. Tests:
  `model/src/model/_test/shape-triangle.test.ts`. Upstream: candidate. Not mixed.
- **cellPACK entity descriptions** — an entity's description from `_entity.pdbx_parent_entity_id`, none from a
  compartment path; a particle's hover label shows it (two lines, Markdown links as text). Why: the descriptions lane
  (2026-11-04). Files: `model/src/formats/particles/mmcif.ts`, `model/src/model/label.ts`,
  `model/src/model/particles/particle-list.ts`. Commits: `dac4930de`, `43de664ef`, `78c0b8514`. Tests:
  `model/src/formats/particles/_test/mmcif.test.ts`. Upstream: candidate. Not mixed.
- **Particle list queries and bounds** — select by entity or target through cached groups; target ids from an
  attribute; the list's bounding sphere fills the given sphere; `Particle.selectLoci` merges sets in pairs (night
  review A7, quadratic before); sites targets for colors by zoom on mmCIF particles. Why: layers by entity or
  compartment on a particle representation; the night review. Files: `model/src/model/particles/particle-list.ts`,
  `model/src/formats/particles/mmcif.ts`. Commits: `7bd52c7fb`, `71e72db42`, `01234d2cd`, `15acd8278`, `d48629cd9`.
  Tests: `model/src/model/particles/_test/particle-list.test.ts`, `model/src/formats/particles/_test/mmcif.test.ts`.
  Upstream: candidate. Mixed: `15acd8278` (adds `apps/prism-me/src/explorer/_test/loci.scaling.ts`).
- **OME-Zarr volume** — `volumeFromOmeZarr`: a level of an OME-Zarr as a `Volume`; stats over finite voxels, sigma as
  standard deviation. Why: the CryoET Data Portal tomograms (cryoet-portal, ome-zarr lane). Files:
  `model/src/formats/volume/ome-zarr.ts`. Commits: `061b7a006`, `e4fbbfbc9`. Tests:
  `model/src/formats/volume/_test/ome-zarr.test.ts`. Upstream: candidate. Not mixed.
- **`binGrid`** — a grid binned by block means (voxels at the blocks' centers in Å, its stats, periodic only when the
  blocks tile its sides). Why: an MRC's Level in the Data section (data-controls, cryoet-level). Files:
  `model/src/model/volume/bin.ts`. Commits: `f1638aa25`, `fa5a295e3`, `c087547e6`. Tests:
  `model/src/model/volume/_test/bin.test.ts`. Upstream: candidate. Not mixed.
- **Volume cell size without the origin** — `cellSize` replaces three copies; a slice of a periodic volume keeps the
  grid's origin. Why: the volume-periodic-origin changelog (written with the "v6 graphics" slice commits). Files:
  `model/src/model/volume/volume.ts`. Commit: `5affa6d17`. Tests: `model/src/model/volume/_test/periodic.test.ts`.
  Upstream: candidate. Not mixed.

## io

- **glTF 2.0 reader** — GLB and `.gltf` with data URIs, baked into an OBJ-shaped mesh (grouped by primitive and name,
  vertex colors clamped, in 8-bit steps); indices and data URIs are checked. Why: the portal's segmentation GLBs
  (glb-reader lane). Files: `io/src/reader/gltf/parser.ts`, `schema.ts`, `to-obj.ts`, spec `io/_spec/gltf.md`.
  Commits: `fc16e17e8`, `1c3e65b8b`, `285243046`, `d74f2f1e5`, `d497b6dec`, `1d80e9a06`. Tests:
  `io/src/reader/_test/gltf.test.ts`, `gltf.scaling.ts` (`pnpm test:scaling` in io, config
  `io/vitest.scaling.config.ts`). Upstream: candidate. Not mixed.
- **Zarr v2 and OME-NGFF 0.4 reader** — store, array (chunks, filters, orders), metadata, OME multiscale. Chunks are
  untrusted: zlib checked, block sizes bounded, errors name the chunk. Why: OME-Zarr tomograms (ome-zarr lane).
  Files: `io/src/reader/zarr/{array,metadata,ome-zarr,store}.ts`, spec `io/src/reader/zarr/_spec/zarr.md`. Commits:
  `0114533ed`, `e37be1f59`. Tests: `io/src/reader/zarr/_test/zarr.test.ts` and about 150 fixture files (`_test/fixtures/`).
  Upstream: candidate. Not mixed.
- **Blosc1 and LZ4 decoders in TypeScript** — for Zarr chunks (no WASM). Files: `io/src/reader/zarr/blosc.ts`,
  `lz4.ts`. Commit: `be4d1b471`. Tests: `io/src/reader/zarr/_test/blosc.test.ts`, bench `bench-blosc.mjs`. Why: Zarr chunks (ome-zarr lane); no note on the
  TypeScript decoder. Upstream: candidate. Not mixed.
- **CCP4/MRC modes 6 and 12, and more file names** — MODE 6 and 12 read; `.rec`, `.st`, `.ali`, `.mrcs` open as
  CCP4/MRC. Why: cryo-ET tomograms (the app's decisions, 2026-10-18). Files: `io/src/reader/ccp4/parser.ts`; the
  names are in the plugin entry. Commits: `33dbca0c5`, `59ef5aa38`. Tests: `io/src/reader/_test/ccp4.test.ts`.
  Upstream: candidate. Not mixed.
- **CryoET Data Portal `instancePoint` records** — read, `instance_id` kept as a particle attribute (none when
  absent); rotation convention tested (`xyz_rotation_matrix` as given). Files: `io/src/reader/cryoet/ndjson.ts`,
  `model/src/formats/particles/ndjson.ts`. Commits: `81ef4f42d`, `aff43fea1`, `a5cc35519`. Tests:
  `io/src/reader/_test/cryoet-ndjson.test.ts`, `model/src/formats/particles/_test/ndjson.test.ts`. Upstream:
  needs work (a portal-specific format; a general ndjson reader would first need agreement). Not mixed.

## graphics

- **Color levels** — colors by size on screen: far a particle by compartment or entity, closer by chain, closest by
  atom; blended in the shader (`ColorLevels`, sphere and mesh programs on WebGL2 and WebGPU, far colors from
  `particle-hierarchy`, edges 0.27, 2.2, 28.8 px). Why: "colors that follow the zoom" (dynamic-color, Ludo 2026-10-30),
  plan `.v6/plans/gl/color-levels.md`. Files: `graphics/src/geo/geometry/color-levels.ts`, `gl/webgl/shader/chunks/color-levels.glsl.ts`,
  `gl/webgpu/shader/chunks/color-levels.wgsl.ts`, `theme/color/particle-hierarchy.ts`, `repr/particles/representation/target/*`.
  Commits: `c5934eabf`, `3383be2d3`, `b7f91b530`, `bc5a4bcd7`, `e6ff852e8`, `82fd88f90`. Tests: `geo/geometry/_test/color-levels.test.ts`,
  `gl/_test/color-levels.test.ts`, `repr/particles/_test/color-levels.test.ts`, `theme/_test/particle-colors.test.ts`.
  Upstream: candidate. Not mixed (the app default `5b67c9e70` is separate and mixed).
- **Clipping table per part, graded cuts** — a clip keeps a layer, cuts, or cuts wider per (clip, part), with a band
  in Å and a fuzziness; encoded once; WebGL1's flag reads 16 clip objects, not 8. Why: graded cuts, from the cellVIEW
  evaluation (graded-cuts lane). Files: `graphics/src/geo/geometry/clipping-data.ts`, `theme/clipping.ts`,
  `gl/webgl/shader/chunks/{common-clip,clip-instance}.glsl.ts`, `gl/webgpu/shader/chunks/clip.wgsl.ts`, `repr/visual.ts`.
  Commits: `3c0ed1d34`, `5434a0da6`, `2b6c73ccc`, `529645fe0`. Tests: `theme/_test/clipping-table.test.ts`,
  `canvas3d/_test/clip-table.test.ts`. Plan: `.v6/plans/gl/clip-culling.md`. Upstream: candidate. Not mixed.
- **Hidden instances out of the transparency averages** — hidden means 255 only per instance at a theme strength of
  1; an all-hidden member leaves a merged object's average. Why: do hidden particles cost a frame (hidden-cost,
  2026-10-29). Files: `graphics/src/geo/geometry/transparency-data.ts`, `gl/renderable/merged.ts`, `gl/draw-table.ts`,
  `gl/precompile.ts`. Commits: `528ec6ea6`, `88c31c344`, `942af991f`, `f8156c3ed`. Tests: `gl/_test/hidden-instances.test.ts`.
  Upstream: candidate. Mixed: `942af991f` (adds `apps/prism-me/scripts/hidden-cost-bench.mjs`).
- **Mesh picking by triangle, and marked triangles** — the GPU's group narrowed to a triangle on the CPU (a lookup
  graded by triangle size, counting sort, NaN triangles left out); a shape representation marks triangles itself and
  keeps them through a move. Why: measurements on meshes, per triangle (mesh-measure, 2026-10-31); plan
  `.v6/plans/gl/triangle-picking.md`. Files: `graphics/src/geo/geometry/mesh/triangle-pick.ts`, `repr/shape/triangle-marks.ts`,
  `geo/shape/shape.ts`, `canvas3d/helper/interaction-events.ts`, `repr/shape/representation.ts`. Commits: `f078afd6e`,
  `772faf324`, `8af312ac4`, `d437d8dd6`, `0d74a346b`, `104e24625`. Tests: `geo/geometry/mesh/_test/triangle-pick*.test.ts`,
  `repr/shape/_test/triangle-marks.test.ts`, `canvas3d/_test/pointer-ray.test.ts`. Upstream: candidate.
  Mixed: `0d74a346b` (adds a line in `apps/prism-me/TODO.md`).
- **Far and transparent outlines** — transparent outlines beyond 500 times the near plane kept; a far outline is kept
  when its depth packed to 0 and with fog off; an outline in front of an opaque edge stays. Why: "the ghost on
  cellpack rendering disappears at some distance" (ghost-cull, Ludo 2026-10-31). Files: `graphics/src/gl/webgl/shader/outlines.frag.ts`,
  `postprocessing.frag.ts`, `gl/webgl/shader/illumination/compose.frag.ts`, `gl/webgpu/shader/outlines.wgsl.ts`. Commits: `99d026f92`,
  `6d21b2f5f`, `0bee02d89`, `02a39773d`, `89c0974dd`. Tests: none of its own found (the ghost-cull note records Dawn
  images). Upstream: needs work (written for the removed outline ghost;
  check against master's clip ghost first). Not mixed.
- **Merged objects sync only what moved** — a merged object's sync writes the members that changed and grows its bounds;
  the GPU culler writes only members that moved; a target visual none of whose particles moved keeps its instances
  and colors; a list moved alone is one whose moves came or went. Why: "MG lags on WebGPU" dragging a particle's
  handle (fast-particle-drag, Ludo 2026-11-05). Files: `graphics/src/gl/renderable/merged.ts`, `merged-culler.ts`, `repr/merged.ts`,
  `repr/particles/representation/target/common.ts`. Commits: `b5a54dc57`, `ff4699bad`, `62d091e9e`, `bbf4ed0dc`,
  `4fc4dec5f`, `0128dfcf9`. Tests: `gl/_test/merged.test.ts`, `gl/_test/merged-culler.test.ts`,
  `repr/_test/merged.test.ts`, `repr/particles/representation/_test/moved-only.test.ts`. Upstream: candidate. Not mixed.
- **Culling by instance and cluster, grown by wiggle and tumble** — GPU culling tests each instance of a drawn cell
  and clusters of 256 spheres; CPU culling by instance on WebGL2; batches, cells and instances grown by how far the
  animations move them; positions by level of detail in Morton order. Why: "close up, framerate drops a lot"
  (instance-cull, Ludo 2026-10-31). Files: `graphics/src/gl/renderable/merged-culler.ts`, `gl/renderable.ts`,
  `gl/compute/cell-cull.ts`, `gl/webgpu/shader/cell-cull.wgsl.ts`. Commits: `21ef1ec20`, `fb5b94520`, `281260de8`,
  `9dda0fc74`, `4ac650258`, `21b19c611`, `e8fac2583`. Tests: `gl/_test/cull-view.test.ts`, `gl/_test/cull-segment.test.ts`,
  `plugin/headless/src/_test/webgpu-gpu-culling.test.ts`. Upstream: needs work (overlaps master's #2060/#2061 culling).
  Not mixed.
- **GPU occlusion and two-phase fixes** — a rectangle reaching past the pyramid's view is clamped only where nothing
  beyond can show; pyramid versions never reset; a dispatch skipped only against the build it tested; two-phase
  occlusion only with opaque objects and one camera; a frame at rest tests no Hi-Z of the moving frames. Why: found
  while testing instance-cull and after the master merge (instance-cull, merge-master notes). Files:
  `graphics/src/gl/renderable/merged-culler.ts`, `gl/webgpu/shader/cell-cull.wgsl.ts`, `canvas3d/canvas3d.ts`, `gl/renderer.ts`.
  Commits: `50cc9ba4e`, `39fe62c23`, `5bf520a54`, `fcabb7134`, `7db9ce2ad`, `bec016375`, `9cfe6151e`, `cc494440a`.
  Tests: `plugin/headless/src/_test/webgpu-two-phase-culling.test.ts`. Upstream: candidate (fixes on master's design).
  Not mixed.
- **`gpuCulling: auto` thresholds** — culls on the GPU from 10 M vertices at full detail and 30 instances; from 1 M
  spheres without the raster; particle target signatures count the spheres of structure targets. Why: WebGPU zoomed
  frames slower after the merge (webgpu-zoom-regression, no-raster-auto, 2026-11-01). Files: `graphics/src/repr/signatures.ts`,
  `geo/geometry/base.ts`, `repr/particles/representation/target/representation.ts`. Commits: `3636fff0f`, `3e77fc3a1`,
  `39103f24a`, `618b1708b`, `e69d778cf`. Tests: `repr/particles/_test/signatures.test.ts`, `gl/_test/minimum-limits.test.ts`.
  Upstream: needs work (thresholds measured on one machine; says so in the note). Not mixed.
- **GPU culling dispatched in rows** — workgroups past the device's dispatch limit go in rows. Why: a yeast slab,
  104k workgroups (cull-dispatch-rows, Ludo 2026-11-07). Files: `graphics/src/gl/compute.ts`, `gl/compute/cell-cull.ts`,
  `gl/webgpu/shader/cell-cull.wgsl.ts`. Commits: `c32efa12e`, `2d05e8bfc`, `74186acdf`. Tests: `gl/_test/webgpu-compute.test.ts` (a Dawn case with an idle workgroup). Upstream: candidate.
  Not mixed.
- **WebGPU draw lists safe against replaced resources** — a recording made before a shared draw resource was replaced
  is not replayed; data-layer pages by arithmetic past 16 layers. Why: not recorded beyond the commit messages. Files:
  `graphics/src/gl/webgpu/context.ts`, `gl/webgpu/data-layers.ts`, `gl/draw-table.ts`. Commits: `d42241bbb`,
  `8a159bd86`, `fa6437a44`, `de0a7ed3d`. Tests: `gl/_test/webgpu-data-layers.test.ts`, `plugin/headless/src/_test/webgpu-draw-lists.test.ts`.
  Upstream: candidate. Not mixed.
- **Canvas3D motion** — `motion.pixelScale` (a lower-resolution drawing buffer while the camera moves) and
  `motion.lodScale` (coarser levels of detail); no switch when the canvas does not resize; images end a motion; the
  trackball takes page coordinates against the viewport at full resolution. Why: framerate in motion (instance-cull,
  quality-motion). Files: `graphics/src/canvas3d/canvas3d.ts`, `canvas3d/controls/trackball.ts`, `gl/renderer.ts`.
  Commits: `445725f4c`, `75d672664`, `c81b63546`, `f0e0f45fa`, `333cc74f9`, `02d0e93c3`. Tests:
  `canvas3d/controls/_test/trackball-resolution.test.ts`, `gl/_test/lod-levels.test.ts`,
  `plugin/headless/src/_test/webgpu-motion-lod.test.ts`. Upstream: candidate. Not mixed.
- **Sphere skip** — a sphere the marking or transparency pass discards whole leaves before the projection (read back
  from the varyings; `dNoVertexSkip` turns it off), WebGL2 and WebGPU. Why: "you render everything at least twice"
  (Alexander, via marking-cost 2026-10-31). Files: `graphics/src/gl/webgl/shader/spheres.vert.ts`,
  `gl/webgpu/shader/spheres.wgsl.ts`. Commits: `1b1b7fe72`, `a341b7560`, `94ae9dcef`, `8782d0952`, `2b1938a67`. Tests:
  `canvas3d/_test/sphere-skip-draw.test.ts`, `plugin/headless/src/_test/webgpu-sphere-skip.test.ts`. Upstream: candidate.
  Not mixed.
- **Volumetric lighting of direct volumes, and the extinction pyramid** — `lighting: 'volumetric'`; volumes shadow
  the traced molecules and honor clip objects. Why: volume-lighting lane (2026-11-02); plan
  `.v6/plans/gl/volume-lighting.md`. Files: `graphics/src/gl/compute/volume-lighting.ts`, `gl/renderable/direct-volume.ts`,
  `gl/webgpu/shader/volume-lighting.wgsl.ts`, `direct-volume.wgsl.ts`, `canvas3d/passes/tracing.ts`. Commits:
  `2d7d5b74b`, `b93709784`, `4a1eb2b17`, `9091c7a5e`, `6f4d2a613`. Tests: `gl/_test/direct-volume.test.ts`,
  `plugin/headless/src/_test/webgpu-volume-lighting.test.ts`. Upstream: candidate. Not mixed.
- **Neural lighting of direct volumes (experimental)** — `lighting: 'neural'`: a small network in WGSL, inputs clamped
  to its training range. Why: volume-neural lane (parts B and C). Files: `graphics/src/gl/webgpu/shader/volume-neural.wgsl.ts`,
  `gl/renderable/direct-volume.ts`. Commits: `fe91569e5`, `794c0910b`, `495c7ba25`, `80dad7178`. Tests:
  `gl/_test/volume-neural.test.ts`, `plugin/headless/src/_test/webgpu-volume-neural.test.ts`. Upstream: needs work
  (experimental, WebGPU only, weights shipped with it). Not mixed.
- **WebGPU textures with mip levels** — written one level at a time by kernels. Why: the extinction pyramid.
  Files: `graphics/src/gl/webgpu/texture.ts`, `gl/texture.ts`, `gl/webgpu/compute.ts`, `gl/webgpu/shader/kernels.ts`.
  Commit: `e805da7a9`. Tests: through `gl/_test/webgpu-compute.test.ts`. Upstream: candidate. Not mixed.
- **Volume slices** — a grid slice's pixel-to-cell index computed, not a Map (a level-0 slice fast enough to drag); a
  plane slice as wide as its volume in Å. Why: fast-slice (Ludo 2026-11-04) and the "v6 graphics" slice commits.
  Files: `graphics/src/repr/volume/slice.ts`, `repr/volume/util.ts`. Commits: `d033b90d4`, `f855f1c5d`, `655ac6a2c`,
  `3b176d497`, `ea7dc5d3e`. Tests: `repr/volume/_test/slice.test.ts`. Upstream: candidate. Not mixed.
- **Wireframe visual for mesh shapes** — vtp, ply and obj meshes as a wireframe (`visuals: ['wireframe']`), through the
  plugin's shape transform and MVS's `load-shape`. Why: not recorded (commit "Shape: wireframe visual"). Files:
  `graphics/src/formats/shape/common.ts`, `obj.ts`, `ply.ts`, `vtp.ts`, `geo/geometry/lines/lines.ts`,
  `repr/shape/representation.ts`, `plugin/core/src/state/transforms/shape/representation.ts`. Commit: `38f59dd25`.
  Tests: `formats/shape/_test/common.test.ts`, `geo/geometry/_test/lines.test.ts`. Upstream: candidate. Not mixed.
- **A mesh's visuals mark only their own shape** — a hover on one mesh no longer marks another; a highlight made before
  a mesh moves still clears. Why: not recorded. Files: `graphics/src/repr/shape/representation.ts`. Commits:
  `afab24add`, `8269e9585`, `992635654`. Tests: `repr/shape/_test/representation.test.ts`. Upstream: candidate.
  Not mixed.
- **Gizmo hover cue and frame poses** — the hovered handle lights in pure yellow (the move knob stays orange);
  `poseOfFrame` and `frameOfPose`; a `VisualSet` update settles when its representation is removed meanwhile. Why:
  the handles' look (gizmos.md, 2026-10-26); the frame poses are for the cuts' and objects' handles. Files:
  `graphics/src/util/gizmo/controller.ts`, `gestures.ts`, `util/visual-set.ts`. Commits: `0e9ded806`, `4e21d0afc`,
  `956f0a404`, `6ffbdee19`, `ded144e8d`. Tests: `util/gizmo/_test/controller.test.ts`, `gestures.test.ts`,
  `util/_test/visual-set.test.ts`. Upstream: needs work (the hover color is a prism-me choice; the rest is general).
  Not mixed.
- **Target representation: layers, a transform, bounds** — layers on the particle target representation (overpaint,
  transparency, clipping, hidden targets); the representation's transform; bounds follow particles updated in place.
  Why: layers by entity, compartment or target, and a moved list (the particles registry work, 2026-10-18 to 25). Files:
  `graphics/src/repr/particles/representation/target/common.ts`, `representation.ts`; state side in the plugin entries.
  Commits: `1c3e65b8b`, `f149a9071`, `e91553839`, `90c0152a3`, `4af9a48cd`. Tests:
  `repr/particles/representation/_test/target-bounds.test.ts`, `target-frames.test.ts`. Upstream: needs work (these
  grew over merges; check what master has since). Not mixed.
- **Empty layer data is not shared** — a visual's layer data (marker, overpaint, emissive, size, substance, wiggle,
  clipping) no longer shares the empty array. Why: a bug found in graded cuts (commit message). Files:
  `graphics/src/geo/geometry/{emissive,marker,overpaint,size,substance,wiggle}-data.ts`. Commit: `c3e191f1c`. Tests:
  `geo/geometry/_test/empty-layer-data.test.ts`. Upstream: candidate. Not mixed.

- **Color grid per fragment** (mesh-volume-texture, 2026-11-14) — `ColorVolume.fragment` → define
  `dColorGridFragment`: the grid color types read in the fragment stage at the interpolated grid position (cell
  centers); palette, emissive, tracing consistent; pick, depth and marking ignore it. WebGL and WebGPU. Why: the grid
  types were read per vertex, so a triangle lost the grid's detail (Color by › Volume, Detail Texture). Files:
  `graphics/src/geo/geometry/color-data.ts`, `theme/color.ts`, `gl/renderable/schema.ts`, `gl/shader-code.ts`, GLSL
  chunks `color-{vert,frag}-params`, `assign-color-varying`, `assign-material-color`, `mesh.frag`; WGSL `varyings`,
  `material`, `output`. Commits: `67181b462`, `b7586aea9`, `0b3549fa8`, `60a381d9b`. Tests:
  `gl/_test/color-grid-fragment.test.ts`, `geo/geometry/_test/color-data.test.ts`. Upstream: needs work (a partial
  overpaint still pre-mixes the vertex color, review S6; precompile signatures do not predict the define). Not mixed.
- **A Shape's color grid** (mesh-volume-texture, 2026-11-14) — `Shape.colorGrid` (model) as data; the shape
  representation makes the texture with its graphics context (`applyMeshColorGrid`), reads it per fragment, else
  colors the vertices; reused, moved to a new context, destroyed. Why: a shape's colors were fixed to `getColor` per
  group, and a context-free getter cannot make a texture. Files: `model/src/shape/shape.ts`,
  `graphics/src/geo/geometry/mesh/color-smoothing.ts`, `repr/shape/representation.ts`. Commits: `88452e74d`,
  `ad167aa28`. Tests: `repr/shape/_test/color-grid.test.ts`. Upstream: candidate. Not mixed.
- **A 2d grid layout of one column at least** (mesh-volume-texture, 2026-11-14) — `getVolumeTexture2dLayout`:
  `columns ≥ 1`; a grid longer in x than its slices' area gave width 0 and height Infinity (a crash). Files:
  `graphics/src/repr/volume/util.ts`. Commit: `e65fa0712`. Tests: `repr/shape/_test/color-grid.test.ts` (a [305, 7, 7]
  grid). Upstream: candidate (a fix on its own). Not mixed.

## plugin

- **glTF meshes open as shapes** — format `gltf` (`.glb`, `.gltf`), listed after the shapes. Why: portal GLBs
  (glb-reader). Files: `plugin/core/src/state/formats/shape/gltf.ts`, `plugin/core/src/state/formats/shape/catalog.ts`, `state/objects.ts`,
  `default-registry.ts`. Commits: `94a14894e`, `cccfcc8fd`. Tests: `plugin/core/src/state/formats/_test/gltf-load.test.ts`,
  `format-entries.test.ts`. Upstream: candidate. Not mixed.
- **OME-Zarr volumes from a URL** — `OpenOmeZarr`, `OmeZarrFromUrl`, `VolumeFromOmeZarr`; `omeZarrLevelNeeds` (the bytes a
  level's read holds; `maxSizeMB` guard counts the decoded chunk); the default registry's data actions count three more.
  Why: OME-Zarr tomograms, a volume's Level (ome-zarr, cryoet-level). Files: `plugin/core/src/state/formats/volume/ome-zarr.ts`,
  `state/objects.ts`, `default-registry.ts`. Commits: `8d62596bf`, `1f467bf01`, `27de280b7`, `c90595657`. Tests:
  `plugin/core/src/state/formats/_test/ome-zarr.test.ts`, `plugin/core/src/_test/empty-registries.test.ts`. Upstream:
  candidate. Not mixed.
- **CCP4 volumes: names and `bin`** — `.rec`, `.st`, `.ali`, `.mrcs` as CCP4/MRC; `VolumeFromCcp4` has an optional
  `bin` (a session without it reads as before). Why: tomograms; an MRC's Level (data-controls). Files:
  `plugin/core/src/state/formats/volume/ccp4.ts`. Commits: `59ef5aa38`, `46c4bcdf2`. Tests: `plugin/core/src/state/formats/_test/format-entries.test.ts`.
  Upstream: candidate. Not mixed.
- **Layers on particle representations** — layers by entity, compartment or target (overpaint, transparency, ...),
  cuts of some particles, cuts per part as a clipping table with a layer's share shown, targets left out (`hidden`);
  the representation-state behavior handles particle representations too. Why: the mesoscale looks and clips
  (looks-owner, graded-cuts). Files: `plugin/core/src/state/transforms/particles/layers.ts`, `state/objects.ts`,
  `behavior/static/representation.ts`. Commits: `6604ae6d3`, `0e8772ffc`, `5e0144056`, `d0490334f`. Tests:
  `plugin/core/src/state/transforms/particles/_test/layers.test.ts`. Upstream: needs work (large, grew by lanes).
  Mixed: `d0490334f` (also `extensions/mesoscale/src/operations.ts`).
- **A particle list moved and turned as one** — `ParticleListTransform` (rigid body, scales positions); `ParticleListOffsets`
  for some targets' particles in their own frames, or one instance alone; a decoration inserted above them is
  followed; the input's `movedFrom` dropped. Why: moving a model, a class, a particle (stage tools' moves;
  decorate-transform, Ludo 2026-10-31). Files: `plugin/core/src/state/transforms/particles/ops.ts`, `particles-registry.ts`.
  Commits: `1dc5551f8`, `77d18fb97`, `f64938e9d`, `40ade3a89`, `a03c1c952`, `1ad0a8fb7`. Tests:
  `plugin/core/src/state/transforms/particles/_test/with-targets.test.ts`. Upstream: needs work. Mixed: `42fef76c0`
  (a particle's local handle: app and stage-tools hunks).
- **Targets that reference objects in the state** — a target is any cell; the objects listed once; update in place,
  loading only the sources that changed; a target of another particle list as a decoration source; targets by class
  and back to the file keep the particles drawn. Why: decorating a list's classes with PDB structures (cryoet
  decorations). Files: `plugin/core/src/state/helpers/particle-targets.ts`, `state/transforms/particles/ops.ts`. Commits:
  `e7d68e5c3`, `b61f61c28`, `aee093367`, `542fbec73`, `c00f33863`, `0f5db4d92`. Tests: `plugin/core/src/state/transforms/particles/_test/with-targets.test.ts`.
  Upstream: needs work. Not mixed.
- **A list's default visuals: orientations and fibers** — `Config.Particles.ShowOrientations` (off) adds a list's
  orientations as axes; a cellPACK list shows its fibers where their points have a target. Why: the yeast slab had no
  fibers (fibers-targeted, Ludo 2026-11-07). Files: `plugin/core/src/config.ts`, `state/formats/particles/provider.ts`.
  Commits: `14da88084`, `5e64b7c24`. Tests: `plugin/core/src/state/formats/particles/_test/visuals.test.ts`. Upstream:
  candidate (master has the same `hasUntargeted` guard; the note says the fix goes there on Ludo's word). Mixed:
  `00f941648` (a line in `apps/prism-me/TODO.md`).

- **VolumeTransform scale** (volume-pixel-size, 2026-11-14) — `VolumeTransform` gains `scale` (default 1, the old
  behavior): `transform × scale × grid`, the scale before the move, a centroid turn about the scaled center; a session
  without it reads 1. Why: a volume's Pixel size (Å), set when a file's header is wrong. Files:
  `plugin/core/src/state/transforms/volume/ops.ts`. Commits: `f2c910a78`, `2b79575ef` (format). Tests:
  `state/transforms/_test/volume-transform.test.ts`. Upstream: candidate. Not mixed.

## mvs

- **Wireframe in MVS shapes** — a doc line on `load-shape` that `visuals: ['wireframe']` asks for a wireframe, and tests.
  The code is in the graphics entry "Wireframe visual for mesh shapes". Files: `mvs/runtime/src/helpers/load-shape.ts`.
  Commit: `38f59dd25`. Tests: `mvs/runtime/src/_test/shape.test.ts`, `clip.test.ts`. Upstream: candidate. Not mixed.

## prism/viewer

- **A cut's preview and numbers** — `clipping.previewCut` and `endPreview` show a cut as a view's gesture changes it,
  outside the state (no history step); `boundsOf`, `cone`; the cut's gizmo follows the preview. Why: "a small icon on
  a clip's line that toggles its parameters" (clip-params, Ludo 2026-10-27). Files:
  `prism/viewer/src/features/clipping/operations.ts`, `sources/clipping/preview.ts`, `sources/clipping/cuts.ts`,
  `sources/clipping/gizmo/controller.ts`. Commits: `f8e94871a`, `9bdab464d`, `1a0da52d3`, `6fb067259`. Tests:
  `prism/viewer/src/features/clipping/_test/preview.test.ts`. Upstream: needs work (spec `prism/viewer/_spec/clipping.md`
  names the app's use). Not mixed.
- **Cuts by part and particles** — `clipping.add` with `only` (a part) and `particles`; a cut of several parts read back
  as their union; `clipping.release` of some atoms; a moved or changed cut keeps its representations' variant;
  `clipping.update ghost`. Why: graded cuts and Clips category (graded-cuts-ui, clips-category). Files:
  `prism/viewer/src/features/clipping/operations.ts`, `features/particles/operations.ts`, `sources/clipping/particles.ts`,
  `sources/clipping/kept.ts`. Commits: `2047c169c`, `858cdb13b`, `c54f0986b`, `fb98db883`, `54d49e220`, `e850926c4`.
  Tests: `prism/viewer/src/features/clipping/_test/operations.test.ts`, `features/particles/_test/cuts.scaling.ts`.
  Spec: `prism/viewer/_spec/clipping.md`, `operations.md`. Upstream: needs work. Not mixed.
- **`particles.look`, one owner of a particle representation's looks** — one operation writes a representation's Layers
  cell; patches several lists in one write, refuses a malformed patch, copies no array it did not change. Why:
  architecture §7.1 (looks-owner, 2026-10-25). Files: `prism/viewer/src/sources/particles/look.ts`,
  `features/particles/operations.ts`, `features/lazy/index.ts`. Commits: `8f86ecf94`, `91fd804cb`, `62a377ba9`,
  `42b36a7ef`, `c76c1f77f`, `9763ac72d`. Tests: `prism/viewer/src/features/particles/_test/look.test.ts`,
  `look.scaling.ts`. Upstream: unknown. Not mixed.
- **`GizmoHandles`, one host for the gizmo library's handles** — frames, placements, drags without meshes; the cuts' handles
  on it; `canvas.handles` sets the handle size only (master draws handles over the scene since #2069); the structure
  move is master's. Why: "one handle class" (gizmo-handles, Ludo 2026-10-26). Files: `prism/viewer/src/sources/gizmos/{handles,frame,placement,index}.ts`,
  `sources/move/gizmos.ts`, `features/canvas-settings/operations.ts`, `testing/gizmo-canvas.ts`. Commits: `2b25d003f`,
  `0781672d5`, `b26a1924f`, `442193716`, `f654a119a`, `b2b6f8301`. Tests: `prism/viewer/src/sources/gizmos/_test/handles.test.ts`,
  `frame.test.ts`, `handles.scaling.ts`, `look.test.ts`. Spec: `prism/viewer/_spec/gizmos.md`. Upstream: needs work
  (overlaps master's move feature). Mixed: `b2b6f8301` (two app tests); `3bbe0a15d` (`extensions/cryoet`).
- **A gesture takes one checkpoint** — at its start; applies nothing once a step was refused; the next change after a
  throw starts another gesture; `gestureSteps` exported for an extension's sliders. Why: marked "upstream candidate" in
  the commits (gesture-one-checkpoint). Files: `prism/viewer/src/sources/gesture-steps.ts`. Commits: `0df43529b`,
  `8c2fc7fea`, `6a15e0d88`, `532e2d5a6`. Tests: `prism/viewer/src/sources/_test/gesture-steps.test.ts`. Upstream:
  candidate. Not mixed.
- **The scene syncs once a state update ends** — one deferral (`syncWhenDone`); before, a single update that removed a
  volume and a particle list threw in `getDecoratorRoot`, and so did the undo of a cryoet load. Why: night review B1
  (scene-sync-undo, 2026-11-05). Files: `prism/viewer/src/sources/scene.ts`. Commits: `e308195bb`, `2c6d8915e`. Tests:
  `prism/viewer/src/sources/_test/scene.test.ts`, `scene-sync.scaling.ts`. Upstream: candidate (the tests are red on
  master). Not mixed.
- **A shape's representations under a decorator of it** — listed and focused. Why: not recorded (the review M2 in the
  commit). Files: `prism/viewer/src/sources/shapes.ts`. Commits: `10e7418de`, `cb9dca7e3`. Tests:
  `prism/viewer/src/features/shapes/_test/operations.test.ts`. Upstream: unknown. Not mixed.
- **Volume transfer: x1/2 and x2, and exports** — two buttons scale every point's opacity one step; the transfer
  function's source and view and the volume facts (`volumeStats`, `gridText`, `voxelText`) exported. Why: a volume's
  Data section and the direct-volume section (cryoet-volume integration); the buttons' reason: not recorded. Files:
  `prism/viewer/src/model/volume-transfer.ts`, `views/volume/volume-transfer.tsx`, `api/volume.ts` (new),
  `prism/viewer/package.json` exports. Commits: `a16517242`, `630b025de`, `8b7f017f1`, `a361af8e6`. Tests:
  `prism/viewer/src/sources/_test/volume-transfer.test.ts`, `views/volume/_test/volume-transfer.test.tsx`. Upstream:
  unknown. Mixed: `630b025de` (adds `apps/prism-me/src/explorer/_test/direct-volume-section.test.tsx`).
- **UI scale: its commands and row** — the scale kept in settings, commands to change it, a row in Appearance, Seq\*'s
  letters and track gutter keep their size, the waste audit budgets a press; the viewer's CSS modules take the scaled
  tokens. Why: UI scale (ui-scale, Ludo 2026-10-30). Files: `prism/viewer/src/ui/settings.tsx`, `ui/shell.tsx`,
  `sequence/sequence-control.tsx`, about 35 `*.module.css`. Commits: `fc0bac97b`, `9ed85230e`, `983c0e23f`, `3279e8e52`.
  Tests: `prism/viewer/src/ui/_test/settings-ui-scale.test.tsx`, `sequence/_test/track-gutter-unscaled.test.ts`,
  `sequence/_test/font-token.test.ts`, `ui/_test/waste.test.tsx`. Upstream: needs work (what it does not reach is in
  `prism/ui/_spec/styling.md` §6 and `prism/TODO.md`). Not mixed.

- **Volume move keeps the scale** (volume-pixel-size, 2026-11-14) — `volume.transform` and its reset change the move
  only and keep the `VolumeTransform` scale; the gizmo turns about the scaled center. Why: Pixel size. Files:
  `prism/viewer/src/api/volume.ts`, `sources/volume-transform.ts`, `sources/move/gizmos.ts`. Commits: `b2d096926`,
  `2b79575ef`. Tests: Prism viewer's volume transform tests. Upstream: candidate (with the core scale). Not mixed.

## prism/ui

- **UI scale** — the size tokens are multiplied by `--msp-ui-scale`; box sizes in px follow it; rounded tokens fall
  back where CSS has no `round()`; the rail fits its buttons at the scale; the empty canvas's mark is centred at its
  drawn size. Why: UI scale (ui-scale, Ludo 2026-10-30). Files: `prism/ui/src/shell/ui-scale.ts`, `styles/theme.css`,
  `views/shell/{rail.ts,shell-view.tsx,dock-view.tsx}`, `model/settings.ts`, `views/settings/ui-scale-row.tsx`, about 40 `*.module.css`.
  Commits: `42a3b3290`, `4a3c9df27`, `c96983034`, `674bd225c`, `69f8e663c`, `e5675c89c`. Tests:
  `prism/ui/src/shell/_test/ui-scale.test.ts`, `styles/_test/ui-scale-tokens.test.ts`, `_test/ui-scale-offsets.test.ts`,
  `views/settings/_test/ui-scale-row.test.tsx`. Spec: `prism/ui/_spec/styling.md` §6. Upstream: needs work. Not mixed.
- **`Slider` as its own component** — ParamsForm's slider extracted and exported (`Slider`, `SliderProps`). Why: for
  the extensions' own sliders (commit "prism-ui: ParamsForm's slider as its own component"). Files:
  `prism/ui/src/components/params/slider.tsx`, `params-form.tsx`, `index.ts`. Commit: `825604f94`. Tests:
  `prism/ui/src/components/params/_test/slider.test.tsx`. Upstream: candidate. Not mixed.
- **An interval without bounds is two number fields** — not a slider over 0..1; an interval set to the value it has is
  no change; the ends never cross; `NumberField` typed as text, out of `NumberControl`. Why: unbounded-interval
  (2026-11-03). Files: `prism/ui/src/components/params/extra-controls.tsx`, `params-form.tsx`. Commits: `c385a231d`,
  `55691d170`, `c4d8c144d`, `7c5815a2d`. Tests: `prism/ui/src/components/params/_test/params-inputs.test.tsx`,
  `params-watch.test.tsx`, `components/_test/accessibility.test.tsx`. Upstream: candidate. Not mixed.
- **`parseColor` in its own DOM-free module** — the extensions read colors the picker's way. Files:
  `prism/ui/src/components/color/parse-color.ts`, `color-picker.tsx`. Commit: `f0c312420`. Tests: not found (covered
  through the extensions' tests). Why: not recorded beyond the commit (the extensions read colors the picker's way). Upstream: candidate. Not mixed.
- **Type and scissors icons** — Files: `prism/ui/scripts/icons.mjs`, `components/icon/icon.ts`. Commits: `c6f878b1b`,
  `afe4c375f`. Tests: `prism/ui/src/components/icon/_test/icon.test.ts`. Why: not recorded. Upstream: prism-me only. Not mixed.
- **A choice's title is the app's tooltip** — `data-tip`, as a button's. Files: `prism/ui/src/components/choices/choices.tsx`.
  Commit: `b8962b078`. Tests: none of its own. Why: not recorded. Upstream: candidate. Not mixed.
- **A virtual list re-places its rows on any measured difference** — Files: `prism/ui/src/components/virtual-list/virtual-list.tsx`,
  `recycled-list.tsx`. Commit: `2f27cfe08`. Tests: `prism/ui/src/components/virtual-list/_test/virtual-list.test.tsx`.
  Why: not recorded (committed in the UI scale series). Upstream: candidate. Not mixed.

## prism/assistant, prism/stories

- **CSS modules regenerated from the scaled CSS** — the assistant's inspector, limits, agent turn, AI setup, history
  and the story tab take the UI scale's tokens. Why: UI scale (commit `1b1e7ffa0`). Files:
  `prism/assistant/src/inspector/*.module.css`, `views/*.module.css`, `prism/stories/src/views/story-tab.module.css`.
  Tests: none. Upstream: needs work (with the UI scale). Not mixed.

## extensions

- **geo-export: the GLB writer takes its glTF constants from io's reader** — Why: one copy of the glTF constants
  (commit `9793ba362`). Files: `extensions/geo-export/src/glb-exporter.ts`. Tests: `extensions/geo-export/src/_test/prism-viewer.test.ts`.
  Upstream: candidate (with the glTF reader). Not mixed.
- **command-language: console CSS on the UI scale's tokens** — Files: `extensions/command-language/src/prism-viewer/console.module.css`.
  Why: UI scale. Commit: `4a3c9df27`. Tests: none. Upstream: needs work (with the UI scale). Not mixed.

## Open

- `prism/TODO.md` and the `.md` specs under `prism/*/_spec`, `core/src/state/_spec`, `io/_spec`, `model/_spec` (formats.md)
  are docs the lanes added; they are not entries. `prism/viewer/_spec/parity.md` changed too.
- Package export maps in `graphics/package.json`, `io/package.json`, `plugin/core/package.json` hide `_test/` folders
  (`null`) and `io` has a `test:scaling` script; `prism/viewer/package.json` adds exports for the gizmo host, volume
  transfer, gesture steps and the test canvas. Not classified (housekeeping that goes with the entries above).
- The `.v6/changelogs/*.md` and `.v6/plans/gl/*.md` files the lanes added are also outside `packages`; they are the
  upstream-style notes for the graphics entries.
- Commits titled "v6 graphics", "v6 prism" and "Particles:" were written in master's style; whether any was sent
  upstream is not recorded. Check against master before cherry-picking.
- The `why` of the wireframe visual, the shape-representations-under-a-decorator fix, the x1/2 and x2 buttons, the
  type and scissors icons, the mesh-marks fix and the WebGPU draw-list fix is not recorded in a note.
- `graphics` entry "Target representation" and the plugin entries on layers, the list transform and targets grew over
  many master merges (`50ff64bcb`, `e5b10d9bd`, `f0a63ca45`, `a3eab8dcc`); a cherry-pick needs a diff against current master.
- Color smoothing's vertex-stage grid lookup reads half a cell off in x and y against its CPU twin
  (`getTrilinearlyInterpolated`); seen by mesh-volume-texture, not changed: needs work, a lane of its own.
- `gl/_test/backend-neutral.test.ts` fails on prism-me: it takes `ctx.extensions.ensureFor` in
  `extensions/mesoscale/src/operations.ts` for a WebGL extension call (a false match); to fix in the test's pattern.
- Stage-tools `volumeMatrixOf` and the portal's `volumeMatrix` ignore a centroid-centered `components` turn (seen by
  volume-pixel-size's review, N6; older than it).
