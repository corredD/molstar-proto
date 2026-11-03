# Lane portal-tomograms (2026-11-03)

Branch `me/portal-tomograms`, worktree `~/prism-me-lanes/portal-tomograms`, dev server port 1349.

## Brief (Ludo, 2026-11-03)

"On cryoET data portal, for a given run there is multiple tomograms to choose between": the portal's "Select tomogram"
for 10518 pt117_ts_001 lists each tomogram's id, reconstruction method and processing (64011 WBP Filtered, 64005 SART
Raw, 64010 WBP Denoised, 64008 Fourier Space Filtered), `TM-<id> · <spacing>Å (<x>, <y>, <z>) px · AL-<alignment>`,
`Rec:` and `Proc:` software, and checks a default (64007 WBP Filtered at 10.403 Å).

1. Index: per tomogram, the reconstruction method, the reconstruction and processing software, the alignment id and the
   portal's default flag; version bumped only if old readers break; the four datasets rebuilt, the growth reported.
2. Card: one Tomogram choice listing every tomogram of the run across its spacings, labelled as the portal's, compact;
   picking one sets the spacing (no spacing select), its annotations and levels; the portal's default first; the
   tomogram view renamed so the names do not clash; Prism's `ParamsForm`, no new styling.
3. Default annotations: with the portal's default tomogram, report what 10453 tomogram_003 and 10518 pt117_ts_001 load;
   no other rule unless Ludo's case needs it.
4. URL: `portal-tomogram=<id>` (its spacing with it).
5. Spec in the same commits: portal.md §1, §2, §4, §5; features.md; `.v6/changelogs/portal-tomograms.md`; the TODO.

## What was built

- **Index** (`tools/portal-index/portal_index.py`, `PortalTomogram` in `portal-index.ts`): `method` (WBP, SART,
  Fourier_Space), `reconstructionSoftware`, `processingSoftware`, `alignment`, `default`; each written only when the
  portal has it (22064 of 10453 has no processing software). **Optional, version 1 still**: an older reader ignores
  unknown fields, a newer one reads an older file as "no flag" (today's first). `checkPortalIndex` unchanged (version
  only); the shipped-index test pins the new fields on 10518 pt117_ts_001.
- Rebuilt: nothing else moved on the portal (each file identical once the new fields are removed). Sizes: 10003 116 →
  121 KB (+5 %), 10453 297 → 325 KB (+9 %), 10524 27 → 32 KB (+21 %), 10518 213 → 259 KB (+22 %).
- The tool now retries a file host read (5 tries): the resolver dropped a name lookup in the burst of 16 reads, and
  seven rebuilds in a row failed on it.
- **Which tomogram** (`describePortalRun`, portal.md §2): a tomogram id finds its spacing; with neither named, the run's
  default is the lowest id flagged (the portal's run page does `tomograms.find(isVisualizationDefault)` over a query
  ordered by id: 10518 pt117_ts_001 flags both 64007 at 10.403 Å and 64011 at 5.003 Å, and the portal shows 64007); a
  spacing alone takes its flagged tomogram, else its first; nothing flagged: as before.
- **Card**: the Tomogram field lists every tomogram of the run by id (`portalTomogramOptions`, `portalTomogramLabel`):
  `64010 · WBP Denoised · 10.403 Å · 886×630×246 · AreTomo3 v2.3.0, IsoNet2` (the processing software after the
  reconstruction's when it differs; the version tells 64004 from 64006). The spacing field is gone; the tomogram view is
  "Show as". The story gains "Card, a run of several tomograms" (10518).
- **URL**: `portal-tomogram=<id>` and `portal-spacing=<Å>` (trivial: the load had `spacing` already), read as
  `portal-level` is.

## What the defaults load now (item 3)

- **10518 pt117_ts_001**: before, the first spacing, 5.003 Å: 64011 and the 177 capsid oriented points. Now the portal's
  default 64007 at 10.403 Å and its default annotation, the membrane mask; the capsid picks are a pick of 64011 away.
  This is what the portal shows.
- **10453 tomogram_003**: the portal's default is 56411 (WBP, IsoNet-denoised, 10 Å), the same spacing as before: the
  membrane mask and the 4 automated (Octopi) V-ATPase picks, not the 3 manual ground-truth picks at 13.44 Å (22064, IMOD
  raw). Unchanged; left in the TODO. Proposed rule, not built: when the default tomogram's spacing has no ground-truth
  annotation and another spacing of the run has, say so in the card (a line under Annotations), or take the ground-truth
  spacing's annotations by default. Ludo's call.

## Decisions

- Options are ordered by id (the portal's own list is in no visible order); the default is marked by being chosen.
- The alignment id is in the index but not in the label (compact; the software version already separates 64004 and
  64006).
- A spacing with no tomogram cannot be chosen in the card (none in the shipped index; the API's `spacing` still can).

## Checks

`npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm format:check`, `pnpm check:workspace` (after
`node scripts/workspace/assets.mjs` in the fresh worktree), the unit tests of `packages/extensions/cryoet` and
`apps/prism-me` (227), `typecheck:storybook` of prism-me. In the browser (headed Chromium, port 1349): the card on 10518
pt117_ts_001 lists the 8 tomograms with their labels, 64007 chosen; 64010 offers the membrane mask at 10.403 Å and loads
it; `?portal-dataset=10518&portal-run=pt117_ts_001&portal-tomogram=64010` loads 64010's zarr (`Tomograms/107`) and the
membrane mask.

## Left

- 10453's ground-truth default (above).
- PR #44 (`me/portal-guard`) also changes `portal-card.tsx` and `portal.ts`: expect a conflict in `RunForm`'s load.
