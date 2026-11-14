# mesh-volume-texture (brief, 2026-11-14)

Ludo: "change the color by volume of the mesh, right it seems to use color per vertex. I think for this it should use a
texture to get more color details. Could we add a toggle to switch to texture coloring for both at surface and projected
to have the same detail resolution as the volume despite the mesh resolution?"

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
- **Projected** (Mean/Min/Max ±Depth): a value per voxel needs a direction. For the voxels in a thin band around the
  mesh (|distance| ≤ ~1.5 voxels, the ones fragments can sample), take the nearest surface point's normal and run the
  same projection as the per-vertex path from that voxel. Voxels outside the band are never sampled. Measure it on
  Ludo's data (bounding box of the capsid at 13.36 Å; the band only); budget below.
- Frames: the volume's and the mesh's transforms (the VTP's Scale 10, moved meshes) as the per-vertex path handles them;
  the grid transform in the mesh's own frame.
- The kept array `density_<volume>` stays per vertex/cell as now (data, not display).
- Size cap: a grid over N texels (e.g. 256³ or the device's 3D texture limit) is downsampled, and the section says so.
- Live as now: Level, Range, Invert, Sample, Depth, a moved volume or mesh, a removed volume (back to the mesh's own
  color, as the decorator does).

## Tests (fail first)

- The grid at voxel centers equals the volume's values (At surface), and its transform maps a voxel center to the right
  model position (with a scaled and a moved mesh).
- A two-triangle mesh over a striped volume: Texture gives a grid holding the stripes; Vertex gives only the corners.
- Projected: grid values at the band voxels next to each vertex agree with the per-vertex projected values (tolerance in
  σ, stated).
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
2026-11-14), and no master lane is made. They are still committed apart from the app, with no app or extension hunks, so
they can be cherry-picked later. They are recorded under "Core changes" below.

1. **Library (packages/graphics, packages/model):** a per-fragment color-grid lookup, opt in on the `volume` color
   types, consistent with palette, overpaint, emissive, transparency, marking and picking, on WebGL and WebGPU. Also a
   hook so that a Shape can carry a color grid as data. The representation uploads it where it has its graphics context,
   and Shape getters stay context-free. Shader and unit tests.
2. **App (cryoet, prism-me):** the brief's Vertex | Texture toggle in Color by › Volume. At surface and Projected (the
   band of voxels) are as in "Wanted" above.

Size: ~150–250 library lines + ~300–450 app lines. Report to the coordinator if it runs past ~1.5× that.

## Stopped (2026-11-14, before code)

The lane stopped at the reading step, as the brief allows ("stop and report when the work turns out different"). Nothing
was built. The Texture toggle cannot be built as the brief describes it without library changes larger than the brief.
There are two reasons:

1. _*Mol*'s `volume` color type samples per vertex, not per pixel._* `tColorGrid` is read only in the vertex shader:
   `packages/graphics/src/gl/webgl/shader/chunks/assign-color-varying.glsl.ts:40-44` samples it into `vColor`, and that
   chunk is included only by `mesh.vert.ts:59`. `vColor` is a varying (`common.glsl.ts:14`, `dColorType_grid` →
   `dColorType_varying`), so the fragment shader reads the interpolated value (`assign-material-color.glsl.ts:26-27`).
   No fragment shader samples `tColorGrid`. Color smoothing uses the same path. A triangle therefore interpolates its
   three vertices' grid colors, which gives the same detail as Vertex. Wired as the brief describes, the Texture toggle
   would change nothing on screen.
2. **A Shape representation takes no grid theme.** `repr/shape/representation.ts:146` sets its theme from
   `ShapeUtils.getTheme` (`ShapeGroupColorTheme`, `geo/shape/shape.ts:26-31`), and its `setTheme` (`:401-407`) ignores
   any other theme. A `Shape` has no field that can carry a `ColorVolume`. The getter also has no WebGL context to make
   the grid's texture.

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
  vertices as now. The Look's toggle becomes "Detail: Mesh | Voxel". This multiplies the vertex count by about (edge /
  voxel)², which is about 2.4× on the capsid and more on a decimated mesh. It trades memory for detail, and picking or
  labels must map the new vertices back to cells. This path is outside the brief's "how", so it is listed here for Ludo
  to choose and is not a recommendation.

Size at the stop: 0 production lines.

## Built (Option A)

