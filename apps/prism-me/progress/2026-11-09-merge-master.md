# Lane merge-master (2026-11-09)

Branch `me/merge-master` from `origin/prism-me` (worktree `~/prism-me-lanes/merge-master`).

## Brief

**Asked (Ludo, 2026-11-09).** "merge master from repo that has lot of change and resolve conflict in prism-me, favor
master."

**What.** `origin/master` (= `upstream/master`, dabbf29f9, v6 #2069 "gl-gizmos-clip-ghosts-mesoscale" and #2068, #2064)
is 59 commits ahead of `origin/prism-me` (prism-me 1,375 ahead); 474 files, +24.6 k −4.2 k, mostly `packages/graphics`
(WebGPU passes, uniforms, bind groups, culling, clip objects on mesoscale, buffer reclaim), the test harness moved to a
private package `@molstar/test-harness`, deps updated.

**How (How we work: "Master comes in").** One merge commit `Merge origin/master (v6 #2069) into prism-me`. Conflicts
resolved **favoring master** (Ludo): take master's side of each conflicting hunk; keep prism-me's side only where master
has no equivalent and dropping it would remove a prism-me feature (record each such hunk, file:line and why, in this
file). Then adaptation commits of their own (one cause each): prism-me code that called APIs master changed.

**Done when.** `pnpm install`; `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm format:check`,
`pnpm check:workspace`; the quick lane of `packages/graphics`, `packages/prism`, the three extensions and
`apps/prism-me` (with Dawn where the lanes ran it); `styles:check`, `typecheck:storybook`. The app runs
(`node scripts/esbuild/app.mjs apps/prism-me --dev --port 1355`): loads a cellPACK example and a mesh, no console
errors. Gate on the adaptation commits (`git diff <merge>..HEAD`) and on the merge's conflict resolutions.

**Ludo checks.** prism-me on 1355: the explorer, a mesoscale model, clipping, gizmos (master's new overlay layers).

**Not here.** The lipid-procedural lane's graphics commits (pool, patch texture) touch the same culler as master: they
rebase on this merge after it lands. Paint stays on hold.

**Size and model.** Conflict resolution and adaptation: Opus (judgment over graphics); running checks: Sonnet.

## The merge (46aa8cae3)

63 files conflicted (61 content, 2 modify/delete), about 150 hunks; `graphics` the most (`merged-culler.ts` 14,
`canvas3d.ts` 14, `merged.ts` 8, `renderable.ts` 7). Lockfile: master's, then `pnpm install` (adds prism-me's packages).
Resolved by feature, not by marker: per file both sides' diffs since the merge base (c1b8ecb82), master's taken,
prism-me's kept only where master has no equivalent.

### Superseded by master (prism-me's dropped)

- **Ghosts** (prism-me's `Clip.Params.ghost`: the cut part outlined from a depth draw into the transparent depth;
  `Scene.hasGhosts`, `Renderer.renderDepthGhost`, `uClipObjectGhost`, `DrawFact.Ghost`, `clipping.update ghost`) →
  master's `Canvas3DParams.clipGhost` and the `clipGhost` geometry param (a tint and edges of what clip objects remove,
  culled on the GPU; Prism `clipping.settings ghost`). Remnants removed in 8242aa44e. **Look change for Ludo:** a faint
  tint and edges, not outlines; canvas-wide, not per cut.
- **On-top layer** (`Canvas3D.setOnTop`, `Helper.onTop`, `VisualSet.setOnTop`, `DrawPass.renderOnTop`,
  `Renderer.withoutOcclusion`, `GizmoLook.onTop`) → master's overlay and screen layers (gizmos always above the scene,
  `occludedAlpha`). Remnants removed in 87f8d5fd1 (graphics) and the Prism/app adaptations.
- **Hover light of gizmo handles** (pure yellow) → master's marker highlight and glow. **Look change for Ludo.**
- **structure-move** (`sources/structure-move/gizmos.ts`, `_spec/structure-move.md`) → master's `move` feature
  (`MoveGizmos`, `move.md`: structures, particle lists, shapes, volumes).
