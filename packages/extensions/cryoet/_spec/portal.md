# The CryoET Data Portal, direct

Portal data (datasets → runs → voxel spacings → tomograms and annotations) loaded in the browser on a static site, no
server of ours and no copick (`apps/prism-me/plans/2026-11-02-cryoet-portal.md`, Decision). Code: `src/portal-index.ts`
(the format), `src/portal.ts` (the `cryoetPortal` area), `src/portal-run.ts` (a run and its sizes, plain functions),
`src/portal-card.tsx` (the card, no viewer import: its story runs it over a fake), `src/portal-ui.tsx` (the card's
registration); the index tool `tools/portal-index/`.

## 1. The index

- **Built offline, shipped with the app.** The portal's GraphQL refuses browsers (a CORS allow-list); its file host
  (`files.cryoetdataportal.cziscience.com`) serves any origin to a plain GET. So `tools/portal-index/portal_index.py`
  reads the chosen datasets once with the portal's client and writes `index.json` (the catalog) and `<id>.json` (a
  dataset); the app hands them to `CryoetPortalExtension` as a `PortalIndexSource` (prism-me: one lazy chunk a file).
- **Versioned** (`PortalIndexVersion`, now 1): a file of another version is refused by name. A portal schema change
  breaks the tool, not the app.
