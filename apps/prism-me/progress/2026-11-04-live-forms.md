# Lane live-forms (2026-11-04)

Branch `me/live-forms`, worktree `~/prism-me-lanes/live-forms`, dev server port 1350.

## Brief (Ludo, 2026-11-04)

Items 6, 3 and 7 of the small items left by #46-#49, in this order, with Ludo's answers:

- **Item 6, undo during a drag.** Every applied step of a slider drag takes a full history checkpoint (how
  `gestureSteps` runs its group); on a scene whose snapshot takes over 50 ms, one drag can switch undo off. Answer:
  **"Fix on prism-me, upstream later"**: a small change in prism-viewer's gesture handling (one snapshot per drag, at
  its start), in its own commit with a test, marked as an upstream candidate for David.
- **Item 3, other sliders.** The slice, contrast, oblique and opacity sliders follow a drag (#48); the Isosurface,
  Direct volume and particle forms still wait 150 ms after the last change. Answer: **"All of them"**: same rule as the
  slices (newest value applied as soon as the last landed, one drag one undo step, the release's value always applied).
- **Item 7, slicing at level 0.** One slice step on TS_08 level 0 takes 150–240 ms (2–3 slices a second in a drag).
  Answer: **"Measure first"**: profile one step (texture upload, image build, state update, render) and report where the
  time goes, with a proposal. **No code change for item 7.**

### What was found

- `gestureSteps` is exported from prism-viewer (#48, commit `532e2d5a6`); the cryoet controls use it through a small
  helper (`live` in `packages/extensions/cryoet/src/controls.tsx`). Calls must go through the group's API (a root-area
  call waits behind the group and deadlocks: #48's tests).
- The 150 ms wait of the forms: `apps/prism-me/src/explorer/properties.tsx` (the Isosurface, Direct volume and particle
  Look/representation forms; #48's progress file `progress/2026-11-03-live-slice.md` names where the slice form's wait
  was removed). The portal-polish lane edits cryoet `controls.tsx` and `portal.ts`: stay off them except the `live`
  helper if item 3 needs it shared (then say so in the PR).

### Steps

1. **Item 6**, a `prism-viewer` commit naming no extension: a gesture takes one checkpoint (at its start), its steps
   none, its end closes the group; the history keeps one step per drag. Run the **full** prism-viewer suite (it changes
   every Prism slider's history), not only the quick lane. Keep #48's assertion: history unchanged mid-drag, +1 after
   the release. Test first: a drag of N steps takes 1 checkpoint (today N).
2. **Item 3**, on the same helper: the Isosurface level/options, the Direct volume form and the particle forms follow a
   drag. Measure one update of each (isosurface on TS_08 level 1; a particle form on CellPack MG); report any form that
   pops or flickers while rebuilding mid-drag and what you did about it.
3. **Item 7**, measurement only: in the progress file, where one level-0 slice step's time goes, by part, and a proposal
   (e.g. a coarser level while dragging, a GPU-side slice, a partial upload), with its expected gain.
4. Spec in the same commits: `apps/prism-me/_spec/features.md`, `ui.md` (the forms follow a drag),
   `.v6/changelogs/live-forms.md`, the TODO (item 7's proposal).

### Tests

- Fails first: one checkpoint per gesture (prism-viewer); an Isosurface form drag calls the update during the drag
  (jsdom, fake timers, as #48's `Slice` test) and leaves one undo step.
- Headed Chromium (`--enable-unsafe-webgpu`, Playwright from the worktree, port 1350):
  `?portal-dataset=10003&portal-run=TS_08` drag the isosurface level, screenshots mid-drag; CellPack MG, a particle form
  slider mid-drag; History +1 per drag.

### Ludo's check

http://localhost:1350/apps/prism-me/build/?portal-dataset=10003&portal-run=TS_08: add an isosurface, drag its level: the
surface follows the pointer; Undo after the drag goes back to where it started. Same for the Direct volume form and a
CellPack model's form sliders. Item 7's numbers and proposal are in this file.

Size: about 60 production lines (history 25, forms 35), plus tests.

## Built

- `0df43529b` prism-viewer (upstream candidate, names no extension): `gestureSteps` runs its group with the default
  `rollback` instead of `continue`. Under `continue` every run inside a group takes its own checkpoint (`history.ts`
  `#nested`): a drag of N applied steps took N+1 snapshots. Now one, at the gesture's start. The cost: a gesture is all
  or nothing (a step refused or failed mid-drag undoes the whole drag at its end, api.md §5); before, it undid only
  itself. Tests on a headless viewer (`sources/_test/gesture-steps.test.ts`), failing first: a 5-step drag takes 1
  snapshot (was 6), history +0 mid-drag and +1 after, Undo back to the start; with a 60 ms snapshot undo stays on after
  a 4-step drag (was turned off); a refused step restores the start.
- `089c5e847` prism-me: the explorer's `Representations` form goes through `gestureSteps` for every type (it did for a
  slice only; the others wrote 150 ms after the last change). Labelled by the representation; `throttleMs: 0` as the
  slice's. A direct volume's form reloads from the state only while no step is in progress (`overlay('')`), so a landed
  step does not set its knob back. jsdom test (fake timers), failing first for three of the four: a drag of 10 previews
  calls the update during it, applies the release's value, one group, for a slice, an isosurface, a direct volume and a
  particle list's form. The cryoet `live` helper was not needed (not touched).

## Measured (headed Chromium, WebGPU, M-series Mac, port 1350; a Sonnet helper, scripts in the session's scratchpad)

One update of each form, during a real 40-move mouse drag (the operation call, from `api.events`):

- Isosurface, TS_08 level 1 (464×464×225), the iso value: `volume.update` 40 calls for 40 moves, median 3.4 ms (2.9–9.6;
  with screenshots taken mid-drag up to 66 ms; a few at extreme values 190–790 ms). History 3 → 3 mid-drag → 4; Undo
  back to 2σ, the start. No pop or flicker in the stills (the surface shown and changing in each).
- Direct volume, TS_08 level 1, its Opacity: `volume.update` 40 calls, median 2.6 ms (2.2–17.6). History +0 mid, +1
  after; Undo back to 1.
- CellPack MG, the model's Representation (Objects, the decoration), its Opacity: `particles.update` 28 calls for 40
  moves (the moves landing during a call merged), median 69 ms (63–84). History +0 mid, +1 after; Undo back to 1.
- Seen: a drag held over 600 ms (a 1 s screenshot, a 1.2 s stall) is two steps (gestureSteps' quiet, the form has no
  release); after an Undo the isosurface's and the particle form show the dragged value until the row is picked again
  (they never followed the state; only a direct volume's does). Both pre-existing, in TODO.md.

Checkpoints: before 6 for a 5-step drag (N+1), after 1 (the headless test's count of `getSnapshot`).

## Item 7: where a level-0 slice step goes (measurement only, no code)

TS_08 level 0 is 928×928×450 (1.55 GB decoded, `large: true`); a Z slice image is 928×928 (861k pixels). 12 Z steps (+5
each), awaited one at a time, the call plus two frames:

| level | grid        | step, median (range) | image build (`createGridImage`) |
| ----- | ----------- | -------------------- | ------------------------------- |
| 2     | 232×232×113 | 18–32 ms (13–106)    | about 9 ms                      |
| 1     | 464×464×225 | 49–91 ms (42–133)    | about 39 ms                     |
| 0     | 928×928×450 | 436–449 ms (366–526) | 387 ms                          |

Level 0, by part (Chrome CPU profile through CDP, 100 µs sampling, 12 steps, ms a step): image build 387 (89 %; self
time in `createGridImage` 333, `trilinearlyInterpolate` 39, `transformMat4` 16), texture upload about 12 (2.8 %;
`writeTexture` 7, `flipRows2` 5), render about 3 (0.8 %), GC 23 (5 %); the state update's own work is inside the build
(at most 14 ms besides, the upload in it). The step is the main thread building the image, not the GPU. #48 measured
150–240 ms here; this run read 366–526 ms (another session, the level just read; the split is what matters).

Why (read in `slice.ts` 456–560): for each pixel a theme `color()` call and a `Vec3.transformMat4` (even for a uniform
theme), and `mapping.index.set(o, [i])`: a Map of 861k entries with an array each, made again every step (the GC).

Proposal, in order: (1) a library lane from `origin/master` (upstream candidate, every Mol* grid slice gains): the
pixel→cell index lazy or a typed array (it is for picking), the color once for a uniform theme, the position stepped
instead of transformed; expected 3–5× (about 80–130 ms a level-0 step). (2) If still over a few frames: a coarser level
while dragging, the full one at the release (level 1 is about 50 ms, but needs that level in memory). (3) A GPU-side
slice (the 3D texture sampled in a shader): a few ms a step, but a new representation; not before (1) is measured. In
TODO.md.

## Checks

The full prism-viewer suite (quick 213 files, 1408 passed; medium 3 files, 28 passed); prism-me (28 files, 172 passed);
cryoet, mesoscale and stage-tools (passed); `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`,
`pnpm format:check`, `pnpm check:workspace` (after `node scripts/workspace/assets.mjs`: a missing CSS export) and
prism-viewer `styles:check` pass. prism-viewer `typecheck:storybook` fails on `src/api/styles.ts:114` (a file this lane
does not touch: not ours).

## Size

Brief: about 60 production lines. Production diff: 3 lines in gestureSteps (and its comment), about 15 in
properties.tsx. Under: the history fix is one option, and the forms reused the slice's path.
