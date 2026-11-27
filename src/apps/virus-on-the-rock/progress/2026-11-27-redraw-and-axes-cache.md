# 2026-11-27 redraw-and-axes-cache (lane, branch votr/redraw-and-axes-cache)

## Brief (copied from 2026-11-27-overnight.md)

### `redraw-and-axes-cache` (review issues 4, 7)

- **Build:** (4) `canvas3d.setAudioFrame` forces a render when the illumination or hue drive changed or is above 0,
  and once more when it returns to 0. (7) `syncStructureAssemblyAxes`' cache stores the bare key so it hits; the
  applied key keeps the count.
- **Tests:** (7) a spy on `AssemblySymmetryProvider.get`: 2,1,1,1 reads over four syncs (2,2,2,2 today); (4) a unit
  test of the force-render decision as a pure function.
- **Size:** ~20 production lines.