- **What it holds:** a dataset's title, organism, DOIs, run count, its runs (all, or the first n: `runs` says how many
  in all); per voxel spacing its tomograms (size, each OME-Zarr level's path, size, spacing, decoded bytes, read from
  the level's `.zarray`; and what the portal's own tomogram list shows: `processing` (raw, filtered, denoised), `method`
  (the reconstruction method: WBP, SART, Fourier_Space), `reconstructionSoftware` and `processingSoftware` (with
  versions: AreTomo3 v2.3.0, IsoNet2), `alignment` (the portal's AL-id) and `default`, the portal's visualization
  default; each written only when the portal has it, so optional, and version 1 still: an older reader ignores them) and
  annotations (id, object, shape, format, path, size, count, ground truth, the portal's visualization default, and the
  portal's words for it, each when it has them: `description` ("chloramphenicol bound 70S ribosome"), `method`
  ("Template matching + manual filtering + 3D classification filtering"; up to 759 characters) and `goId`, the object's
  Gene Ontology term, `GO:` ids only: 10524's `CDPO:0000001` "sample" is left out; Ludo, 2026-11-04); per run its tilt
  series (`tiltSeries`, optional, version 1 still: an OME-Zarr's levels, the portal's pixel size, the tilt axis, and
  `angles`, one an image by the portal's `z_index`, so `angles[i]` is image i whatever the rows' order; from the
  client's per-section parameters, `tiltseries_metadata.json` for a series whose rows are not one an image; the client
  has no default flag for a tilt series, so none). Paths are relative to the file host. A shape's MRC is left out when
  it has a zarr (a browser reads whole files; the zarr has levels).
- **Curated, not the portal's:** `decorations` by object name: the PDB that decorates the points, the EMDB average, and
  the average's box center in the structure's frame (§3). The portal links no fitted model.
- Size: 10003 (65 runs) 201 KB, 10453 (95 runs) 522 KB, 10524 (12 runs) 45 KB, 10518 (49 runs, PP7 virus-like particles;
  Ludo, 2026-11-03) 385 KB (the annotations' words: +22 %, +36 %, +12 %, +33 %); each loaded on first use only.

## 2. The operations

- `cryoetPortal.datasets` and `cryoetPortal.run` read the index; `cryoetPortal.load` loads, one history step (its calls
  go through `ctx.api`, the zarr's transforms through the plugin's state; the run's checkpoint covers both). Values:
  `dataset`, `run` (name or id), `spacing`, `tomogram`, `level` (absent: the coarsest), `annotations` (`1212`,
  `2321/SegmentationMask`, `none`; empty: the portal's defaults), `as` (`both`: slices and a direct volume, `slices`,
  `none`), `tiltSeries` (an id; absent: none), `tiltSeriesLevel` (absent: the coarsest), `large`. `run` lists the run's
  tomograms and tilt series by the ids `load` takes.
- **Which tomogram** (`describePortalRun`; Ludo, 2026-11-03): `tomogram` by id, from whichever spacing of the run holds
  it (its spacing, annotations and levels come with it); `spacing` alone: that spacing's default tomogram, else its
  first; neither: the run's default tomogram, the lowest id flagged `default` (a run may flag one a spacing: 10518
  pt117_ts_001 flags 64007 at 10.403 Å and 64011 at 5.003 Å, and the portal's run page shows 64007, its first by id),
  else the first tomogram of the first spacing that has one. Annotations are the chosen spacing's.
- **Reuse, no reader of its own:** ndjson and GLB by `load.url` (`PortalReaders`), an OME-Zarr by the format's
  transforms (`OmeZarrFromUrl`, `VolumeFromOmeZarr`: several files, not one URL; not `OpenOmeZarr`, whose default
  isosurface the slices would only hide), the points' pixel size by `particles.source`, the decoration by
  `cryoet.decorate` (`with: pdb`) and `cryoet.offset`, the slices by `cryoet.slices`, a mask's surface by
  `volume.representation` (isosurface, absolute 0.5), the average by `load.entry` (`emdb`) and `stage.move`.
- **A tilt series is its Z slice only** (Ludo, 2026-11-03): its zarr's z is the image index, not a distance (only x, y
  are binned; 10003 TS_08 is 41 images at z 1.7 Å, a stack 70 Å thick and 6500 Å wide), so no direct volume and no
  isosurface: `loadZarr`, then `cryoet.slice` along z from the middle image (the least tilted). The z scale stays the
  format's (`VolumeFromOmeZarr`, library code). Loaded with the tomogram, it is placed by it (`tiltSeriesPlace`, below);
  alone, where it lands. `tiltAnglesOf(ref)`: its angles, found from the volume's download (as `originOf`), for the
  Slice row's readout (§4).
- **A tilt series' place, a switch to compare** (Ludo, 2026-11-04: "make it optional so we can compare"; the default is
  undecided, so it stays `beside`): `cryoetPortal.place` (`volume`, `place`), `load`'s `tiltSeriesPlace`, each an
  absolute matrix on top of where it was read (`tiltSeriesMatrix`), sent to `stage.move` as the move from where it is
  (its volume's transform decorator), so a switch back and forth ends where the place says. `beside`: along −x by 2.5
  times its radius, as the average (`besideMatrix`), the images as read; `turned`: so, turned about z through its center
  by **−(tilt axis + 180°)**; `overlay`: turned, its center on the tomogram's in x, y, its top at the tomogram's bottom,
  where the tomogram is now (its transform), not where it was read (its run's tomogram found in the scene by its
  download; none: refused). The sign was measured, not assumed: on 10003 TS_08 (tilt axis −5°, tomogram 638, Warp), the
  0° image (index 20) band-passed and turned over the full circle, with and without a mirror, against the tomogram's top
  view (level 1 summed over z): one peak at −175.5° (CC 0.66; every other angle under 0.08, the median 0.04; mirrored,
  at most 0.06), centre to centre within 14 Å, so the tomogram is the image turned, not mirrored, and −(tilt axis +
  180°) is 0.5° off the peak (about 28 Å at the field's edge). In the app, overlay's turned image and the tomogram's Z
  slice show the cell's outline alike. One run measured: another reconstruction's convention may differ (TODO).
- **Names: run, kind, id** (Ludo, 2026-11-04): a volume is named `<run> tomogram <id>`, `<run> tilt series <id>`, a mask
  `<run> <object> <annotation id>` (`TS_08 tomogram 638`, `TS_08 tilt series 17086`, `TS_08 membrane 15656`), the label
  of `OmeZarrFromUrl`, its volume's with it; every zarr of a run is `<run>.zarr`, so the tomogram and its tilt series
  were both `TS_08.zarr`. Only the name: the address stays the file's (`originOf`, `tiltAnglesOf` and the Data section
  read it). A point list keeps its file's name (`chloramphenicol_bound_70s_ribosome-1.0_orientedpoint.ndjson`):
  `load.url` names a download by its address.
- **The pixel size is the index's voxel spacing**, never the zarr's scale: they differ in the third decimal.
- **Points without a decoration are spheres of 50 Å** (`PortalPointRadius`; Ludo, 2026-11-03): their size theme's
  `defaultSize`, not the list's radii (a shape decorating them later would scale by those). The theme's own fallback,
  half the typical distance between neighbors, made 10453's 4 sparse V-ATPase picks spheres about 900 Å across.
- An entry whose format the viewer has no reader for is listed with `needs` and skipped by a load, with a warning.
- **Extra views warn, files fail:** a file that cannot be read fails the load (nothing is left); a direct volume the
  viewer cannot make, a decoration whose structure cannot be fetched, the EMDB average: warnings, the rest kept.
- `originOf(ref)`: the dataset and run an object's download came from (its URL), its run page and DOIs once the index is
  read: the right-click menu's links (prism-me).

## 3. Frames, units, size

- ndjson locations are voxels of the annotation's tomogram; `xyz_rotation_matrix` M turns the reference into the
  particle: a target x is drawn at p + M (x − c), M as given (rows as rows), not Mᵀ. Measured on 10003 TS_08
  (`tools/portal-index/rotation_check.py`, 378 ribosomes against EMD-13412, tomogram level 1): M wins at 375–378 of 378
  points (CC 0.186 vs 0.106–0.124 for Mᵀ, the mirrored references and the random and shuffled controls), with the
  reference **mirrored in x**: EMD-13412 is of the other hand than the portal's TS_08 (a data fact, not the reader's).
  Pinned by `model/formats/particles/_test/ndjson.test.ts`.
- **So the decorations' orientations are at chance against this tomogram:** unmirrored, M scores 0.111 against random
  rotations' 0.110. The points' positions are right; a rigid structure (7PHB, fitted into EMD-13412) cannot be turned
  into its mirror image, so no rotation or `cryoet.offset` fixes it. What would: the tomogram and its points mirrored in
  world x (points F p, matrices F M F), or a mirrored copy of the structure as the target. Neither is built: Ludo's call
  (TODO.md).
- A structure target is drawn about its boundary's center; the average's point is its box center: `cryoet.offset` by the
  difference (7PHB: about 7 Å) puts the structure where the average is.
- OME-Zarr levels in Å from NGFF `scale` (the reader's, `io/src/reader/zarr/_spec/zarr.md`); MB are 1e6 bytes, as the
  format's limit counts them.
- **Size guard:** above 512 MB decoded (the tomogram's level, the zarr annotations at that level and the tilt series'
  level), a load fails with `confirm` until `large: true`; the card shows the size beside Load and passes `large`.
- A loaded level is changed in place afterwards (`cryoet.level`, prism-me's Data section: ui.md §4): the same guard, the
  zarr's own `maxSizeMB`, which a load sets from the level's voxels (at least 512 MB).

## 4. The card

- The explorer's **+ Open** › CryoET Data Portal… opens the overlay card `cryoet-portal.overlay.portal`: a `ParamsForm`
  made from the index (dataset, run, tomogram, level with its size, Show as (the tomogram's view: slices and a direct
  volume, slices, none), Tilt series, annotations with the portal's defaults checked), made again when dataset, run or
  tomogram changes; the total size beside Load; the result under it.
- **One Tomogram choice for the run** (Ludo, 2026-11-03: a run has several, as the portal's "Select tomogram"): every
  tomogram of the run across its spacings, by id, labelled as the portal's list, compact (`portalTomogramLabel`):
  `64010 · WBP Denoised · 10.403 Å · 886×630×246 · AreTomo3 v2.3.0, IsoNet2` (the processing's software after the
  reconstruction's when it differs; the version tells 64004 from 64006). Picking one sets its spacing, so there is no
  spacing field, and that spacing's annotations and levels. Its default is §2's. A spacing without a tomogram cannot be
  chosen here (none in the shipped index; the API's `spacing` can).
- **A Tilt series choice** (Ludo, 2026-11-03): None (the default: a load as before), or each tilt series of the run,
  labelled as the portal's (`portalTiltSeriesLabel`): `TS-17086 · 1.7005 Å · 3838×3710×41 · −60°…+60° step 3°` (the full
  size, the range of its angles whatever their order). One picked: its Series level row under it (a `MappedStatic` of
  flat groups, so the form is not made again and the annotations picked stay), the coarsest first; its bytes in the size
  beside Load.
- **The tilt angle on the Slice row** (Ludo, 2026-11-03): a portal tilt series' Z slice shows its image's angle on a
  Tilt line under the Slice slider (`−60.005°`), by the image's index from 0 (the box counts from 1). Not in the
  slider's unit: a unit of changing width resizes the track, and a drag went backwards (review S1); prism-me's
  properties pass `tiltAnglesOf(volume)` to the cryoet `Slice`. Under it, its **Placement**: Beside, raw / Beside,
  turned / Overlay, turned (Prism's `Choices`, a click each, no reload; the one it is in pressed, none once moved by
  hand: `placeState`), §2.
- **An annotation's words in its properties** (Ludo, 2026-11-04: "Portal: description + method"): a point list's or a
  mask's, under its name, Markdown (`portalAnnotationText`, by `annotationTextOf(ref)`: the file's download, as
  `originOf`): `cytosolic ribosome: chloramphenicol bound 70S ribosome`, the method on one line (cut at a word past 90
  characters: 10453's run to 757), the GO term a link to `https://amigo.geneontology.org/amigo/term/<id>`. Not on hover:
  Mol\*'s particle label shows an entity's description (`entityInfo`), and a list with entities is a mesoscale model in
  prism-me's tree; a mask's hover is the volume's label (TODO).
- Story: prism-me › Explorer › CryoET Data Portal (Card, a run of several tomograms: 10518 pt117_ts_001).

## 5. The URL (prism-me)

`?portal-dataset=10003&portal-run=TS_08`, then `portal-tomogram` (an id: it picks its spacing too), `portal-spacing`
(Å), `portal-annotations`, `portal-level`, `portal-tiltseries` (an id), `portal-tiltseries-level` (its own: the
tomogram's level is not the tilt series') and `portal-tiltseries-place` (`beside`, `turned`, `overlay`; another word:
beside): `cryoetPortal.load` once the viewer is up (`apps/prism-me/src/url.ts`). A value that is not a number is left
out (the load's default). `?portal-dataset=10518&portal-run=pt117_ts_001&portal-tomogram=64010`: the IsoNet2-denoised
tomogram and the membrane mask at 10.403 Å. `?portal-dataset=10003&portal-run=TS_08&portal-tiltseries=17086`: TS_08's
tomogram and ribosomes, its tilt series beside them.
