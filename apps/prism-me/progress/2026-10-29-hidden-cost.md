# Do hidden particles cost a frame? (2026-10-29, lane `hidden-cost`)

## Brief

- **Asked** (Ludo, [../TODO.md](../TODO.md) Next, "From the cellVIEW evaluation", item 6; wants it testable by
  2026-10-29): on WebGPU, CellPack MG with 90 % of the particles hidden against none hidden. If the two are close, the
  GPU cull does not skip hidden instances and a visibility table would help. **Check:** the numbers in this file; if a
  table is built, hiding most of a model makes it faster.
- **Why:** cellVIEW skips a hidden ingredient before its draw batch is built
  ([../\_spec/cellview.md](../_spec/cellview.md) §1); prism-me's hidden part is a transparency of 1 on its entities
  (`particleLayerState`, `packages/plugin/core/src/state/transforms/particles/layers.ts:111-123`), which
  [the evaluation](2026-10-28-cellview-evaluation.md) (speed idea 1) guessed is still drawn.
- **Measure:** the frame time with about 90 % of the particles hidden (the app's eye, `mesoscale.style visible:false`),
  none hidden, and the same 90 % removed (never in the list). WebGPU first, WebGL2 for comparison; several runs, a fixed
  camera, a steady state.
- **Not in scope:** building the cull change. If it is worth it, this lane says so and estimates it; Ludo decides.
- **Gate:** `pnpm format:check`. A measurement-only PR: no reviewer or skeptic; the method is written so it can be
  repeated.

## Result

**Hidden is not free. At 90 % hidden the frame is slower than with everything visible (1.5 to 2.8 times), and 8 to 13
times slower than the same 90 % removed.** The GPU cull does not look at a hidden instance; a visibility table would
help.

Frame time in ms (median of the runs' medians, lower is better). CellPack MG, 2,124,843 particles; hidden: 89.4 %
(1,899,863 particles, 571 of 572 entities); removed: the same particles, never loaded.

| Backend | Camera | None hidden (A) | 90 % hidden (B) | 90 % removed (C) | B / A | B / C |
| ------- | ------ | --------------- | --------------- | ---------------- | ----- | ----- |
| WebGPU  | whole  | 21.1            | 58.2            | 5.7              | 2.8   | 10.2  |
| WebGPU  | close  | 70.7            | 107.4           | 8.5              | 1.5   | 12.6  |
| WebGL2  | whole  | 51.4            | 75.5            | 9.1              | 1.5   | 8.3   |
| WebGL2  | close  | 84.2            | 131.6           | 9.9              | 1.6   | 13.3  |

- Runs (each the median of 100 frames): A four (before the hide, after each show, after restoring the list), B three, C
  three. Spread between runs of one arm: WebGPU whole A 20.7 to 22.4, B 57.8 to 60.3, C 5.6 to 7.6; WebGL2 whole A 50.7
  to 52.6, B 75.0 to 80.4, C 9.1 to 9.9. The first WebGPU close A run was 92.9 (a cold GPU); the later three are 67.3 to
  72.7, so the A median stands for them.
- The pipelined column (20 frames submitted, one wait: the GPU-bound frame time) says the same: WebGPU whole A 19.1, B
  56.0, C 4.4; close A 67.1, B 104.3, C 7.2; WebGL2 whole A 45.6, B 70.0, C 5.3; close A 80.4, B 128.5, C 8.7.
- Draw calls per frame (renderer stats): WebGPU 21 (A), 22 (B), 21 (C); WebGL2 13, 14, 13. The one more draw is the
  second pass below.
- **B′, to find why (WebGPU, one session, 60 frames):** the same hidden state, with the object's `transparencyAverage`
  forced to 0 so that its draw facts say "no transparency" (draws 22 to 21): whole 25.6 (A 20.9, B 55.1 in that
  session), close 46.3 (A 67.0, B 104.7). So about 30 of the 58 ms (whole) are the second, transparent draw and the
  blended passes; what is left (25.6 against 20.9) is the hidden instances still going through the vertex stage and the
  per-instance transparency fetch. B′ is a probe (the value is set in the page, not by any app path), not a fix.

## Why (file:line, at `460d197f9`)

- **A hidden entity is a transparency of 1 on its instances**: `layers.ts:117` (`!layer.visible` pushes
  `{ loci, value: 1 }`), the hidden targets at `:121-124`. The eye calls `mesoscale.style` with `visible:false`
  (`apps/prism-me/src/explorer/rows.ts:485`), which writes that layer.
- **The vertex stage does not drop a hidden instance.** The spheres' vertex stage moves an instance out of the clip
  volume only for its LOD range and for a clip (`spheres.wgsl.ts:190-201`); the instance's transparency is read for
  every instance into `vTransparency` (`varyings.wgsl.ts:234-237`) and acts only per fragment: the colour and pick paths
  (`material.wgsl.ts:94-108`), the depth outputs (`output.wgsl.ts:177-196`). An impostor quad is rasterized and its
  ray-sphere test run before the discard.
- **A partly hidden object is drawn twice and turns on the blended path.** Its draw facts: `transparencyAverage` 0.894
  is `TransparencyAny` (`draw-table.ts:174-176`); `checkOpaque` holds (only `TransparencyFull` blocks it,
  `renderer.ts:424-436`) and `checkTransparent` holds (`TransparencyAny` is a reason, `renderer.ts:426-439`), so it is
  drawn in the opaque pass and in the transparent pass; and `scene.opacityAverage < 1` (`draw-table.ts:142`,
  `scene.ts:525-531`) turns on the blended passes (`draw.ts:240`, `:389`; `renderer.ts:2030`). This is what the extra
  draw call and the 30 ms of B′ are.
- **The GPU cull never sees a hidden instance.** `cell-cull` tests whole cells (frustum, LOD, Hi-Z:
  `compute/cell-cull.ts:1-20`); `instance-copy` copies every instance of a drawn cell, its only test the cell's level
  mask (`webgpu/shader/cell-cull.wgsl.ts:132-200`, `drawn = (mask & (1u << j)) != 0u`); the packed instance data has no
  visibility (`merged.ts:88-107`, `InstanceDataVec4s = 7`). 90 % hidden instances are in the same cells as the visible
  ones, so they are copied, given a LOD and drawn. The WebGL2 numbers go the same way (it culls on the CPU, per batch
  and cell of the instance grids, `renderable.ts:474-477`).
- **Why C is fast:** fewer instances to copy and draw (224,980), and no transparency, so one pass.
- Not read nor measured: whether an object 100 % hidden (`TransparencyFull`) is skipped everywhere; it leaves the opaque
  pass (`renderer.ts:425`) but `checkTransparent` (`:439`) still holds.

## Conclusion and recommendation

Hidden is not close to removed: it costs as much as drawn or more. A visibility table is worth building, in two steps
(Ludo decides; nothing is built here):

1. **The facts (small, both backends, WebGPU and WebGL2).** Count a hidden instance (transparency 1) out of the object's
   `transparencyAverage` / `transparencyMin`, so a mostly hidden object stays in the opaque pass only. Where:
   `transparency-data.ts:39-51` (the average and the min) and `merged.ts:719-736` (the merged average), ~15 lines, plus
   a test on the draw facts. B′ says: 58 to about 26 ms (WebGPU whole); still not below A.
2. **The table in the GPU cull (WebGPU).** A bit per instance, hidden or not, read by `instance-copy`:
   - WGSL: one binding `hidden: array<u32>` and
     `drawn = drawn && (hidden[instance >> 5u] & (1u << (instance & 31u))) == 0u;` in `instance_copy_wgsl`
     (`cell-cull.wgsl.ts:132-200`), one `StorageBufferSpec('u32', 'read')` in `InstanceCopySchema`
     (`compute/cell-cull.ts`): about 6 lines.
   - Size: 1 bit per instance, 66,400 u32 = 265 KB for MG (2.1 M instances).
   - CPU: in `merged-culler.ts` `sync()` (`:300-312`), key on the version of the merged instance-granularity
     `tTransparency` (`merged.ts:159-164`); on a change set the bit where the value is 1 and write the buffer (about 2
     ms for 2.1 M instances, only on a change of the layers), then advance `dataVersion` so the cull runs again. About
     35 lines.
   - Tests: the cull's existing GPU tests in `graphics/src/gl/_test` (a hidden instance is not in the drawn lists; the
     counts and `cacheHits.cull`), about 120 lines.
   - Together about 60 source lines and 120 of tests, 1.5 to 2 days for WebGPU with the facts. The WebGL2 CPU cull lists
     need the same skip (not read in depth): about one day more. Open question: whether a hidden instance should also
     leave the marking pass (a hover on a hidden particle already finds nothing, as the pick path discards by alpha,
     `uPickingAlphaThreshold`).
   - **Expected:** B falls from 58 to near C (5.7 ms, WebGPU whole); hiding most of a model makes it faster, as the
     brief's check wants.

## Method (to repeat it)

- **Machine:** MacBook, Apple M1 Pro (16 GPU cores), macOS 26.6.1, Google Chrome 156.0.8078.73 (`channel: 'chrome'`,
  headless, args `--enable-unsafe-webgpu --enable-features=WebGPU --ignore-gpu-blocklist --use-angle=metal`), viewport
  1280 x 800 (the canvas 896 x 800, device pixel ratio 1), Playwright from the repo.
- **App:** `node scripts/esbuild/app.mjs apps/prism-me --dev --port 1355`, then
  `http://localhost:1355/apps/prism-me/build/?graphics-backend=<webgpu|webgl2>&timing-mode=1&example=cellpack-mg` (the
  backend was checked by `graphics.capabilities.backend`). No graphics mode set: the app's own at open. The example's
  file (53 MB, `d39ulgwcl2k1f0.cloudfront.net/me/cellpack/MG_1184_cellpack_atom_instances.bcif`) sends no CORS header,
  so the page's request was answered by `page.route` from a local copy with `access-control-allow-origin: *`.
- **Model:** CellPack MG, the largest cellPACK example the app lists (the PetWorld ones are not cellPACK): 2,124,843
  particles, 572 entities, 848 targets, one `spheres` render object (merged, instance grid, 4 LOD levels).
- **Which 90 %:** entities by particle count, largest first (inner membrane 373,311, outer membrane 338,329, entity 570
  with 1,159,980), then more whole entities while the hidden total stays at 90.5 % or less; all but entity 571 (224,980
  particles, 4 targets) are hidden: 89.4 %. One entity holds 55 % of the particles, so the visible 10 % is one compact
  entity, the same in B and C.
- **A (none hidden):** the example as loaded. **B (hidden):**
  `viewer.api.run('mesoscale.style', { entities: <ids>, visible: false })`, the call the eye makes; six seconds to
  settle. **C (removed):** the list transform's `asymIds` (the chains of the 4 targets of the entity kept) updated,
  which rebuilds the list and its representation without the other 1.9 M particles (count 224,980); ten seconds to
  settle; restored with `asymIds: []` (A4).
- **Order:** A, B, A, B, A, B, C, C, C, then the list restored and A again; each arm measured at both cameras.
- **Frames:** the app's animation loop stopped (`plugin.animationLoop.stop()`), then each frame
  `canvas3d.requestDraw(); canvas3d.tick(performance.now(), { isSynchronous: true }); await graphics.waitForGpuCommandsComplete()`.
  Camera fixed per run: `whole` is the camera after the load, `close` the same view with the camera a quarter of the
  distance from the target; set with `canvas3d.camera.setState(snapshot, 0)` before each measure. Steady state: 60
  frames discarded; then 100 frames timed one by one (the synchronous time: encode, submit, GPU, `performance.now()`
  around each); then 5 batches of 20 frames submitted without waiting and one wait at the end (the pipelined time).
- **GPU timing, tried and not used:** WebGPU has `timestamp-query` and `timing-mode=1` returned pass times, but headless
  Chrome on the M1 Pro reports about 11.7 ms for every pass, a trivial one included (the 14 passes of a frame sum to 163
  ms against a wall time of 21 ms). The wall time with `waitForGpuCommandsComplete` is what is reported. On a machine
  where the timestamps are right, `graphics.timer.resolve()` gives `Canvas3D.render` with its `DrawPass.render`.
- **Limits:** one machine, one model, headless, the default look and quality, 89.4 % not exactly 90 %. The scripts are
  in the lane's scratchpad, not the repo (asked in the PR whether to commit a small helper).
- **The core of the page script** (the rest is the Playwright launch, the route and the sequence above):

```js
const { v, pl, c, g } = { v: molstar.viewer, pl: molstar.viewer.plugin, c: molstar.viewer.plugin.canvas3d, g: molstar.viewer.plugin.canvas3d.graphics };
pl.animationLoop.stop();
const frame = async () => {
  c.requestDraw();
  c.tick(performance.now(), { isSynchronous: true });
  await g.waitForGpuCommandsComplete();
};
async function measure(n) {
  for (let i = 0; i < 60; i++) await frame();
  const wall = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await frame();
    wall.push(performance.now() - t0);
  }
  return wall.sort((a, b) => a - b)[n >> 1];
}
// B: await v.api.run('mesoscale.style', { entities: '0,1,570,...', visible: false });
// C: update the list transform (ms-plugin.particle-list-from-mmcif-assembly) with params { ...params, asymIds: [<chains to keep>] }
```
