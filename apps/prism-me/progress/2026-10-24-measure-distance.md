# Measure a distance, structures and particles (2026-10-24)

Lane `me/measure-distance` (port 1344). The brief: TODO.md's Next item "Measure a distance, structures and particles".
features.md: a new Stage tools row, Done. Spec: `_spec/ui.md` §7.

## Built

- stage-tools: `StageDistance`, a transform from the root to a `Shape.Representation3D` drawn by Mol*'s
  `DistanceRepresentation`. Its params are JSON: two points, each an object ref plus a structure bundle or a particle
  index, with its name and row key. It depends on both objects (`dependsOn`), so removing either one removes it in the
  same step. Its text and line are scaled by the larger thing measured.
- `stage.distance` (a point as a pick `{ loci }`, a structure target `A:10@CA` or `<list ref>#<index>`; "already" for
  the same pair at the same row), `stage.editDistance` (text size, line width, opacity, visible, remove),
  `distancesState()`; ⌘K commands and agent tools `measure_distance`, `change_distance`.
- `pickOf` (the stage's) resolves a pick on the root structure or on a moved one, not only via the substructure helper's
  decorator cell.
- The explorer: Ctrl+click (or ⌘+click) twice (`measure.ts`, a small model fed by the canvas clicks). The first point is
  marked in 3D, said on the status line, and its row is picked. Esc on the canvas (the plugin's key stream) or a plain
  click lets it go. The point is normalized to the selection granularity, so it matches the row the pick reveals.
- A distance row under its first point's row (`rows.ts`: labels and distances share the by-node fallback), its eye, its
  right-click (Focus, Hide, Remove), a click on its line picks it (its text is not pickable), its properties in
  `distance-properties.tsx` (points that pick their rows, text size, line width, opacity).
- `spec.ts`: the camera's Ctrl+click focus triggers and the representation focus's `clickFocusAdd` (Ctrl and ⌘) are
  dropped; a test checks that no behavior of the finalized spec answers Primary with Ctrl or ⌘.

## Decided

- A stage-tools transform, not Prism's `measure.distance`: Mol*'s measurement manager takes structure loci only and has
  no field for the row key or the size. Mol*'s `DistanceRepresentation` takes any pair of loci (particles too), so the
  drawing is Mol*'s and Prism is unchanged.
- The value is between the points' sphere centers, as Mol*'s text says it (not `Loci.getCenter`, which differs for a
  residue).
- Ctrl and ⌘ both measure (Ctrl+click on a Mac can also mean a right-click; ⌘ is the safe one there).

## Checked in the app

Playwright on the dev server (port 1344), with `?example=cellpack-hiv1` and 1CRN from `data/examples`, using real
Ctrl+mouse clicks:

- Two CA atoms give "5.96 Å" (PRO 5 to GLY 31, residue granularity) under CRAMBIN, drawn as a dashed line with its
  value. After the second click, with the pointer off, no mark is left and the structure selection is empty.
- Two SerumAlbumin particles give a distance under SerumAlbumin.
- In the properties panel (Distance unfolded), typing 3 in Text size and 50 in Opacity gives `textSize` 3 and `opacity`
  0.5. The From and To buttons pick the points' row (CRAMBIN). Three undos revert both edits and remove the distance.
- The `role="menu"` count stays at its baseline (1, before any click) after a plain click and both Ctrl+clicks: no
  context menu opened.

## Learned

- Between particles of a dense model, the line and its text are often hidden inside the model: a chord between two
  visible points of a convex surface runs behind it. Mol*'s measurements behave the same way. It is clear between
  objects at the edge.
- On a model, the line between particles is thin (its width scales with the protein, about 2 Å for an albumin, at a 1500
  Å view). Line width goes up to 10×. Ludovic may want a larger default.
- The disk filled up during the lane (another project's temp folder). Two edits made just before were lost and redone.

## Open

- A distance follows its objects' later moves only when it is re-evaluated (TODO Backlog).
- Volumes and voxels: the next brief.
