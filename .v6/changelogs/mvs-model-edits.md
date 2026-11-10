## prism-me: change the biology from a population's Built by

- A document population's Built by section now edits the model: **Copies asked for** (its count: 506 to 300 packs the
  copies again), **Seed** (its model's, other copies), **Add relax stage** (a `meso.relax` refine stage after the model:
  the missing copies are inserted and the overlaps relaxed, 506 of 506). Each is one patch and one step, saved with the
  document, undone by Undo; only the models whose inputs changed resolve again. A count below 0 or a fraction is said
  under the field and nothing is sent.
- While it resolves, the status names the model (`Resolving m.recipe (1 of 3)…`) and **Cancel** stops it: the step is
  rolled back, the document and its copies as they were.
- For extensions and the runtime: `RuntimeOptions.signal` (an `AbortSignal`, checked between models and in the
  packers' loops) and `onProgress`; a stopped compile rejects with an `AbortError` and keeps no partial result.
  `meso.pack`, `cellpack-gpu` and `meso.relax` give the event loop back every 30 ms when a signal is given, and run as
  before when none is. `api.mesoviewspec.progressState()`, `countPatch`, `seedPatch`, `relaxPatch` in `meso-molstar`.