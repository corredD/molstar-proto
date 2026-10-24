## prism-me: Stage tools

- Measure a distance in the explorer: Ctrl+click (or ⌘+click) two points (atoms, residues, chains, instances,
  particles). The first point is marked and said on the status line; Esc or a plain click lets it go. The distance is
  drawn by Mol*'s distance representation, sized to what it measures, and listed under its first point's row with its
  eye, a right-click menu (focus, hide, remove) and its properties (its points, text size, line width, opacity). It is
  removed with either object.
- `stage.distance` (a point as a pick, a structure target or `<list ref>#<index>`) and `stage.editDistance` (text size,
  line width, opacity, visibility, remove); `StageApi.distancesState()`; ⌘K commands and agent tools
  (`measure_distance`, `change_distance`).
- Ctrl+click and ⌘+click no longer focus the camera or add to the representation's focus in prism-me.
