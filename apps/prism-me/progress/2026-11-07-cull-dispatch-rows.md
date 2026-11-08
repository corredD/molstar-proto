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
