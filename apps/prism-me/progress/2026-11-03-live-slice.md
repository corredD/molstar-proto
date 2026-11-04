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
