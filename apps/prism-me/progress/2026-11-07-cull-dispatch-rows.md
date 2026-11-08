# Lane cull-dispatch-rows (2026-11-07)

Branch `me/cull-dispatch-rows` (from `origin/prism-me`, worktree `~/prism-me-lanes/cull-dispatch-rows`).

## Asked

Ludo loaded a 600 nm slab of the whole yeast cell (zoidpuff.github.io/yeast_cell_viewer converted to a full-atom
cellPACK BinaryCIF: 4.6M instances, 2.3M fibre points) in prism-me on WebGPU; every frame threw
`kernel 'cell-cull': 104127 × 1 × 1 workgroups exceed 65535 per dimension` (`merged-culler.ts` dispatch).

## Built

- Test first: `graphics/src/gl/_test/merged-culler.test.ts` (a fake compute context whose kernels throw past a limit, as
  WebGPU's dispatch does: red with the same error at a limit of 4) and the Dawn suite's first case run again at a limit
  of 1 a dimension (`plugin/headless/src/_test/webgpu-gpu-culling.test.ts`: with rows dispatched and the old kernels'
  `id.x`, 58 instances culled in view of 61).
- `ComputeContext.maxWorkgroupsPerDimension` (WebGPU: the device's limit), `workgroupRows` (`compute/cell-cull.ts`), the
  culler's three dispatches through it, the three kernels indexing `wid.x + wid.y * num_workgroups.x`; the copy kernel's
  workgroup segment read clamped for the idle workgroups past the last row's end.

## Decided

- From `origin/prism-me`, not master: the culler on prism-me is 341 lines past master's (#59 among them). Master has the
  same 1D dispatch (`groups(instanceCount)`): the fix is small and goes there when Ludo says.

## Checks

`npx tsc -b`, `pnpm lint`, `pnpm format:check`, `pnpm test:unit packages/graphics packages/extensions/mesoscale` (1817
passed), the WebGPU culling and raster suites on Dawn (25 passed). Not checked in the app yet (Ludo: the slab).

## Review (2026-11-08, lane-reviewer, Opus)

Must-fix 0, should-fix 0, nits 3, all fixed in 2d05e8bfc:

1. The clamped segment read for idle workgroups never ran on a GPU (limit 1 gives rows of one) → the Dawn case runs
   again at a limit of 2 with a fourth member (3 workgroups in rows of 2, one idle).
2. sphere-raster.ts computed the same rows inline → it dispatches through `workgroupRows` (rows of 65535, which its
   chunk kernel hard-codes).
3. The unit test checked only the instance copy's dispatch → every kernel's dispatch is asserted within the limit.

The reviewer could not run the quick lane in its sandbox; it was run here after the fixes: graphics quick lane 1743
passed, the WebGPU culling and raster suites on Dawn 12 + 5 passed, tsc, lint, format clean. The skeptic pass was not
run (no must- or should-fix to refute).

## PR body (draft; not opened)

`gh pr create -R corredD/molstar-proto --base prism-me --head me/cull-dispatch-rows --title "graphics: GPU culling dispatches its workgroups in rows past the device's limit" --body-file <this section>`

### What

Loading a 600 nm slab of a whole yeast cell (6.7M instances) on WebGPU threw at every frame:
`kernel 'cell-cull': 104127 × 1 × 1 workgroups exceed 65535 per dimension`. The GPU culler of a merged object dispatched
one workgroup of 64 per item along x only: 4.2M items at most.

### Changes

- `ComputeContext.maxWorkgroupsPerDimension` (WebGPU: the device's `maxComputeWorkgroupsPerDimension`).
- `workgroupRows(n, size, max)` (`compute/cell-cull.ts`): the workgroups in rows past the limit.
- The culler's three dispatches (both phases) and the sphere raster's chunk dispatch go through it.
- The three culling kernels index `wid.x + wid.y * num_workgroups.x`; the instance copy's workgroup-segment read is
  clamped for the idle workgroups past the last row's end.
- `.v6/plans/gl/merged-render-objects.md` (GPU culling) says so; changelog `.v6/changelogs/cull-dispatch-rows.md`.

### Notes for review

- Public API: `ComputeContext` gains a readonly field (one implementation, WebGPU; test fakes cast).
- A library fix made on a prism-me lane (the culler on prism-me is far past master's): master has the same 1D dispatch;
  the port waits on Ludo.

### Testing

- `merged-culler.test.ts`: a fake compute context throwing past a limit of 4, as WebGPU does: red with the reported
  error before the fix; every kernel's dispatch asserted within the limit.
- `webgpu-gpu-culling.test.ts` (Dawn): the first case again at limits 1 and 2 (a fourth member: 3 workgroups in rows of
  2, one idle): the GPU culls exactly the instances in view, the same image as the CPU culling; with the old kernels and
  rows dispatched it lost instances (58 of 61).
- `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm format:check`, `pnpm check:workspace` (after
  `node scripts/workspace/assets.mjs`: a fresh worktree has no built skins), graphics quick lane (1743 passed), the
  WebGPU culling and raster suites on Dawn.
- In the app: the slab loaded and drew (Ludo, 2026-11-07: "works well").

### Review

Lane-reviewer (Opus): 0 must-fix, 0 should-fix, 3 nits, all fixed in 2d05e8bfc (above).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
