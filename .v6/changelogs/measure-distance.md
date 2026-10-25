## prism-me: Stage tools

- Measure a distance in the explorer, in selection mode: two ⌘+clicks on a Mac, two Ctrl+clicks elsewhere (atoms,
  residues, chains, instances at the pick granularity; particles; a volume's voxel, or its center at a coarse
  granularity). Modifier clicks select as plain ones do; the first point is said on the status line; Esc, a plain click
  or leaving selection mode lets it go. The distance is drawn by Mol*'s distance representation, sized to what it
  measures, and listed under its first point's row with its eye, a right-click menu (focus, hide, remove) and its
  properties (its points, text size, line width, opacity). It is removed with either object.
- `stage.distance` (a point as a pick, a structure target or `<list ref>#<index>`) and `stage.editDistance` (text size,
  line width, opacity, visibility, remove); `StageApi.distancesState()`; ⌘K commands and agent tools
  (`measure_distance`, `change_distance`).
