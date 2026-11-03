# Lane `cryoet-portal` (prism-me): the CryoET Data Portal, direct (2026-11-02)

Branch `me/cryoet-portal` from origin/prism-me, port 1345. Brief and full findings: the parked plan
[../plans/2026-11-02-cryoet-portal.md](../plans/2026-11-02-cryoet-portal.md) (read it whole). This lane builds its parts
**A and D** and wires in the readers of the library lanes `ome-zarr` (part B, `me/ome-zarr`) and `glb-reader` (part C,
`me/glb-reader`) as they land.

## Scope (coordinator, 2026-11-02)

Ludo, 2026-11-02: "do now the parked plan with many lanes... Easier access to cryoETDataportal, and nice volume. Go
independent. Expert coding, efficient and optimized. No repetition with existing code."

- **A1 index:** `tools/portal-index/` (Python, the portal client `cryoet_data_portal` in the conda env `cryoet-portal`:
  `~/miniforge3/bin/conda create -y -n cryoet-portal python=3.11 cryoet_data_portal zarr=2 numcodecs numpy mrcfile scikit-image`;
  `conda env list` first, lanes `ome-zarr` and `glb-reader` may have made it: add packages, do not recreate). Index at
  least 10003 (all runs, or the first ~10 if very large: say which) and 10453, and one dataset with GLB meshes (10524 or
  10521). Shipped as `apps/prism-me/portal/<dataset>.json` (small: check the size), versioned format, loaded on demand.
- **A2 `instancePoint`** in `packages/io/src/reader/cryoet/ndjson.ts` (+ `instance_id` kept per particle), failing test
  first. This one is a library fix: its own commit naming no extension, upstreamable.
