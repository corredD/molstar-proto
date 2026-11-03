# CryoET Data Portal, direct: browse and load portal data in the browser, without copick (2026-11-02, lane `cryoet-portal`)

Parked (Ludo, 2026-11-02: "is it worth using copick or just go without it?", then "yes" to writing the plan for the
direct route). Started on Ludo's word: the lane copies this brief to its `progress/<date>-cryoet-portal.md` and builds
from there.

## Brief

- **Asked** (Ludo, 2026-11-02): "find an example with 1 tomogram, 1 segmentation mesh, one particle list (.star), one
  STA map and PDB", "review how we could connect to cryoET data portal directly", "doesn't biohub and cryoETdata have a
  library, copick? could we use that?". **Check:** on the published static site (no server of ours), open
  `?portal-dataset=10003&portal-run=TS_08`. The ribosome set loads: the binned tomogram as slices, the membrane mask as a
  surface, the 378 ribosomes decorated with 7PHB, and the EMD-13412 average beside them. The ribosomes sit in the
  densities of the tomogram.
- **Decision** (2026-11-02): no copick dependency. copick reaches a browser only through a Python server (copick-web),
  and prism-me ships as a static site. The work that makes portal data load (the OME-Zarr and GLB readers) is the same
  with or without copick. copick stays a later second source (part E).
- **Spec:** `apps/prism-me/_spec/features.md` gains the portal rows. New `extensions/cryoet/_spec/portal.md`: the index,
  the operations, the frames and units, the size guards. Upstream readers have their own spec next to the reader.
- **Touches:** `packages/io` (a new `reader/zarr/`, a new `reader/gltf/`, `reader/cryoet/ndjson.ts`), `packages/model`
  (`formats/particles/ndjson.ts`), `plugin/core` (volume and shape formats), `packages/extensions/cryoet` (the portal
  source, the panel), `apps/prism-me/src/url.ts`. A new `tools/portal-index/` (Python, not shipped).
- **Base and delivery:** the readers (B, C) are library lanes from `git merge-base origin/prism-me upstream/master`, with
  PRs into the fork's `prism-me`, and later upstream on Ludo's word. The portal source and the panel (A, D) are
  prism-me only.

## What was found (2026-11-02, by curl; the dataset and API reports of that day)

**The example set: portal dataset 10003, *M. pneumoniae* 70S ribosomes, chloramphenicol** (Xue, Cramer, Mahamid;
EMPIAR-10499; doi:10.1038/s41586-022-05255-2). Our fixture `.me-data/fixtures/cryoet-ribosomes.ndjson` comes from
this dataset (run TS_01).

| Piece | ID | Size | Note |
|---|---|---|---|
| Tomogram | run TS_08 (run 368, tomogram 638), 6.802 Å, 928×928×450 | 1.55 GB MRC; Zarr level 1 (13.604 Å) about 194 MB | TS_01 = tomogram 631, run 361 |
| Segmentation | membrane, annotation 2321, SegmentationMask | 388 MB MRC, 3.3 MB Zarr | no mesh: make one from the mask |
| Particles | ribosomes, annotation 1212, OrientedPoint ndjson, 378 points | 119 KB | voxels of the 6.802 Å tomogram; no .star |
| STA map | EMD-13412, 70S with A and P tRNAs, 4.9 Å | 7.8 MB | `files.wwpdb.org/pub/emdb/structures/EMD-13412/map/` |
| Model | PDB 7PHB, fitted into EMD-13412 | 3.3 MB | |

File base: `https://files.cryoetdataportal.cziscience.com/10003/TS_08/Reconstructions/VoxelSpacing6.802/`. Runner-up:
dataset 10453, synaptic vesicles (no fitted PDB).

**The portal:**

- **GraphQL** `https://graphql.cryoetdataportal.czscience.com/graphql`. Schema: datasets → runs →
  tomogramVoxelSpacings → tomograms; annotations → annotationShapes → annotationFiles. Shapes: SegmentationMask,
  OrientedPoint, Point, InstanceSegmentation, InstanceSegmentationMask, Mesh. **Browsers can't use it:** every CORS
  preflight returns 400 `Disallowed CORS origin` (it has an allow-list), and a GET has no `Access-Control-Allow-Origin`.
- **Files** `https://files.cryoetdataportal.cziscience.com/` (note: cziscience, not czscience). GET returns
  `Access-Control-Allow-Origin: *`. A `Range` request needs a preflight, and the preflight gets 403: **from a browser,
  whole files only.** The host can't list files: the metadata must come from somewhere else.
- **OME-Zarr:** Zarr v2, NGFF 0.4, axes z,y,x in Å, 3 levels (1×, 2×, 4×), 256³ chunks, `/` separator, blosc-lz4 with
  byte-shuffle. Tomograms `<f4`, masks `|i1`. A 4× level of a tomogram is one chunk of about 14 MB.
