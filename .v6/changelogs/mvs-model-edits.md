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

### After the review gate

- Every model edit (Built by, the agent, `api.run('mesoviewspec.edit')`) is a Mol\* task in the status pill while it
  resolves: `Resolving m.recipe (1 of 3)…`, its progress per model, and Cancel, which stays when another row is picked.
  The pill's Cancel and the run's signal are one: either stops the resolution and the step is rolled back.
- Built by's fields are disabled while an edit runs, and show the document's value again after a refused, stopped or
  failed edit. `TextInput` takes `disabled`.
- The packers' slice yield is no longer a timer (a `MessageChannel`, `setImmediate` in Node), so a long
  resolution does not crawl in a background tab, and the timers still run between slices, so an abort sent by one stops
  the packer. A stop whose reason is not an `AbortError`, or that comes during
  the last model, never commits a partial IR. `MesoViewSpecOptions.resolvers` sets the resolvers.