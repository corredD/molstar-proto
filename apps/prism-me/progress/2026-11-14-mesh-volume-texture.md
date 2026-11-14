# mesh-volume-texture (brief, 2026-11-14)

Ludo: "change the color by volume of the mesh, right it seems to use color per vertex. I think for this it should use a
texture to get more color details. Could we add a toggle to switch to texture coloring for both at surface and
projected to have the same detail resolution as the volume despite the mesh resolution?"

Slug `mesh-volume-texture`, branch `me/mesh-volume-texture` from prism-me a08cbf8e7, port 1377. Lane model: **Opus**
(renderer data and a hot path: the projected grid).

## Now

Look › Color by › Volume (`mesh-volume-color`, merged): `packages/extensions/cryoet/src/mesh-volume.ts` samples the
volume at each vertex (or cell center for a VTP's cell arrays), At surface or Projected Mean/Min/Max ±Depth, maps the
values to colors and writes them per vertex (`MeshVolumeColor` decorator). A triangle interpolates its three vertex
colors, so detail finer than the mesh's edges is lost (Ludo's capsid: 122,348 cells, ~13 Å voxels; a coarser mesh loses
more). Progress file of that lane: `2026-11-14-mesh-volume-color.md` (in this branch).

## Wanted

A toggle **Detail: Vertex | Texture** (names to settle; Vertex the default, as now) in Color by › Volume. With Texture,
the color comes from a **3D color grid at the volume's voxel resolution**, sampled per pixel by the mesh's position, for
**At surface and Projected** alike. The colors then show the volume's detail whatever the mesh's resolution.

## How (to confirm by reading the code first)

- Mol* meshes already support `dColorType` **`volume`**: `tColorGrid` (a 3D texture or its 2D layout), `uColorGridDim`,
  `uColorGridTransform`, sampled per fragment from the model position. It is what color smoothing uses
  (`packages/graphics/src/geo/geometry/mesh/color-smoothing.ts`, `getVolumeTexture2dLayout`; molecular and gaussian
  surface visuals). Reuse that path, not a new shader. Check that a `Shape`'s mesh (the VTP's visual) can take it, and
  where the decorator sets the color values.
- **At surface**: the grid is the volume's own values over the mesh's bounding box (clipped to the volume, padded one
  voxel), mapped through the same color scale (Range, Invert, Level live). Trilinear filtering in the texture.
- **Projected** (Mean/Min/Max ±Depth): a value per voxel needs a direction. For the voxels in a thin band around the mesh
  (|distance| ≤ ~1.5 voxels, the ones fragments can sample), take the nearest surface point's normal and run the same
  projection as the per-vertex path from that voxel. Voxels outside the band are never sampled. Measure it on Ludo's
  data (bounding box of the capsid at 13.36 Å; the band only); budget below.
- Frames: the volume's and the mesh's transforms (the VTP's Scale 10, moved meshes) as the per-vertex path handles them;
  the grid transform in the mesh's own frame.
- The kept array `density_<volume>` stays per vertex/cell as now (data, not display).
- Size cap: a grid over N texels (e.g. 256³ or the device's 3D texture limit) is downsampled, and the section says so.
- Live as now: Level, Range, Invert, Sample, Depth, a moved volume or mesh, a removed volume (back to the mesh's own
  color, as the decorator does).

## Tests (fail first)

- The grid at voxel centers equals the volume's values (At surface), and its transform maps a voxel center to the
  right model position (with a scaled and a moved mesh).
- A two-triangle mesh over a striped volume: Texture gives a grid holding the stripes; Vertex gives only the corners.
- Projected: grid values at the band voxels next to each vertex agree with the per-vertex projected values (tolerance
  in σ, stated).
- The toggle switches the color type to `volume` and back to vertex; sessions keep it; old sessions read Vertex.
- Live: a Level or Range change refills the grid without recomputing the projection where only the mapping changed.
- Perf: the band projection on a 122k-cell mesh at 13 Å within a stated budget (the repo's perf rule).

## Check (in the app, port 1377)

Ludo's `~/Downloads/7-2_cryolithe_bin2.mrc` and `~/Downloads/7-2_capsids_curvature.vtp` (Scale 10), Color by › Volume:
At surface and Projected Min ±40 Å, Custom −5.5 to −2.5σ, Inverted; Vertex vs Texture screenshots side by side, close
up. Also a decimated mesh (e.g. 1/10 of the cells) to show Texture keeps the detail. Times for both.

## Size

~300–450 production lines (the grid builder, the band projection, the toggle and its wiring).

## Out of scope

UV textures (a VTP has no UVs); coloring other shapes than meshes; changing the per-vertex path.