- **Meshes:** GLB, POSITION plus indices, no Draco, in Å (some datasets only, e.g. 10524/10521; not 10003).

**prism-me today:** no Zarr reader and no blosc decoder; no GLB reader (OBJ, PLY, VTP only); the ndjson reader rejects
`instancePoint`; `pixelSize` in `formats/particles/ndjson.ts` already scales voxels to Å. The rotation convention of
`orientedPoint` is not documented by the portal.

## Steps

**A. The index and the particles (no new reader).**

1. `tools/portal-index/`: a Python script on the portal client (`cryoet_data_portal`). For each chosen dataset it writes
   one JSON: runs → voxel spacings → tomograms (sizes, levels, file URLs) → annotations (shape, format, URL, size,
   object name, spacing). It is built once and shipped with the app under `apps/prism-me/portal/`. The format is
   versioned. Test: the index of 10003 has TS_08 with annotation 1212 and its URL.
2. The `instancePoint` records in `reader/cryoet/ndjson.ts` (`instance_id` kept as a per-particle attribute). Test first:
   a small instance ndjson fixture fails today with "No readable records".
3. The rotation check: load the 10003 ribosomes decorated with 7PHB over the TS_08 tomogram. The 70S densities in the
   tomogram give the truth. A test fixes the convention: a known point and matrix give a known orientation.
4. The portal source in the cryoet extension (`ExtensionApis`, `cryoetPortal`): `portal.datasets()`, `portal.run(id)`,
   `portal.load({ run, tomogram, level, annotations })`. Loads reuse existing operations: ndjson by `load.url` with
   `pixelSize` = the annotation's voxel spacing, from the index only (not mixed with the Zarr scale; they differ in the
   third decimal).
5. URL params `portal-dataset`, `portal-run`, `portal-annotations`, `portal-level`, read the way `url.ts` reads the
   mesoscale ones.

Gate: the particles of TS_08 load from the portal on the static build, decorated, in the right orientation.

**B. OME-Zarr volumes (library lane, upstream candidate).**

1. `packages/io/src/reader/zarr/`: a Zarr v2 reader: `.zarray`, `.zattrs` NGFF multiscales, chunks, dtypes `<f4`, `|i1`,
   `|u1`, `<u2`. Codecs: blosc (lz4, zstd, zlib) with shuffle, by a lazy-loaded WASM decoder; check the bundle size
   against the budget.
2. A volume format in `plugin/core`: choose a level (default: the coarsest), assemble the chunks, set the grid from the
   NGFF scale and translation in Å. Check the half-voxel offset against the MRC of the same tomogram (both must overlay
   the same ribosome to within one voxel).
3. Size guard: warn above about 200 MB decoded, ask before more. Chunks kept in the Cache API.
4. Masks: the `|i1` volume shown as an isosurface at 0.5 (the membrane of 10003), or meshed once in a worker.

Gate: the TS_08 tomogram (level 1 and 2) and its membrane mask load from the portal, overlay the MRC exactly; tests on
small Zarr fixtures made by `zarr-python` (each dtype, each codec).

**C. GLB meshes (library lane, upstream candidate).**

`packages/io/src/reader/gltf/`: GLB, POSITION, NORMAL if present, indices, the node transforms; no Draco, no
materials beyond a base colour. A shape format next to OBJ, PLY and VTP. Test: the sample GLB from dataset 10524 (about
180 KB) gives its triangle count and its bounds in Å.

**D. The portal panel.**

A panel in the cryoet extension's UI chunk: dataset (from the index) → run (thumbnail if the portal has one) → voxel
spacing and level, with the sizes → annotation checkboxes → load. The right-click menu on a portal object can show its
DOI and its portal page. Storybook story for the panel.

Gate: Ludo loads 10003 TS_08 and one other dataset from the panel, on the published site.

**E. Later, on Ludo's word.**

- Ask CZI to add molstar.org and the lab site to the GraphQL allow-list. If they do, the panel can search the whole
  portal live, and the index becomes a cache.
- copick picks JSON (location in Å, a 4×4 `transformation_`) as a particle format, read and written, so picks move
  between prism-me, ChimeraX-copick and napari-copick.
- copick-web as a second source (its REST API: runs, picks, segmentations, GLB meshes, a Zarr proxy), for the lab's own
  tomograms and for writing picks back. Only if prism-me becomes an annotation client.
- Tilt series and alignments (`affineTransformationMatrix`).

## Risks

- The portal schema changes: the index is built offline and versioned, so a change breaks the script, not the app.
- A Zarr level that is too big for the browser: the size guard and the coarsest level by default.
- The blosc WASM decoder adds bundle size: load it only when a Zarr opens.
- The `orientedPoint` convention: step A.3 tests it before anything is built on it.
