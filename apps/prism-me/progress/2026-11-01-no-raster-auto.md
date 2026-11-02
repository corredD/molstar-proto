# gpuCulling auto without the sphere raster (2026-11-01, lane `no-raster-auto`)

Branch `me/no-raster-auto` from `origin/me/merge-master` (b20714a90); PR to `me/merge-master`.

## Brief

- **Problem**: after the merge of master (#2061) only master's `gpuCulling: 'auto'` rule remains (from 20k instances
  with 30 per draw, or from 100k spheres where the device has the sphere raster, d65fc4bfd). prism-me's rule (3636fff0f:
  from 10 M vertices at full detail and 30 instances) is gone; its test is skipped in
  `packages/graphics/src/repr/_test/merged.test.ts` (`// rework:`). So on Apple M1/M2 (no `atomic-vec2u-min-max`, no
  raster) PetWorld HIV (19 objects, ~13 M spheres) is CPU-culled on WebGPU again. Coordinator's bench (M1 Pro, Chrome
  156, ms a frame at camera 1 / 0.1 / 0.02 of its distance): PetWorld WebGPU before the merge 24.8 / 21.6 / 41.9, after
  25.4 / 71.1 / 47.5.
- **Goal** (Ludo: "favor master first, rework on top if relevant, no duplication"): ONE auto rule, master's, extended for
  devices without the raster, not a second rule next to it. Measure first on the M1 (the zoom bench, PetWorld and
  CellPack, gpuCulling forced on vs off at 1 / 0.1 / 0.02), then extend master's rule by the measured condition; the
  skipped test re-enabled, adapted to the merged rule (not weakened); a test for the no-raster case failing first.
- **Item 2 of the rework list** (CPU culling by instance on WebGL2) only if the measurement shows WebGL2 needs it; the
  coordinator's bench shows WebGL2 equal or better after the merge (PetWorld 33.1 / 83.7 / 73.1 -> 29.2 / 74.1 / 50.4;
  CellPack 9.7 / 73.7 / 40.9 -> 9.0 / 68.3 / 36.2). If not needed: the numbers recorded, dropping recommended, its tests
  left skipped with a note.
- **Stays off**: the merged-culler / cell-cull kernels (lane `webgpu-zoom-regression`).
- **Done when**: PetWorld on WebGPU without the raster GPU-culled by auto where faster (numbers before/after in the PR),
  CellPack unchanged, one rule in one place, documented in `.v6/plans/gl/merged-render-objects.md` and
  `.v6/changelogs/no-raster-auto.md`; `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`,
  `pnpm format:check`, `pnpm check:workspace`, vitest for the packages touched. Size < 60 production lines.
- **Models**: benches and checks to Sonnet subagents; design to Opus. Then the review gate (lane-reviewer, lane-skeptic),
  push, PR.
