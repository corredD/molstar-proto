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

## Decided: Option A (Ludo, 2026-11-14)

Ludo picked Option A after the stop below, to be built in this lane. The core changes stay on prism-me (Ludo,
2026-11-14), and no master lane is made. They are still committed apart from the app, with no app or extension hunks,
so they can be cherry-picked later. They are recorded under "Core changes" below.

1. **Library (packages/graphics, packages/model):** a per-fragment color-grid lookup, opt in on the `volume` color
   types, consistent with palette, overpaint, emissive, transparency, marking and picking, on WebGL and WebGPU. Also
   a hook so that a Shape can carry a color grid as data. The representation uploads it where it has its graphics
   context, and Shape getters stay context-free. Shader and unit tests.
2. **App (cryoet, prism-me):** the brief's Vertex | Texture toggle in Color by › Volume. At surface and Projected (the
   band of voxels) are as in "Wanted" above.

Size: ~150–250 library lines + ~300–450 app lines. Report to the coordinator if it runs past ~1.5× that.

## Stopped (2026-11-14, before code)

The lane stopped at the reading step, as the brief allows ("stop and report when the work turns out different").
Nothing was built. The Texture toggle cannot be built as the brief describes it without library changes larger than
the brief. There are two reasons:

1. **Mol*'s `volume` color type samples per vertex, not per pixel.** `tColorGrid` is read only in the vertex shader:
   `packages/graphics/src/gl/webgl/shader/chunks/assign-color-varying.glsl.ts:40-44` samples it into `vColor`, and that
   chunk is included only by `mesh.vert.ts:59`. `vColor` is a varying (`common.glsl.ts:14`, `dColorType_grid` →
   `dColorType_varying`), so the fragment shader reads the interpolated value
   (`assign-material-color.glsl.ts:26-27`). No fragment shader samples `tColorGrid`. Color smoothing uses the same
   path. A triangle therefore interpolates its three vertices' grid colors, which gives the same detail as Vertex.
   Wired as the brief describes, the Texture toggle would change nothing on screen.
2. **A Shape representation takes no grid theme.** `repr/shape/representation.ts:146` sets its theme from
   `ShapeUtils.getTheme` (`ShapeGroupColorTheme`, `geo/shape/shape.ts:26-31`), and its `setTheme` (`:401-407`) ignores
   any other theme. A `Shape` has no field that can carry a `ColorVolume`. The getter also has no WebGL context to
   make the grid's texture.

**Measured (one number for the choice):** the capsid VTP's edges at Scale 10 are a mean of 20.8 Å (median 20.9, p90
23.9). That is 1.56 voxels of 13.36 Å. The current path also samples per cell and averages the cells to the vertices.
This makes its detail coarser than the edges. On the full mesh, per-pixel coloring would gain about 1.5× in linear
detail. On a decimated mesh it would gain more.

## Options for Ludo

- **A: a library lane from `origin/master`, which upstream could want.** Add a fragment-stage grid lookup behind a new
  define or color type, for example `volumeFragment`:
  - Pass the local position (`volume`) or the model position (`volumeInstance`) to the fragment shader as a varying.
  - Declare `tColorGrid` and `uColorGrid*` in the fragment params.
  - Include `texture3d-from-2d-linear` in the fragment shader and sample there in `assign-material-color`.
  - Make palette, overpaint, color levels and emissive behave as the varying path does.
  - Add a hook so that a `Shape` can supply a color grid (its theme as a grid theme, with the texture made where the
    representation has its WebGL context).

  Estimate: about 150–250 library lines, with shader tests. This lane then sits on top of it at the brief's ~300–450
  lines.
- **B: in cryoet only, with no shader change.** Subdivide the triangles longer than about one voxel, then color the
  vertices as now. The Look's toggle becomes "Detail: Mesh | Voxel". This multiplies the vertex count by about
  (edge / voxel)², which is about 2.4× on the capsid and more on a decimated mesh. It trades memory for detail, and
  picking or labels must map the new vertices back to cells. This path is outside the brief's "how", so it is listed
  here for Ludo to choose and is not a recommendation.

## Size

0 production lines, against the brief's ~300–450.
