## prism-me: the CryoET Data Portal, direct

- A portal run's tomograms in one choice: the card's Tomogram lists every tomogram of the run across its voxel spacings,
  labelled as the portal's own list (`64007 · WBP Filtered · 10.403 Å · 886×630×246 · AreTomo3 v2.3.0`); picking one
  sets its spacing, annotations and levels. The view of the tomogram is now "Show as". The index has each tomogram's
  reconstruction method, software, alignment and the portal's default flag (format version 1 still).
- A load with no tomogram named takes the portal's default tomogram (the lowest id flagged, as the portal's run page),
  not the run's first spacing; `tomogram` finds its spacing. `?portal-tomogram=<id>` and `?portal-spacing=<Å>` in the
  URL.
