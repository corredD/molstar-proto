# Lane `cryoet-portal` (prism-me): the CryoET Data Portal, direct (2026-11-02)

Branch `me/cryoet-portal` from origin/prism-me, port 1345. Brief and full findings: the parked plan
[../plans/2026-11-02-cryoet-portal.md](../plans/2026-11-02-cryoet-portal.md) (read it whole). This lane builds its
parts **A and D** and wires in the readers of the library lanes `ome-zarr` (part B, `me/ome-zarr`) and `glb-reader`
(part C, `me/glb-reader`) as they land.

## Scope (coordinator, 2026-11-02)

Ludo, 2026-11-02: "do now the parked plan with many lanes... Easier access to cryoETDataportal, and nice volume. Go
independent. Expert coding, efficient and optimized. No repetition with existing code."

- **A1 index:** `tools/portal-index/` (Python, the portal client `cryoet_data_portal` in the conda env
  `cryoet-portal`: `~/miniforge3/bin/conda create -y -n cryoet-portal python=3.11 cryoet_data_portal zarr=2 numcodecs numpy mrcfile scikit-image`;
  `conda env list` first, lanes `ome-zarr` and `glb-reader` may have made it: add packages, do not recreate). Index at
  least 10003 (all runs, or the first ~10 if very large: say which) and 10453, and one dataset with GLB meshes (10524 or 10521).
  Shipped as `apps/prism-me/portal/<dataset>.json` (small: check the size), versioned format, loaded on demand.
- **A2 `instancePoint`** in `packages/io/src/reader/cryoet/ndjson.ts` (+ `instance_id` kept per particle), failing test
  first. This one is a library fix: its own commit naming no extension, upstreamable.
- **A3 rotation convention, numerically** (no eye needed): place EMD-13412 (or a 70S map cut to size) at each TS_08
  particle under each candidate convention (matrix as given, its transpose, and what Mol*'s ndjson reader does today),
  and correlate with the tomogram (torch/numpy in the env, on the 6.802 Å MRC or zarr level 0 subvolumes around the
  points); the clear winner is tested in Vitest with a known point and matrix. If today's reader is wrong, fix it in a
  library commit with that test.
- **A4 portal source** in `packages/extensions/cryoet` as `ExtensionApis` (`cryoetPortal`): datasets(), run(id),
  load({ run, tomogram, level, annotations, as }) reusing existing operations: ndjson by `load.url` with `pixelSize` =
  the annotation's voxel spacing from the index only; the tomogram and masks through the `ome-zarr` lane's format
  (merge `origin/me/ome-zarr` when it has commits that work; merge, never rebase; again when it moves); GLB meshes
  through `origin/me/glb-reader` likewise. Until a reader lands, those entries say "needs reader" and the rest works.
- **A5 URL params** `portal-dataset`, `portal-run`, `portal-annotations`, `portal-level`, read the way
  `apps/prism-me/src/url.ts` reads the mesoscale ones.
- **D panel** in the cryoet extension's lazy UI chunk: dataset → run → voxel spacing and level (with sizes) → annotation
  checkboxes → load; DOI and portal page in the right-click menu of a portal object; a Storybook story. Prism tokens
  (`--msp-*`), Prism components; no new CSS framework.
- **The demo** (Ludo's check, the plan's Brief): `?portal-dataset=10003&portal-run=TS_08` on this lane's server loads the
  binned tomogram (default level 2; as slices AND as a direct volume, whose transfer function suits a tomogram: dense =
  dark values), the membrane mask as a surface, the ribosomes decorated with 7PHB (PDB) and EMD-13412 beside. The
  direct volume's `lighting` (lane `volume-lighting`) is wired later by the coordinator's integration branch
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

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
