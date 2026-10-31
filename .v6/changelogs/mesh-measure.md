## Graphics: meshes picked by triangle

- A file's mesh (OBJ, PLY, VTP) is hovered, highlighted and selected by triangle: the GPU pick's group is narrowed on
  the CPU to the triangle under the pointer (`Shape.getTriangleLoci`, opted in by `enableTrianglePicking`), the loci a
  `ShapeGroup.Loci` with `triangles` (its picked point as barycentric weights), its bounds centered on that point. Its
  groups (materials, vertex colors) are unchanged. 1 M triangles: the lookup 24 ms to build once, 6 MB, a pick under
  0.1 ms.
- One very wide triangle whose center sits outside the surface does not coarsen that grid: a hover still reads only
  the cells near the pointer.
- A shape representation marks triangles by themselves (copies of the marked triangles drawn over the mesh), never
  their group. A highlight made before the mesh moves still clears when that same loci is removed.
- `Ray3D.intersectTriangle` (Möller–Trumbore, either side).

## prism-me: Stage tools

- Measurements from a mesh's triangle, at the point picked on it, following the mesh's moves and scales; between
  triangles, atoms, residues, particles and voxels. A triangle picked before the mesh is moved, scaled or recolored
  still measures.
- An angle and a dihedral between any of these points: `stage.angle`, `stage.dihedral`, and in the explorer the latest
  three or four ⌘/Ctrl+clicked points by the canvas's right-click. Each point keeps its row, so its properties button
  reveals that row. Measuring the angle or the dihedral leaves the unpaired point, so the next click still completes
  its distance.
