# Master into prism-me: v6 #2060, #2061 (2026-11-01, lane `merge-master`)

## Brief

- **Asked** (Ludo): "Merge master. It has to be done smart. No duplication, favor master first, and rework on top if
  relevant." upstream/master c1b8ecb82 (#2060 negative label offsets, #2061 sphere raster, two-phase culling, clip
  culling, geometry data per item, direct-volume fixes) into origin/prism-me 00da9d6c8; merge base fb8772a88; 28 files
  in conflict. #2061 supersedes most of prism-me's #28 (`2026-10-31-instance-cull.md`).
- **Branch** `me/merge-master`: the merge commit, then one commit per adaptation. No PR from this lane.

## Commits

| Commit    | What                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| cbf34d4fe | `Merge origin/master (v6 #2060, #2061) into prism-me`: the resolutions, #28's duplicates removed           |
| 128bcfff7 | clip objects with a ghosted one cull nothing (#2061's clip culling ate the ghosts)                         |
| de0a7ed3d | data layer pages by arithmetic past 16 layers (master's 4 layers + prism-me's 3 wrapped the 32-bit layout) |
| 82fd88f90 | the sphere raster with color levels (model position before the layers in the resolve), no clipping tables  |
| 9dda0fc74 | GPU culling's wiggle and tumble allowance (281260de8) on master's kernels                                  |
| 578160701 | this file, `.v6/changelogs/merge-master.md`                                                                |
| 21b19c611 | CPU culling's wiggle and tumble allowance on batches and cells (4ac650258's, on master's `cullSegment`)    |
| (next)    | this file updated; `instance-cull.md`'s changelog and `features.md` trimmed to what still holds            |

## Per conflicted file

| File                                                                                         | Decision                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gl/renderable/merged-culler.ts`                                                             | Master's whole (#28 superseded: per-instance test, two phases, pyramid versions all master's). Adapted after: ghost (128bcfff7), slack (9dda0fc74)                                                                                                                                            |
| `gl/compute/cell-cull.ts`, `webgpu/shader/cell-cull.wgsl.ts`                                 | Master's whole (#28's instance test, rect clamp, clusters, two phases dropped). Slack re-added after (9dda0fc74)                                                                                                                                                                              |
| `webgpu/shader/kernels.ts` (auto-merged)                                                     | Master's: #28's `cluster-copy`, `cluster-dispatch`, `cull-snapshot`, `cull-args-second` no longer exist                                                                                                                                                                                       |
| `gl/renderable/merged.ts`                                                                    | Master's, with color levels' merged textures (3383be2d3) and the hidden members' transparency average (88c31c344, 942af991f) re-added. #28's phase lists, CPU instance spheres and `gpuCullSettled` dropped                                                                                   |
| `gl/renderable.ts`                                                                           | Master's, with `LodView.set`'s scale (`motion.lodScale`). #28's CPU culling by instance, `growMdbData`, animation slack, the two-phase interface dropped. Ghost check in `getCullClipObjects` after (128bcfff7)                                                                               |
| `gl/renderer.ts`                                                                             | Master's two phases, raster and culling; prism-me's ghost pass, hidden checks (`checkOpaque` from the draw table), on-top `withoutOcclusion`, `setLodScale` and the draw lists' view with the LOD scales kept. #28's `prepareCullSecond`/`renderOpaqueSecond`/`gpuCullUnsettledCount` dropped |
| `canvas3d/passes/draw.ts`                                                                    | Master's `planOpaqueSecond` and raster; #28's `occlusionPyramid`, `renderOpaqueSecond`, stereo gate dropped (f3100843d covers stereo). Ghost transparent depth and on-top kept                                                                                                                |
| `canvas3d/canvas3d.ts`                                                                       | Master's Hi-Z render (stereo/XR), prepared objects (`releasePreparedObjects`, `markPreparedObjectsAdded`, `holdForUpdated`, now per layer for the on-top layer). `motion` kept without "no occlusion while moving"; #28's `buildOcclusionPyramid` and unsettled frames dropped                |
| `canvas3d/controls/trackball.ts`                                                             | Both: master's `viewport` for the pan, prism-me's `resolutionScale`                                                                                                                                                                                                                           |
| `geo/geometry/base.ts`                                                                       | Master's auto rule (d65fc4bfd) and description; the ghost uniform kept. 3636fff0f's 10 M vertex rule dropped                                                                                                                                                                                  |
| `repr/merged.ts`                                                                             | Master's raster-sphere count; prism-me's vertex count dropped; 9ec9bf2d5's sync of a kept merged object kept                                                                                                                                                                                  |
| `geo/geometry/center-group.ts`                                                               | Master's whole (Morton e8fac2583 dropped: master moved the levels' order to `lod-levels.ts`)                                                                                                                                                                                                  |
| `gl/draw-table.ts`                                                                           | Both. Master's `ClipCull` keeps bit 24, prism-me's `Ghost` moves to bit 25 (they collided). No ClipCull with a ghost after (128bcfff7)                                                                                                                                                        |
| `webgpu/shader/chunks/clip.wgsl.ts`                                                          | Master's shared core (`clip_core_wgsl`, programs and kernels); the ghost turned into accessors each side defines (`clipGhostPass`, `clipObjectGhost`: false in kernels), `clipGhostless` in `clipTest`, `clipExit` and `clipSphereClass` (class 2). Clip table kept                           |
| `webgl/shader/chunks/common-clip.glsl.ts` (auto-merged)                                      | Master's `clipSphereClass` called the old `clipInverted(shape)`: now `clipInverted(shape, i)` and class 2 where ghostless                                                                                                                                                                     |
| `webgpu/shader/chunks/varyings.wgsl.ts`                                                      | Clip table's flag written to master's `vMarkerClipping.y`                                                                                                                                                                                                                                     |
| `webgpu/shader/spheres.wgsl.ts`, `webgl/shader/spheres.vert.ts`                              | Master's `assign_lod_factor`; prism-me's model position before the varyings (color levels) and the color-levels chunk                                                                                                                                                                         |
| `webgpu/data-layers.ts`                                                                      | Master's four layers, then prism-me's three (the layout of before stays). Their two-bit layout fixed after (de0a7ed3d)                                                                                                                                                                        |
| `webgpu/context.ts`                                                                          | Master's `getSharedIndicesVersion` for recordings; prism-me's replay check (d42241bbb) kept on `getDrawResourcesVersion` = shared indices + shared textures                                                                                                                                   |
| `plugin/core/.../shape/representation.ts`                                                    | Both: prism-me's wire visual (`createShapeRepr`), master's `prepareRepresentation`                                                                                                                                                                                                            |
| `CHANGELOG.md`                                                                               | Union                                                                                                                                                                                                                                                                                         |
| `.v6/plans/gl/merged-render-objects.md`                                                      | Master's whole: prism-me's lines described #28 (dropped), the rest master already says                                                                                                                                                                                                        |
| `canvas3d/passes/hi-z.ts` (auto-merged)                                                      | Master's: #28's pyramid version and the `gpu` description were duplicates of bf755a4ce                                                                                                                                                                                                        |
| `core/util/_test/clip.test.ts`                                                               | Authors of both                                                                                                                                                                                                                                                                               |
| Tests: `cull-segment`, `gl/merged`, `repr/merged`, `webgpu-draw-lists`, `webgpu-gpu-culling` | Union of the cases. Rework tests skipped (below); `webgpu-draw-lists` keeps prism-me's and master's test of the quad indices grown while recording (they reproduce it differently)                                                                                                            |
| `geo/geometry/_test/lines.test.ts` (prism-me's)                                              | Read master's `lineData` (`LineStride`): `startBuffer`/`groupBuffer` are gone ("geometry data per item")                                                                                                                                                                                      |

## Auto-merged files both sides changed

Read against master's; each surviving prism-me hunk is an orthogonal feature (of #28 only `motion` is left):

- Ghosts (#24): `scene.ts` (`hasGhosts`), `outline.ts`, `postprocessing.ts`, `common.glsl.ts`, `common.wgsl.ts`,
  `output.wgsl.ts`, `assign-material-color.glsl.ts`, `clip.ts` (`Clip.Objects.ghost`), `schema.ts` (`uClipObjectGhost`).
- Graded cuts (#20): `clipping-data.ts`, `assign-clipping-varying.glsl.ts`, `clip-instance.glsl.ts`, `schema.ts`
  (`tClipTable`), `visual.ts`, `common-clip.glsl.ts`.
- Hidden cost (#17): the empty layers of the `*-data.ts` files, `precompile.ts`'s transparent flag, the draw table's
  checks.
- Color levels (#27): `spheres.ts`, `mesh.ts`, `texture-mesh.ts`, `renderable/{spheres,mesh,texture-mesh}.ts`,
  `assign-color-varying.glsl.ts`, `mesh.vert.ts`, `mesh.wgsl.ts`.
- On-top layer (#10): `illumination.ts`, `image.ts`, `pick.ts`, `helper.ts`.
- Shape wire visual: `shape.ts`, `provider.ts`, `lines.ts` (`Lines.fromMesh` without duplicate edges).
- Particle bounds (e91553839): `repr/particles/representation/target/*`.
- `kernels.ts` and `hi-z.ts`: master's whole (#28's kernels and pyramid versions removed in the merge commit).

## Removed as duplicates of #2061

- #28's two-phase occlusion (7db9ce2ad, bec016375, 602fe3852, 3b844c507): master's `hiZ.twoPhase`
  (`two-phase-culling.md`), also without OIT; stereo and XR gated by f3100843d.
- #28's per-instance GPU test (fb5b94520): master's `instance_copy_wgsl` tests each instance's sphere (frustum, ranges,
  levels, pyramid, clip). `webgpu-gpu-culling`'s first test with prism-me's exact count passes on it.
- #28's pyramid versions and dispatch per build (5bf520a54): master's `OcclusionPyramid.version`, `pyramidRounds`.
- #28's frames forced until occlusion settles (1a92bfdbe, `gpuCullUnsettledCount`): master's two phases are exact in the
  frame.
- `motion`'s no occlusion while moving (db7011f20): master's two phases are exact while moving.
- `gpuCulling` auto from 10 M vertices (3636fff0f, a10854af4): master's rule (d65fc4bfd); listed as rework below for
  devices without the raster.
- The WebGPU recording check on the quad indices (8a159bd86): master's `getSharedIndicesVersion` (more buffers).

## Rework list

1. **gpuCulling auto without the sphere raster** (3636fff0f, a10854af4; `repr/_test/merged.test.ts` skipped). On the M1
   (no `atomic-vec2u-min-max`) PetWorld's 19 objects of large proteins go back to CPU cells. Rebuild: a fourth argument
   besides `rasterSpheres` (vertices at full detail), checked only where the raster count is 0. Still worth it on Apple
   GPUs; measure master's per-instance test first (PetWorld HIV 0.1: 119 → 75 ms with #28's).
2. **CPU culling by instance, WebGL2** (07dbe3a12, 8c5e17359, 4ac650258; `cull-segment.test.ts`: the `it.skip.each` and
   the wiggle case). Rebuild inside master's `cullSegment` after its clip classes: cut cells' instances by
   `invariantBoundingSphere` (already in `CullValues`), `growMdbData` in `emit`. Worth it (CellPack 0.1 80 → 60 ms),
   also for PetWorld on the M1 (item 1). Its wiggle allowance per instance belongs with it (batches and cells have
   theirs again, 21b19c611; the GPU's, 9dda0fc74).
3. **A coarse level's padding in the instance test** (fb5b94520; `webgpu-gpu-culling`: "at the levels their distance
   reaches" skipped). Master tests the invariant sphere alone: level 1 drew 11 instances, prism-me 12, the image the
   same here. Rebuild: `segmentData`'s largest radius (y) times the level scale less one in `sphereLevels`' instance
   path. Upstreamable (possible pixels missing at the edges); check with an image before.
4. **Clusters per instance, meshlet culling** (21ef1ec20, 5359b9fd0, 335f17925, efbcb1d5a; `webgpu-gpu-culling`: "draws
   level 0 of large members by clusters" skipped). Rebuild: a third kernel after master's `instance-copy`, regions per
   cluster after the raster's. Worth it only where the raster is absent (the raster draws close-up spheres per pixel
   cheaply); measure on the M1 first (PetWorld 0.02: 49 → 41 ms).
5. **Morton order within each level** (e8fac2583; `center-group.test.ts` skipped, its call with a ts-expect-error). Moot
   without clusters (step 5a measured no gain alone); rebuild with them in `lod-levels.ts` (which now orders the
   per-vertex colors and sizes, 879496397), or drop.
6. **The occlusion rectangle clamped at the view's edges with the cap test** (50cc9ba4e, 39fe62c23, 0e9761df6;
   `webgpu-gpu-culling`: "also where its rectangle reaches past the view" skipped). Master leaves such spheres
   unoccluded (correct, costlier while turning: CellPack 0.1 22 → 45 ms then). Rebuild in master's `occluded()`; with
   exact two phases the cap test may be enough without the pyramid-frustum detail. Worth measuring first.
7. Superseded, not rework (skipped with a note): `webgpu-gpu-culling`'s #28 two-phase test (its API is gone; master's
   `webgpu-two-phase-culling.test.ts` covers the feature) and "one phase: a canvas draws again ... until occlusion
   tested a pyramid of its view".

## Collision checks

- **The clip frame's first column `w`** (885192691, the spectral norm): the ghost flag is `Clip.Objects.ghost` and
  `uClipObjectGhost`, the graded cuts read `tClipTable`; every reader of the frame takes `.xyz` of `frame * vec4(p, 1)`
  (GLSL `clipObjectSD`, WGSL `clipLocal`, `Clip.getSignedDistance`). No collision.
- **Ghosts and master's clip culling**: a ghost's cut part was culled before the ghost pass (`webgpu-clip-ghosts` failed
  twice). Fixed (128bcfff7). Master's vertex-stage class follows the ghost pass (`clipInverted`, `clipGhostless` → class
  2 in GLSL and WGSL, merge commit).
- **Graded cuts and clip culling**: master culls only without a clipping layer (`dClipping`), which a clipping table
  always has; the raster's pixel clip read rows as flags: no raster with a table (82fd88f90).
- **`DrawFact` bits**: master's `ClipCull` and prism-me's `Ghost` were both `1 << 24`; `Ghost` is 25.
- **Data layer pages**: 17 layers overflow the 32-bit layout (de0a7ed3d).
- **Renamed varyings** (`vMarker` → `vMarkerClipping.x`, `vClipping` → `vMarkerClipping.y`, `vTransparency`/`vEmissive`
  → `vTransparencyEmissive`, the spheres' `vRadius` → `vSphere.w`): no old name left in GLSL or WGSL; the clip table's
  flag resolved onto `vMarkerClipping.y`.
- **The raster's resolve**: color levels read `out.vModelPosition` after the layers: moved before (82fd88f90).

## Checks

- `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, the full declaration check (`check:types:full`'s script): pass.
- `pnpm lint`, `pnpm format:check`: pass. `pnpm check:workspace`: pass (after `node scripts/workspace/assets.mjs`: the
  worktree had no built CSS, `./*.css has no matching files` before).
- `vitest run` (quick lane, all packages, WebGPU through Dawn with the native `webgpu` of
  `~/prism-me-lanes/marking-cost`): on 9dda0fc74 0 failed (on the merge commit 3: the ghosts and the data pages, fixed
  by 128bcfff7 and de0a7ed3d); again after 21b19c611. `packages/extensions/mesoscale` `test:scaling` (the culler's
  scaling guard): pass.
- Shader variants (`SHADER_VARIANTS=1 vitest run tests/src/shader-variants`, master's, beb426b6c): every source compiles
  and links on WebGL (native `gl`) and WebGPU (Dawn) with no problem (12 tests); the two coverage tests fail for the
  machine: WebGPU leaves the four sphere-raster kernels uncompiled (the M1 has no `atomic-vec2u-min-max`), WebGL 14
  programs (the same list, and two more, on the merge base fb8772a88 with this `gl`).
- **Not verified**: the sphere raster on a device that has it (the M1 has no `atomic-vec2u-min-max`: its headless tests
  skip), the app in a browser, frame times (the instance-cull tables are of #28's code), Firefox.
