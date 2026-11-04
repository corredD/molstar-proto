## prism-me: the CryoET Data Portal, direct

- A portal run's tilt series: the card's Tilt series (none by default; `TS-17086 · 1.7005 Å · 3838×3710×41 ·
  −60°…+60° step 3°`, with its own level) loads its images as the Z slice, stepped image by image, with each image's
  tilt angle after the count on its Slice row (`/ 41 · −60.005°`); loaded with the tomogram, it sits beside it.
  `cryoetPortal.load` takes `tiltSeries` and `tiltSeriesLevel`, the URL `?portal-tiltseries=<id>` and
  `?portal-tiltseries-level=<n>`. The index has each run's tilt series and their angles (format version 1 still).
