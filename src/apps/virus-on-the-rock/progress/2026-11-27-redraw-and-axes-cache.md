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

- `mol-canvas3d/audio-redraw.ts` `AudioRedrawTracker.next(frame)` (gate, replaces the first stateless
  `audioFrameNeedsRender` and the two prev fields in `canvas3d.ts`): holds the previous illumination, hue, wave drive,
  scope count and the 8 previous scope kinds and drives (preallocated Float32Array(8)); `canvas3d` owns one instance.
  Illumination, hue and narrowed kinds 8 and 9 render on change only; the instance wave and the narrowed motion kinds
  (their shader terms use `uTime`) render while above 0 and once on the drop to 0. A disabled route (count 1 to 0)
  counts as drive 0, so one final render. Drives compare as Float32 (`Math.fround`), so a held 0.12 is not a change.
  Spec `mol-canvas3d/_spec/audio-redraw.spec.ts`: 7 cases.
- `assembly-symmetry-axis.ts`: the cache entry stores the bare key; the applied key is `key:count:waveRadial`. Spec
  `mol-plugin-state/helpers/_spec/assembly-symmetry-axis.spec.ts` (fake plugin and structure, spy on
  `AssemblySymmetryProvider.get`): reads 2,2,2,2 before, 2,1,1,1 after; a changed symmetry and a changed order still miss.
- `_spec/core-changes.md`: both entries.

## Decided

- The decision lives in its own small file, not in `canvas3d.ts`, so a spec imports it without the canvas.
- Red runs: the first version (stateless rule) had 2 of 4 cases failing against its extracted logic, then 4 of 4. The
  gate version: the spec and a placeholder tracker with the stateless rule in one commit (4 of 7 fail: held
  illumination, narrowed illumination, narrowed motion, wave), then the tracker; the same 4 fail again against the
  placeholder with the final spec (the first spec shared its scope arrays between frames, fixed with the tracker).
  The red commit is not green by itself; the next commit makes it so.
- coordinator, gate: render on change only for glow and hue (global and kinds 8, 9); a held value (floor above 0, or a
  stuck denormal) does not render, since the glow and hue shader terms have no time term. This overrides the brief's
  "or is above 0", which broke "a frame at rest does nothing". The wave and narrowed motion keep "while above 0" plus
  one final render on the drop (`uTime` terms).

## Testing

`data-local/tests/clicksync.mjs` not run: it reads manager drives, which this lane does not change.

## Review (gate: reviewer + skeptic, Opus)

| # | Finding | Reviewer | Skeptic | Commit / outcome |
|---|---|---|---|---|
| 1 | `> 0` redraws forever (released drive sticks at a denormal; a floor holds it) | must-fix | confirmed (37 500/37 500 frames rendered over 600 s), should-fix: brief-mandated, masked by `hasAnimation` in VotR | e64d9e2c6 (red 62380fb40): glow and hue render on change only |
| 2 | prev-value wiring untested | should-fix | confirmed (a reorder passes lint and jest), should-fix (low) | e64d9e2c6: state moved into the tested `AudioRedrawTracker` |
| 3 | narrowed glow/hue get no final render (count 1→0) | should-fix | confirmed (predates), should-fix (low) | e64d9e2c6 |
| 4 | clicksync not re-run | should-fix | letter confirmed, substance refuted (it reads drives, unchanged): nit | Testing line |
| 5 | dead `mockClear` | nit | confirmed | 5c3b67dc9 |
| 6 | red-commit note wrong | nit | refuted (2 of 4 replayed red); wording nit | 1b49db34c |
| 7 | redundant count in the applied key | nit | confirmed, brief-mandated | dropped |
| 8 | NaN forces a render | nit | not reachable (router guard) | dropped |
| N1 | `!==` clause and spec name overstate | — | skeptic, nit | gone with e64d9e2c6 |
| N2 | core-changes entry omits the masking and issue 11 | — | skeptic, nit | 1b49db34c |

Gate: reviewer and skeptic (Opus), fix step (Sonnet); verdicts as written by them (coordinator, from their reports).

## Learned

- First sync reads the provider twice (cache key, then `getStructureAssemblyAxes`); later syncs once (the key needs
  the symmetry object's identity each time).

## Size

Production: `audio-redraw.ts` ~55 lines plus ~3 in `canvas3d.ts` and ~4 in `assembly-symmetry-axis.ts` (brief: ~20; the tracker's per-route state took the room); specs ~130 lines.

## Checks

`npm run lint` 0 errors (2 warnings, not mine); `npx tsc --noEmit -p tsconfig.json` clean; jest (votr, mol-plugin-state,
mol-repr/structure, mol-canvas3d) 14 suites, 86 tests pass; `build.mjs -a virus-on-the-rock --prd` done.
