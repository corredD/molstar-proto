# A streamed document in prism-me (2026-11-10, lane `mvs-streaming-app`)

## Brief

From `packages/mesoscale/_spec/prism.md` §12.2, lane 8. Stacked on `me/mesoviewspec` at `185bc8d0d` (lanes 0 to 6 and
the streaming lane merged). prism-me dev server for this worktree: port 1371. In flight beside it: lane 7 (`mvs-agent`,
port 1370), which edits `prism-viewer.ts` and the evals. Keep off those.

- **Check (Ludo):** the streaming lane's tiled fixture opened in prism-me: coarse first, copies where the camera looks,
  the budget in Settings; History shows no tile steps; Undo of a look edit while tiles stream.
- **Spec:** prism.md §9; streaming.md (the streaming lane's).
- **Tests:** unit: tiles requested from the canvas camera; tile lists are no step and no outside change; a checkpoint
  leaves them out; the budget setting.
- **Touches:** `packages/mesoscale/molstar/src/document-model.ts`, the tile cells' transformer registered as
  behavior-owned (lane 0's registry), Settings.
- **Size:** ~300 production lines.
- **Lane model:** Sonnet; Opus for the history rule.
- **Steps:** 1. the camera feed and the budget (Sonnet) 2. the history rule (Opus) 3. checked in the app
  (coordinator) 4. the gate (Opus).
- **Base:** after lanes 0 and 2 and the streaming lane merged (all are).
- **Known from lane 5 (open):** streamed tile lists may record steps (latent); this lane's history rule settles it.

## Built

## Learned

## Review
