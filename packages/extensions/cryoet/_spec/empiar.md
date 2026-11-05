# EMPIAR by id

An EMPIAR entry walked live in the browser, its runs' files picked and loaded, no index of ours
(`apps/prism-me/plans/2026-11-04-empiar.md`, steps A and B). Code: `src/empiar-entry.ts` (the replies parsed, the walk,
the grouping: plain functions), `src/empiar.ts` (the `empiar` area), `src/empiar-card.tsx` (the card, no viewer import:
its story runs it over a fake), `src/empiar-ui.tsx` (the card's registration).

## 1. The walk

- **Live, no index**, unlike the portal (portal.md §1): EMPIAR's REST API
  (`www.ebi.ac.uk/empiar/api/entry/EMPIAR-<id>/`) and its file host's folder listings
  (`ftp.ebi.ac.uk/empiar/world_availability/<id>/…/`) both answer any origin (`Access-Control-Allow-Origin: *`). Both
  are under `ebi.ac.uk`, a known data service: the assistant is not asked.
- **The entry:** title, EMDB cross-references (in the API's order), image sets (directory, category, name, pixel size),
  the folders their segmentations name. A **condition** is a folder holding image sets (12534: `data/EMPIAR_upload`,
  CHX-treated; `data/EMPIAR_upload_nonCHX`, vehicle). The API's counts are not the files': 12534's says 38 CHX
  tomograms, its folders hold 91.
- **A condition's grids:** the subfolders of its folders (12534: 5 and 2). Its own files (`Particle_lists/*.star`) are
  shared by its runs. A frames folder (its name, or a `micrographs` image set) is never read: 1825 rows a grid, never
  loaded.
- **A grid's runs:** the files of each folder holding the grid, read when the grid is picked. Each read is cached by
  folder; a failed read is asked again next time. A read changes nothing in the scene. The card shows only its latest
  pick's answer (`latest`, rendering.md §2.7).
- **The listing is HTML, not an API** (Apache's `Index of`): each anchor and the size after its date; sort links and the
  parent left out. A page that is not a listing fails as "Could not read the folder …", never as an empty folder.
- **Sizes are Apache's**, binary units rounded (`834M` is 834 MiB; the file is 874 706 944 bytes). Said in MB of 10^6
  bytes, as the portal does (`834M` reads `875 MB`; kB and GB at the ends; the default run's total `1.3 GB`), one unit
  with the guard (512e6 bytes), the speeds and the progress line (night review B3). The guard compares bytes.

## 2. Runs, kinds, the load

- **A run is a stem**, exact: a file's name to its first dot, without `_labels`/`_seg`/`_mask`
  (`YTC041_1_lam1_1_ts_003.mrc_9.98Apx.mrc`, `…_labels.mrc`, `….mrc.st`, `….mrc.rawtlt`). The runs are the stems of the
  tomograms and tilt series, else of every file. A file of no run is listed under its folder. Each file lands once.
- **Kinds**, by the image set (the folder), else the folder's name and the extension: `reconstructed volumes` →
  tomogram; under a segmentation's folder (or named segment/label/mask), an MRC → mask; `tilt series` or `.st` → tilt
  series; `.star` → particles; `.rawtlt`/`.tlt` → angles; `.hff`/`.stl`/`.obj`/`.ply` → surfaces; `.tif`/`.eer` or a
  `micrographs` set → frames; `.mdoc` etc. → metadata; another MRC → volume.
- **What does not load says why:** surfaces (needs a reader for EMDB-SFF, HDF5), frames, metadata, angles (with their
  tilt series), unknown formats, and any file above 2 GB (`EmpiarWholeMaxBytes`: read whole it does not fit in a tab;
  12534's 3.3 GB tilt series). Ranged reads are step C.
- `empiar.load` (`id`, `run`; `condition`, `grid` found from the run when absent: the grid whose name starts the stem;
  `files`; `emdb`; `large`): one operation, its scene one history step (`empiar.build`, below). **Default files:** what
  loads of the run, without its tilt series (their size).
- **The download is outside the history step** (night review B2): the history runs its steps one at a time, and a file
  from EBI takes up to hours, which held every other edit. `empiar.load` (no step of its own) fetches the files first
  into the plugin's assets (`FetchAhead`, `src/load-steps.ts`: one download per address, the latest under way's progress
  a state, review F3b, the call's signal ends its own wait, a stalled one's too; the download stops when every call
  waiting for it has, review F3a), then runs `empiar.build` (the step, `record: false`, no tool), whose `Download`s read
  them from memory. A cancel or a failed download leaves no step and nothing in the scene. Each load holds its files
  until its step has read them (`release`); a file above 64 MB (`EmpiarKeepBytes`) is let go at the last hold, so a load
  sharing it, its step queued, does not read it again inside that step (review F3c); a smaller one (a STAR every run of
  a condition shares) is kept for the next load. An undo then a redo reads the file again (its `Download` runs again),
  inside that step.
- **MRCs are read whole, without the format's own visual** (`Ccp4Provider.parse`, no `visuals`): `load.url`'s isosurface
  of a 218 M voxel tomogram costs seconds and memory, only to be hidden by its slices. Tomogram: its three slices
  (`cryoet.slices`), no direct volume (an 875 MB 3D texture). Mask: an isosurface at absolute 0.5 (labels 0, 1, 2). Tilt
  series: its Z slice (`cryoet.slice`, as portal.md §2), its angles from the run's `.rawtlt` on the Slice row. Another
  MRC: an isosurface.
- **Particles:** the STAR read whole, then kept to the run's rows (`particles.source`: the names of its
  `rlnMicrographName`, else `rlnTomoName`, whose stem is the run's). None: the list removed, a warning. Decorated with
  the EMDB average (below), else spheres of 50 Å (`PointRadius`, `load-scene.ts`). The STAR is the condition's, shared
  by its runs: another run's is the file loaded again (`load.url`'s `copy`, its bytes from the assets), its own download
  and list, so removing one run's leaves the other's; the run's list in the scene already is "already loaded", nothing
  added (`loadParticleList`, review N1).
- **The EMDB average:** the entry's first cross-reference (`emdb`, or `none`), by `load.entry`, beside the tomogram, lit
  volumetric (as portal.md §2). It decorates the particles (`cryoet.decorate`, `with: object`: a volume target is drawn
  about its isosurface's center). Not fetched: a warning, the particles as spheres.
- **Fails as the portal:** a file that cannot be read fails the load; the average is a warning.

## 3. Frames, units, size (measured on EMPIAR-12534)

- **Particles in Å by their own `rlnPixelSize`**, never the tomogram's: RELION 3 from Warp, `rlnCoordinateX/Y/Z` in
  pixels of 4.99 Å (bin 2) against the tomogram's 9.98 Å (MRC mode 2, 682×960×334, origin 0, header cell 6806×9581×3333
  Å). The reader takes `rlnPixelSize` per row (`resolvePixelSize`); the STAR's block is nameless (`data_`).
- **Measured** (a scratch check after `tools/portal-index/rotation_check.py`): EMD-48752 low-passed to 30 Å and placed
  at the 233 particles of YTC041_1_lam1_1_ts_003, correlated with the tomogram within 160 Å (dense matter dark).
  - Position: coord × 4.99 Å scores CC 0.23–0.34 under any rotation. Twice the scale (9.98 Å pixels), flipped in z or y,
    or random places score under 0.04.
  - Rotation: the reader's A = (Rz(rot) Ry(tilt) Rz(psi))ᵀ (ZYZ, as `relionEulerToRotation`), a target drawn at p + A (x
    − c), scores 0.336 ± 0.10. Aᵀ scores 0.235, shuffled 0.228, random rotations 0.226. A wins at 219 of 233 points
    against Aᵀ, at 224 against random.
  - **Hand: the tomogram's and EMD-48752's agree.** The reference mirrored in x scores 0.232 (chance; A wins at 227 of
    233). Unlike the portal's 10003 (portal.md §3), no mirror.
  - Pinned by `_test/empiar.test.ts`: particle 26 of the run at (2379.28, 2552.93, 1558.01) Å, voxel (238, 256, 156),
    its matrix from the numbers above (CC 0.55).
- **Size guard:** above `PortalLargeBytes` (512 MB) of picked files, a load fails with `confirm` until `large: true`.
  The card asks first ("…: 1.3 GB to read whole (…). Load anyway?") and its second Load goes on.
- **EBI's speed is said, not hidden** (Ludo, 2026-11-04: "a warning on speed from empiar"): `EmpiarEbiSpeed`, 0.1–0.2
  MB/s, measured by curl on 12534's tomogram (88 KB/s over HTTPS, first byte after 26 s; 219 KB/s over HTTP, 6 s). EBI
  is the only source: PDBj has no EMPIAR files. A pick above 5 MB (`EmpiarSlowBytes`) gets its usual time from it
  (`ebiTime`: `about 1–2 h` for 875 MB, `about 2–4 h` for the default run's 1.3 GB), in the card and in the size
  question.
- **Measured load** (2026-11-04, M1, Chromium 1243 headed, prism-me dev build; macOS `vmmap` peak physical footprint, as
  an RSS sampler misses compressed pages and peaks): the 834 MB tomogram alone, from a same-origin copy, loads in
  5.3–5.5 s, the renderer at 2.3 GB at its peak (1.9 GB after; JS heap 1.8 GiB, about twice the file), the GPU process
  0.5 GB. The card's default run (with the mask, both STARs, EMD-48752): 28.7 s, renderer 4.8 GB at its peak, GPU
  process 3.2 GB (the mask's isosurface over 218 M voxels). From EBI the files come at about 150 KB/s a connection here
  (0.9 MB/s over 12 ranged connections), so a whole-file load takes over an hour: the case for step C.

## 4. The card

- **+ Open › EMPIAR id…** opens the overlay card `cryoet-empiar.overlay.empiar`: an id field (`EMPIAR-12534` or `12534`;
  Enter reads), then the entry: its title (a link to its page), Condition (by its folder and its tomograms' image set
  name), Grid, Run (selects, as the portal's card: a pick reads and makes the form again), Files (the run's loadable
  files with kind and size, the default load checked), EMDB average (None or each cross-reference); then the files that
  do not load, greyed, with why; the total beside Load.
- **A slow pick says so**: under Load, a muted line for a pick above 5 MB,
  `875 MB from EBI: about 1–2 h at its usual speed (EMPIAR's server is often slow, 0.1–0.2 MB/s).` (§3); none for a
  small pick.
- **While Load runs**, the download said as it goes,
  `Reading tomogram ….mrc (1 of 4): 120 of 875 MB, 0.15 MB/s, about 1 h left` (the area's `fetching`), and **Cancel**,
  which stops it: nothing loaded, no step (§2).
- **Load asks first** above the guard: the operation's `confirm` message (its EBI time with it) with "Load anyway?", the
  button "Load anyway"; a second press passes `large`.
- Story: prism-me › Explorer › EMPIAR (Card, Card wide: 12534's YTC041_1 over a few recorded folders).

## 5. The URL (prism-me)

`?empiar=12534` (or `EMPIAR-12534`) opens the card on the entry, `&empiar-run=<stem>` picks its run (its condition and
grid found from the stem). Nothing loads until Load (`empiar.open`; `apps/prism-me/src/url.ts`).
