# glTF 2.0 (GLB) meshes

`src/reader/gltf/`: `parseGltf(data)` reads a glTF 2.0 asset's meshes as triangles (a `GltfFile`), `gltfToObj` bakes its
scene into one world-space mesh for the OBJ shape builder. The constants (component types, primitive modes, GLB magic
and chunk types) are in `schema.ts`, shared with geo-export's GLB writer. Spec:
https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html.

## 1. Container

- **GLB** (magic `glTF`, version 2): the JSON chunk and the BIN chunk; buffer 0 without a `uri` is the BIN chunk. A
  length past the end, a chunk past the end or no JSON chunk is an error.
- **.gltf** (anything without the magic is read as JSON text): only buffers as base64 data URIs. An external `uri` is
  refused by name: a reader gets one file's bytes, and resolving siblings is the caller's (as the OBJ's MTL is).
- `asset.version` must be `2.x`.

## 2. Accessors: views where possible

- **A view, not a copy**, on the input bytes when the accessor is tight (`byteStride` absent or the element size),
  aligned (the absolute byte offset, including the input's own `byteOffset`, a multiple of the component size) and the
  host little-endian: the float attributes and the indices of a well-formed GLB (trimesh, Blender, Mol*'s exporter).
  Why: a portal mesh is read without touching its arrays; the bake (§3) is the one copy. The result keeps the input
  alive and reads it: `ParseGltf` hands the reader a copy of shared response bytes (`.v6/data-response`).
- **Decoded otherwise** (interleaved, unaligned, integer or normalized attributes): `DataView` reads, little-endian,
  normalized integers scaled as spec §3.11 (signed clamped at -1). So `KHR_mesh_quantization` needs no code of its own.
- An accessor shared by several primitives is read once (a map by accessor index).
- Indices must be unsigned scalars and below the vertex count (checked once per accessor: a consumer indexing the views
  never reads past them).
- Refused: sparse accessors and accessors without a buffer view (only meaningful with sparse).

## 3. Scene to mesh

- **Modes:** TRIANGLES (the default) as is; TRIANGLE_STRIP and TRIANGLE_FAN converted to a list (spec §3.7.2.1: odd
  strip triangles swap their first two vertices, fan triangle i is (i+1, i+2, 0)). POINTS and LINES primitives are
  skipped with a warning; a scene without triangles is an error.
- **Nodes:** the default scene (`scene`, else 0); without scenes the root nodes (no parent); without nodes each mesh
  once. Each node's `matrix` (column-major, as `Mat4`) or TRS (`Mat4.compose`) times its parent's; a node reached twice
  is an error (glTF nodes form a strict tree). Only the meshes the scene uses are read.
- **The bake** (`gltfToObj`): every primitive of every mesh node, its positions times the node's world matrix, its
  normals times the inverse transpose; a negative determinant reverses the winding (spec §3.7.4). One face group per
  mesh primitive and label: the label is the node's name, else the mesh's, else `Mesh <i>`, with the primitive's glTF
  index when the mesh has several (made unique per label, a suffix counter, not a scan). Instances of a mesh under one
  name share their groups (so picking one highlights its namesakes): the group count is the names', not the nodes',
  which keeps an instanced scene's colour parameters few. The groups are the OBJ's material groups: picking labels them,
  the shape's colour parameters list them. `gltf.scaling.ts` guards the bake at n and 4n same-named nodes.
  `normalIndices` is `positionIndices`, so the OBJ builder takes its indexed path and duplicates no vertex. Normals are
  kept only when every primitive has them (else the builder computes them all: a partial set would leave some zero).
- **Colours:** a material's `baseColorFactor` is the group's MTL `Kd` (the shape's `given` colouring); without any
  material the MTL is empty and the shape is coloured as an OBJ without one (`custom`: grey for one group, distinct
  colours for several). COLOR_0 (RGB or RGBA, float or normalized) times the base colour is the vertex colour;
  primitives without it take their base colour. glTF colours are linear, Mol*'s sRGB: converted on floats, not through
  8-bit `Color`s (which band the dark tones), then clamped and rounded to 8-bit steps (`Color.fromNormalizedRgb`, which
  packs them, neither clamps nor rounds).

## 4. Units

Positions are read as Å, unscaled. The CryoET Data Portal's meshes (trimesh) say `extras.units: "meters"` while their
values are Å (a 10 Å-voxel tomogram is 5480 × 7720 in x, y), so `extras` is not read.

## 5. Refused, clearly

`extensionsRequired` other than `KHR_mesh_quantization`, `KHR_texture_*` and `KHR_materials_*` (which change nothing
read here) is an error naming them: Draco (`KHR_draco_mesh_compression`), meshopt (`EXT_meshopt_compression`). An
extension only in `extensionsUsed` has its uncompressed fallback, which is read. Textures, skins, morph targets and
animations are not read.
