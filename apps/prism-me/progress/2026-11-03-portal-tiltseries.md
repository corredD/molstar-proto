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
