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
| b20714a90 | this file updated; `instance-cull.md`'s changelog and `features.md` trimmed to what still holds            |
| 57d232309 | review A2: the CPU allowance computed once per cull from the 8 cells it reads, passed to `cullSegment`     |
| 36c1ec694 | review A1, N2: a still frame culls again where the allowance changed (animation cells in the cull keys)    |
| 8430deb97 | review N1: the CPU's clip classes of batches and cells with the allowance, as the GPU kernel               |
| 992635654 | review B1: `ShapeMultiRepresentation.getSignatures` (vtp, ply, obj prepared by `prepareRepresentation`)    |
| ac0960a7e | review B4: one `prepareCommitted` for both layers, releasing the prepared objects                          |
| 36b8ad7b5 | the two new tests formatted (biome)                                                                        |
| cc494440a | review B2: the frame at rest after a motion clears the Hi-Z levels where no second phase tests its own     |
| b00e86593 | review B3: the allowance in `merged-render-objects.md`, the ghost exception in `clip-culling.md`           |
| 7a4ca1a46 | review B5: the clipping table with the layer and clip objects in the shader variants' define axes          |
| 6d1833f2d | review B5: images left out in the pixel variant only (the instance variant links)                          |
| (next)    | this file: the review                                                                                      |

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
  flag resolved onto `vMarkerClipping.y`. (Review correction: the renames are WGSL's; master's GLSL keeps `vClipping`,
  which images read unwritten, an open bug of master's below.)
- **The raster's resolve**: color levels read `out.vModelPosition` after the layers: moved before (82fd88f90).

## Review

The gate on the merge (an Opus reviewer, then a skeptic re-running or re-reading each finding). Fixed: a test failing
first on the code before (where testable), then the fix, a commit each.

| Finding                                                                                                                                                                                                               | Verdict (skeptic)                                                     | Commit / open                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 (must-fix): the CPU still-frame cull cache ignores the animation (`getCullCells` without its cells; a merged object keyed on `cullVersion` alone): an amplitude 0 → 5 with the camera still kept the slack-0 lists | confirmed (probe `cache.test.ts`)                                     | 36c1ec694 (`cull-view.test.ts`: a renderable and a merged object cull again, no cache hit, after an amplitude or tumble change)                                                    |
| A2: the slack recomputed per `cullSegment` per member from 155-key spread values objects                                                                                                                              | confirmed                                                             | 57d232309 (behaviour unchanged: 21b19c611's wiggle test passes, only how the slack is given changed)                                                                               |
| A3: the GPU culler's per-dispatch member loop (`getAnimationSlack(values, members)`, ~1.9 ms / 20k members)                                                                                                           | confirmed, pre-existing                                               | open: the culler lanes (`merged-culler.ts`, not touched here)                                                                                                                      |
| A4: `DrawFact.Ghost` collides with `ClipCull`                                                                                                                                                                         | refuted by mutation (`Ghost = 1 << 24` fails two `clip-ghosts` tests) | -                                                                                                                                                                                  |
| A5: the slack is not scaled by an instance's scale                                                                                                                                                                    | partly confirmed, pre-existing                                        | open                                                                                                                                                                               |
| A6: no allowance on whole-object tests (`cullObject`, gridless segments)                                                                                                                                              | confirmed, pre-existing                                               | open                                                                                                                                                                               |
| N1: the CPU classifies the grid's spheres against clip objects without the slack (`getGridClipClasses`), the GPU kernel with it                                                                                       | confirmed by reading                                                  | 8430deb97 (`cull-segment.test.ts`: a plane's cells within the wiggle of it drawn as the reference with the slack)                                                                  |
| N2: a member's wiggle (`dWiggle`, `uWiggleStrength`) changed without `cullVersion` moving (`sync`)                                                                                                                    | confirmed by reading                                                  | 36c1ec694 (the merged case of the same test, synced through `merged.sync()` alone as `repr/merged.ts` does)                                                                        |
| B1: `ShapeMultiRepresentation` without `getSignatures`: vtp, ply, obj (wireframe) shapes not prepared                                                                                                                 | confirmed                                                             | 992635654 (`repr/shape/_test/representation.test.ts`)                                                                                                                              |
| B2: with Hi-Z, no second phase and `motion.lodScale` > 1, the frame at rest tests a pyramid of the coarse moving frames and nothing draws again                                                                       | plausible                                                             | cc494440a (`webgpu-motion-lod.test.ts`, Dawn: `HiZPass.clear` at rest for the CPU test and one-phase GPU culling, not with two phases; a spy on the clear, the image not compared) |
| B3: the allowance gone from `merged-render-objects.md`; the ghost exception missing from `clip-culling.md`                                                                                                            | confirmed                                                             | b00e86593                                                                                                                                                                          |
| B4: `commitScene` inlines `prepareCommitted` plus `releasePreparedObjects()`; the on-top branch without the release                                                                                                   | confirmed                                                             | ac0960a7e (no test: a move of one call; the on-top release, while a split commit of the main scene is still pending, is no earlier than master's timer release)                    |
| B5: the shader variants never compile `dClipTable` with `dClipping` and `dClipObjects` (nor its depth variant, the ghost pass's)                                                                                      | confirmed                                                             | 7a4ca1a46, 6d1833f2d (results under Checks; images in the pixel variant left out, see Open)                                                                                        |

Open (pre-existing, not of this merge's review fixes):

- **A3**: the GPU culler computes `getAnimationSlack(values, members)` per dispatch over every member (about 1.9 ms per
  frame with 20k members). For the culler lanes (`merged-culler.ts`): compute it per `sync`, or keep the members'
  largest wiggle strength there.
- **A5**: the slack is in model units of the instance: an instance scaled up wiggles further than its allowance.
- **A6**: whole objects (`cullObject`) and gridless segments (`cullSegment`'s `cellSize <= 1` path) are tested without
  the allowance, the clip class of a whole object too.
- **Images with a clipping layer and clip objects** (found by B5): `image.vert` writes no `vClipping`, which the
  fragment stage's `clipTest` reads (the flags undefined); linking that program (pixel variant, with or without the
  table) crashes the native `gl` (SIGSEGV, reproduced standalone outside vitest). Master's too (`image.vert` has no
  clipping varying there): a library fix lane from `origin/master` (assign the varying, or no `dClipping` for images).
  The shader variants leave images in the pixel variant out of the table's combinations until then (6d1833f2d).
- B2's fix costs the frame at rest its occlusion (CPU test or one-phase GPU culling): it draws unoccluded once, then
  builds its own levels.

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
- After the review fixes (57d232309..7a4ca1a46): `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`,
  `pnpm check:workspace`: pass; `pnpm format:check`: only `progress/current.md` (not this lane's, as before).
  `vitest run` of `packages/graphics` (141 files, 1680 tests), `packages/plugin` and `packages/extensions/mesoscale`
  (122 files, 692 tests, Dawn): 0 failed. The whole quick lane (`vitest run`, Dawn): 1333 files passed, 1 failed under
  the full parallel load (`webgpu-update-hold`: 4 skipped draws for 2, a timing of pipelines compiling in the
  background), which passes alone three times out of three and in the `packages/plugin` run. Mesoscale `test:scaling`:
  pass.
- Shader variants after B5 (6d1833f2d, files one after the other): every source compiles and links on WebGL (native
  `gl`) and WebGPU (Dawn), 12 tests; define axes 134 signatures on WebGL (121 before), 180 on WebGPU. A hook on the
  native `gl`'s links showed the table with the layer and clip objects, the depth variant (the ghost pass's) among them,
  for lines, mesh, points, text and texture-mesh in both clip variants; not shown for direct-volume (its defines did not
  match the hook's filter); spheres and cylinders are in no WebGL source (the native `gl` draws no impostors, before
  this lane too). The two coverage tests fail as before, the same lists: WebGL 14 programs, WebGPU the four
  sphere-raster kernels.
- **Not verified**: the sphere raster on a device that has it (the M1 has no `atomic-vec2u-min-max`: its headless tests
  skip), the app in a browser, frame times (the instance-cull tables are of #28's code), Firefox.
