## Formats: glTF 2.0 meshes as shapes

- glTF 2.0 meshes open as shapes, next to OBJ, PLY and VTP: GLB, or .gltf with its buffers as data URIs (format
  `gltf`, `ParseGltf`, `ShapeFromGltf`; io `parseGltf`, `gltfToObj`). The scene's node transforms are applied, each
  primitive of each node is a group (named, coloured by its material's base colour or COLOR_0); triangle strips and
  fans are converted. Compressed meshes (Draco, meshopt), sparse accessors and external buffers are refused by name.
  Read on the CryoET Data Portal's meshes (Å).
- geo-export's GLB writer takes its glTF constants from `@molstar/io/reader/gltf/schema`.