- **A3 rotation convention, numerically** (no eye needed): place EMD-13412 (or a 70S map cut to size) at each TS_08
  particle under each candidate convention (matrix as given, its transpose, and what Mol*'s ndjson reader does today),
  and correlate with the tomogram (torch/numpy in the env, on the 6.802 Å MRC or zarr level 0 subvolumes around the
  points); the clear winner is tested in Vitest with a known point and matrix. If today's reader is wrong, fix it in a
  library commit with that test.
- **A4 portal source** in `packages/extensions/cryoet` as `ExtensionApis` (`cryoetPortal`): datasets(), run(id), load({
  run, tomogram, level, annotations, as }) reusing existing operations: ndjson by `load.url` with `pixelSize` = the
  annotation's voxel spacing from the index only; the tomogram and masks through the `ome-zarr` lane's format (merge
  `origin/me/ome-zarr` when it has commits that work; merge, never rebase; again when it moves); GLB meshes through
  `origin/me/glb-reader` likewise. Until a reader lands, those entries say "needs reader" and the rest works.
- **A5 URL params** `portal-dataset`, `portal-run`, `portal-annotations`, `portal-level`, read the way
  `apps/prism-me/src/url.ts` reads the mesoscale ones.
- **D panel** in the cryoet extension's lazy UI chunk: dataset → run → voxel spacing and level (with sizes) → annotation
  checkboxes → load; DOI and portal page in the right-click menu of a portal object; a Storybook story. Prism tokens
  (`--msp-*`), Prism components; no new CSS framework.
- **The demo** (Ludo's check, the plan's Brief): `?portal-dataset=10003&portal-run=TS_08` on this lane's server loads
  the binned tomogram (default level 2; as slices AND as a direct volume, whose transfer function suits a tomogram:
  dense = dark values), the membrane mask as a surface, the ribosomes decorated with 7PHB (PDB) and EMD-13412 beside.
  The direct volume's `lighting` (lane `volume-lighting`) is wired later by the coordinator's integration branch
  `me/cryoet-volume`; keep the direct-volume load in one function so it gets one param there.
- **Data:** download the 10003 TS_08 set into `~/molstar-prism-me/.me-data/cryoet-10003/` (gitignored; zarr level 1–2 of
  the tomogram, the mask zarr, the ndjson, EMD-13412 map, 7PHB cif; also a binned MRC of the tomogram for lane
  `volume-lighting`, about 100–200 MB, written with mrcfile). Tiny synthetic fixtures for tests only.
- **Browser check:** from `http://localhost:1345`, a plain cross-origin fetch of the portal files works (no custom
  headers). If it does not, stop and report.
- **Stays off:** `packages/io/src/reader/zarr/**`, `packages/io/src/reader/gltf/**`, the volume/shape format catalogs
  (library lanes own them), `packages/graphics/**`.
- **Spec:** `packages/extensions/cryoet/_spec/portal.md` (new); `apps/prism-me/_spec/features.md` rows; TODO.md: remove
  the Backlog item's built parts. Changelog `.v6/changelogs/cryoet-portal.md`.
- **Size:** ~700 production lines (index tool not counted).
- **Done:** How we work's checks (`~/molstar-prism-me/apps/prism-me/AGENTS.md`), gate, PR
  `gh pr create -R corredD/molstar-proto --base prism-me`. Then the progress file's end.

## Built

- **A1** `tools/portal-index/portal_index.py` (portal client, six bulk queries a dataset, each zarr's
  `.zattrs`/`.zarray` from the file host): `apps/prism-me/portal/index.json`, `10003.json` (65 of 65 runs, 116 KB),
  `10453.json` (95, 297 KB), `10524.json` (12, GLB meshes, 27 KB). Versioned format `src/portal-index.ts` (v1). Biome
  skips the generated files. Test: `apps/prism-me/src/_test/portal.test.ts` (TS_08, annotation 1212, its URL, 7PHB,
  levels).
- **A2** `instancePoint` in io's ndjson reader, `instance_id` a particle attribute (and in the label): library commit
  81ef4f42d, failing test first.
- **A3** `tools/portal-index/rotation_check.py`: the convention measured (below); Vitest pins M as given
  (`model/formats/particles/_test/ndjson.test.ts`). The reader was right: no fix.
- **A4** `packages/extensions/cryoet/src/portal.ts`, `CryoetPortalExtension(source)`, area `cryoetPortal` (`datasets`,
  `run`, `load`, `originOf`): reuse only (load.url, OpenOmeZarr, particles.source, cryoet.decorate, cryoet.offset,
  cryoet.slices, volume.representation, load.entry, stage.move); one history step; size guard 512 MB; the direct volume
  in one function (`showTomogramVolume`, `tomogramControlPoints`: the Tomogram preset) for lane `cryoet-volume`'s
  lighting param.
- **A5** `portal-dataset`, `portal-run`, `portal-annotations`, `portal-level` (`apps/prism-me/src/url.ts`, index.ts).
- **D** the card (`src/portal-ui.tsx`, overlay `cryoet-portal.overlay.portal`, lazy chunk): ParamsForm from the index,
  sizes, Load, result; + Open › CryoET Data Portal…; right-click › run page, DOIs; story prism-me › Explorer › CryoET
  Data Portal (two).
- Merged `origin/me/glb-reader` (cccfcc8fd) and `origin/me/ome-zarr` (8d62596bf); one conflict, io `_spec/README.md`.
- Data: `~/molstar-prism-me/.me-data/cryoet-10003/` (README.txt): TS_08 zarr levels 1–2, membrane zarr, ndjson,
  EMD-13412, 7PHB, `TS_08_bin2.mrc` (464×464×225 at 13.604 Å, 194 MB, origin 0) for lane `volume-lighting`. Conda env
  `cryoet-portal` (zarr 2.18.7, cryoet_data_portal 4.9.0).
- Checked from `http://localhost:1345/apps/prism-me/build/?portal-dataset=10003&portal-run=TS_08` in headless Chromium
  (Playwright; Chrome's extension was not connected): TS_08.zarr level 2 (232×232×113) as 3 slices and a direct volume,
  the membrane mask as a surface, 378 ribosomes decorated with 7PHB (offset 7.4 Å to the average's center), EMD-13412
  beside; no console errors. The card: TS_08 picked, Load, the result line. 10524's GLB mesh by the same operation.
  CORS: every file (ndjson, `.zattrs`, `.zarray`, a 23.5 MB chunk, PDBe density server, RCSB) answers a plain GET with
  `Access-Control-Allow-Origin: *` (node fetch with `Origin: http://localhost:1345`).

## Decided

- The index reaches the static site as lazy JSON chunks (`import(\`../portal/${name}.json\`)`, esbuild's glob): no copy
  step, no fetch base (me).
- A zarr opens by the ome-zarr lane's `OpenOmeZarr` action, not `load.url` (several files, not one URL) (me).
- The URL's annotations default to the portal's visualization defaults: for TS_08 the ribosomes (1212) and the
  membrain-seg membrane (15656), not 2321; `portal-annotations=1212,2321` gives the brief's (me).
- No direct-volume-only view (`as`: both, slices, none): a direct volume alone was not asked (me).
- MRC annotation files are left out of the index when a zarr exists (whole files only from a browser) (me).

## Learned

- **The rotation convention, measured** (10003 TS_08, 378 ribosomes, EMD-13412 low-passed to 30 Å at 13.604 Å, tomogram
  level 1 negated, 160 Å sphere): CC M 0.112 ± 0.028, Mᵀ 0.106 ± 0.031, shuffled 0.106, random 0.108; M with the
  reference mirrored in x **0.183 ± 0.037** (wins at 377/378 over M, 375/378 over Mᵀ mirrored in x, 378/378 over the
  rest); mirrored in y or z: null. So M as given (Mol*'s reader) and **EMD-13412 is of the other hand than the portal's
  TS_08**. Unmirrored, M (0.112) is at chance (random 0.108): the 7PHB decorations sit at the right places, their
  orientations no better than random against the density, and no rotation fixes a mirror. Left to Ludo (TODO.md).
- Rerun with the reference low-passed before resampling (review nit): M mirrored in x 0.186 ± 0.038, M 0.111, Mᵀ 0.107,
  random 0.110, shuffled 0.106; wins 375–378 of 378 over every other candidate. Same conclusion.
- 7PHB's box center is 18 Å from EMD-13412's (bbox), 7.4 Å by Mol*'s boundary: the offset is needed.
- `dataFormats.get` throws for an unknown name; `has` does not.
- A headless viewer cannot make a direct volume (no graphics): tested by its transfer function instead.
- `tsc -p apps/prism-me/tsconfig.storybook.json` fails on prism-me itself (viewer `api/area.ts` `measure`,
  `api/styles.ts`): not this lane's files.

- `pnpm check:workspace` fails here only in `registry-compare.mjs`: the OME-Zarr action and two transforms are not in
  its v6 allow list (the glb-reader lane added `gltf` there; the ome-zarr lane has not yet). Theirs to add; open. It
  also needs `node scripts/workspace/assets.mjs` first in a fresh worktree (plugin-ui's `./*.css`).

## Size

About 1,020 production lines against ~700 (portal.ts 583 with its comments and the three operations' messages, the card
187, the index format 122, app wiring 82, the readers 44); tools 307 (not counted). The room: the load composing nine
operations with their failures, `originOf`, the average's placement and centering.

## Review

Gate: `lane-reviewer` (0 must-fix, 6 should-fix, 9 nits), then `lane-skeptic` (probes on a copy of the worktree): 4
should-fix confirmed, S2 split (direct volume confirmed, decoration refuted), S6 down to a nit, one new should-fix (X1).
Each fix with a test failing first.

| Finding                                                               | Severity          | Verdict                                   | Commit / open                                                                                  |
| --------------------------------------------------------------------- | ----------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| S1 offset test blind to sign and frame                                | should-fix        | confirmed (sign-flip mutation passed)     | e65703a4c (non-zero center, exact shift)                                                       |
| S2 a direct volume that cannot be made undoes the load                | should-fix        | confirmed (headless default `as`)         | c0bd28b1c                                                                                      |
| S2 a decoration fetch failing undoes the load                         | should-fix        | refuted (it passes silently: X1)          | —                                                                                              |
| S3 the format's isosurface built and hidden                           | should-fix        | confirmed                                 | e65703a4c (the format's transforms, no default visual)                                         |
| S4 no test of a failure midway, EMDB, GLB                             | should-fix        | confirmed gap; checkpoint covers the zarr | e65703a4c (midway, GLB); EMDB path open (needs the density server stubbed and the stage tools) |
| S5 the hand understated                                               | should-fix (docs) | confirmed                                 | 581c2463c, a5ca506a2                                                                           |
| S6 card size at level 0 without a tomogram                            | nit (latent)      | confirmed                                 | c70bd6c02                                                                                      |
| X1 a decoration that cannot be fetched passes as decorated            | should-fix        | new, confirmed                            | 26d5023c2                                                                                      |
| N1 catalog rejection cached                                           | nit               | confirmed                                 | c70bd6c02                                                                                      |
| N2 first catalog answer outside `latest`; sets after await            | nit               | confirmed, harmless                       | open                                                                                           |
| N3, N4, N5, N6, N8 comments and spec words                            | nit               | confirmed                                 | c70bd6c02, 581c2463c                                                                           |
| N7 default dataset 10003 in the extension                             | nit               | design                                    | kept (fails cleanly when absent)                                                               |
| N9 index tool rank/dtype; instance_id absent; rotation_check aliasing | nit               | confirmed / plausible                     | a5ca506a2, a5cc35519                                                                           |
