# Lane `data-controls`: a VTP's Color by, an MRC's Level slider (2026-11-12)

Ludo, 2026-11-12: "When dropping a MRC, in the data properties I dont see the resolution slider (to bin). The VTP format
doesnt have the channel color template where we can switch the cells for coloring."

Branch `me/data-controls` from `origin/me/paint` (92a52528e: prism-me, paint, paint-layer, grow). Local until Ludo signs
off; it goes back into `me/paint` (PR #64), not a branch of its own on the fork.

## What was found

- Neither was lost in a merge: neither was ever in prism-me's panels.
- **VTP.** The shape's `colorTheme` (packages/graphics/src/formats/shape/vtp.ts:134) is `attribute` (a point or cell
  array by name, a color list, a domain auto/symmetric or custom) or `uniform`; attribute by default when the file has
  arrays. Prism-me's mesh Look (`MeshControls`, packages/extensions/cryoet/src/controls.tsx:636, through `cryoet.mesh`
  at operations.ts:251) offers only one color, Surface/Wireframe/Both and Opacity. Check what `cryoet.mesh`'s color
  write does to an attribute theme (it may set `uniform` over it).
- **MRC.** The Data section's Level slider (`VolumeData`, controls.tsx:378) shows only when a volume has levels, and
  only an OME-Zarr has them (`levelViews`, operations.ts:1063; `cryoet.level`, :829 refuses "has one resolution"). Bin
  on the fly was proposed 2026-11-04 (lane `mrc-bin`, never built). Prior art: `Volume.downsample` and a
  `VolumeDownsample` decorator on `opt/direct-volume-downsample` (v5 layout, June 2026; port, don't merge).

## Brief

**What Ludo sees.**

1. **A VTP's Color by** in its Look: Uniform (the color picker as now) or an array of the file: **Array** (its point and
   cell arrays, by name, "cell: Labels", "point: Curvature"), **Colors** (a scale: viridis…), **Range** (Auto, or a min
   and max). A VTP with arrays opens on Array, as the shape does. OBJ and PLY keep Uniform only. One undo step a change;
   the color picker drags as now.
2. **An MRC's Level** in its Data section: 1×, 2×, 4× (and 8× when the grid is over 1000 voxels a side), the label as an
   OME-Zarr's ("2× · 19.9 Å · 105 MB"). The binned grid is the mean of each 2×2×2 (4×4×4…) block, built from the loaded
   grid (memory and GPU saved, not the download). The slices keep their place in Å, the gray windows and transfer
   functions their σ (as `cryoet.level` does for a Zarr). One undo step; sessions keep the level.
