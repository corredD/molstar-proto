# Current

What is in flight, one line a lane, linking to its progress file. Only the coordinating session (the main checkout,
`~/molstar-votr`) edits this file (How we work). What was built is the dated files beside it; what is not built is the
queue ([TODO.md](../TODO.md)).

## In flight

- `stem-events` ([brief](../progress/2026-11-27-stem-events.md) on `votr/stem-events`): the study's kick, snare and
  bass-note detector live in the stem worker, as route sources; worktree `~/molstar-votr-lanes/stem-events`, base
  `votr/lookahead-sync`. Design.

## Waiting on Ludo

- `lookahead-sync`: PR #76 into `votr/overnight` (the analysis reads the delay line ahead; the stem study's two
  fixes; angine.mp3 as an example). Ludo: the "to confirm" list (a)–(i), by ear, then merge.

- The overnight of 2026-11-27: eight lanes merged on `votr/overnight` (#67–#74), one PR into `virus-on-the-rock`
  ([record](2026-11-27-overnight.md#built)). Ludo: the checks by ear listed there, the four "Ludo to confirm" decisions,
  then merge.
