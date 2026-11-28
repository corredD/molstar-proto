# Current

What is in flight, one line a lane, linking to its progress file. Only the coordinating session (the main checkout,
`~/molstar-votr`) edits this file (How we work). What was built is the dated files beside it; what is not built is the
queue ([TODO.md](../TODO.md)).

## In flight

- `stem-events` round 2 ([brief](2026-11-27-stem-events.md#round-2-ludos-try-2026-11-28), on PR #77's branch):
  holes when HTDemucs falls behind go to the stand-ins, instant pause, HTDemucs faster on WebGPU.

## Waiting on Ludo

- `stem-listen`: PR #78 into `votr/stem-events` (a speaker per stem, heard through the delay; port 1354). Open:
  HTDemucs and SCNet not heard headed (only Spleeter measured), the tail before a pause or the end, D changed in a
  pause's drain un-mutes the mix.

- `stem-events`: PR #77 into `votr/lookahead-sync` (retarget to `votr/overnight` once #76 merges). Kick, snare/hat and
  bass-note events from all three models; Drums & Bass Burst hits symAxis on each kick. Open: 48 kHz snare/hats ~85 %
  (the worker's linear resampler), Spleeter 5.2 % false on the drive, by ear.

- `lookahead-sync`: PR #76 into `votr/overnight` (the analysis reads the delay line ahead; the stem study's two
  fixes; angine.mp3 as an example). Ludo: the "to confirm" list (a)–(i), by ear, then merge.

- The overnight of 2026-11-27: eight lanes merged on `votr/overnight` (#67–#74), one PR into `virus-on-the-rock`
  ([record](2026-11-27-overnight.md#built)). Ludo: the checks by ear listed there, the four "Ludo to confirm" decisions,
  then merge.
