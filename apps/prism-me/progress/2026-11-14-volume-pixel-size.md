# volume-pixel-size (brief, 2026-11-14)

Ludo: "for the volume I am missing the pixel size info / slider if I want to change it if there is an error in the
file".

Slug `volume-pixel-size`, branch `me/volume-pixel-size` from prism-me ebe21bd07, port 1379. Lane model: **Sonnet**; one
Opus subagent for the design step (where the scale lives and what moves with it).

## Now

- A volume's Data section shows its voxel size read-only (Prism's volume facts:
  `packages/prism/viewer/src/sources/ scene.ts` ~3136 `['Voxel', voxelText(stats)]`; ui.md Data row, line ~118).
- Nothing sets it. Meshes have Scale (`cryoet.mesh` `scale`: "a mesh in pixels: the pixel size, Å"), particle lists have
  Å per unit (`stage.scale_particles`), volumes have no equivalent. A volume can be moved/turned with a
  `VolumeTransform` (stage-tools `operations.ts` ~245, ~487-491).

## Wanted

In a volume's **Data** section, a **Pixel size (Å)** row: the value in use, a number field and a slider (log-scaled,
e.g. 0.1–100 Å, as the mesh's Scale), and **Reset** to the file's value (shown: "file: 13.36 Å"). Changing it rescales
the volume as if the header had said that size: every voxel's position scales by new/file **about the scene origin** (a
header's origin is in Å, voxel index × pixel size, so the whole map scales from 0, as a mesh's Scale does). Isotropic
(one value, x = y = z) by default; per-axis only if the file's voxels are anisotropic (then the ratio kept, the x value
shown) — say which in the progress file.

