# Triangle picking on meshes

A file's mesh (OBJ, PLY, VTP) is hovered, highlighted, selected and measured by triangle. Its groups stay what they
were (a material, a vertex for vertex colors, a PLY property): they carry its colors, its overpaint and transparency
layers and its labels.

## Decisions

- **The GPU picks the group, the CPU finds the triangle.** The pick pass gives the object, the instance, the group and
  the depth point. `Canvas3dInteractionHelper.getLoci` narrows a group loci of a shape that opted in
  (`Shape.getTriangleLoci`, set by `enableTrianglePicking` in `geo/shape/shape.ts`) to the triangle under the pointer:
  the pointer's ray (the eye through the depth point, which lies on it) against the triangles near the depth point,
  the hit nearest to the depth point (not the first along the ray: a clipped front is not what the pick saw); no hit (a
  pick a few pixels off an edge, the pick buffer's spiral): the triangle nearest to the depth point. Why: no
  `primitive_id` in WebGL2 or core WebGPU, and one group per triangle cannot be had on an indexed mesh (a closed mesh
  has about half as many vertices as triangles; a flat group is its provoking vertex's, the last in WebGL and the
  first in WebGPU), so it would need an unindexed mesh: 3× to 6× the vertex memory, vertex colors no longer
  interpolated, per-material layers per triangle.
- **The lookup** (`geo/geometry/mesh/triangle-pick.ts`): a `GridLookup3D` over the triangles' centroids, queried at
  the depth point with the largest centroid-to-vertex distance added, built at the first pick of a mesh and kept while
  its vertex and index buffers are the same versions (a `WeakMap` on the mesh). Nothing allocated per pick but the
  loci.
- **Opt in per shape**, never by geometry: Mol\*'s planes, boxes and handles are meshes whose groups are their meaning.
  A wireframe of a mesh is not picked by triangle.
- **The loci** is a `ShapeGroup.Loci` with `triangles` (`{ instance, index, uv }`): what reads only `groups` (labels by
  group, the gizmo, MVS) takes it as its group, as before. `areLociEqual` compares the triangles (their picked points
  aside); `structure` granularity makes it the whole shape (whole-mesh select stays one click at that granularity); its
  bounds (`Shape.getTriangleBoundingSphere`) are centered on the picked point.
- **The point on a triangle is the picked surface point**, kept as barycentric weights `uv` of the triangle's second
  and third vertices in the mesh's space, evaluated through the instance's current transform: it follows a move, a
  turn and a scale exactly and is saved with a session. Mol\*'s distance, angle and dihedral representations measure
  between bounds' centers, so they measure from that point. As ChimeraX's surface markers and 3D Slicer's model
  markups place theirs. A centroid would move the point up to half a triangle from where the person clicked; a vertex,
  up to a whole edge.
- **Marked triangles are drawn again** (`repr/shape/triangle-marks.ts`): the mesh's marker is by group and instance,
  so a marked triangle is a copy, in its group's color, with the marker on (Mol\*'s highlight and select looks), a hair
  off each side of the surface (0.5 % of its longest edge) so the side in view draws over the mesh. One render object
  made with the representation (empty), not pickable, shown and moved with the mesh. A triangle loci never marks its
  group; the whole shape or everything clears the copies.

## Cost

Measured on the dev build, M1 Max, Chrome (numbers in `apps/prism-me/progress/2026-10-31-mesh-measure.md`).

## Open

- A preview move (`setState({ transform })`) is not read by the pick: during a drag the triangle is found where the
  mesh was.
- Overpaint, transparency and focus by a triangle loci apply to its group.
- A mesh with a few huge triangles and many small ones queries a large radius (the largest triangle's).
