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
- **The lookup** (`geo/geometry/mesh/triangle-pick.ts`): the triangles sorted by the grid cell of their centroid (a
  counting sort; cells about two triangles wide, at most half a cell a triangle), queried at the depth point with the
  largest centroid-to-vertex distance of the triangles the grid holds added; built at the first pick of a mesh and kept
  while its vertex and index buffers are the same versions (a `WeakMap` on the mesh). A triangle wider than 8 times a
  typical one is not in the grid (the widest 64): it would set that distance for every pick, and one floor under a fine
  surface would make every hover read every cell. A pick tests those few on their own, so one of them is still found
  far from its centroid. The grid's box is the other triangles: a wide centroid outside the surface does not coarsen
  the cells. Not `GridLookup3D`: it keeps the centroids and its buckets (20 bytes a triangle against 6) and
  built 12× slower. Nothing allocated per pick but the loci.
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
  made with the representation (empty), not pickable, shown and moved with the mesh. A loci from before the move (the
  old shape, the same mesh) still clears its triangle. A triangle loci never marks its group; the whole shape or
  everything clears the copies.

## Cost

Measured 2026-10-31 on an M1 Max, Chrome (headless, Metal), a UV sphere of radius 500 Å (a membrane's density), one
material. The lookup: `triangle-pick-scaling.test.ts` (heavy lane; `TRIANGLE_PICK_N=1000000` for these sizes).

| Triangles | Lookup build | Lookup bytes          | Mesh's own (CPU) | A pick (p50 / p95) |
| --------- | ------------ | --------------------- | ---------------- | ------------------ |
| 1 M       | 24 ms        | 6.0 MB (6 B/triangle) | 26 MB            | 30 µs / 76 µs      |
| 4 M       | 86 ms        | 24 MB                 | 104 MB           | 47 µs / 120 µs     |

`GridLookup3D` in its place: 297 ms and 20 MB at 1 M. In the app (1 M triangles, WebGPU and WebGL2): the narrowing
under 0.1 ms (p95) a hover; the same triangles found on both backends; frames unchanged with a triangle highlighted
(16.7 ms p50, vsync, both); one more draw call (the marked copies, 2 triangles a mark). Pointer move to hover event
46 ms (median of 12) by group, where one material never changes, against 57 ms by triangle, where each move moves the
highlight (a redraw); the first hover builds the lookup (and, on WebGL2, compiles the copies' program: 280 ms once).

One group per triangle instead, at 1 M triangles (500 k vertices): unindexed, 3 M vertices of 28 bytes (position,
normal, group) are 84 MB against 14 MB, with a color and a marker texel a triangle; the provoking-vertex reorder (about
one vertex a triangle, 28 MB) depends on the backend's provoking vertex, and vertex colors would no longer
interpolate.

## Open

- A preview move (`setState({ transform })`) is not read by the pick: during a drag the triangle is found where the
  mesh was.
- Overpaint, transparency and focus by a triangle loci apply to its group.
- A mesh with a few huge triangles and many small ones queries a large radius (the largest triangle's).
