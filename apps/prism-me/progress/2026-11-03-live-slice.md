# Lane live-slice (2026-11-03)

Branch `me/live-slice`, worktree `~/prism-me-lanes/live-slice`, dev server port 1349.

## Brief (Ludo, 2026-11-03)

"I would like all the volume slice slider to be interactive, as I move the slider, the slice move. Every software does
that."

### What was found (by reading the code)

- Prism's `Slider` (`packages/prism/ui/src/components/params/slider.tsx:41-50`) already calls `onPreview` once a frame
  during a drag, and `onCommit` on release.
- The cryoet controls (`packages/extensions/cryoet/src/controls.tsx`) **debounce** it: `run` clears and re-arms a 60 ms
  timer on each preview (`Slice` ~line 482, `ObliqueSlice` ~line 279; the mesh Opacity `set(..., 80)` ~line 611). At a
  frame every 16 ms the timer never fires while the pointer moves: the slice moves only when the drag pauses or ends.
- `cryoet.slice` (`operations.ts` ~line 687) is a state update and commit of the slice representation.

### Steps

1. **One rule, in one place:** replace the debounce with a "latest wins" runner: a preview runs at once if nothing is in
   flight; while a call is in flight, keep only the newest value and run it when the call settles; a commit always runs
   (after the one in flight). One small helper in the cryoet extension (or Prism UI if a generic one already exists
   there: look first, do not duplicate), used by `Slice` (index, contrast), `ObliqueSlice` (x, y, z, ex, ey, contrast)
   and the mesh Opacity. No timers left in those controls.
2. **Undo:** a drag must not fill History with one step a frame. Check what a `cryoet.slice` call records today; if each
   call is a step, make the previews not recorded (or merged) and the commit one step, with the operation API's existing
   means (look at how Prism's own sliders or camera ops do it: `history: false`, a transient flag, a group). Do not
   invent a new history mechanism.
3. **Cost:** measure one `cryoet.slice` step on the 10003 TS_08 tomogram (level 1) and on a large dropped MRC; if a step
   is longer than a frame, say so and what bounds it (the runner already drops the values in between). Do not optimise
   the representation in this lane unless the measure shows it is needed (report first).
4. **Other volume slice sliders:** the representation form of a `slice` row (Prism `ParamsForm`, `params-form.tsx:569`
   sets on preview) and the oblique slice's handle drag: check they follow the pointer too; fix them only if they don't,
   with the same helper.
5. Spec in the same commits: `apps/prism-me/_spec/features.md` (the slice rows say "follows the slider during a drag"),
   the cryoet spec if it describes the sliders, `.v6/changelogs/live-slice.md`.

### Tests

- Fails first: a jsdom test of `Slice` with fake timers: previews every 16 ms for 300 ms call `area.slice` during the
  drag (today: 0 calls until the last + 60 ms), the last value is the one applied, and no more than one call is in
  flight at a time.
- The runner: newest wins, commit after the call in flight, nothing after unmount.
- History: a drag of N previews and a commit leaves one undo step (if step 2 changes it).
- Headed Chromium (`--enable-unsafe-webgpu`, Playwright from the worktree): drop or portal-load a tomogram, drag the Z
  slice slider with real mouse moves, take screenshots mid-drag (before release): the slice index on the canvas changes
  during the drag. Screenshot paths in the report.

### Ludo's check

On http://localhost:1349/apps/prism-me/build/: load 10003 TS_08 from the portal (or drop a tomogram), pick a slice row,
drag the Slice slider without releasing: the slice moves under the pointer. Same for Contrast, the oblique slice's
sliders and a mesh's Opacity. Undo after a drag goes back to where the drag started.

Size: about 60 production lines (helper 30, call sites 20, history 10), plus tests.

## Built

- `532e2d5a6` prism-viewer exports `gestureSteps` (`./sources/gesture-steps`): the existing latest-wins runner of
  Prism's own sliders (one apply in flight, the newest change per key merged, `settle` applies the last at once, a
  gesture one `api.group`). Nothing new was written for the rule: `latest` (prism-ui) aborts and runs concurrently,
  `restartable` is the debounce being removed.
