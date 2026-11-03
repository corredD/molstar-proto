# Lane `glb-reader` (library): glTF 2.0 binary (GLB) meshes as shapes (2026-11-02)

Branch `me/glb-reader` from c1b8ecb82. Library lane: packages/ only, upstreamable. This file is untracked; the
coordinator copies it into prism-me's progress folder at close. Keep its sections up to date.

## Brief

- **Asked** (Ludo, 2026-11-02): CryoET Data Portal plan part C
  (`~/molstar-prism-me/apps/prism-me/plans/2026-11-02-cryoet-portal.md`). "Expert coding, efficient and optimized. No
  repetition with existing code."
- **Check:** drop a portal GLB mesh (dataset 10524 or 10521 have them; find one with the portal GraphQL API
  `https://graphql.cryoetdataportal.czscience.com/graphql`, shape `Mesh`, or a file under
  `https://files.cryoetdataportal.cziscience.com/` ending `.glb`; ~180 KB, POSITION + indices, no Draco, in Å) into a
  Mol* viewer: it shows as a shape like an OBJ does, at the right place and size in Å; its triangle count and bounds
  match the file's accessors.
- **Build:**
  1. `packages/io/src/reader/gltf/`: GLB container (header, JSON chunk, BIN chunk), the JSON's meshes/primitives (mode
     TRIANGLES; TRIANGLE_STRIP/FAN converted or refused clearly), accessors (componentType float/uint8/16/32,
     normalized, byteStride, sparse refused), bufferViews, node hierarchy transforms (matrix or TRS) applied, POSITION,
     NORMAL if present, COLOR_0 or a material's baseColorFactor as one color per primitive; Draco / meshopt / KHR_*
     compression: a clear "unsupported" error. Typed-array views on the BIN chunk where aligned, no copies.
  2. **Reuse first:** `packages/extensions/geo-export` writes glTF/GLB: grep its constants/types (component types,
     magic, chunk types). If shared constants are needed by both, move them down into `packages/io/src/reader/gltf/` (or
     a common io module) and make geo-export import them: no duplication. Check the boundary rules in `biome.json`.
  3. A shape format next to OBJ/PLY/VTP in `packages/plugin/core/src/state/formats/shape/` and its catalog (extensions
     `.glb`, maybe `.gltf` only if it embeds its buffer as a data URI; else refuse), and the geometry built the way
     `@molstar/graphics/formats/shape/obj` builds a Mesh (reuse its builder path, groups per primitive/node).
- **Spec:** `packages/io/src/reader/gltf/_spec/gltf.md`; the format list where shapes are specced. Changelog
  `.v6/changelogs/glb-reader.md`.
- **Tests:** Vitest: a tiny GLB made in the test (or by a python script in the test folder: `pygltflib`/`trimesh` in the
  conda env `cryoet-portal`, create it if missing, `~/miniforge3/bin/conda create -y -n cryoet-portal python=3.11 ...`;
  check `conda env list` first), node transforms, interleaved byteStride, uint16 vs uint32 indices, a refused Draco
  file; the portal GLB's header values (downloaded once into the test as a fixture only if < 300 KB, else a trimmed
  synthetic one).
- **Stays off:** `packages/io/src/reader/zarr/**` and volume formats (lane `ome-zarr`), `packages/extensions/cryoet/**`,
  `apps/**`, `packages/graphics/**` except the shape builder if it truly needs a change (say why).
- **Size:** ~350 production lines.
- **Done:** `npx tsc -b`, `pnpm lint`, `pnpm format:check`, `pnpm check:workspace`,
  `pnpm test:unit packages/io packages/plugin/core packages/extensions/geo-export`; gate; PR
  `gh pr create -R corredD/molstar-proto --base prism-me`.

## Built

PR: https://github.com/corredD/molstar-proto/pull/38 (base `prism-me`, not merged).

- `packages/io/src/reader/gltf/`: `schema.ts` (glTF constants, shared with geo-export; the `GltfFile` record),
  `parser.ts` (`parseGltf`: GLB or .gltf with data URIs; views on the BIN chunk where tight, aligned and little-endian,
  decoded otherwise; strips and fans converted; node matrix/TRS hierarchy; refusals by name), `to-obj.ts` (`gltfToObj`:
  the scene baked into one world-space `ObjFile` and `MtlFile`).
- `packages/plugin/core/src/state/formats/shape/gltf.ts`: `ParseGltf`, `ShapeFromGltf` (bake, then `shapeFromObj`),
  `GltfProvider` (format `gltf`, `.glb` binary, `.gltf` string), appended to `BuiltInShapeFormats`; `SO.Format.Gltf`.
- geo-export's `glb-exporter.ts` imports the constants from io (no private copy).
- Fixture `data/examples/shapes/cryoet-10521-mesh.glb` (183.7 KB, dataset 10521 run L2_P2_ts_002) with a README.
- Specs: `packages/io/_spec/gltf.md` (new), io `_spec/README.md` (file table, binary formats list),
  `.v6/data-response/README.md` (glTF keeps views, so it reads a copy), `.v6/plans/plugin-composition.md` §6.1 and
  `scripts/workspace/registry-compare.mjs` (the new format allowed). Changelog `.v6/changelogs/glb-reader.md`.
