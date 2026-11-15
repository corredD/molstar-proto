# volume-pixel-size (brief, 2026-11-14)

Ludo: "for the volume I am missing the pixel size info / slider if I want to change it if there is an error in the
file".

Slug `volume-pixel-size`, branch `me/volume-pixel-size` from prism-me ebe21bd07, port 1379. Lane model: **Sonnet**;
one Opus subagent for the design step (where the scale lives and what moves with it).

## Now

- A volume's Data section shows its voxel size read-only (Prism's volume facts: `packages/prism/viewer/src/sources/
  scene.ts` ~3136 `['Voxel', voxelText(stats)]`; ui.md Data row, line ~118).
- Nothing sets it. Meshes have Scale (`cryoet.mesh` `scale`: "a mesh in pixels: the pixel size, Å"), particle lists have
  Å per unit (`stage.scale_particles`), volumes have no equivalent. A volume can be moved/turned with a
  `VolumeTransform` (stage-tools `operations.ts` ~245, ~487-491).

## Wanted

In a volume's **Data** section, a **Pixel size (Å)** row: the value in use, a number field and a slider (log-scaled,
e.g. 0.1–100 Å, as the mesh's Scale), and **Reset** to the file's value (shown: "file: 13.36 Å"). Changing it rescales
the volume as if the header had said that size: every voxel's position scales by new/file **about the scene origin**
(a header's origin is in Å, voxel index × pixel size, so the whole map scales from 0, as a mesh's Scale does).
Isotropic (one value, x = y = z) by default; per-axis only if the file's voxels are anisotropic (then the ratio kept,
the x value shown) — say which in the progress file.

- An operation `cryoet.volume` (or extend the existing volume op, read what exists) with `pixelSize` (Å, or `null` for
  the file's), one history step, undo; sessions keep it; ⌘K / assistant describe it.
- Composes with a moved volume (`VolumeTransform`): the scale is applied before the move (the move is in Å of the
  scene). Design step (Opus): one `VolumeTransform` holding scale × move, or a scale of its own; slices, isosurfaces,
  direct volume, Level (binning) and the Data's facts (grid, voxel, size in Å) all follow; picking/labels report the
  new positions; Color by Volume on a mesh and the density fit read the volume where drawn (they already read its
  transform: check).
- The Data section's Voxel line shows the size in use, and "(file: x Å)" when changed.

## Tests (fail first)

- Set 2× the file's pixel size: a voxel center's scene position doubles (from origin), the box doubles; Reset gives
  the file's back exactly; undo/redo.
- With a move: scale then move (a voxel's position = move(scale(p))); the move's handles still work after a scale.
- A session round-trip keeps it; an old session reads the file's.
- The density fit / Color by Volume sample the scaled volume where drawn (one test each, small synthetic map).
- An OME-Zarr level change (cryoet.level) keeps the pixel size override (scaled relative to the finest level).

## Check (port 1379)

Ludo's `~/Downloads/7-2_cryolithe_bin2.mrc` (13.36 Å): set 6.68 Å, the map halves about the origin, slices and
isosurface follow; Reset. With the VTP (Scale 10) the capsids line up at 13.36 and not at 6.68. Screenshots.

## Size

~150–250 production lines.

## Rules

Core changes (outside mesoscale/cryoet/stage-tools) as their own commits, recorded in a "Core changes" section of this
file (not `_spec/core-changes.md`). ui.md (Data row) and features.md updated. No `git stash pop`.
