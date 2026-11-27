# Current

What is in flight, one line a lane, linking to its progress file. Only the coordinating session (the main checkout,
`~/molstar-votr`) edits this file (How we work). What was built is the dated files beside it; what is not built is the
queue ([TODO.md](../TODO.md)).

## In flight

- `router-nan-guard` (NaN on the overlay, found testing PR #65): `~/molstar-votr-lanes/router-nan-guard`, branch
  `votr/router-nan-guard`, port 1351, Sonnet; started 2026-11-26; router only, off the app folder. Step: building.

## Waiting on Ludo

- `split-app-by-card` (D15): PR #65, gate done (2 left open to the queue); Ludo: checklist 1–10 on port 1350,
  then merge. Branch `votr/split-app-by-card`, `~/molstar-votr-lanes/split-app-by-card`.