3. `cryoet.level` takes an MRC: `level` "1", "2", "4"… for a binned map (its levels in `dataState` as a Zarr's).

**How (the lane's design, to settle first).**

- The binned volume: a decorator transform under the volume (`VolumeBin { factor }`, as `VolumeTransform` is one), so
  every representation and `drawnGrid` (cryoet/operations.ts:906) read it; factor 1 is the volume as loaded. Or a param
  of the volume's own node. Pick the one that keeps the slices, the measure tools, the particles' Å and sessions right,
  and say why in Decided.
- Binning: a mean over full blocks, the edge's partial blocks averaged over what they hold; the cell's origin and voxel
  size scaled so a feature stays at its place in Å; stats recomputed. A pure function in `model` (volume), tested.

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

About 280 production lines: bin and its transform ~120, `cryoet.level` and `dataState` for an MRC ~60, the mesh's color
theme in `cryoet.mesh` ~30, the controls ~70.

## Model

Opus for the bin transform and the level's frames (design); Sonnet subagents for the mechanical steps.

## Built

- `binGrid` (packages/model/src/model/volume/bin.ts): a grid binned by a factor, each voxel the mean of its block (a
  partial block at the far edge, of what it holds), Float32 whatever the map's type, one pass in memory order (strides,
  else the accessors), yielding per slow-axis slab. A side shorter than the factor is binned by its length. Voxel 0 at
  its block's center, the voxel the factor times: a spacegroup grid stays one (its fractional box moved and sized), a
  matrix grid post-multiplied. Stats recomputed; periodic only when the blocks tile the sides.
- `VolumeFromCcp4`'s optional `bin` (plugin core): the map loaded binned. A session without it reads it as before.
- `cryoet.level` on an MRC: levels "1", "2", "4" (and "8" over 1000 voxels a side; a binning listed while the longest
  side keeps 8 voxels), each its voxel and size ("2× · 20 Å · 5.2 MB": 1× its type's bytes, a binning Float32); one
  write (`bin`, each slice at its place in Å by the levels' frames), then the windows and transfer functions refit in σ
  (the OME-Zarr path's `moveSlices`, `windowsOf`, `refit`, `commitWatched`). A tilt series or an image stack (.st, .ali,
  .mrcs) has none. The Data section's Level slider needed no change: it shows an MRC's levels as a Zarr's.
- `cryoet.mesh` colors a VTP by its `colorTheme`: `color` (uniform; before, a VTP's color was a no-op: the write looked
  for `coloring`, OBJ's and PLY's), or `array` (key or name), `colorList` (a color scale), `range` (auto or [min, max]);
  a color with an array refused, an OBJ refuses an array, an unknown array lists them. Opacity, visuals and scale leave
  the theme alone; another array goes back to Auto. `cryoet.meshes` lists a mesh's arrays (each its range from the file)
  and its Color by.
- The mesh's Look: Color by (Uniform | Array), Array and Colors selects, Range (Auto | Custom, a min and max form from
  the array's range); the picker only under Uniform, keeping the mesh's last color.
- The spec (ui.md Data and Look), features.md, `.v6/changelogs/data-controls.md`, TODO.md.

## Decided

- The binned volume is a param of the volume's own node (`VolumeFromCcp4.bin`), not a decorator (Claude, with the
  advisor): the hierarchy's `VolumeRef.cell` is the first `Volume.Data` (`VolumeFromCcp4`; `CustomVolumeProperties` is
  already a decorator under it), and every cryoet reader (`sliceOf`, `volumeDataOf`, `windowsOf`, `refit`, the slice
  clamps, `sliceVisuals`) reads that cell. A decorator would have left them on the 1× grid and needed an insert above
  the representations; the param takes the OME-Zarr `level` path whole (one write, undo, sessions, σ windows, the moved
  volume's `VolumeTransform` re-applied over it). Cost: two library files (S7 below: Ludo's call).
- The prior art's geometry (`opt/direct-volume-downsample`) not ported: it kept the fractional box, so a side not a
  multiple of the factor got a spacing other than f·s and every voxel sat at its block's first voxel, not its center.
- Levels listed while the longest side keeps 8 voxels at that binning (a 4³ map: none, "too small to bin"); 8× only over
  1000 voxels a side (the brief).
- A stack is told by its file name (.st, .ali, .mrcs, as `Ccp4Provider` names them), not the header's ISPG (IMOD writes
  0 for tomograms too).
- Array from Uniform picks the last array, else the first cell array; Custom starts at the array's range (half a unit
  about a single value).

## Learned

- A VTP's one color was never written: `cryoet.mesh` wrote `coloring` only when the params had it (OBJ, PLY); a VTP's is
  `colorTheme`, so the picker did nothing and `cryoet.meshes` reported no color. `mesoscale.theme` and the menu's Color…
  reach a VTP now too (review N1).
- An MRC written with its box at 0 and the cell its extent is read `periodicity: 'xyz'`: a binned grid with partial
  blocks must drop it.
