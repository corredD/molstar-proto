# Lane portal-tiltseries (2026-11-03)

Branch `me/portal-tiltseries`, worktree `~/prism-me-lanes/portal-tiltseries`, dev server port 1347.

## Brief (Ludo, 2026-11-03)

"do we have access to the tilt series?", then "yes" to: index the tilt series, a Tilt series entry on the run card
(level 2 by default), loaded as images stepped one by one with each image's tilt angle shown.

### What was found (2026-11-03, by curl and the portal client, on 10003 TS_08)

- Tilt series 17086: 41 images, −60° to +60°, step 3°, 1.7005 Å a pixel, tilt axis −5°, `is_aligned: False` (raw, not in
  the tomogram's frame). MRC 2.3 GB; OME-Zarr `10003/TS_08/TiltSeries/100/TS_08.zarr`. The files host sends
  `Access-Control-Allow-Origin: *` for it.
- Zarr levels, z,y,x, `<f4`, chunks 256³ (z padded from 41 to 256), scale in Å:
  - 0: 41×3710×3838, scale [1.7, 1.7, 1.7], about 2.3 GB.
  - 1: 41×1855×1919, scale [1.7, 3.4, 3.4], about 584 MB.
  - 2: 41×928×960, scale [1.7, 6.8, 6.8], about 146 MB.

  The z scale is not a distance: z is the image index. Only x,y are binned.

- Angles: `10003/TS_08/TiltSeries/100/tiltseries_metadata.json`, `per_section_parameter[]` with `z_index` and
  `raw_angle` (z_index 0 = −60.005). Also `tilt_axis`, `tilt_range`, `tilt_step`, `tilting_scheme`, `scales`.
  `alignment_metadata.json` (`Alignments/100/`) has **no** angles (identity GLOBAL affine, `tilt_path: None`). The
  rawtlt is `TiltSeries/100/00261.rawtlt` (a deposition name, not `TS_08.rawtlt`); do not guess its name.

### Steps

1. **Index** (`tools/portal-index/portal_index.py`, `PortalRun` in `packages/extensions/cryoet/src/portal-index.ts`): an
   optional `tiltSeries` list on a run. Each entry: `id`, `zarr`, `levels` (as `PortalLevel`), `pixelSpacing`,
   `tiltAxis`, `angles` (one per image, **sorted by `z_index`**, so `angles[i]` is image i; do not trust the file's
   order), `default` when the portal flags one (else the first). From the client if it exposes the per-section
   parameters, else the script reads `tiltseries_metadata.json` over HTTPS (with the tool's existing retries).
   **Optional field, version 1 kept**, as #45 did; `checkPortalIndex` unchanged. Rebuild the four datasets, report the
   growth.
2. **Load** (`portal.ts`): a tilt series loads through the existing `loadZarr` and shows **slices only, axis Z** (no
   direct volume, no isosurface: at z 1.7 Å the stack is ~70 Å thick and ~6500 Å wide, a 3D view of it is meaningless).
   Do **not** change the z scale in `VolumeFromOmeZarr` (library code; not on a prism-me lane). Placement: loaded with
   the tomogram, it goes **beside** it (reuse `besideTheTomogram`, as the EMDB average); alone, where it lands. Default
   level 2. Size guard as is: `omeZarrLevelNeeds` adds one padded 256³ f4 chunk (≈67 MB), so level 2 needs ≈213 MB
   (passes), level 1 ≈651 MB (asks first). Do not "fix" the guard.
3. **Angle readout**: the tilt angle of the image shown, tied to the Z slice index (on the slice's row or the card;
   choose the one that reuses existing UI). The only new UI.
4. **Card** (`portal-card.tsx`, `portal-run.ts`): a "Tilt series" choice (none / each series of the run, labelled like
   the portal: `TS-<id> · <pixel> Å · <x>×<y>×<n> · −60°…+60° step 3°`), its level select with the sizes, Prism's
   `ParamsForm`, no new styling. Default: none (the tomogram load stays as today).
5. **URL**: `portal-tiltseries=<id>` (and its level through the existing level param if it fits; else
   `portal-tiltseries-level`), read as `portal-tomogram` is.
6. **Spec in the same commits**: `extensions/cryoet/_spec/portal.md`, `apps/prism-me/_spec/features.md` (the portal tilt
   series row; the dropped `.tlt`/`.rawtlt` row **stays Deferred**), `.v6/changelogs/portal-tiltseries.md`, the TODO.

### Tests

- The shipped 10003 index has TS_08 tilt series 17086, 41 angles, `angles[0] ≈ −60.005`, levels with z = 41.
- A unit test: slice index → angle (ends and the middle, 0°).
- The card: a run with a tilt series lists it; picking it and Load runs the tilt-series load (jsdom, as
  `portal-card.test.tsx`).
- **Headed Chromium on the real host** (`--enable-unsafe-webgpu`, Playwright from the worktree): level 2 of 17086 loads,
  the Z slice steps through the 41 images, the readout shows −60.005 at image 0. First real read of a zarr whose z is
  padded in one chunk while x,y have 4×4 chunks; screenshot it.

### Ludo's check

On http://localhost:1347/apps/prism-me/build/: + Open › CryoET Data Portal…, 10003, TS_08, Tilt series TS-17086, Load.
The images show as a slice; moving the slice steps image by image and the angle follows (−60° … +60°). With the tomogram
loaded too, the series sits beside it. Also `?portal-dataset=10003&portal-run=TS_08&portal-tiltseries=17086`.

Size: about 250 production lines (script 40, index types 20, load 60, card 60, readout 40, URL 20), plus tests.

## What was built

- **Index** (`portal_index.py`, `PortalTiltSeries` in `portal-index.ts`): per run an optional `tiltSeries` list: `id`,
  `zarr`, `levels`, `pixelSpacing` (the client's 1.7005, not the zarr's 1.7), `tiltAxis`, `angles` (one an image by
  `z_index`). From the client: `TiltSeries` and `PerSectionParameters` are two more bulk queries a dataset; a series
  whose rows are not exactly z 0..n−1 once each falls back to `tiltseries_metadata.json` (none did) and fails if that
  does not fit either. **Version 1 kept**, `checkPortalIndex` unchanged.
- Rebuilt: nothing else moved (each file identical once `tiltSeries` is removed). Every run of the four datasets has one
  tilt series (65, 95, 12, 49), all stored in angle order. Sizes: 10003 121 → 165 KB (+36 %), 10453 325 → 383 KB (+18
  %), 10524 32 → 40 KB (+24 %), 10518 259 → 289 KB (+11 %).
- **Load** (`portal.ts`): `cryoetPortal.load` takes `tiltSeries` (an id; absent: none) and `tiltSeriesLevel` (absent:
  the coarsest, level 2). `loadTiltSeries`: `loadZarr`, then `cryoet.slice` along z from the middle image (0°, the least
  tilted); `besideTheTomogram` when the tomogram was loaded in the same call. Its level's bytes count in the size guard.
  `cryoetPortal.run` lists the run's tilt series (the ids `load` takes).
- **Readout**: the cryoet `Slice` row takes `angles`; on the Z slice, when there is one angle an image, a Tilt line
  under the slider reads `−60.005°` (`tiltAngleText`, the image's index from 0, the box counting from 1). The angles
  come from `CryoetPortalApi.tiltAnglesOf(ref)`: the volume's download address (as `originOf`) in a Map of the read
  datasets' tilt series by zarr address, filled once a dataset is read. prism-me's properties pass it at both Slice
  sites (a slice picked, and a volume's Slice section).
- **Card**: a Tilt series field (`PD.MappedStatic`: None, or each series labelled
  `TS-17086 · 1.7005 Å · 3838×3710×41 · −60°…+60° step 3°`), its case a flat group holding Series level, so the form is
  not made again on a pick (the annotations picked stay). None by default. Its bytes in the size beside Load.
- **URL**: `portal-tiltseries=<id>`, `portal-tiltseries-level=<n>`.
- Spec: portal.md §1–§5, features.md (a Done row; the portal's Deferred row keeps alignments; `.tlt`/`.rawtlt` stays
  Deferred), ui.md's Slice row, the TODO, `.v6/changelogs/portal-tiltseries.md`.

## Decisions

- **No `default` on a tilt series**: the client (4.9.0) has no visualization-default flag for one, so the tool cannot
  write it and nothing would read it. The card's default is None anyway.
- **A level of its own** (`tiltSeriesLevel`, `portal-tiltseries-level`): the tomogram's level does not fit (TS_08's
  tomogram level 1 is 194 MB, the series' 584 MB: one level for both asks first, or reads the series too coarse).
- **The readout on a Tilt line** (the controls' own `Line`), under the Slice slider. First built in the slider's unit;
  the review measured that the unit's changing width resized the track mid-drag (a drag to the right went 30 → 28), so
  it moved (S1).
- **Angles found from the download address**, not stored in the state: as `originOf`; no new state, no new transform.
  The cost: after a session reload the readout shows only once the dataset's index is read again.
- The range in the label is the angles' min and max, the step their span over n − 1 (right for any order of the stack).

## Learned

- The padded z chunk reads: level 2 of 17086 is 960×928×41 (the chunk 256 deep), stats finite, images 0 and 40 alike and
  darker than 20 (thicker at ±60°). The grid's z is the zarr's z index, so `angles[i]` is slice i.
- The client exposes `per_section_parameters` (`z_index`, `raw_angle`); `tiltseries_metadata.json` was not needed.
- Prism's UI is in shadow roots: a Playwright check reads text by `getByText`, not `querySelectorAll`.

## Checks

In the browser (headed Chromium, `--enable-unsafe-webgpu`, port 1347, the real file host):
`?portal-dataset=10003&portal-run=TS_08&portal-tiltseries=17086` loads tomogram 638, the ribosomes, the membrane mask,
EMD-13412 and the tilt series (one Z slice, nothing else), centered at x −8086 Å beside the tomogram's +3156 Å; the Z
slice stepped 0..40, the readout following each image (−60.005°, −57.002°, … −0.007° at 20, … 59.99°); + Open › CryoET
Data Portal…, TS_08, Tilt series TS-17086 (Series level `2: 960×928×41 at 6.8 Å, 146 MB`), Load: "… tilt series 17086
(level 2, 41 images)". Screenshots: the scratchpad's `tiltseries-url.png`, `tiltseries-card-loaded.png`.

## Size

About 250 production lines against the brief's 250 (script 45, index types 20, load 85, card 33, run and labels 29,
readout 20 + properties 5, URL 8, story 4).

## Left

- Both volumes are named `TS_08.zarr` in the tree (the format's label): the tilt series is told by its size (960 × 928 ×
  41). A label of its own is not built.
- A tilt series is raw (`is_aligned: False`), not in the tomogram's frame; alignments stay in the TODO.

## Review gate

Reviewer: 0 must-fix, 2 should-fix, 5 nits; skeptic: none refuted (5 confirmed, 2 plausible), 2 new nits folded into S1.

| #   | Finding                                                                                         | Skeptic                                         | Outcome                                                                 |
| --- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| S1  | should-fix: the angle in the slider's unit changes its width, resizing the track mid-drag       | confirmed, worse: a drag went backwards         | fixed, c66dedbf2 (a Tilt line; test first; track 123 px at every image) |
| S2  | should-fix: the card test's "size beside Load" check passed on the new row alone                | confirmed (mutant passed 85/85)                 | fixed, 3e7cf3f90 (asserts +146 MB; the mutant now fails, 31 vs 177)     |
| N1  | nit: the angle follows the committed index, 60 ms behind the box during a drag                  | confirmed                                       | left (the angle is the slice drawn)                                     |
| N2  | nit: `tiltAnglesOf` is read at render; a volume shown before its index is read gains no readout | plausible                                       | left (as `originOf`; a re-pick shows it)                                |
| N3  | nit: the cryoet extension's own Slice row passes no angles                                      | confirmed                                       | left (prism-me hides that tab)                                          |
| N4  | nit: the index tool does not guard a null zarr, size, pixel size or tilt axis                   | plausible (never seen; tomograms unguarded too) | left, for indexing all 392 datasets (TODO)                              |
| N5  | nit: the label's `+60°` is signed, the readout's `59.99°` not; the step is the span over n − 1  | confirmed (sign), plausible (step: 3.0 in all)  | left                                                                    |
