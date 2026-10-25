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

## Review gate (reviewer and skeptic), fixed

Each fix has its own commit, with a test that failed first where one could be written:

- M1: the bindings test reads a behavior's own defaults, so it now fails without the representation focus override.
- M2: both distance tests clear the font atlas cache after the canvas stand-in.
- S3: only the line picks the row (Mol*'s text sets `pickable: false`).
- S4: a bond is a point (normalized before its row is read).
- S5: when the first point's object is removed, the next Ctrl+click is a new first point (said).
- A: the same pair again, or a failure, says so; an existing distance's row is picked.
- S6: the identity is the two points, either way round, from any row.
- S7: the undos are checked step by step.
- S8: a label or distance whose row is not there goes under its object's row.
- S9: a Ctrl+click on a label is refused. Not tested headless, because `labelAt` needs the canvas.
- S10: unmarking the first point puts back the structure selection's marks. Tested on a stand-in canvas. A particle
  selection under the point loses its mark (it has no state to put back).
- N15: a multi-particle point is measured from all its particles.
- B: a residue is named "LYS 120 (A)".
- N16: the value is stored once on the data.
- Nits: test names, an unused variable, Ctrl+click on nothing keeps the first point.

## Ludovic's decisions (2026-10-24)

1. A point follows the pick granularity (residue by default): CA 1 to CA 10 of 1CRN reads 10.67 Å by residues and 12.60
   Å at atoms. The code already did this; a test now holds it.
2. ⌘+click on a Mac, Ctrl+click elsewhere. The status line names the platform's gesture. The platform is decided once,
   on the explorer area (`ExplorerApi.mac`).
3. The gesture lives in selection mode: "This mode already let us do selection of everything in the scene. The only
   difference is that if ctrl or apple modifier is used on two click we automatically create the distance label."
   `spec.ts` is back to prism-me's (the canvas's Ctrl and ⌘ focus restored). Outside selection mode nothing measures;
   leaving it lets a first point go. Off a Mac, Mol*'s selection-mode camera bindings still answer a Ctrl+click
   (recenter on a point, reset on nothing); ⌘ on a Mac leaves the camera still.

A second review (reviewer and skeptic) of these commits: the platform flag is tested through canvas clicks and decided
once (35a43a9fa); the selection-mode test checks the pending point clears (260c49d94); ui.md §7 states the camera's
Ctrl+click effects (65f4d8f3f). Left open in TODO.md (57da93248): a hint outside selection mode, tests of the explorer's
click routing (including S9's label refusal), the particle selection's mark (S10).

Rechecked in the app (port 1344, 1CRN and cellpack-hiv1, real ⌘+clicks): outside selection mode two ⌘+clicks make
nothing; in it, 5.96 Å between PRO 5 (A) and GLY 31 (A), the status line saying "⌘+click the second point", and a
distance between two SerumAlbumin particles; text size and opacity typed in the properties, three undos.

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

## After Ludovic tried the app (2026-10-25)

"In selection mode … with ctrl or apple modifier, nothing is selected." A modifier click now selects exactly as a plain
click does: `spec.ts` adds Ctrl and ⌘ triggers to Mol*'s selection-mode click toggle (6a78743d0). The picker no longer
marks its first point itself (272b7c360), which also closes the particle-selection gap. A modifier click on a volume
selects it and says volumes are not measured yet (9284b34ea; before, it gave the generic message). Rechecked on port
1344: ⌘+clicks on two 1CRN residues select them ("2 residues", 11 atoms) and make the distance; two SerumAlbumin
particles show selected.

## Volume points (Ludovic, 2026-10-25)

The TODO brief "Measure a distance, volumes" was merged into this PR. A volume point is the voxel under the click, on an
isosurface or a slice ("emd_1181.map voxel (i, j, k)"). At Mol*'s coarse granularity (`structure`, which takes a volume
whole) it is the volume's center ("(center)"). Positions come from Mol*'s Volume spheres, and the size from the grid's
spacing. The distance depends on the volume. About 60 production lines, against the 150 to 250 estimated: the stage's
point model took particles and structures already.

Built: 264ccc3e1 (stage-tools), 4244653f0 (the explorer's picker; a modifier click selects the voxel as the others),
673a9fe30 (docs). Review (reviewer, then skeptic):

- M1, a moved volume (or an MVS-transformed one) was refused, because the representation draws a decorator's new volume:
  fixed in 591d655fa.
- S1, the voxel size was the lane's own formula: fixed in f81548e8a (Mol*'s spacing).
- M2, N1, N5 (docs): fixed in 1fa270fc9.
- S3, a Mol* bug in `Particle.getBoundingSphere` gives a wrong distance to a one-particle list. It is real and reachable
  in this PR, but it is a library fix (its own lane from master): recorded in TODO.md and left open.
- K1, a distance stays where its objects were before a later move. It predates this work and applies to structures and
  lists too: in TODO.md.
- S2 (one instance kept) and N2–N6 are not reachable from the UI: noted, S2 in TODO.md.

Checked in the app (port 1344, cellpack-hiv1, 1CRN, emd_1181.map, real ⌘+clicks in selection mode):

- On the isosurface, a voxel then ILE 34 give 72.19 Å, under emd_1181.map. The isosurface was hidden after the voxel's
  pick, because it covers 1CRN.
- On a slice, a voxel then GLY 37 give 95.43 Å, also under emd_1181.map, with the voxel and the residues selected.
- A direct volume rendering gave no volume pick anywhere on a grid of the canvas: not pickable, as Mol*'s pick pass
  shows.
