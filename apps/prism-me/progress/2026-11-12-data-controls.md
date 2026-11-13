# Lane `data-controls`: a VTP's Color by, an MRC's Level slider (2026-11-12)

Ludo, 2026-11-12: "When dropping a MRC, in the data properties I dont see the resolution slider (to bin). The VTP format
doesnt have the channel color template where we can switch the cells for coloring."

Branch `me/data-controls` from `origin/me/paint` (92a52528e: prism-me, paint, paint-layer, grow). Local until Ludo
signs off; it goes back into `me/paint` (PR #64), not a branch of its own on the fork.

## What was found

- Neither was lost in a merge: neither was ever in prism-me's panels.
- **VTP.** The shape's `colorTheme` (packages/graphics/src/formats/shape/vtp.ts:134) is `attribute` (a point or cell
  array by name, a color list, a domain auto/symmetric or custom) or `uniform`; attribute by default when the file has
  arrays. Prism-me's mesh Look (`MeshControls`, packages/extensions/cryoet/src/controls.tsx:636, through `cryoet.mesh`
  at operations.ts:251) offers only one color, Surface/Wireframe/Both and Opacity. Check what `cryoet.mesh`'s color
  write does to an attribute theme (it may set `uniform` over it).
- **MRC.** The Data section's Level slider (`VolumeData`, controls.tsx:378) shows only when a volume has levels, and
  only an OME-Zarr has them (`levelViews`, operations.ts:1063; `cryoet.level`, :829 refuses "has one resolution"). Bin on
  the fly was proposed 2026-11-04 (lane `mrc-bin`, never built). Prior art: `Volume.downsample` and a `VolumeDownsample`
  decorator on `opt/direct-volume-downsample` (v5 layout, June 2026; port, don't merge).

## Brief

**What Ludo sees.**

1. **A VTP's Color by** in its Look: Uniform (the color picker as now) or an array of the file: **Array** (its point
   and cell arrays, by name, "cell: Labels", "point: Curvature"), **Colors** (a scale: viridis…), **Range** (Auto, or a
   min and max). A VTP with arrays opens on Array, as the shape does. OBJ and PLY keep Uniform only. One undo step a
   change; the color picker drags as now.
2. **An MRC's Level** in its Data section: 1×, 2×, 4× (and 8× when the grid is over 1000 voxels a side), the label as
   an OME-Zarr's ("2× · 19.9 Å · 105 MB"). The binned grid is the mean of each 2×2×2 (4×4×4…) block, built from the
   loaded grid (memory and GPU saved, not the download). The slices keep their place in Å, the gray windows and
   transfer functions their σ (as `cryoet.level` does for a Zarr). One undo step; sessions keep the level.
3. `cryoet.level` takes an MRC: `level` "1", "2", "4"… for a binned map (its levels in `dataState` as a Zarr's).

**How (the lane's design, to settle first).**

- The binned volume: a decorator transform under the volume (`VolumeBin { factor }`, as `VolumeTransform` is one), so
  every representation and `drawnGrid` (cryoet/operations.ts:906) read it; factor 1 is the volume as loaded. Or a param
  of the volume's own node. Pick the one that keeps the slices, the measure tools, the particles' Å and sessions right,
  and say why in Decided.
- Binning: a mean over full blocks, the edge's partial blocks averaged over what they hold; the cell's origin and
  voxel size scaled so a feature stays at its place in Å; stats recomputed. A pure function in `model` (volume), tested.

## Tests (each first failing)

- Bin: a known grid binned 2× gives the block means, the partial edge too; a point's position in Å is kept (a voxel's
  center maps to its block's); stats recomputed.
- `cryoet.level` on an MRC: levels 1, 2, 4 listed; a slice at z = 120 Å stays near 120 Å at 2×; the σ windows kept; one
  undo step; a session keeps the level.
- The Data section shows the Level slider for an MRC.
- `cryoet.mesh` with a color theme: Array, Colors and Range written; a uniform color does not clear an attribute theme
  the person did not change; OBJ refuses an array.
- The mesh Look shows Color by for a VTP with arrays, not for an OBJ.

## Check in the app

A tomogram MRC dropped: Data › Level, drag to 2×, the slices stay, the grid and size halve and eighth. A VTP with cell
arrays (a membrain-seg or a portal mesh): Look › Color by › Array, switch arrays and scales.

## Size

About 280 production lines: bin and its transform ~120, `cryoet.level` and `dataState` for an MRC ~60, the mesh's
color theme in `cryoet.mesh` ~30, the controls ~70.

## Model

Opus for the bin transform and the level's frames (design); Sonnet subagents for the mechanical steps.
