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

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
