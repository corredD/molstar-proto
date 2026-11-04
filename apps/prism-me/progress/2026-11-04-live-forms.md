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
