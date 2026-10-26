# One handle class in Prism (2026-10-26, lane `gizmo-handles`)

## Brief

- **Asked** (Ludo, [../TODO.md](../TODO.md) `Next`, from [../\_spec/architecture.md](../_spec/architecture.md) §7.4):
  one handle class in Prism's gizmo library for the oblique slice, the object move and the particle move: preview
  outside the state, one commit on release. **Check:** drag each handle (an object, a tomogram's oblique slice, one
  particle), then undo once: it goes back to before the drag. Also: undo while dragging cancels the drag; Esc cancels; a
  release outside the canvas commits or cancels cleanly.
- **What the coordinator found** (read-only scoping, 2026-10-26): the protocol is already in the library
  (`packages/graphics/src/util/gizmo/controller.ts:121-142`, the drag at :434-517: one preview in flight, one commit on
  `interactionEnd`, cancel on Esc, `invalidated`, or a false commit), and all three bindings already preview outside the
  state and commit once. What repeats is the **host**, five times: Prism's `StructureMoveGizmos`
  (`packages/prism/viewer/src/sources/structure-move/gizmos.ts:198`, `api.move.gizmos`) and `ClipGizmos`
  (`sources/clipping/gizmo/controller.ts:25`), stage-tools' object move
  (`packages/extensions/stage-tools/src/move-gizmos.ts`) and particle move (`stage-tools/src/particle-handle.ts`),
  cryoet's oblique slice (`packages/extensions/cryoet/src/oblique-handle.ts`): each its own target state, items subject,
  show/hide, click claim, `state.events.changed` → publish loop, `holdFrames(MaxCommitHoldMs)`, restore after a failed
  commit. The object move's pose math (move-gizmos.ts:25-58) copies structure-move/gizmos.ts:41-68.
- **The bug** (fails first): the object, oblique and particle bindings declare `invalidated` and never fire it
  (move-gizmos.ts:68, oblique-handle.ts:73, particle-handle.ts:170); only Prism's `MoveBinding` watches its cells
  (structure-move/gizmos.ts:94-97). An undo during a drag does not cancel it, and the object move's stale relative move
  lands on the undone placement.
- **Design** (Ludo, 2026-10-26: one lane on prism-me; tests with a fake canvas):
  - `GizmoHandles<T>` in `packages/prism/viewer/src/sources/gizmos/` (it needs the plugin context, so not in graphics):
    owns the controller, the click claim, the items and the publish loop; wraps the commit in `holdFrames`; fires
    `invalidated` when the cells under an item's key change; takes `{ items(state), layout, preview, commit, cancel }`.
    A `FrameValue` helper (`{ frame, size }`, `apply` by `poseOfFrame`/`frameOfPose`) for the oblique and particle
    bindings.
  - Prism's `StructureMoveGizmos` and `ClipGizmos` convert to it, in Prism commits of their own that name no extension
    (upstreamable; they must not need `ded144e8d`, which is on prism-me only, unless the oblique/particle helper is a
    commit apart).
  - The extensions keep their own preview and commit callbacks; their hosts and copied pose math go.
  - The headless viewer has no canvas (`headless.ts:33`): the class takes an injectable canvas, and the tests use the
    controller tests' `fakeCanvas` (`controller.test.ts:32`); no public API added only for tests.
- **Spec:** architecture.md §7.4 (built), §4/§6 where they describe the handles; Prism's spec for the gizmos or the move
  (`packages/prism/viewer/_spec/`), whichever names the hosts; `features.md` rows that change; ui.md only if a behaviour
  changes (undo or Esc during a drag).
- **Tests** (headless, `createPrismViewerHeadless` with the fake canvas):
  - fails first: for the object, oblique and particle handles, an undo (a state change under the item) during a drag
    cancels it, and the release commits nothing;
  - for each of the five: preview ×N, release → one history step; one undo restores the placement, plane or offset
    (characterization: passes today, kept as a guard through the refactor);
  - Esc cancels: no step; a failed commit restores;
  - `*.scaling.ts` on the host path: n and 4n previews allocate no more per preview (scratch matrices), with a control;
    the particle preview's copy of every coordinate (`offsetParticles`) is known debt (architecture §5), outside the
    guard and recorded in TODO.md.
