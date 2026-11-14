# Lane mesh-volume-color (2026-11-14)

## Brief

**Ludo (2026-11-14):** "what about projecting/coloring the vtp/mesh by a given volume?" — yes; and yes to keeping the
projected values as an array on the mesh.

**What.** A mesh's Look › Color by gets a third choice beside Uniform and Array (lane data-controls,
[progress](2026-11-12-data-controls.md)): **Volume**.

- **Volume:** a volume of the scene (an MRC, a Zarr level), read in the frame it is drawn in (its instance transform,
  its current Level/bin), the mesh in its own drawn frame (its shape's instance transform, a VTP's nm → Å scale as the
  app draws it).
- **Sample:** At surface (the density at each vertex, or each cell's center when the mesh's arrays are per cell, as
  `7-2_capsids_curvature.vtp`), or **Projected**: the Mean, Min or Max of the density along the normal within ±Depth (Å;
  default 2 voxels; sampled every half voxel, trilinear).
- **Values in σ** of the volume (mean and σ of its grid); a color scale (the existing Array scales), a Range Auto (±2σ)
  or Custom, and Invert (a tomogram's protein is dark).
- **Live:** changing the volume, Sample, Depth or the volume's Level recolors; one undo step a change; saved in sessions
  (the parameters, not the values; recomputed on load).
- **Kept as an array (Ludo: yes):** the sampled values are also added to the mesh as a named array (e.g.
  `density_<volume>`), per vertex or per cell as sampled, so Array coloring and later tools (a density-weighted grow on
  the surface) can read it; it is refreshed with the coloring. State whether it lives in the mesh's data or beside it,
  and keep the file's own arrays untouched.
- **Any mesh:** VTP, OBJ, PLY. `cryoet.mesh`'s `colorTheme` gains the volume choice (⌘K, the assistant).
- Decision 13 (lane decisions, not merged yet): Color… leaves an array theme alone; treat a volume theme the same.

**Tests, failing first.**

- A synthetic sphere mesh inside a synthetic volume with a known radial profile (a dark shell at the mesh's radius): At
  surface gives the profile's value at each vertex; Projected Min ±Depth finds the shell's minimum when the mesh is
  offset by less than Depth; Mean and Max as defined.
- Frames: a moved/scaled mesh and a volume with an origin give the same values as the unmoved case (both read where
  drawn).
- Per-cell sampling for a mesh with cell arrays; per-vertex otherwise.
- σ units, Range Auto ±2σ, Invert flips the scale.
- The array is added with the values, the file's arrays unchanged; Array coloring by it equals the Volume coloring.
- Live change of Depth or the volume's Level: one undo step, recolored; a session reload recomputes.
- A scaling guard: sampling time linear in vertices × depth samples.

**Ludo's check (app).** Load `/Users/ludovicautin/Downloads/7-2_cryolithe_bin2.mrc` (512×720×225, 13.36 Å) and
`/Users/ludovicautin/Downloads/7-2_capsids_curvature.vtp` (coordinates in nm; the walls measured −1.37σ on the surface,
+0.3σ at ±50 Å). Color by › Volume › the MRC, Projected Min ±40 Å, Invert: the capsid walls' density on the mesh; the
hexamer lattice should show where the mesh hugs the wall.

**Size.** ~250–350 production lines (sampler ~120, theme and params ~80, Look UI ~60, array ~40).

**Model.** Opus (frames of mesh and volume, the projection). **Port** 1375
(`node scripts/esbuild/app.mjs apps/prism-me --dev --port 1375`, log `~/prism-me-lanes/dev-1375.log`), left running.

## Built

- `mesh-volume.ts` (cryoet): `meshSamplePoints` (each vertex, its normal the area-weighted sum of its triangles'; or
  each cell's center and normal, its triangles' area-weighted), `sampleVolume` (the points at the mesh's drawn
  transform, the grid in its own frame: at the point, or the Mean, Min or Max of 2K + 1 samples along the normal within
  ±Depth, K = ⌈Depth / half a voxel⌉, trilinear; a sample outside the grid's outer voxel centers counts for none, a
  periodic grid too; σ of the grid sampled), and `MeshVolumeColor`, a decorator between a mesh's shape and its
  representation (Shape.Provider → Shape.Provider): it samples (again only when the shape, the volume, the sample or the
  depth changed: its cache), keeps the values as an array and, while shown, colors the mesh by them (per vertex;
  per-cell values averaged to the vertices as a VTP colors a cell array; NaN gray).
- `cryoet.mesh` `volume` (name or ref), `sample` (surface, mean, min, max), `depth` (Å > 0; default 2 voxels), `invert`;
  `colorList` and `range` (σ) go to the volume coloring of a mesh shown by one. A color or an array turns Volume off
  (the decorator kept, its array with it); `volume` alone turns it on again with its last sample and depth.
  `cryoet.meshes` gives `volumeColor` (the volume's ref and label, sample, depth, colors, range, invert, the array's
  key; `missing` when its volume is gone). `CryoetApi.volumesState()`.
- The Look's Color by: Uniform | Array (with arrays) | Volume (with a volume in the scene, any mesh): the volume, Sample
  At surface | Projected, Along the normal Mean | Min | Max, Depth (± Å, on release), Colors, Range Auto ±2σ | Custom
  (σ), Color order As is | Inverted.
- Core state `weakDependencies` (a transformer flag): a deleted or absent dependency is waited for and the cell is
  evaluated without it (dependencies.md §3).
- stage-tools: `shapeCellOf` (drawn.ts), a mesh's shape past the decorators of its shape, for its move, placement and
  gizmo.
- cryoet `test:scaling` reads the shared harness where it moved (`test-harness/`): it did not load.
- ui.md (a Look row), features.md, `.v6/changelogs/mesh-volume-color.md`, the cryoet skill's guidance.

## Decided

- **Where it lives: a decorator, `MeshVolumeColor`, between the mesh's shape and its representation** (Claude, with the
  advisor). It is what sessions save (its params, never the values), what one write changes (one undo step), and what
  the state orders after the volume. Its params: the volume's drawn cell, the array's name, sample, depth, show, colors,
  range, invert.
- **The volume: its last decorator's object, by a weak dependency on it.** That cell is the grid as drawn (the Level is
  above it, a move's `VolumeTransform` is inserted above it), so a Level and a first move both re-evaluate it (tests). A
  plain dependency put the decorator, and so the mesh's representation, in error when the volume was removed (the mesh
  gone from the scene and its tree until an undo); without a dependency, a session with the mesh loaded first sampled
  before the volume existed. Hence `weakDependencies` in core state: library code (Ludo's call, as data-controls' S7).