- `b5d3efc65` cryoet controls: `live(api, label, apply)` (20 lines over `gestureSteps`, `throttleMs: 0`) used by `Slice`
  (index, contrast), `ObliqueSlice` (x, y, z, ex, ey, contrast) and the mesh Opacity; the timers are gone. `apply` runs
  through the group's API (`g.cryoet!.slice`): a call through the root area inside the group waits behind the group (a
  deadlock; the history test fails that way). The sliders show the values not landed yet over the state (`shown`):
  without it an earlier step landing set the knob back (8 times in a 60-move drag at level 1) and the release applied
  the stale value. `Slice` and `MeshControls` take `api`.
- `522a66fc3` the explorer's Representation form of a slice (grid or oblique) through `gestureSteps` too (it wrote 150
  ms after the last change); the other forms keep it (TODO.md). Specs: features.md, ui.md, TODO.md, changelog.
- `8276c19ed` `MeshControls` by the mesh's ref: the mesh lists rendered it by `MeshInfo`, and Prism's `For` renders an
  item again when its value changes under the same key, so the first live opacity step remade the controls and the drag
  was lost (seen in Chromium only).

## Review gate

Reviewer (Opus): 1 must-fix, 4 should-fix, 2 nits. Skeptic (Opus): all 7 confirmed (4 narrowed), 2 new (nit,
should-fix).

- 1 must-fix, the axis picker showed and applied a Z index on X while a Z step landed: fixed `9393c67dd` (steps by axis;
  failing test first).
- 3 should-fix, a held arrow key made an undo step per repeat (the old debounce merged repeats under 60 ms): fixed
  `9393c67dd` (settle only after a drag; failing test first).
- 5 should-fix, no ObliqueSlice test: a headless one added (fails if the apply runs through the root area).
- 2 should-fix, a checkpoint per applied change (`gestureSteps`' `continue` group): confirmed, pre-existing in
  `gestureSteps`, more often here; open (TODO.md, a Prism fix).
- 4 should-fix, the slice form writes its stale model: pre-existing, not worse; open (TODO.md).
- 6 nit, N1 the 600 ms quiet holds the history after a form change, a key or a typed value: as Prism's own sliders; open
  (TODO.md). 7 nit, per-frame literals: negligible (gestureSteps spreads already). N2: the fakes do not model the lock;
  the headless tests do (TODO.md).

## Decided (Opus, this lane)

- Undo: a drag is one step (one group). Each `cryoet.slice` call was a step of its own (20 calls: 20 steps).
- The controls gone mid-drag apply what they showed (`settle` on cleanup), as the mesh color and `lastWrite` do; the
  brief said "nothing after unmount": nothing new is accepted, the shown value lands once.
- Pacing is `gestureSteps`': with `throttleMs: 0` a step waits as long as the last took after it, so the page keeps
  frames for the pointer (about half the time busy at most).
- A drag paused over 600 ms (gestureSteps' quiet) is two steps; the form has no release, so its gesture ends that way.
- Step 4: the oblique handle drag already followed the pointer (GizmoHandles previews outside the state; checked in
  Chromium, one step at the release). The slice Representation form did not: fixed. Other forms: left, TODO.md.

## Measured (TS_08, 10003, headed Chromium, WebGPU, M-series Mac)

One `cryoet.slice` step (call to settled): level 2 (232×232×113, the default) 8–13 ms; level 1 35–50 ms (x: 31–33);
level 0 150–240 ms (one 630 ms outlier). Level 2 is under a frame, level 1 two to three; level 0 is 2–3 slices a second
during a drag, bounded by the runner (the values between dropped). No dropped large MRC was measured: level 0 of TS_08
(behind the size guard) stands for it. Not optimised (the brief: report first).

## Checked in the app (port 1349)

Z slice index, Z Contrast, an oblique slice's X and Tilt X, a dropped cube.obj's Opacity: the state follows during the
drag, history +0 during it and +1 after the release; undo goes back to where the drag started (Z slice). The oblique
handle dragged along its normal: the plane moves, the state untouched until the release. Screenshots: `drag-mid-20.png`,
`drag-mid-45.png`, `check-*-mid.png`, `handle-mid-drag.png` in the session's scratchpad.

## Learned

- Prism's `For` re-renders an item whose value changes under the same key: a control that edits its item must be keyed
  by an id that stays (or the drag in it is lost as soon as the edit lands).
- A Slider fed by state that changes during its own drag needs the pending value over the state.

## Size

Brief: about 60 production lines. Production diff: about 110 lines (helper 25, call sites 35, the knob overlay 15, the
slice form 20, the mesh ref 15). Over by the overlay, the form (step 4) and the mesh remount, none foreseen.
