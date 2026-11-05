## prism-me: EMPIAR by id

- The `empiar` area and its card (+ Open › EMPIAR id…, `?empiar=12534&empiar-run=<run>`): an EMPIAR entry walked live
  from the browser through EMPIAR's API and its file host's folder listings, no index; its conditions, grids and runs,
  each run's files with their sizes, what cannot load greyed with why (EMDB-SFF surfaces, frames, files above 2 GB).
- `empiar.load`: a run's picked files read whole in one history step, asked first above 512 MB: tomograms as slices
  (no isosurface made to be hidden), masks as surfaces, tilt series as their Z slice with their `.rawtlt` angles, the
  STAR's particles of the run in Å by their own `rlnPixelSize`, the entry's EMDB average beside and on them. The STAR
  frame and EMD-48752's hand were measured on EMPIAR-12534's tomogram (no mirror).
- The EMPIAR card warns that EBI is often slow (0.1–0.2 MB/s) and gives a pick's usual time above 5 MB ("875 MB from
  EBI: about 1–2 h at its usual speed"); the size question says it too.
- `cryoetPortal.load` counts an EMDB average as loaded only when it made a volume (one already in the scene is a
  warning, "EMD-…: not loaded (… is already loaded.)"), as `empiar.load` does: both load it by one step.
- The EMPIAR and portal cards keep a load across a pick (busy, its result and its size question stay with the load and its
  pick), the portal's failed read puts its select back and clears its error, and the latest read clears Read's busy.
- EMPIAR says sizes in MB of 10^6 bytes, as the portal and its 512 MB guard count (a listing's `834M` reads `875 MB`).
- `empiar.load` warns of a named file that cannot load and loads the rest, as the portal does; its download runs outside
  the history step, with progress and Cancel.
- `empiar.load` of another run of a condition loads that run's particles from the condition's STAR already in the scene
  (its own list); a run, or a run's MRC, already in the scene is said "already loaded", not added or read again.
- Loads that share a file share its download: a cancel ends only its own load, the file stays until the last of them has
  built, and the card's progress shows the latest download under way ("Loading…" when none is). A card closed and opened
  again shows the load still running, with its Cancel.
