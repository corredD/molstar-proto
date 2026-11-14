## prism-me: CryoET

- A mesh's Color by › Volume in its Look (any mesh: VTP, OBJ, PLY): a volume of the scene, sampled At surface (each
  vertex, or each cell's center when the mesh's arrays are per cell) or Projected (the Mean, Min or Max along the normal
  within ±Depth Å, every half voxel, trilinear), in σ of the volume's grid; a color scale, a Range (Auto ±2σ or Custom,
  in σ) and a Color order (As is or Inverted). The mesh and the volume are read where they are drawn (the mesh's
  instance transform, its scale; the volume's Level and move), and it follows them: a Level, a move, Depth or Sample
  recolors, one step each; sessions keep the parameters and sample again. The values are kept as the mesh's array
  `density_<volume>` (a VTP's beside its file's own, which stay as read), so Array can color by it. Removing the
  volume leaves the mesh gray (no values) until it comes back. `cryoet.mesh { volume, sample, depth, invert }`;
  `cryoet.meshes` gives a mesh's `volumeColor`; `CryoetApi.volumesState`.
- `MeshVolumeColor` (cryoet): a decorator between a mesh's shape and its representation.
- stage-tools: a mesh's move, placement and gizmo find its shape past such decorators; cryoet: a mesh's Scale too
  (after a `shape.transform` it wrote nothing before).
- Prism viewer: `shape.list`, `shape.focus` find a shape's representations under any decorator of it.
- Core state: a transformer's `weakDependencies` (dependencies.md §3): a deleted or absent dependency is waited for, the
  cell evaluated without it, instead of an error that takes its children with it.