- **Clip gizmos on `GizmoHandles`** (0781672d5) → master's `ClipGizmos` on its own `GizmoController`; lost for clipping
  only: `holdFrames` on commit, mesh reuse by frame during a drag.
- **`transformHandles` `rotate`** → master's `rings` (with `roll`, `free`).
- **Dispatch rows** (`workgroupRows`, `ComputeContext.maxWorkgroupsPerDimension`; c32efa12e, 2d05e8bfc) → master's
  `getDispatchSize` over `MergedCullerLimits.maxWorkgroupsPerDimension` (74186acdf; prism-me's tests kept, on master's
  limit).
- **Compaction by copy** (the culler's compacted attributes) → master's compaction by index (`sCulledIndices`,
  `CulledData`, `dCulled`).
- **Target transform sync** (4af9a48cd `applyTransform`, e91553839 `writeTransforms`) → master's
  `TargetVisual.setTransform`/`updateTransform`. Open: for a non-element target a size change alone no longer recomputes
  its bounds (e91553839's test says whether it matters).
- **One `prepareCommitted` for both layers** (ac0960a7e) → master's `commitScene`, which releases both layers' objects.

### prism-me hunks kept (master has no equivalent)

| file                                                                    | kept                                                                                                                                                                                                                                                                                    | why                                                                                                                       |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `gl/renderable/merged-culler.ts`                                        | cells by member (`slotBases`/`slotCounts` blocks, `computeMemberCells`, `writeMemberCells`, `writeRecord`, `syncMembers`, `writeMemberData`, `segmentScale`), ported onto master's layout (typed-array split, `cellSegments`/`layoutSpheres`, `moveLayout`, ghost region, `CulledData`) | ff4699bad: a drag's preview moves one member of thousands; master's `moveLayout` covers a placement moved as a whole only |
| same                                                                    | `uAnimationSlack` (set per dispatch, in `isDispatched` and `predictRecords`)                                                                                                                                                                                                            | 9dda0fc74: wiggle and tumble allowance                                                                                    |
| same                                                                    | `setPyramid` / `uHiZClamp` (after the planes are set)                                                                                                                                                                                                                                   | 6f7305d78, 9cfe6151e: occlusion clamped at the pyramid's own view                                                         |
| same                                                                    | buffer labels kept by `ensure`                                                                                                                                                                                                                                                          | debugging; harmless                                                                                                       |
| `gl/webgpu/shader/cell-cull.wgsl.ts`                                    | `hiZClampable`, slack in `sphereLevels` (on master's `inView`), the idle workgroup's clamped `wgSegment` read                                                                                                                                                                           | the same features; 2d05e8bfc's clamp: master reads past the instances in the last row's idle workgroups                   |
| `gl/renderable.ts`                                                      | `AnimationValues`, `getAnimationCells`, `getAnimationSlack`; `cullSegment(…, isOrtho, clipGhost = false, slack = 0)`                                                                                                                                                                    | wiggle allowance on the CPU; slack after master's `clipGhost`                                                             |
| `gl/renderable/merged.ts`                                               | `growBounds` sync option, hidden members out of `transparencyAverage`, member wiggle cells, `updateMemberInstances` (ported onto master's segmented transforms: a changed member's part re-pointed and its version advanced)                                                            | b5a54dc57, 88c31c344, the wiggle allowance                                                                                |
| `gl/webgpu/compute.ts`                                                  | `TextureLevel` bindings in master's numeric bind key (level in the key)                                                                                                                                                                                                                 | e805da7a9: mip levels written by kernels                                                                                  |
| `gl/webgpu/context.ts`                                                  | draw list replay checks `getDrawResourcesVersion`                                                                                                                                                                                                                                       | d42241bbb: a replay after a shared draw resource was replaced                                                             |
| `gl/draw-table.ts`                                                      | `checkOpaque`/`checkTransparent` exported (all-hidden objects in no pass), with master's `Occludable`                                                                                                                                                                                   | 942af991f                                                                                                                 |
| `gl/_test/*`                                                            | prism-me's tests: merged (hidden members), cull-segment (wiggle, skipped by-instance cases)                                                                                                                                                                                             | the kept features                                                                                                         |
| `canvas3d/canvas3d.ts`                                                  | Canvas3D `motion` (`lodScale`, `pixelScale`, `holdMs`, `setMotionPixelScale`, the rest frame)                                                                                                                                                                                           | db7011f20, 02d0e93c3, f0e0f45fa                                                                                           |
| `gl/renderer.ts`                                                        | `setLodScale`, 30 view planes                                                                                                                                                                                                                                                           | 75d672664                                                                                                                 |
| `geo/geometry/base.ts`, `repr/merged.ts`                                | `AutoGpuCullingMinSpheres` (10M without the raster) and `resolveGpuCulling`'s fifth argument, beside master's 50k instances                                                                                                                                                             | 39103f24a: few instances of large members (PetWorld)                                                                      |
| `repr/shape/representation.ts`                                          | mesh-move retarget, triangle marks by themselves (`previewTransform` for the marks), `ShapeMultiRepresentation`                                                                                                                                                                         | 772faf324, 992635654, 8269e9585                                                                                           |
| `repr/particles/representation/target/*`                                | colorLevels, `ParticleFrames`/`setParticleFrames` (through master's `updateTransform`), `setLayers`, `unmoved`, `particlesMovedOnly`, `previewing`; spheres count for signatures (also master's `sites`)                                                                                | bbf4ed0dc, 62d091e9e, e69d778cf                                                                                           |
| `util/gizmo/controller.ts`                                              | `GizmoLook`/`GizmoAppearance`, `scale` only, on master's `#setFrame`                                                                                                                                                                                                                    | the app's handle size                                                                                                     |
| `util/gizmo/gestures.ts`                                                | `poseOfFrame`, `frameOfPose`                                                                                                                                                                                                                                                            | used by prism-viewer gizmos                                                                                               |
| `clip-instance.glsl.ts`, `clip.wgsl.ts`, `common-clip.glsl.ts`          | the clipping table (graded cuts) with master's `uObjectTransform` and ghost inversion; WebGL1 16-bit `bitwiseAnd`                                                                                                                                                                       | 3c0ed1d34                                                                                                                 |
| `prism/viewer/.../clipping/operations.ts`                               | `only`, `particles`, release of a target, `particles.look`, previews, a moved cut's variant                                                                                                                                                                                             | prism-me's clipping                                                                                                       |
| `prism/viewer/sources/clipping/gizmo/controller.ts`                     | `ClipGizmos.preview` on master's `#publish`                                                                                                                                                                                                                                             | 6fb067259                                                                                                                 |
| `prism/viewer/sources/move/gizmos.ts`                                   | a scaled placement's pose is its turn alone; scratch matrices per drag step                                                                                                                                                                                                             | 42e5f0413 (master's `placementPose` was wrong under a scale), 0579ae12e                                                   |
| `model/formats/particles/mmcif.ts`                                      | cellPACK entity description in master's per-chain loop                                                                                                                                                                                                                                  | dac4930de                                                                                                                 |
| `plugin/core/particles-registry.ts`, registries, `registry-compare.mjs` | both sides' transforms and actions (`dataActions` 52)                                                                                                                                                                                                                                   | unions                                                                                                                    |
| `CHANGELOG.md`, `biome.json`, `plugin-composition.md`, specs            | unions; specs describe the result                                                                                                                                                                                                                                                       |                                                                                                                           |

**Silent-drop check** (a script over the 85 code files both sides changed: every name prism-me declared since the merge
base, grepped in the result): 19 missing, all accounted for above: the on-top layer (`onTopReprs`, `onTopChanged`,
`layerMovesOnly`, `onTopCopy`, `onTopTarget`), the outline ghost (`ghostable`, scene's `anyFacts`), the culler's and
merged object's by-member writes rewritten on master's layout (`syncInstanceRange`, `memberKeys`, `slotSpheres`,
`writeMemberInstances`…: the same feature under new names), `writeTransforms` (master's `updateTransform`), `HoverColor`
(master's highlight).

## Adaptations (46aa8cae3..HEAD, one cause each)

- 8242aa44e graphics: prism-me's outline ghost removed (`Clip.Objects.ghost`, `Scene.hasGhosts`, the outline pass's
  ghost depth, the culling exemption, their tests).
- 87f8d5fd1 graphics: prism-me's on-top layer removed (`Helper.onTop`, `VisualSet.setOnTop` cases, `on-top.test.ts`).
- 74186acdf graphics: dispatch rows are master's (`workgroupRows`, `ComputeContext.maxWorkgroupsPerDimension` gone;
  prism-me's tests on `MergedCullerLimits`; the culler test on `CulledData`).
- 90c0152a3 graphics: a target representation's transform syncs its merged objects again (4af9a48cd's behaviour).
- 647e7c12d graphics tests: master's segmented merged transforms; the scale line off in the clipping-table tests.
- 6adfbece2, f654a119a, b2b6f8301 prism-viewer: the gizmo test canvas has what master's controller reads;
  `canvas.handles` sets the size only (`on-top.test.ts` → `look.test.ts`); `handles.scaling.ts` on `GizmoHandles` +
  `PlacementHandles` (structure-move gone). b2b6f8301 also carries the deletion of the app's two on-top tests (staged by
  mistake; 70f66168f says so).
- 3bbe0a15d cryoet: the oblique handle asks for `rings: [0, 1]`, `roll: false`, `free: false` (tilt only, as before).
- bf3f3f4ea stage-tools: `targetSphere` for master's `sites` targets too.
- c2f391f62, 70f66168f, 2bb8e11a8, ed0d374a6 prism-me: the structure handles are master's move feature; no On top
  (Position, a clip's line, the start default); Ghosts is master's canvas-wide clip ghost ("Ghosts (all clips)",
  `clipping.settings ghost`, one undo step); the switch listens to the ghost alone.
- 89c0974dd graphics: `OutlineParams.transparentColor` gone (it colored the outline ghosts; master's `api/styles.ts`
  failed prism-viewer's `typecheck:storybook`).
- 6ffbdee19 graphics: a `VisualSet` update settles when its representation is removed meanwhile (master's
  `GizmoController#front` does not await it; the prism-viewer gizmo runs had unhandled errors). A library fix: TODO.
- 0f718c390 format.

## Checks

- `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm format:check`, `pnpm check:workspace` (after
  `node scripts/workspace/assets.mjs`: the worktree had no built CSS), prism-viewer and prism-me `typecheck:storybook`
  and `styles:check`: pass (final run below).
- Quick lane,
  `packages/graphics packages/prism packages/extensions/{mesoscale,cryoet,stage-tools} apps/prism-me packages/plugin/headless`,
  WebGPU through Dawn (`NODE_PATH` the native modules of `~/prism-me-lanes/lipid-procedural`): before the gate's fixes
  4754 passed, 2 failed, 1 error; final run (on 7157723ea): 4757 passed, 1 failed (`webgpu-points`, inherited), 1 error
  (the device-listener SIGSEGV, TODO); `decorate-transform` passes.
- Inherited or not ours: `webgpu-points.test.ts` "picks a ring point" fails on master's own tree too (flaky: passed in
  the lane's full run); `webgpu-bundle-frag-depth.test.ts` fails only under the full parallel run (passes alone, here
  and on master). `webgpu-device-listener.test.ts` (master's) crashes Dawn with SIGSEGV on the lane, passes on master;
  master's test on pre-merge prism-me crashes too, so a prism-me cause: TODO.
- The app: `node scripts/esbuild/app.mjs apps/prism-me --dev --port 1355` (log `~/prism-me-lanes/dev-1355.log`), HTTP
  200 at `http://localhost:1355/apps/prism-me/build/`. Not looked at in a browser.

## Gate

Reviewer (Opus, read-only) on `git show --remerge-diff 46aa8cae3` and `46aa8cae3..6ffbdee19`; skeptic (Opus) on each
finding at 6ffbdee19.

| #    | finding                                                                                                                                                                                                                       | skeptic                                    | outcome                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| M1   | prism-me's `transformParticles`/`offsetParticles` copy `movedFrom`: `Particle.getMove` gives an identity on a decorated list, its targets keep old positions and bounds (decorate-transform "decorates a scaled list" failed) | confirmed                                  | fixed 1ad0a8fb7 (the failing test first)                |
| M2   | no changelog of the lane's own                                                                                                                                                                                                | confirmed                                  | fixed 0a7f4f9b6 (`merge-master-2069.md`)                |
| M3   | author lines lost on clip.ts, scene.ts, helper.ts                                                                                                                                                                             | refuted as must-fix (files equal master's) | put back 62d13a45e by the header rule; a nit either way |
| S4   | `syncMembers` splits each changed member twice (drag hot path)                                                                                                                                                                | confirmed                                  | fixed 0128dfcf9                                         |
| S5   | stale changelog entries (on top, outline ghosts)                                                                                                                                                                              | confirmed                                  | fixed 0a7f4f9b6                                         |
| S6   | a size-only change of a non-element target keeps its bounds                                                                                                                                                                   | plausible, nit                             | TODO (7157723ea)                                        |
| S7   | the VisualSet fix is a library fix in the lane                                                                                                                                                                                | confirmed (process)                        | kept (the lane needed it); its own lane in TODO         |
| N1   | after M1's fix, `particlesMovedOnly` counted `movedFrom` as a change: undo/redo of a drag rebuilt every target                                                                                                                | plausible                                  | fixed 4fc4dec5f (test first: `moved-only.test.ts`)      |
| nits | `ghostSphere` without slack; `moveLayout` leaves `splitGridVersions` stale; sync on an unchanged transform; scaling `moveTransformData` vs rebuild radii; Ghosts switch per clip                                              | —                                          | TODO, or left                                           |

## PR body (draft)

**What.** origin/master (dabbf29f9, v6 #2069 and #2068, #2064: overlay and screen layers for gizmos, clip ghosts,
marking performance, mesoscale loads, culled regions as instance indices, the test harness package, deps) merged into
prism-me, conflicts resolved favoring master (Ludo).

**Changes.** One merge commit (46aa8cae3, 63 conflicted files) and 22 commits after it: prism-me's code moved onto
master's APIs (handles look, move feature, `rings`, `sites` targets, clip ghost), prism-me's superseded pieces removed
(outline ghost, on-top layer, dispatch rows), and the gate's fixes. The resolutions, file by file, are in
`apps/prism-me/progress/2026-11-09-merge-master.md`.

**Notes for review.**

- Look changes: Ghosts are a faint tint and edges, canvas-wide (one switch, "Ghosts (all clips)"), not outlines per
  clip; handles are always over the scene (no On top), a hovered one glows instead of turning yellow; a particle's
  handle has master's roll circle and free turn; the oblique handle stays tilt-only.
- Kept from prism-me on master's code: cells by member in the GPU culler (a drag's preview writes the moved member
  alone), the wiggle and tumble allowance, the occlusion clamp, Canvas3D motion, the 10M-sphere `gpuCulling` floor,
  particle frames previews, the clipping table, the handle size.
- A library fix rides here (6ffbdee19, `VisualSet.update`); upstream it as its own lane.
- Open (TODO): Dawn SIGSEGV in master's device-listener test on prism-me; a size-only bounds refresh of non-element
  targets; the Ghosts switch's place.

**Testing.** tsc (build and app), lint, format, workspace, storybook typechecks, styles; the quick lane of graphics,
Prism, the three extensions, the app and headless with Dawn (inherited failures listed in the progress file). The app
serves on 1355; Ludo checks there: the explorer, a cellPACK model, a clip with Ghosts, moving a structure and a particle
by its handles, a mesh.

**Review.** The table above.
