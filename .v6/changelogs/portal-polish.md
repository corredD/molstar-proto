## prism-me: the CryoET Data Portal, polish

- A portal volume is named by its run, kind and id: `TS_08 tomogram 638`, `TS_08 tilt series 17086`, a mask
  `TS_08 membrane 15656` (before, the tomogram and its tilt series were both `TS_08.zarr`).
- A portal tilt series' Placement, on its Slice row: Beside, raw (as before, the default), Beside, turned (by its tilt
  axis, −(tilt axis + 180°), measured on 10003 TS_08) and Overlay, turned (under the tomogram, centred on it), a click
  each; `cryoetPortal.place`, `cryoetPortal.load`'s `tiltSeriesPlace` and `?portal-tiltseries-place=`.
