# 2026-11-27 redraw-and-axes-cache (lane, branch votr/redraw-and-axes-cache)

## Brief (copied from 2026-11-27-overnight.md)

### `redraw-and-axes-cache` (review issues 4, 7)

- **Build:** (4) `canvas3d.setAudioFrame` forces a render when the illumination or hue drive changed or is above 0,
  and once more when it returns to 0. (7) `syncStructureAssemblyAxes`' cache stores the bare key so it hits; the
  applied key keeps the count.
- **Tests:** (7) a spy on `AssemblySymmetryProvider.get`: 2,1,1,1 reads over four syncs (2,2,2,2 today); (4) a unit
  test of the force-render decision as a pure function.
- **Size:** ~20 production lines.

## Built

- `mol-canvas3d/audio-redraw.ts` `audioFrameNeedsRender(prevIllumination, prevHue, frame)`: pure; `setAudioFrame` calls
  it and keeps the previous illumination and hue in two preallocated number fields. Spec
  `mol-canvas3d/_spec/audio-redraw.spec.ts` (failed 2 of 4 with today's logic extracted as is, then 4 of 4).
- `assembly-symmetry-axis.ts`: the cache entry stores the bare key; the applied key is `key:count:waveRadial`. Spec
  `mol-plugin-state/helpers/_spec/assembly-symmetry-axis.spec.ts` (fake plugin and structure, spy on
  `AssemblySymmetryProvider.get`): reads 2,2,2,2 before, 2,1,1,1 after; a changed symmetry and a changed order still miss.
- `_spec/core-changes.md`: both entries.

## Decided

- The decision lives in its own small file, not in `canvas3d.ts`, so a spec imports it without the canvas.
- No test-only commit chain with a red test: the redraw spec's red run is recorded here (extraction commit has the
  failing cases, the next commit fixes them).

## Learned

- First sync reads the provider twice (cache key, then `getStructureAssemblyAxes`); later syncs once (the key needs
  the symmetry object's identity each time).

## Size

Production: ~24 lines in two files plus the new 28-line `audio-redraw.ts` (brief: ~20); specs ~110 lines.

## Checks

`npm run lint` 0 errors (2 warnings, not mine); `npx tsc --noEmit -p tsconfig.json` clean; jest (votr, mol-plugin-state,
mol-repr/structure, mol-canvas3d) 14 suites, 86 tests pass; `build.mjs -a virus-on-the-rock --prd` done.
