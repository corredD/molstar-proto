# The CryoET Data Portal, direct

Portal data (datasets → runs → voxel spacings → tomograms and annotations) loaded in the browser on a static site, no
server of ours and no copick (`apps/prism-me/plans/2026-11-02-cryoet-portal.md`, Decision). Code: `src/portal-index.ts`
(the format), `src/portal.ts` (the `cryoetPortal` area), `src/portal-ui.tsx` (the card); the index tool
`tools/portal-index/`.

## 1. The index

- **Built offline, shipped with the app.** The portal's GraphQL refuses browsers (a CORS allow-list); its file host
  (`files.cryoetdataportal.cziscience.com`) serves any origin to a plain GET. So `tools/portal-index/portal_index.py`
  reads the chosen datasets once with the portal's client and writes `index.json` (the catalog) and `<id>.json` (a
  dataset); the app hands them to `CryoetPortalExtension` as a `PortalIndexSource` (prism-me: one lazy chunk a file).
- **Versioned** (`PortalIndexVersion`, now 1): a file of another version is refused by name. A portal schema change
  breaks the tool, not the app.
- **What it holds:** a dataset's title, organism, DOIs, run count, its runs (all, or the first n: `runs` says how many
  in all); per voxel spacing its tomograms (size, each OME-Zarr level's path, size, spacing, decoded bytes, read from
  the level's `.zarray`) and annotations (id, object, shape, format, path, size, count, ground truth, the portal's
  visualization default). Paths are relative to the file host. A shape's MRC is left out when it has a zarr (a browser
  reads whole files; the zarr has levels).
- **Curated, not the portal's:** `decorations` by object name: the PDB that decorates the points, the EMDB average, and
  the average's box center in the structure's frame (§3). The portal links no fitted model.
- Size: 10003 (65 runs) 116 KB, 10453 (95 runs) 297 KB, 10524 (12 runs) 27 KB; each loaded on first use only.

## 2. The operations

- `cryoetPortal.datasets` and `cryoetPortal.run` read the index; `cryoetPortal.load` loads, one history step (its calls
  go through `ctx.api`). Values: `dataset`, `run` (name or id), `spacing`, `tomogram`, `level` (absent: the coarsest),
  `annotations` (`1212`, `2321/SegmentationMask`, `none`; empty: the portal's defaults), `as` (`both`: slices and a
  direct volume, `slices`, `none`), `large`.
- **Reuse, no reader of its own:** ndjson and GLB by `load.url` (`PortalReaders`), an OME-Zarr by the plugin's
  `OpenOmeZarr` (several files, not one URL), the points' pixel size by `particles.source`, the decoration by
  `cryoet.decorate` (`with: pdb`) and `cryoet.offset`, the slices by `cryoet.slices`, a mask's surface by
  `volume.representation` (isosurface, absolute 0.5), the average by `load.entry` (`emdb`) and `stage.move`.
- **The pixel size is the index's voxel spacing**, never the zarr's scale: they differ in the third decimal.
- An entry whose format the viewer has no reader for is listed with `needs` and skipped by a load, with a warning.
- `originOf(ref)`: the dataset and run an object's download came from (its URL), its run page and DOIs once the index is
  read: the right-click menu's links (prism-me).

## 3. Frames, units, size

- ndjson locations are voxels of the annotation's tomogram; `xyz_rotation_matrix` M turns the reference into the
  particle: a target x is drawn at p + M (x − c), M as given (rows as rows), not Mᵀ. Measured on 10003 TS_08
  (`tools/portal-index/rotation_check.py`, 378 ribosomes against EMD-13412, tomogram level 1): M wins at 375–378 of 378
  points (CC 0.183 vs 0.106–0.122 for Mᵀ, the mirrored references and the random and shuffled controls), with the
  reference **mirrored in x**: EMD-13412 is of the other hand than the portal's TS_08 (a data fact, not the reader's).
  Pinned by `model/formats/particles/_test/ndjson.test.ts`.
- A structure target is drawn about its boundary's center; the average's point is its box center: `cryoet.offset` by the
  difference (7PHB: about 7 Å) puts the structure where the average is.
- OME-Zarr levels in Å from NGFF `scale` (the reader's, `io/src/reader/zarr/_spec/zarr.md`); MB are 1e6 bytes, as the
  format's limit counts them.
- **Size guard:** above 512 MB decoded (the tomogram's level plus the zarr annotations at that level), a load fails with
  `confirm` until `large: true`; the card shows the size beside Load and passes `large`.

## 4. The card

- - Open › CryoET Data Portal… opens the overlay card `cryoet-portal.overlay.portal`: a `ParamsForm` made from the index
    (dataset, run, spacing when more than one, level with its size, tomogram view, annotations with the portal's
    defaults checked), made again when dataset, run or spacing changes; the total size beside Load; the result under it.
- Story: prism-me › Explorer › CryoET Data Portal.

## 5. The URL (prism-me)

`?portal-dataset=10003&portal-run=TS_08`, then `portal-annotations` and `portal-level`: `cryoetPortal.load` once the
viewer is up (`apps/prism-me/src/url.ts`).