- An operation `cryoet.volume` (or extend the existing volume op, read what exists) with `pixelSize` (Å, or `null` for
  the file's), one history step, undo; sessions keep it; ⌘K / assistant describe it.
- Composes with a moved volume (`VolumeTransform`): the scale is applied before the move (the move is in Å of the
  scene). Design step (Opus): one `VolumeTransform` holding scale × move, or a scale of its own; slices, isosurfaces,
  direct volume, Level (binning) and the Data's facts (grid, voxel, size in Å) all follow; picking/labels report the new
  positions; Color by Volume on a mesh and the density fit read the volume where drawn (they already read its transform:
  check).
- The Data section's Voxel line shows the size in use, and "(file: x Å)" when changed.

## Tests (fail first)

- Set 2× the file's pixel size: a voxel center's scene position doubles (from origin), the box doubles; Reset gives the
  file's back exactly; undo/redo.
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

---

# Result (lane, 2026-11-14)

## Built

- `cryoet.volume { volume, pixelSize?, reset? }`: Å, or `reset` for the file's. It runs `stage.scale` (now also for a
  volume: the factor over the file's), so labels, clips and plane slices follow in the same one history step. Without
  the stage tools: `blocked`. ⌘K command ("Pixel size") and the assistant tool `set_pixel_size`.
- The scale is one `scale` param on the core `VolumeTransform` (as a particle list's): `transform x scale x grid`,
  applied before the move; the centroid turn is about the scaled center. No scale in a session reads 1.
- Data section: Pixel size (log slider 0.1-100 Å, commits on release, typed number), "file: 13.36 Å" and Reset once
  changed; the Voxel line "26.7 Å (file: 13.4 Å)"; the levels' voxels and labels scaled; the grid and size are the
  file's. Plane slices' radius reads the drawn grid. Portal placement (tilt series over tomogram) uses each box as
  drawn.
- Verified on port 1379 with `7-2_cryolithe_bin2.mrc` (13.36 Å) and the VTP at Scale 10: at 6.68 Å the map halves about
  the origin and the capsids no longer line up; Reset puts it back. Screenshots in the scratchpad
  `/private/tmp/claude-501/-Users-ludovicautin-molstar-proto-git/bc8a7dcf-b4ed-4027-911e-5f56df74a469/scratchpad/volume-pixel-size/`
  (2-mesh-13.png, 3-6.68.png, 4-reset.png, 5-data.png, 6-data-changed.png, 7-data-reset.png).

## Decided

- One decorator with a unitless factor k = new/file (Opus design), not a separate scale decorator (insert order would
  give move-then-scale) and not one baked matrix (Reset of the move would wipe the size).
- Isotropic: one k, x = y = z. An anisotropic file keeps its axis ratio, and the row shows the x value (the finest
  level's). Not per-axis.
- The pixel size is relative to the finest level (an MRC's 1x, an OME-Zarr's finest), so Level changes keep it; Reset is
  exact (k = 1). The file's own value typed in (float32 header) is "the file's" (1e-6 relative).
- Prism's own facts (`scene.ts` Voxel line) still show the file's value: prism-me's Data section is cryoet's.

## Review (reviewer, then skeptic)

| Finding                                                                                     | Verdict                    | Outcome                                                                                    |
| ------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| M1 file's value typed in counted as a change                                                | confirmed                  | fixed, 63d1298c0 (test first)                                                              |
| M2 biome format fails                                                                       | confirmed                  | fixed, 2b79575ef (core) and 3b754a252                                                      |
| M3 progress file incomplete                                                                 | confirmed                  | this section                                                                               |
| M4 portal placement ignores pixel size                                                      | confirmed (fix half right) | fixed per box, 5c80084b8 (test first)                                                      |
| S1 no ⌘K/tool; PD.Value drops in agent shape                                                | confirmed, raised to must  | fixed, dd79d1ead                                                                           |
| S2 fit test does not run a fit                                                              | confirmed (gap)            | left: asserts the scene volume's drawn grid, which the fit reads (`sceneVolumes`)          |
| S3 Color by Volume only "differs"                                                           | confirmed (gap)            | fixed: exact color for x=30 then x=15, 3b754a252                                           |
| S4 handles untested                                                                         | confirmed (gap, no bug)    | `stage.pose` test added, 3b754a252                                                         |
| N1 dead `void Vec3`                                                                         | confirmed                  | removed                                                                                    |
| N2/X3 duplicate commit subject                                                              | confirmed                  | left (pushed history, fixed forward not amended)                                           |
| N3 transform-reset wording on a scaled volume                                               | confirmed                  | left (core wording, behavior right)                                                        |
| N5 typed value stays after a refused write                                                  | plausible                  | left, the status line says why                                                             |
| X1 OME-Zarr level untested                                                                  | plausible                  | left: only MRC binning tested; the level op updates the cell in place, the decorator stays |
| N6 older: centroid `components` ignored by stage `volumeMatrixOf` and portal `volumeMatrix` | pre-existing               | to TODO                                                                                    |
| X2 progress file prettier                                                                   | pre-existing pattern       | formatted                                                                                  |

Counts: 4 must (+S1 raised), 4 should, 6 nits; 0 refuted.

## Learned

- A `PD.Value<...|null>` param is dropped by the agent's params shape and shown as a file picker in ⌘K: use an optional
  Numeric and a flag.
- Float32 headers: 13.36 is stored 13.3599996; compare to 1e-6, not exactly.
- `builder.update({..})` replaces all params: every VolumeTransform write must be `(p) => ({ ...p, transform })`.

## Size against the brief

About 280 production lines added (50 removed) against 150-250: the portal fix, the ⌘K/tool and the Prism functional
updates were not in the brief's estimate.

## Decisions for Ludo

- Isotropic only, relative to the finest level: OK?
- Portal tilt series placement now follows a pixel size set on either volume (not in the brief).
- Prism's own Voxel line (core) still shows the file's value; changing it is optional core work.
- TODO: centroid `components` turns in stage-tools/portal matrices (pre-existing).

## Core changes

- f2c910a78 (plugin/core `state/transforms/volume/ops.ts`): `VolumeTransform` gains `scale` (default 1: old behavior).
  Upstreamable.
- b2d096926 (Prism viewer `api/volume.ts`, `sources/volume-transform.ts`, `sources/move/gizmos.ts`): `volume.transform`
  and its reset change the move only and keep the scale; the center turned about is the scaled one.
- 2b79575ef: biome format of both.