- io gained a `test:scaling` tier (`packages/io/vitest.scaling.config.ts`, `gltf.scaling.ts`: the bake at n and 4n
  same-named nodes, with the quadratic control; biome exempts the config's default export).
- Tests: `packages/io/src/reader/_test/gltf.test.ts` (portal file counts, bounds and views; TRS × matrix hierarchy;
  mirror flips winding; interleaved stride and normal transform; uint8/16/32 indices; unaligned and quantized copies;
  strip and fan; groups, names, colours; .gltf data URI; points/lines skipped; refusals), plugin
  `formats/_test/gltf-load.test.ts` (the portal file through auto → parse → shape → representation), geo-export's export
  test reads its GLB back with `parseGltf`; `format-entries` and `empty-registries` updated.

## Decided

- **Groups by (mesh, primitive, label)**, not one per node (review 4): instances of a mesh under one name share their
  groups, so an instanced scene's colour parameters stay few; the cost is that picking one highlights its namesakes.
- **Reuse the OBJ shape builder, no new graphics code** (me): the glTF scene is baked into an `ObjFile` (`normalIndices`
  = `positionIndices`, so OBJ's indexed path, no vertex duplicated; a face group per primitive per node; base colours as
  an MTL; COLOR_0 as vertex colours). OBJ's colourings and labels come free; `packages/graphics` untouched.
- **The reader returns a record (views and per-instance world matrices), the bake is separate** (`gltfToObj`, in io):
  the reader stays usable without the OBJ path; the bake is the one copy.
- **Spec at `packages/io/_spec/gltf.md`**, not `src/reader/gltf/_spec/`: io keeps its specs in the package `_spec/`
  (cif.md), cited as `gltf.md §n`.
- **Fixture in `data/examples/shapes/`**, not the test folder: io's spec takes real files from `data/examples` only, and
  the plugin test (and Ludo's drag-and-drop check) use the same file.
- **COLOR_0 kept per vertex** (OBJ's `vertex` colouring), not one colour per primitive as the brief said: free with the
  OBJ path, and right for Mol*'s own GLB exports (which always write COLOR_0).
- **`KHR_mesh_quantization`, `KHR_texture_*`, `KHR_materials_*` accepted when required** (they change nothing read: the
  decoder takes any component type); any other required extension (Draco, meshopt) refused by name.
- **No units from `extras`**: the portal's trimesh files say "meters", the values are Å.
- **Colours linear → sRGB on floats** (`Color.linearToSRGBNormalized`, core's channel function, now exported), then
  clamped and in 8-bit steps: core's packed `Color.linearToSRGB` truncates the linear value to 8 bits first (0.21586
  gives 0x7e, not 0x80) and `fromNormalizedRgb` truncates (1 gives 0xfe).
- **`ParseGltf` reads a copy** (`readBytes(a, { copy: true })`): the parsed file keeps views on its input, as VTP and
  DCD do (`.v6/data-response`).
- Not done: conda/pygltflib (synthetic GLBs written in TS in the test instead); `apps/viewer/src/state-transforms.ts`
  (apps stay off: the Viewer's `StateTransforms` listing lacks `ParseGltf`/`ShapeFromGltf`; loading works through the
  format registry); MVS `parse({ format: 'gltf' })` not wired.

## Learned

- Portal GLBs (10521): trimesh, nodes `world` → `geometry_0`, the index view first then the positions, all 4-aligned:
  the reader views both arrays with no copy.
- `registry-compare.mjs` (in `check:workspace`) and `empty-registries.test.ts` pin the format list: a new format adds
  itself to both.
- `~/.gitignore_global` ignores `Data` (case-insensitive: `data/`): new files under `data/examples` need `git add -f`.

## Size

About 720 production lines (parser 400, schema 80, bake 145, plugin format 94; headers, comments and Biome's line breaks
included) against about 350. What took the room: the parser's validation and messages (every refusal by name), the
decoder for strided, integer and normalized accessors, and the bake (grouping, normals, colours).

## Review

Reviewer (Opus, read-only): 3 must-fix, 4 should-fix, 3 nit. Skeptic: 9 confirmed (the 3 must-fix downgraded to
should-fix: invalid input or a secondary path), 1 refuted, 2 new (1 should, 1 nit). Each confirmed should-fix got a
failing test, then its fix.

| Finding                                                                    | Severity      | Verdict                                                      | Commit / open                                                                                                                     |
| -------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 1 Shared index accessor checked against the first primitive only           | must → should | confirmed                                                    | 1c5975b68                                                                                                                         |
| N1 The same, aliasing into the next primitive's vertices                   | should        | confirmed                                                    | 1c5975b68                                                                                                                         |
| 2 Truncated or non-base64 data URI read as zeros                           | must → should | confirmed                                                    | 285243046                                                                                                                         |
| 3 Group-name dedupe quadratic (×17.6 at 2000 → 8000 nodes)                 | must → should | confirmed                                                    | d74f2f1e5 (scaling guard)                                                                                                         |
| 4 One group per node: thousands of colour params, `distinctColors` seconds | should        | confirmed                                                    | d74f2f1e5 (groups by name); open: N uniquely named nodes still N groups, a cap belongs in graphics' `createObjShapeParams` (TODO) |
| 5 Vertex colours unclamped (1.2 red packed as #140000)                     | should        | confirmed                                                    | d497b6dec, fe09f2084                                                                                                              |
| 6 Normal test could not tell inverse transpose from the plain matrix       | should        | confirmed                                                    | 1d80e9a06                                                                                                                         |
| 7 sRGB formula copied from core                                            | should        | confirmed                                                    | 520033cc1                                                                                                                         |
| 8 Singular node: stale normal matrix                                       | nit           | confirmed                                                    | 1d80e9a06                                                                                                                         |
| 9 Spec: "grey" only for one group                                          | nit           | confirmed                                                    | d74f2f1e5                                                                                                                         |
| N2 Primitive names shifted by skipped points/lines                         | nit           | confirmed                                                    | d74f2f1e5                                                                                                                         |
| 10 Copy test does not assert a new buffer                                  | nit           | refuted (an unaligned view throws, so the test fails anyway) | none                                                                                                                              |
