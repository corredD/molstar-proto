# Lane `cryoet-level` (prism-me): a volume's Data section, an OME-Zarr read at another level (2026-11-03)

Worked on the integration branch `me/cryoet-volume` (PR #41), port 1346.

## Brief

Ludo, 2026-11-03: "I would like to have the option to control the resolution of the data coming in. So if I click a
volume, I should see a slider for the bin/resolution available, the default is the current, but I want to load higher
resolution optionally. So volume should have a resolution or description entry before isosurface/volume/slice etc."

## Built

- `cryoet.level` (volume, level, large) in the cryoet extension, with its command: the `volume-from-ome-zarr` cell's
  `level` and every grid slice's index (at its place in Å, through the levels' scale and translation) in one write; then
  the slices' gray windows and the direct volumes' transfer functions refit at the same σ over the new level's
  statistics. One history step. Over the transform's `maxSizeMB` (its voxels and one decoded chunk: `omeZarrLevelNeeds`,
  exported by the plugin's format) it fails with `confirm` until `large: true`, which raises the guard. A failed read
  reverts (`revertOnError`) and returns the transform's message.
- `CryoetApi.dataState(volume)`: source, grid, voxel (Prism's `volumeStats`, `gridText`, `voxelText`, now exported by
  `@molstar/prism-viewer/api/volume`), decoded size, the levels coarsest to finest, the level read.
- `VolumeData` (cryoet `controls.tsx`) and the section Data, first for a volume (prism-me `properties.tsx`): the facts,
  then Level, Prism's `Slider` over the levels (the box shows the binning, the line under it "4× · 27.2 Å · 24 MB"),
  read at the release only (a drag only relabels); over the guard an inline Read it / Cancel; reading and a failure on a
  status line.

## Decided

- Section name **Data** (not Resolution): an MRC map shows the facts only, no level.
- A Slider, as Ludo asked, with `onCommit` only acting: a drag across 1× never starts a 1.5 GB read.
- The windows and the transfer functions are kept in σ, not as set. Measured on TS_08: σ is 0.0114 at 4×, 0.029 at 2×;
  the Tomogram preset kept as a fraction of [min, max] covered the 2× level's noise (the box an opaque fog). Remapped in
  σ the points land on the 2× level's own preset (0.627 → 0.411, the preset 0.414).

## Learned

- 2× (464×464×225, 194 MB) reads in about 4.6 s from the portal; undo (back to 4×) about 0.8 s; 1× (928×928×450, 1550
  MB, asked first) about 34 s, the tab's JS heap at 2.3 GB after it.
- At 1× (seen before 6c4653df1, the colors' refit; not tried again) the direct volume read denser and pinker than at 4×:
  its colors followed min/max, and the ray takes more samples. ×½ in Direct volume thins it.
- `portal.ts` `loadZarr` sets `maxSizeMB` from the level's voxels alone (at least 512): a level within one chunk of the
  value would be refused by the transform. Not changed here.

## Review gate

| Finding                                                                                                                                                                                                         | Skeptic              | Fixed by                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------- |
| M1 overlapping level reads: a later release lost, its busy line cleared                                                                                                                                         | confirmed            | 804bf07cc (Prism's `latest`)                                              |
| M2 an asymmetric slice window collapsed to ±kσ, rounded to 0.1σ                                                                                                                                                 | confirmed            | 98f5512d1 (each end in σ)                                                 |
| M3 the Direct volume editor kept the old level's stats                                                                                                                                                          | confirmed (reading)  | 884479443 (made again on new data; TODO.md narrowed to Prism's inspector) |
| S1 the direct-volume refit untested                                                                                                                                                                             | confirmed            | 2e5cc6ec2 (a stand-in direct volume)                                      |
| S2 the undo test without redo                                                                                                                                                                                   | confirmed (test gap) | 2e5cc6ec2                                                                 |
| X1 (skeptic) a direct volume's colors not refit in σ                                                                                                                                                            | plausible            | 6c4653df1                                                                 |
| N1 docstring Load / Cancel                                                                                                                                                                                      | confirmed            | 804bf07cc                                                                 |
| N2 the refit commit's result ignored; N3 a slice update's failure gives the generic message; N4 one frame of the old look before the refit; N5 hidden, oblique, moved, mask untested in the repo (probed: kept) | nits                 | open                                                                      |
| X2 (skeptic) a read already sent is not cancelled: a release after 1× waits for it                                                                                                                              | confirmed (low)      | open: `cryoet.level` has no abort                                         |
| N6 progress file untracked                                                                                                                                                                                      | refuted              | committed here                                                            |