- **The mesh: its shape's instance transform, read from the shape made with the shape's default props** (what Move and
  Scale write). A VTP's own `scale` param (the representation's) is not read: prism-me never writes it.
- **Sampling:** per cell when the mesh's arrays are (a VTP with cell arrays and no point arrays), else per vertex (an
  OBJ, a PLY, a VTP with point arrays or none). Samples every half voxel or less (the grid's shortest side), evenly from
  −Depth to +Depth (both ends and the point itself). Mean, Min, Max over the samples inside the grid; none inside: NaN,
  drawn gray. σ: (value − mean) / σ of the grid sampled (the binned grid's at another Level).
- **The array:** named `density_<volume file without extension>` (`_volume` added if the file has one so named), point
  or cell as sampled, Float32, in σ. A VTP's: the decorator makes a VTP shape of a copy of the file with new array maps
  (the parsed file's own maps untouched), so Array lists it and colors by it exactly as Volume does (test). An OBJ's or
  a PLY's: kept beside the mesh (`sampledArrayOf(provider)`); they have no Array coloring.
- **Range Auto is ±2σ**, Custom in σ; Invert reverses the color list (`ColorScale`'s `reverse`), the domain kept.
- **Off is not removal:** Uniform or Array turns `show` off and keeps the decorator and its array (Ludo: keep the values
  as an array); it is sampled again as the volume or mesh change.
- **The representation is made anew when the decorator comes or goes:** `ShapeRepresentation3D.update` keeps the getter
  it was made with and is given only new data. The decorator's provider is registered as moved by the identity
  (`transformShapeProvider`), so the representation is recreated when it is inserted or removed (an undo), and its
  getter reads everything from the data (`volumeColor` in it) in between; its `getShape` is put back to the unwrapped
  one (a wrapped shape is a copy, not picked by triangle).
- A mesh with groups other than its vertices (an OBJ's materials) is drawn by a copy with one group per vertex.
- Color… and `mesoscale.theme` (a plain color) turn Volume off as they turn an Array theme to Uniform today; Decision 13
  (not merged) treats both alike if it keys on `colorBy` or `volumeColor`.
- **Prism's shapes and the Look's Scale go past any decorator of a shape** (a move, a color by a volume): the
  prism-viewer `shapeEntries` fix is Prism library code, upstreamable, in a commit of its own.
- The Look's invert is "Color order" (As is | Inverted): "Scale" is the mesh's size there.

## Learned

- `ShapeRepresentation3D.update` calls the getter it was made with: a decorator that changes how a shape is drawn is
  never seen by an existing representation unless it is recreated.
- A params-derived dependency that is deleted keeps its dependents in error ("Unresolved dependency.") until it comes
  back; an explicit `dependsOn` removes them with it. Neither suits a drawing that reads another object.
- Stage-tools took a mesh's shape as its representation's parent: a decorator there made a move write into it.
- The lane's scratchpad (the coordinator's `vtpread.py`) was cleared by the crash: the reader was written again into the
  lane's scratchpad folder.
- The 7-2 walls: median −1.96σ at the surface over all cells (the coordinator's −1.37σ was another statistic); Projected
  Min ±40 Å: median −3.77σ, so Auto ±2σ saturates; Custom [−5.5, −2.5] shows the pattern on the walls.

## Checked in the app (port 1375)

`~/prism-me-lanes/mesh-volume-color-check.cjs` (Playwright, headless): the MRC and the VTP loaded, the VTP's Scale 10
(nm → Å), Color by Volume At surface (65 ms), then Projected Min ±40 Å, Invert (200 ms, 122 348 cells, none NaN), then
Mean ±5 Å. Six cells (0, 1000, 20 000, 50 000, 80 000, 122 000) against an independent Python read (the scratchpad's
`mesh-volume-color/crosscheck.py`: the MRC by its header, the cells' centroids and normals from the file ×10, trilinear
by hand): equal to 4 decimals at the surface, Min ±40 Å and Mean ±5 Å (e.g. cell 20 000: −1.7994σ, −4.3659σ, −1.6808σ).
Screenshots in the scratchpad's `mesh-volume-color/` (01 whole, 02 the Look, 04 Min ±40 Å inverted, Auto, close; 05 the
same, Custom [−5.5, −2.5]; 06 the Look's lower controls).

## Size

About 785 production lines added (55 removed) against ~250–350: `mesh-volume.ts` 410 (sampler ~150, the decorator and
its data-driven getter ~150, comments), `operations.ts` +178 (the op's checks and writes, `meshes`' `volumeColor`,
`volumesState`, the shape past the decorator), `controls.tsx` +187 (the Volume block, the choices made again as volumes
come), core state +23 (weak dependencies), stage-tools +32. What took the room: the representation's kept getter (a
data-driven getter, the recreate), the deletion case (weak dependencies), OBJ and PLY (a per-vertex mesh), the
stage-tools walk.

## Review

Reviewer (lane-reviewer) then skeptic (lane-skeptic) on `git diff f70471ae5..HEAD`; the confirmed findings' tests
committed failing first (the cryoet commit "failing tests from the review", the prism-viewer one), then each fix.

| Finding                                                                       | Verdict               | Outcome                                                                  |
| ----------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------ |
| M1 a VTP moved by `shape.transform` drawn unmoved once colored                | confirmed (probe)     | fixed: the rebuilt VTP shape moved as the shape above it moves it        |
| M2 Prism's `shape.list` / `shape.focus` miss a colored mesh's representation  | confirmed (agent, ⌘K) | fixed in prism-viewer `shapeEntries` (any shape decorator), its own test |
| S1 the VTP representation's own `scale` drawn, not sampled                    | refuted for prism-me  | open (nit): nothing in prism-me writes it; recorded under Decided        |
| S2 core-state `weakDependencies` in a prism-me lane                           | confirmed (process)   | open: Ludo's call (keep, or a lane from origin/master)                   |
| S3 every apply rebuilt the VTP shape and remade the inner shape               | confirmed             | fixed with M1 (one commit): both only when values or name change         |
| S4 Volume again took the scene's first volume                                 | confirmed (probe)     | fixed: `cryoet.meshes` `volumeKept`, the Look picks it                   |
| NEW-1 the Look's Scale after a `shape.transform` wrote nothing (pre-existing) | confirmed (probe)     | fixed: cryoet `shapeCellOf` past any shape decorator (also N5)           |
| N1 `depth`'s schema default 10                                                | confirmed             | fixed: 2, described as 2 voxels                                          |
| N2 an OBJ with material groups: a per-vertex copy, labels `Vertex g`          | confirmed / plausible | open (nit)                                                               |
| N3 Array by the kept array: NaN black, not gray                               | confirmed             | open (nit): a VTP theme's `ColorScale.color(NaN)`                        |
| N4 a volume's `instances` ignored                                             | refuted for prism-me  | none                                                                     |
| N6 no rotated or non-uniform sampler test                                     | confirmed             | open (nit)                                                               |

After the fixes: the app check gives the same values (the six cells equal to the Python read).