- **Library, read per fragment** (`dColorGridFragment`): the grid color types (`volume`, `volumeInstance`) sample
  `tColorGrid` in the fragment stage when `ColorVolume.fragment` asks. The vertex stage passes the normalized grid
  position as a varying (`vColorGridPosition`; WGSL `@location(7)`). The fragment stage reads the grid there, adding
  half a cell in x and y: the 2d layout's texels are half a cell off the cells. Palette, emissive and tracing read the
  fragment's color; pick, depth and marking ignore the define. WebGL (`assign-material-color`, `mesh.frag`) and WebGPU
  (`varyings`, `material`, `output`; mesh programs). `setColorType` resets the flag.
- **Library, a Shape's color grid:** `Shape.colorGrid` (model) holds RGBA cells in the shape's own frame. The shape
  representation draws it in place of `getColor` through `applyMeshColorGrid` (beside the mesh color smoothing). With a
  graphics context whose textures fit the layout, it uploads the grid in the 2d layout of the grid color types and reads
  it per fragment. Otherwise it colors the vertices trilinearly on the CPU. The texture is reused, refilled in a new
  context, and destroyed when the shape has no grid. `getVolumeTexture2dLayout` gives at least one column (review M1).
- **App (cryoet):** `colorBand` (mesh-volume.ts) makes a grid at the volume's voxels in the mesh's frame. Its cells sit
  on the voxels when the mesh is drawn without rotation; over 256³ cells it takes every k-th voxel. It also makes the
  band, the cells a pixel reads: the 3³ cells about each point of the triangles, sampled every half cell. Each band cell
  takes the normal of its nearest point. `sampleVolume` samples the band as it samples the vertices (At surface at the
  cell; Projected along the normal within ±Depth). The decorator's `detail` (Vertex, the default, or Texture) selects
  it. The band and its values are cached while only the colors change, and the colors are refilled into the band's
  array. `cryoet.mesh` takes `detail`. `cryoet.meshes` gives `detail`, and for Texture `cell` (Å) and `capped`. The
  Look's Color by › Volume shows Detail and Texture's cell side.
- ui.md, features.md, `.v6/changelogs/mesh-volume-texture.md`, the cryoet skill's guidance.

## Decided

- **A flag on the grid color types, not a new color type** (Claude). `dColorGridFragment` beside `dColorType` 'grid'
  adds no `ColorType`, no theme granularity and no index type. The grid types keep their two positions (local, model).
  It is ignored where color is not drawn, so it adds programs only for the objects that use it.
- **The vertex stage still samples the grid** under the flag. Overpaint's pre-mix and the varying path read `vColor`,
  and the lookup is one texture fetch. The cost is a vec3 varying.
- **The half cell:** the fragment lookup reads a cell's own value at its center (pinned by tests on both backends'
  sources and on a JS model of `texture3dFrom2dLinear`). The existing vertex-stage lookup, used by color smoothing,
  reads half a cell off in x and y. That is left as it is (see Core changes).
- **The Shape carries the grid as data** (CPU RGBA, x fastest). The getters stay free of a graphics context, and the
  representation, which has one, makes and owns the texture. The CPU path is the fallback, so a headless or WebGL1
  viewer draws the grid at the vertices.
- **The band, not the box:** only the cells a pixel reads are sampled (537k of 5.2M on Ludo's capsids). The other cells
  are gray and never read. Projected samples from the cell along the nearest point's normal ("from that voxel", the
  brief), with the same `sampleVolume` as the vertices.
- **The grid on the voxels** when the mesh's drawn transform is a scale and a move: no resampling blur. With a rotation,
  the grid is axis-aligned in the mesh's frame and resampled trilinearly.
- **The cap:** 256³ cells; over it, every k-th voxel (integer k, still on the voxels). The Look says so.
- **The kept array `density_<volume>`** stays per vertex or per cell, sampled as before.
- **The wireframe** stays per vertex: its shape is derived from the mesh's colors, not its grid.

## Core changes

