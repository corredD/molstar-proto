# Shape fixtures

Small, real mesh files for tests and for trying a shape format in the app. Downloaded on 2026-11-02, not edited.

| File                    | Format       | Size     | Contents                                                    | Units         |
| ----------------------- | ------------ | -------- | ----------------------------------------------------------- | ------------- |
| `cryoet-10521-mesh.glb` | glTF 2.0 GLB | 183.7 KB | one mesh, 5084 vertices, 10164 triangles (POSITION, uint32) | Å (see below) |

## cryoet-10521-mesh.glb

- **Source**:
  https://files.cryoetdataportal.cziscience.com/10521/L2_P2_ts_002/Reconstructions/VoxelSpacing10.005/Annotations/101/sample-1.0_mesh.glb
- **Entry**: CZ CryoET Data Portal dataset 10521 ("Cryo-FIB-milled NIH/3T3 mouse fibroblasts (dataset 1)", _Mus
  musculus_), run L2_P2_ts_002, annotation 101 (`sample`, the lamella), shape `Mesh`.
- **Layout**: written by trimesh; nodes `world` → `geometry_0`, no material, no normals, no Draco. Bounds (the
  accessor's): min (0, 0, 682.92), max (5480, 7720, 2804.80). `extras.units` says "meters", but the values are Å.
- **Read by**: `packages/io/src/reader/_test/gltf.test.ts`,
  `packages/plugin/core/src/state/formats/_test/gltf-load.test.ts`.
