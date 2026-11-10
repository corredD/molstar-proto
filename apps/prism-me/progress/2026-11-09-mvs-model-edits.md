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

- **The status pill task (Ludo, 2026-11-09)**, replacing the lane's first choice (no Mol\* `Task`, Prism's run signal
  only), which left Built by's Cancel the only one and lost it when another row was picked. Every model edit (count,
  seed, relax; started by Built by, the agent or `api.run('mesoviewspec.edit')`) runs as a Mol\* task shown in the
  status pill with Cancel (prism.md:166-167, §7.2). The task's abort is linked to the run's signal and the run's signal
  aborts the task; the task's progress is the models done of the total. Built by keeps its own status and Cancel beside
  it. Built: `editAsTask` (`meso-molstar/src/edit-task.ts`) in the `mesoviewspec.edit` operation; it reports every 100
  ms (a Mol\* task sees an abort only when it reports, and the pill lists it once it has run 250 ms), and the operation
  rethrows the abort so Prism fails it as `aborted` and rolls the step back.
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
- **The slice yield in Node is `setImmediate`**, not a `MessageChannel` (the brief's fallback): in Node a channel's
  messages posted from their own handler are delivered in the same turn, so the timers never ran and the pack and relax
  abort tests timed out. In a browser: `scheduler.yield`, else a `MessageChannel`; a timer only where there is neither.

## Review

The gate's findings on the lane's diff; each fixed one has a test that failed first, then its fix.

| Finding                                                                                       | Severity   | Verdict                    | Commit / open               |
| --------------------------------------------------------------------------------------------- | ---------- | -------------------------- | --------------------------- |
| Cancel through a Mol\* task (prism.md:166-167): Built by's Cancel only, lost on a pick        | decision   | Ludo: the status pill task | 1a0a2741e (test), 4c819fc44 |
| S1 `cancel.ts`: the slice yield is `setTimeout(0)` (4 ms clamp, ≥1 s in a background tab)     | should-fix | confirmed                  | 29ed90a04 (test), 9cdbd6378 |
| S2 Built by: a refused, aborted or dropped value stays in its field; `send` drops silently    | should-fix | confirmed                  | d717b54f7 (test), e369f53ac |
| S3a `built-by-edits.test.tsx`: the Cancel test races the packer                               | should-fix | confirmed                  | 9b37633ca                   |
| S3b                                                                                           | should-fix | not taken up here          | open (below)                |
| S4                                                                                            | should-fix | not taken up here          | open (below)                |
| N1 `runtime.ts`: a non-`AbortError` reason, or a stop in the last model, commits a partial IR | nit        | confirmed                  | 072286300 (test), 9409ba0a9 |
| N2                                                                                            | nit        | not taken up here          | open (below)                |
| N3                                                                                            | nit        | not taken up here          | open (below)                |

## Size

~407 production lines added, 21 removed (`git diff -w`, tests, markdown and `_spec` aside) against the brief's ~400:
properties.tsx 128 (the controls, the status and Cancel), `model-edits.ts` 75, `cancel.ts` 65, the owner, session and
runtime plumbing about 130. The gate's fixes add about 120 more: `edit-task.ts` 85 (the status pill task), `cancel.ts`
30 (the yield), properties.tsx 20, `runtime.ts`, the extension and `TextInput` the rest.

## Open

- Step 3, the app check (Ludo: 506 to 300, a seed, Add relax stage 506 of 506, Undo each, Cancel a long one, from Built
  by and from the status pill with another row picked). Step 4, the gate: run; its S1, S2, S3a, N1 and the Cancel
  decision fixed (Review).
- The gate's S3b, S4, N2 and N3, left open by the coordinator (2026-11-09).
- N1 for a label-only edit that keeps the set objects; N2, N3, N5 of lane 4's table.
- Lattice, fiber and bilayer between models only (above).