| Name                                    | What                                                                                                                                                                                                                                    | Why                                                                                                                  | Key files                                                                                                                                                                                                                                                          | Commits                                              | Tests                                                                           | Upstream                                                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Color grid per fragment                 | `ColorVolume.fragment` → define `dColorGridFragment`: the grid color types sampled in the fragment stage at the interpolated grid position, at the cell centers; palette, emissive, tracing consistent; ignored by pick, depth, marking | the grid types sample per vertex, so a triangle loses the grid's detail between its vertices                         | graphics `geo/geometry/color-data.ts`, `theme/color.ts`, `gl/renderable/schema.ts`, `gl/shader-code.ts`, GLSL chunks `color-vert-params`, `color-frag-params`, `assign-color-varying`, `assign-material-color`, `mesh.frag`; WGSL `varyings`, `material`, `output` | 67181b462, b7586aea9, 0b3549fa8, 60a381d9b (headers) | `gl/_test/color-grid-fragment.test.ts`, `geo/geometry/_test/color-data.test.ts` | candidate (needs work: the overpaint pre-mix still uses the vertex color, review S6; precompile signatures do not predict the define) |
| A Shape's color grid                    | `Shape.colorGrid` (model); `applyMeshColorGrid` (graphics); the shape representation uploads it with its graphics context and reads it per fragment, else colors the vertices; texture reused, moved to a new context, destroyed        | a shape's colors were fixed to `getColor` per group; a grid needs a texture, which a context-free getter cannot make | model `model/shape/shape.ts`; graphics `geo/geometry/mesh/color-smoothing.ts`, `repr/shape/representation.ts`                                                                                                                                                      | 88452e74d, ad167aa28                                 | `repr/shape/_test/color-grid.test.ts`                                           | candidate                                                                                                                             |
| A 2d grid layout of one column at least | `getVolumeTexture2dLayout`: `columns ≥ 1`                                                                                                                                                                                               | a grid longer in x than the square of its slices' area got width 0 and height Infinity (a crash)                     | graphics `repr/volume/util.ts`                                                                                                                                                                                                                                     | e65fa0712                                            | `repr/shape/_test/color-grid.test.ts` (a [305, 7, 7] grid)                      | candidate (a fix on its own)                                                                                                          |

Observed, not changed: the existing vertex-stage grid lookup (color smoothing) reads half a cell off in x and y against
its CPU twin (`getTrilinearlyInterpolated`): needs work, a lane of its own if upstream wants it.

## Checked in the app (port 1377)

`~/prism-me-lanes/mesh-volume-texture-check.cjs` (Playwright, headless Chrome, WebGPU) and
`~/prism-me-lanes/mesh-volume-texture-webgl.cjs` (WebGL2, `navigator.gpu` hidden). Ludo's MRC and VTP (Scale 10), and a
decimated capsid OBJ (vertex clustering at 7 nm: 12,333 triangles, 1/10, in the scratchpad), all with Projected Min ±40
Å, Custom −5.5 to −2.5σ, Inverted.

| Step                                   | Time          |
| -------------------------------------- | ------------- |
| Vertex, At surface                     | 66 ms         |
| Texture, At surface (band + sampling)  | 464 ms        |
| Vertex, Min ±40 Å                      | 215 ms        |
| Texture, Min ±40 Å                     | 1,439 ms      |
| Texture, a Range change (refill only)  | 26 ms         |
| Decimated: Vertex / Texture, Min ±40 Å | 19 / 1,002 ms |

Grid 286 × 355 × 51 cells of 13.36 Å (not capped), band 536,788 cells, drawn as `volume` with `dColorGridFragment` on
WebGPU and WebGL2 (the same image). The decimated mesh with Texture looks like the full mesh with Texture; with Vertex
it shows large flat triangles. Screenshots in
`/private/tmp/claude-501/-Users-ludovicautin-molstar-proto-git/bc8a7dcf-b4ed-4027-911e-5f56df74a469/scratchpad/mesh-volume-texture/`:
01/02 whole At surface (Vertex/Texture), 03/04 At surface close (Vertex/Texture), 05/06 Min ±40 Å close
(Vertex/Texture), 07 the Look's Detail, 08/09 the decimated mesh (Vertex/Texture), 10/11 WebGL2 (Vertex/Texture).

## Review

Reviewer (lane-reviewer), then skeptic (lane-skeptic), on `git diff origin/prism-me...HEAD` at 68a12f981. Each confirmed
must-fix and should-fix got a test that fails first, then its fix in its own commit.