- **Out of scope** (to TODO.md if not there): the label Move's own drag (`stage-tools/src/drag.ts:19-77`, raw DOM
  listeners, no `pointercancel`/`lostpointercapture`: a lost release leaves its layer up; it should use Prism's
  `drag()`); the oblique sliders' several undo steps (`cryoet/src/controls.tsx:267`, 60 ms debounce); the particle
  preview's O(n) copy.
- **Touches:** `packages/prism/viewer/src/sources/{gizmos,structure-move,clipping/gizmo}`,
  `packages/extensions/stage-tools/src/{move-gizmos,particle-handle}.ts` (and `operations.ts:244` `previewMove` only if
  the host needs it), `packages/extensions/cryoet/src/oblique-handle.ts`, imports in `apps/prism-me/src`, the specs.
  **Stays off:** nothing else in flight on prism-me.
- **Size:** ~+180 / −300 production lines (net ~−120); tests ~150.
- **Steps and models:** 1. read the controller, the five hosts and their tests (Opus) 2. the class, its fake-canvas
  tests and the invalidation test failing first (Opus) 3. convert Prism's two hosts, then the three extension hosts, one
  commit each (Opus; renames and imports to Sonnet) 4. checks (Sonnet) 5. the gate (Opus reviewer, skeptic).

## Built

