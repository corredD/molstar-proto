# Change the biology from the properties (2026-11-09, lane `mvs-model-edits`)

## Brief

From `packages/mesoscale/_spec/prism.md` §12.2, lane 6. Stacked on `me/mesoviewspec` at `29d95d6c5` (lanes 4 and
`mvs-location` merged). prism-me dev server for this worktree: port 1368. In flight beside it: lane 5 (`mvs-views`, port
1359); merge order 5 then 6, so this lane rebases or merges `me/mesoviewspec` after lane 5 lands if they meet.

- **Check (Ludo):** the exosome's catalase: its count from 506 to 300 in Built by, the copies repacked (one step, the
  status shows the resolution); its seed changed; Add relax stage: 506 of 506; Undo each; Cancel a long one.
- **Spec:** prism.md §4.3 (Built by), §7.2; runtime.md (pipeline, refine stages).
- **Tests:** unit: a count edit is one model edit rerunning only its model (the session's record); a seed edit; adding
  `meso.relax` as a refining model; a cancelled resolution restores the checkpoint; a refused patch (a count below 0)
  changes nothing.
- **Touches:** `apps/prism-me/src/explorer/properties.tsx` (Built by's controls), `packages/mesoscale/molstar/src/`
  (cancel through a Mol\* task), `packages/mesoscale/spec/src/runtime/` (a signal through `RuntimeOptions` to the
  resolvers, checked between models and in the packers' loops).
- **Size:** ~400 production lines.
- **Lane model:** Sonnet.
- **Steps:** 1. the controls as patches (Sonnet) 2. progress and Cancel (Sonnet) 3. checked in the app (Sonnet) 4. the
  gate (Opus).
- **Base:** after lane 4; parallel with lane 5. Lane 5 edits `runtime.ts`'s `updateView` and the explorer's Views row;
  this lane edits the resolve path, the resolvers and `properties.tsx`. Keep to those.
- **Known from lane 4's review (N1):** `list-owner.ts` caches entity info by `PlacementSet`; a model edit that keeps the
  set objects could serve stale names. Check it when a count edit re-resolves.
