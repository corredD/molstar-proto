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

## Built

Steps 1 and 2 of the brief (the controls as patches; progress and Cancel). Step 3 (the app check) and step 4 (the gate)
are the coordinator's.

- **The edits as patches** (`packages/mesoscale/molstar/src/model-edits.ts`): `countPatch` (`abundance.count`),
  `seedPatch`, `relaxPatch` (inserts a `meso.relax` model refining the given one). Each returns a patch, a `refused`
  sentence, or nothing when the document is already so. `EditRecord.models` (from the compile's stats) says which models
  resolved and which were the cache's.
- **Built by's controls** (`apps/prism-me/src/explorer/properties.tsx`, `BuiltBy`, `ModelEdits`): Copies asked for,
  Seed, Add relax stage on a population row, each a `mesoviewspec.edit`; a refused value is said under the field.
- **Cancel through a signal**: `RuntimeOptions.signal` and `onProgress` (`runtime.ts`), `ResolveJob.signal`;
  `runtime/cancel.ts` (`drive`, `isAbort`, `throwIfAborted`). `compile` checks before each model, tells `onProgress`
  before each model that has to resolve, and rethrows an abort from a resolver (it was filed as `resolver.failed`, which
  would have committed a partial IR). `meso.pack` (so `cellpack-gpu`) and `meso.relax` are generators run by `drive`: no
  signal, synchronous and byte-identical; a signal, 30 ms slices. The signal flows `ctx.signal` →
  `MesoDocumentModel.edit` → `MesoSession.edit` → `compile`; Prism turns the abort into a failed `aborted` run and rolls
  the step back. `api.mesoviewspec.progressState()` and the owner's `resolving`/`progress` feed the status line and
  Cancel button.
- **N1** (`list-owner.ts`'s cache keyed by `PlacementSet`): checked after a count edit. A count edit re-resolves its
  model, so its sets are new objects and the cache misses: the owner's entity counts follow (test in
  `model-edits.test.ts`: 354 placed, then 300). It is a pin, not a fix. Still open for a label-only edit that keeps the
  set objects (the entity labels come from the document, the cache is keyed by the set): not reachable from this lane's
  controls.
- **Tests**: `model-edit-patches.test.ts` (unit: what each builder writes and refuses); `model-edits.test.ts` (medium,
  the exosome: count 506 to 300 reruns only `m.recipe`, one step, Undo; a seed edit; Add relax stage reruns only
  `m.relax` and reaches 506 of 506; a count below 0 refused, no step; N1; a cancelled count edit restores the document,
  the lists, the History and the next edit resolves the stopped model; progress as a state); `built-by-edits.test.tsx`
  (medium, jsdom: the three controls, a refusal said under the field, the status and Cancel);
  `spec/_test/cancel.test.ts` (an aborted compile rejects and keeps nothing; the next compile resolves what is left to
  the same IR; progress; an abort in a resolver is not `resolver.failed`; the signal is not in the key; `meso.pack` and
  `meso.relax` stop mid-loop, `meso.pack` is synchronous without a signal and gives the same copies with one).
- **Checks**: `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `tsc --noEmit -p .../tsconfig.storybook.json`: clean.
  `vitest run packages/mesoscale apps/prism-me`: 591 pass, 23 fail, all known (cli.test.ts 8, examples.test.ts 1,
  spec.test.ts 13, one-look-writer.test.ts 1). `--mode medium packages/mesoscale apps/prism-me/src/explorer`: 87 pass.
  `biome check` on the touched code and `prettier` 3.9.9 on the touched markdown: clean. `pnpm lint`, `format:check`,
  `check:workspace` not run (the coordinator's gate).

## Decided

- **No Mol\* `Task`** for Cancel (the brief says "cancel through a Mol\* task"). Prism's run already owns an
  `AbortSignal` (`api.run(id, values, { signal })`, `ctx.signal`) and rolls a failed or aborted step back to its
  checkpoint, the same path as a failed commit; a Task would be a second stop mechanism beside it.
- **Generators for the packers.** The packers are synchronous CPU loops: an abort could never be seen inside one, so
  they must yield. `meso.pack` and `meso.relax` are written as generators that `yield` in their long loops, run by
  `drive` (no signal: straight through, `resolve` still returns its output synchronously, so the CLI, the tests and the
  scaling guards are unchanged). The alternative, making them `async`, would have changed every caller. `relax.ts`'s
  body moved out of the object literal and re-indents (`git diff -w` shows 19 lines).
- **Lattice, fiber and bilayer are not interruptible mid-loop**, only between models: they are fast (no retries) and the
  brief's long runs are the packer and the relax. Say so if a 500k-copy fiber needs it.
- **Counts are edited only for a population given by a count**; a density or concentration population shows no field
  (its count is the area's or the volume's; changing its kind silently would be the document's change, not a field's).
- **Add relax stage** is offered on a model with no refiner that is not itself a relax stage (so it shows once: a second
  relax would repeat the first). The stage starts at `iterations: 400, tolerance: 1` (the example's), id `m.relax`
  (`m.relax.2` if taken), no `activity`. Seed on a population whose model is the runtime's default (no model node in the
  document) shows no field.
- **Progress is told per model** (before each one that has to resolve), not inside a packer: "Resolving m.recipe (2 of
  3)…" is the finest the signal gives without a second callback through every resolver.
- **A refused patch (count below 0)**: the builder refuses it before any patch, and the validation refuses it again if
  sent raw (`value.range`); the unit test is a pin (the validation already refused it), the UI test is the one that
  failed first.

## Size

~407 production lines added, 21 removed (`git diff -w`, tests, markdown and `_spec` aside) against the brief's ~400:
properties.tsx 128 (the controls, the status and Cancel), `model-edits.ts` 75, `cancel.ts` 65, the owner, session and
runtime plumbing about 130.

## Open

- Step 3, the app check (Ludo: 506 to 300, a seed, Add relax stage 506 of 506, Undo each, Cancel a long one), and step
  4, the gate.
- N1 for a label-only edit that keeps the set objects; N2, N3, N5 of lane 4's table.
- Lattice, fiber and bilayer between models only (above).
