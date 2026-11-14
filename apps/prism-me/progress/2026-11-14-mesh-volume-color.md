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
  `7-2_capsids_curvature.vtp`), or **Projected**: the Mean, Min or Max of the density along the normal within ±Depth
  (Å; default 2 voxels; sampled every half voxel, trilinear).
- **Values in σ** of the volume (mean and σ of its grid); a color scale (the existing Array scales), a Range Auto (±2σ)
  or Custom, and Invert (a tomogram's protein is dark).
- **Live:** changing the volume, Sample, Depth or the volume's Level recolors; one undo step a change; saved in
  sessions (the parameters, not the values; recomputed on load).
- **Kept as an array (Ludo: yes):** the sampled values are also added to the mesh as a named array (e.g.
  `density_<volume>`), per vertex or per cell as sampled, so Array coloring and later tools (a density-weighted grow on
  the surface) can read it; it is refreshed with the coloring. State whether it lives in the mesh's data or beside it,
  and keep the file's own arrays untouched.
- **Any mesh:** VTP, OBJ, PLY. `cryoet.mesh`'s `colorTheme` gains the volume choice (⌘K, the assistant).
- Decision 13 (lane decisions, not merged yet): Color… leaves an array theme alone; treat a volume theme the same.

**Tests, failing first.**
- A synthetic sphere mesh inside a synthetic volume with a known radial profile (a dark shell at the mesh's radius):
  At surface gives the profile's value at each vertex; Projected Min ±Depth finds the shell's minimum when the mesh is
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

**Model.** Opus (frames of mesh and volume, the projection). **Port** 1375 (`node scripts/esbuild/app.mjs apps/prism-me
--dev --port 1375`, log `~/prism-me-lanes/dev-1375.log`), left running.