| Finding                                                                                     | Verdict                                                                 | Outcome                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1 a grid long in x (a filament) crashes: layout width 0                                    | confirmed (run)                                                         | fixed e65fa0712                                                                                                                                                                |
| M2 `@author` missing in touched files, two chunks headerless                                | confirmed                                                               | fixed 60a381d9b                                                                                                                                                                |
| S1 progress file not written, gate not run                                                  | confirmed (progress only)                                               | this section; gate below                                                                                                                                                       |
| S2 no perf budget                                                                           | confirmed                                                               | fixed 2c765308f (heavy lane: under 3 s, 1.8 s measured)                                                                                                                        |
| S3 the half cell not pinned in the shader sources                                           | confirmed                                                               | fixed 0b3549fa8 (fails with it removed)                                                                                                                                        |
| S4 texture leak after a context change; kept after Vertex                                   | confirmed (simulated)                                                   | fixed ad167aa28                                                                                                                                                                |
| S5 Projected band vs vertices off at coarse voxels (1.23σ at 4 Å)                           | numbers confirmed; follows the brief                                    | Ludo's call (below)                                                                                                                                                            |
| S6 overpaint pre-mix uses the vertex color                                                  | confirmed in the library; not reachable in prism-me (no mesh overpaint) | open (nit), noted in Core changes                                                                                                                                              |
| S7 a refill allocates a dense grid, then the atlas; hint says "per pixel" on a CPU fallback | confirmed (minor)                                                       | dense grid fixed 7be867104; the atlas copy and the hint open (the hint cannot see the representation's choice; a fallback needs no context or a layout over the texture limit) |
| Nit capped grid point-samples every k-th voxel                                              | confirmed                                                               | open                                                                                                                                                                           |
| Nit vertex-stage lookup half a cell off (pre-existing)                                      | confirmed                                                               | open (Core changes)                                                                                                                                                            |
| Nit precompile misses `dColorGridFragment`                                                  | confirmed                                                               | open (first Texture draw compiles late)                                                                                                                                        |
| Nit late graphics context keeps the grid per vertex until the next color change             | confirmed by reading                                                    | open (the plugin passes the context at creation)                                                                                                                               |
| Nit ui.md order differs from the Look                                                       | confirmed                                                               | fixed 0fab99778                                                                                                                                                                |
| Nit wireframe ignores Detail                                                                | confirmed, by design                                                    | ui.md says so (0fab99778)                                                                                                                                                      |
| Nit dead emissive branch in `color-frag-params`                                             | refuted (pre-existing)                                                  | none                                                                                                                                                                           |

Gate: `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, vitest cryoet + mesoscale + apps/prism-me + graphics + model
(3,249 passed; 1 failure pre-existing on the base: `backend-neutral.test.ts` on mesoscale `operations.ts`), the heavy
budget test, cryoet `test:scaling`, biome lint and format on the touched packages. The skeptic ran the workspace
scripts: `check:workspace` stops on a plugin-ui css export pattern and `registry-compare` on an unbuilt
`backgrounds/lib`, neither in this lane's hunks; `styles:check` and `typecheck:storybook` do not apply (no
`packages/prism` hunks).

## Learned

- Mol*'s grid color types (color smoothing) sample per vertex: `tColorGrid` is read only in the vertex stage, so they
  were never a per-pixel path. The brief's premise was wrong, and the lane stopped before Option A.
- `texture3dFrom2dLinear` reads texel edges at `pos.xy · dim` and slices at `pos.z · dim`: half a cell apart in x and y
  from the CPU's integer convention.
- `getVolumeTexture2dLayout` fails for a grid whose x side is over the square of its slices' area; volumes never hit it
  (cubic-ish), a band over a filament does.
- `enableTrianglePicking` closes over the shape object: a shape cannot be spread into a copy with a new field (its
  picking would test the old object). `Shape.colorGrid` is a settable optional, as the triangle hooks are.
- A Mol* snapshot is applied by version: re-applying a snapshot of the current versions changes nothing. A session test
  must change the state first.

## Size

Production lines against the brief's ~150–250 library + ~300–450 app:

- library about 210 (shaders ~75 over GLSL and WGSL, the Shape hook and `applyMeshColorGrid` ~75, color data, schema,
  theme and ignore ~30, the layout fix 2, headers 18);
- app about 300 (`colorBand` ~150, the decorator's Texture ~60, operations ~40, the Look ~25, the skill 2).

Within the brief. What took the room: the WGSL twin of every GLSL change; the band's coverage (which cells a pixel
reads) and its frame (on the voxels when it can be).

## Decisions for Ludo

1. **Projected at coarse voxels (review S5).** Each band cell projects from its own center along the nearest surface
   point's normal, as the brief says ("from that voxel"). At 1 Å voxels and ±8 Å it agrees with the vertices within
   0.24σ. At 4 Å voxels, up to 1.23σ, because a cell up to 1.5 cells off the surface shifts the ±Depth window.
   Projecting from the nearest surface point instead halves the error at Min (0.71σ), but then At surface is no longer
   exact. Keep "from the voxel" or switch Projected only?
2. **The cap:** 256³ cells, then every k-th voxel, point-sampled (no block mean). Enough, or average the blocks as the
   Level does?
3. **The core changes** (above): all three are upstream candidates. The fragment lookup is consistent on both backends,
   but under a partial overpaint it mixes in the vertex color (S6, not reachable in prism-me). Fix it before any
   upstream PR, or leave it for later?
4. **The vertex-stage lookup's half cell** (pre-existing, color smoothing): a lane of its own if wanted.
