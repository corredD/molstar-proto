## prism-me: the CryoET Data Portal, polish

- A portal volume is named by its run, kind and id: `TS_08 tomogram 638`, `TS_08 tilt series 17086`, a mask
  `TS_08 membrane 15656` (before, the tomogram and its tilt series were both `TS_08.zarr`).
- A portal tilt series' Placement, on its Z slice's row only: Overlay, turned (under the tomogram where it is now,
  centred on it: the default; before, beside), Beside, raw and Beside, turned (by its tilt axis, −(tilt axis + 180°),
  measured on 10003 TS_08), a click each; `cryoetPortal.place`, `cryoetPortal.load`'s `tiltSeriesPlace` and
  `?portal-tiltseries-place=`.
- A portal annotation's description, method and GO term (a link to AmiGO) in its properties, under its name; the index
  has them (`description`, `method`, `goId`; format version 1 still).