- `GizmoHandles<T>` (`packages/prism/viewer/src/sources/gizmos/handles.ts`, exported as
  `@molstar/prism-viewer/sources/gizmos`; Prism's [gizmos.md](../../../packages/prism/viewer/_spec/gizmos.md)): the one
  host of the gizmo library's controller. It makes the controller on show and disposes it on hide, claims the clicks,
  reads the items from the state again at each change (or at the host's own `changes`), holds the canvas's frames while
  a commit runs, and cancels a drag when the cells it started from change (`invalidated`). Those cells are the ones the
  binding names (`cells(key)`, default the key) and every cell under them, compared by their params as at the press. A
  cancel the controller runs late (after a preview in flight) is run at the next press instead.
- `PlacementHandles` (`placement.ts`): Prism's structure pose math, moved here, fixed for a scaled matrix, and run in
  scratch matrices. `frameHandles` (`frame.ts`, over `poseOfFrame`/`frameOfPose`, prism-me only) is the other helper.
  Each gives `layout`, `frame`, `sameGeometry`, `equal` and `apply`.
- On it: Prism's `StructureMoveGizmos` and `ClipGizmos`, stage-tools' `ObjectMoveGizmos` and `ParticleHandles`, and
  cryoet's `ObliqueHandles`. Their public surfaces are unchanged, and each keeps only its preview, commit and cancel.
  The object move's copied pose math is gone. The mesh names its shape provider as a cell to watch.
- The bug: in the object, oblique and particle handles, an undo during a drag did not cancel the drag, and the release
  committed it on top of the undone state. Each test failed first, with one step too many after the undo.
- A drag makes no meshes: the last layout's meshes are kept for a value of the same geometry, and an item's layout is
  dropped when the item leaves. On a structure, 100 previews went from 95.7 MB to 20.3 MB. A placement move went from
  2.5 KB to under 1.2 KB.
- A fake canvas for headless tests (`@molstar/prism-viewer/testing/gizmo-canvas`): hover a handle, drag, release, Esc.
  It is put on the plugin as `canvas3d`, as `camera.test.ts` does.
- Specs: Prism's `gizmos.md` (new), `structure-move.md`, `clipping.md` §4 and the README; the app's architecture §4, §5
  and §7.4, and `ui.md` (an undo during a drag cancels it). TODO: the item left Next, and what stayed open went to the
  Backlog. The changelog is `.v6/changelogs/gizmo-handles.md`. No `features.md` row changes status.

## Decided

- No injectable canvas (agent, after the advisor's review): a test puts a fake on `plugin.canvas3d`, as the camera tests
  do, so the class has no option that only tests use. The fake lives in Prism's `testing/` folder and is exported,
  because the extensions' tests need it (precedent: `./testing/real-viewer`). This deviates from the brief.
- What a drag starts from is the cells a host names and those under them. Not every cell above: that cancelled drags
  during a trajectory's playback (review finding 2). The mesh names its shape provider (by reading: its test passes
  without it). The oblique slice names nothing: `stage.move` moves the slice's plane with its volume, so the slice's own
  cell changes on an undo (`apps/prism-me/src/_test/oblique-volume.test.ts`, which passes with and without a volume
  named).
- The particle handle's test is in `apps/prism-me` because the handle commits `cryoet.instance` and stage-tools does not
  depend on cryoet.
- A cut's commit now holds the canvas's frames, as a structure's does. It is said in `gizmos.md` and in the PR.
- `frameHandles` is in commits of its own, because it needs `ded144e8d`. The other Prism commits apply cleanly on
  origin/master (`git merge-tree`).

## Learned

- The controller lays an item out at each preview (`#show`), and transform handles are about 750 KB of meshes. The
  scaling guard (`checkLinear`) passed both before and after that waste was removed, so an absolute per-move bound (read
  exactly) is what guards the steps.
- The controller defers a cancel behind the preview in flight. Esc and then a press can start a new drag first, so any
  state that is cleared on cancel must allow for a late call.
- The fake canvas needs the plugin's calls too (`add`, `remove`, `update`, `commit`, `syncVisibility`,
  `camera.setState`). The gizmo's representation is found through `clickOwners.owns`.
- A release outside the canvas is the canvas's own (`interactionEnd`). It is not faked, and is left to Ludo's check in
  the app.

## Size

Production +650 / −681 (net −31), against the brief's ~+180 / −300 (net −120). What took the room:

- the review fixes: the late cancel, the layout cache and its pruning, the scratch matrices;
- the placement and frame helpers as their own modules, and the diff counting each rewritten host as both sides.

Tests and the fake canvas came to +864, against ~150: the fake canvas (about 130 lines), one headless drag test per host
(five), the class's own tests, and the scaling and allocation guards.

## Review

The reviewer reported 1 must-fix, 4 should-fix and 4 nits. The skeptic confirmed all 9 (finding 3's mesh-reuse half only
as plausible) and added 2: N1 is part of 1, N2 part of 4.

| Finding                                                                             | Severity   | Verdict   | Commit / open                                   |
| ----------------------------------------------------------------------------------- | ---------- | --------- | ----------------------------------------------- |
| 1. A late cancel (after a preview in flight) erases the next drag's state           | must-fix   | confirmed | c2f3ac8cd                                       |
| N1. The proposed guard for 1 would cancel clip drags spuriously                     | should-fix | confirmed | c2f3ac8cd (cancel run at press)                 |
| 2. The walk above an item cancels drags on unrelated changes (playback)             | should-fix | confirmed | b60154cd1, 4fc87ed38                            |
| 3. The layout cache never drops keys that leave                                     | should-fix | confirmed | 640e70ca5                                       |
| 4. Progress file empty, deviations not recorded                                     | should-fix | confirmed | this file                                       |
| 5. Allocations per pointer event (no scratch matrices)                              | should-fix | confirmed | 0579ae12e; a structure preview's 200 KB to TODO |
| 6. Scaling header comment stale                                                     | nit        | confirmed | 0579ae12e                                       |
| 7. `hide()` clears the target first, the preview stays drawn (pre-existing)         | nit        | confirmed | 08b9888c1                                       |
| 8. The upward loop does not dedupe                                                  | nit        | confirmed | moot (4fc87ed38)                                |
| A1. (advisor, before push) the layout cache shared meshes between two makes at rest | should-fix | confirmed | c02524aaa                                       |
| A2. (advisor) the early-run cancel count outlived hide                              | nit        | confirmed | a7ac73c3d                                       |
| 9. No host test for a refused commit's restore                                      | nit        | confirmed | open (TODO)                                     |
| N2. Deviations: the canvas is not injectable, a test-only export, scratch matrices  | nit        | confirmed | recorded above (Decided)                        |