- The memory saved is the GPU's and the drawn grid's: the 1× values stay in `ParseCcp4`'s file (`volumeFromCcp4` wraps
  them), and binning allocates N/f³ Float64 sums plus the output (review S2). A 300 M-voxel tomogram bins 2× in about
  1.3 s (reviewer's probe: 64 M voxels 267 ms).
- `ParamsFormModel.load` does not fire `onChange`: the controls' reloads write nothing.
- `plugin.state.getSnapshot`/`setSnapshot` brings the level back; `state.data`'s alone did not in the headless test.

## Review

Reviewer (lane-reviewer) then skeptic (lane-skeptic) on `git diff origin/me/paint...HEAD`.

| Finding                                                  | Verdict             | Outcome                                                          |
| -------------------------------------------------------- | ------------------- | ---------------------------------------------------------------- |
| M1 a tilt series / stack binned along its images         | confirmed           | fixed 1cb78f976 (no levels for .st, .ali, .mrcs)                 |
| S1 a distance anchored to voxels breaks at another level | confirmed (reading) | open (TODO.md): the OME-Zarr level has the same gap; a lane      |
| S2 CPU memory not saved                                  | confirmed (brief)   | recorded in Learned; spec and changelog claim none               |
| S3 Custom on a one-value array refused silently          | confirmed (probe)   | fixed (Custom spans it by half a unit), tests in the S5 commit   |
| S4 Uniform after Array writes #cccccc                    | confirmed (probe)   | fixed (the picker keeps the last own color)                      |
| S5 a color merged with a pending array change, refused   | confirmed (probe)   | fixed (each replaces the other in the pending write)             |
| S6 progress file only the brief                          | refuted (timing)    | this section                                                     |
| S7 library code in a prism-me lane                       | confirmed (process) | open: Ludo's call (4 commits cherry-pick to a master lane)       |
| X1 another array keeps the last one's custom range       | confirmed (reading) | fixed 4e944b2b4                                                  |
| N1 theme / menu Color… recolor a VTP now                 | confirmed           | open (intended: the person's own color; noted in Learned)        |
| N2 Array's first pick vs the VTP's default               | confirmed           | open (TODO.md)                                                   |
| N3 a bare name in point and cell data takes the point's  | confirmed           | open (TODO.md)                                                   |
| N4 the Data section's MRC test passes on the old code    | confirmed           | kept as coverage; the failing test is level.test.ts's            |
| N5 VolumeFromCcp4's description NX×NX×NX                 | confirmed (pre-ex.) | open                                                             |
| N6 `bin` 3, 5… not a listed level                        | confirmed           | open (TODO.md)                                                   |
| N7 the Array select's options built once                 | plausible           | open (a file's arrays do not change)                             |
| X2 the Custom form's 0.001 step on tiny values           | plausible           | open                                                             |
| X3 `ccp4Of` reads the diagonal (orthogonal cells)        | confirmed (reading) | open (cryo-ET maps are orthogonal; slices still map, see review) |

## Checked in the app (port 1365)

A synthesized tomogram (301 × 280 × 121, 10 Å, three blobs off center) and a VTP (a lobed sphere: point Curvature, cell
Labels), driven headless (Playwright, the scratchpad's `look2.cjs`, `look3.cjs`). The MRC's Data shows Level 1× (41 MB);
2× gives 151 × 140 × 61, 20 Å, 5.2 MB, the z slice from 600 Å to 605 Å; 4× gives 76 × 70 × 31, 40 Å, 0.7 MB, the slice
at 615 Å; the blobs stay in place; one undo goes back one level. The VTP opens on Array (Cell: Labels, Viridis, Auto);
Point: Curvature with Plasma colors the lobes; Custom writes [-1, 1]; Uniform writes the gray; an undo brings the array
back. Screenshots in the session's scratchpad `data-controls/` (02–04 the MRC, 05–09 the VTP).

## Checks

`tsc -b` model, plugin core, cryoet, apps/prism-me and `tsc --noEmit -p apps/prism-me` clean; `pnpm lint`, biome format
and prettier clean; tests: model, plugin core and cryoet 174 files, 1180 passed before the review, cryoet 17 files, 156
after it. `pnpm check:workspace` fails on unbuilt `lib/` exports in this worktree with or without the lane.

## Size

About 560 production lines against ~280: `operations.ts` +338 (the MRC's levels and frames ~120, the mesh's theme
writes, its arrays and ranges and the checks ~170, the shared `moveSlices` and biome's line breaks), `controls.tsx` +109
(the Color by block and the pending merge), `bin.ts` 105, `ccp4.ts` +12. What took the room: the mesh's array validation
and ranges (the brief counted ~30) and the controls (~70 counted).

## Open

- S1: voxel-anchored distances at another level (MRC and OME-Zarr), in a lane of its own.
- S7: `bin.ts` and `VolumeFromCcp4.bin` are library code: split to a lane from `origin/master`, or keep (Ludo).
- The nits above (TODO.md); isosurfaces with an absolute value under binning keep their value (as for a Zarr level).
