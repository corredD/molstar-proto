# Handles drawn on top (2026-10-26, lane `handles-on-top`)

## Brief

- **Asked** (Ludo, 2026-10-26, before the other `Next` items): an option for the handle geometry to be drawn on top of
  everything, with a toggle. **Check:** show an object's handles (right-click › Move and turn) inside or behind a model:
  toggle On top on: the handles show through everything and are grabbed through it (a press on a handle drags it, not
  the object in front); toggle off: they hide behind as now. The same for a clip's handles, the oblique slice and a
  particle's handle. Dragging and one-undo still work in both modes; the toggle itself is no undo step.
- **Defaults taken by the coordinator** (Ludo did not choose; say so in the PR): one viewer-wide toggle that every
  handle follows (not one per handle), off by default. ~~Only the handles one grabs are on top, the translucent body
  stays depth-tested~~: replaced by Ludo's correction (Decided): every part of a gizmo is on top.
- **What the coordinator found** (read-only, 2026-10-26): Mol\* has no per-object "on top"; the canvas has a helper
  scene drawn after the scene without its depth, the old `HandleHelper`'s `helper.handle.scene`
  (`packages/graphics/src/canvas3d/passes/draw.ts:747-749`, also in `passes/illumination.ts:330`), and picked after it
  (`passes/pick.ts:261-262`); its picks and marks go through `helper.handle.getLoci`/`.mark` (`canvas3d.ts:1176`,
  `1215`, `1241`). The gizmo meshes are representations in the main scene, added by `VisualSet`
  (`packages/graphics/src/util/visual-set.ts`) from the controller (`packages/graphics/src/util/gizmo/controller.ts`
  `#make`, ~:314), hosted by Prism's `GizmoHandles` (`packages/prism/viewer/src/sources/gizmos/handles.ts`, PR #9).
- **Design** (the lane's first step, Opus; pick one and say why in the progress file):
  - a. an on-top layer for representations in Canvas3D (a scene drawn after the main one with depth cleared, or the
    handle helper's generalized), picked first and marked like the main scene's; `VisualSet` adds a gizmo's handles
    there when on top, and moving them between layers needs no rebuild;
  - b. a render-object flag (no depth test, drawn last) if the draw and pick passes take it more simply.
  - Either way: a graphics change (Alexander's gizmo library and Canvas3D) in commits of its own that name no extension
    (upstreamable); the toggle in Prism (`GizmoHandles` option and a viewer setting, outside the history, remembered
    like the canvas's own settings) in its own commit; the explorer's toggle in a third.
  - Stop and report if the pick or the mark of an on-top layer needs a large Canvas3D rework (more than ~250 lines in
    graphics), or if WebGPU's passes (`gl/webgpu`) need their own work.
- **UI** ([../\_spec/ui.md](../_spec/ui.md) §4 Position and Clips): an "On top" toggle beside Handles (Prism's `Button`
  with `pressed`, an icon, `title` saying what it does), in Position and in a clip's Handles line, the same setting in
  both; ⌘K: "Handles on top". The mocks (`src/_stories/properties.tsx` Position, Clips) gain it.
- **Spec:** ui.md §4 (Position, Clips); Prism's `packages/prism/viewer/_spec/gizmos.md`; the gizmo library's spec if it
  has one; `features.md`.
- **Tests:**
  - graphics (gl shim, as `util/gizmo/_test/controller.test.ts`): with on top, the handles' render objects are in the
    on-top layer and a pick there wins over an object in front; switching moves them, no new render object;
  - Prism (headless, the fake canvas `@molstar/prism-viewer/testing/gizmo-canvas`): the toggle sets every host's
    handles; a drag and its one undo step in both modes; the toggle adds no history step;
  - the explorer: the toggle in Position and in a clip's Handles shows the same state.
- **Touches:** `packages/graphics/src/{canvas3d,util/visual-set.ts,util/gizmo}`,
  `packages/prism/viewer/src/sources/gizmos`, its settings, `apps/prism-me/src/explorer/properties.tsx` (Position,
  Clips) and `src/_stories/properties.tsx`, the specs. **Stays off:** nothing in flight on prism-me.
- **Size:** ~+200 production lines (graphics ~120, Prism ~40, explorer ~40); tests ~150.
- **Steps and models:** 1. read the passes, pick, mark and `VisualSet` (Opus) 2. the design, then the graphics layer and
  its tests (Opus, hot path: the draw and pick passes) 3. Prism's option and setting, then the explorer's toggle and the
  mock (Opus; mechanical edits to Sonnet) 4. checks (Sonnet) 5. the gate (Opus reviewer, skeptic).

## Built

- graphics (3 commits, no extension named): `Canvas3D.setOnTop` and the on-top layer (`Helper.onTop`, drawn by
  `DrawPass.renderOnTop` into a target of its own and copied over the image; picked after the scene with the pick depth
  cleared; `Renderer.withoutOcclusion`; the illumination and image passes too; a mark of it draws the image again);
  `VisualSet.setOnTop`; `GizmoLook.xray` became `onTop`, followed by every controller. Tests:
  `canvas3d/_test/on-top.test.ts` (a real Canvas3D on the gl shim: layers, updates, draw and pick order, marking),
  `visual-set.test.ts`, `controller.test.ts`.
- Prism: `canvas.handles` (`onTop`, `scale`; `history: false`), ⌘K "Handles on top" (a toggle), `canvas.get`'s
  `handles`, `api.canvas.handleLook`; the fake gizmo canvas tells what is on top. Test:
  `sources/gizmos/_test/on-top.test.ts` (every host, no step, the command flips it; a drag and its undo in both modes).
- prism-me: On top in Position's Handles line and in each clip's line (`explorer/_test/handles-on-top.test.tsx`), the
  mocks, ui.md §4, features.md, the changelog.

## Decided

- Ludo, 2026-10-26: every part of the gizmo on top: with the toggle on, all a gizmo draws (its handles and its body: a
  clip's plane, a slice's frame, rings, arrows, knobs) is drawn over the scene, because a handle one cannot see cannot
  be grabbed. Picking as designed: the handles are picked through the scene, the body stays not pickable.
- Ludo, 2026-10-26, after trying PR #10: on top, a hover barely shows (no outline, no glow). The hovered handle reacts
  itself: a strong color (no grow: Ludo, 2026-10-27), in the gizmo controller, on top or not (not dimming what is
  behind, not the marking and bloom passes). Built: its group's color in the handles' render object, changed in place
  and put back when the pointer leaves or a drag ends.
- Design a (lane, Opus): a second scene in Canvas3D, not a render-object flag. A flag would have kept the objects in the
  scene's every pass (SSAO, outlines, OIT, shadows, Hi-Z, marking) each needing an exception; a scene of its own is
  drawn in one place, after the helpers, as the old handle helper's is. It draws into a target of its own and is copied
  over, because at that point the image's target has the opaque depth texture attached (Hi-Z and the marking read it
  afterwards): clearing it there would break both.
- No option per host in `GizmoHandles` (lane): the library's per-canvas look already reaches every controller; an option
  per host would contradict one viewer-wide toggle. The Prism setting is the `canvas.handles` operation.
- Not kept across reloads (lane): prism-me keeps no canvas setting across a reload (no `persist.restore`); a Prism host
  with one gets the canvas's props back but not the handles' look (to Prism's TODO). Handle size is the same.
- In the explorer the toggle goes through `canvas.handles` (operations only); Handle size still writes the look
  directly, as before.

## Learned

- A full `Canvas3D` runs on the gl shim in jsdom (`createGl` + `Canvas3DContext.fromGraphics`), with one patch: the shim
  answers 0 for `COLOR_WRITEMASK`. Enough to test what draws and picks what, by wrapping `Renderer.create`.
- Headless Chrome (playwright, `channel: 'chrome'`) gives the explorer WebGPU by default; `?graphics-backend=webgl2`
  gives WebGL2. Both checked.
- On top, a hovered handle is marked in its color (the marking pass's outline draws the scene only) and has no glow
  (bloom is drawn before the helpers).
- Moving gizmos out of the scene leaves its bounds: they no longer count for a camera reset; back in the scene they
  count as when the handles are shown.

## Size

Production about +280 against the brief's ~200: graphics ~180 (the routing through Canvas3D's add, remove, update,
commit, context, marking, and the draw, pick and illumination passes), Prism ~70 (an operation, a command, the fake
canvas), explorer ~25. Tests ~470.

## Review

| Finding                                                         | Severity   | Verdict                                         | Commit / open                          |
| --------------------------------------------------------------- | ---------- | ----------------------------------------------- | -------------------------------------- |
| M1 headers of area.ts, operations.ts (canvas-settings)          | must-fix   | confirmed                                       | d8a5d683d                              |
| N1 headers of controller.ts and its test (the skeptic's)        | must-fix   | confirmed                                       | f081bd8fc                              |
| M2 changelog under two headings                                 | must-fix   | confirmed                                       | 83ee945db                              |
| M2b changelog only in the explorer commit                       | must-fix   | refuted (one file per branch)                   | -                                      |
| S1 toggling On top moved the camera (radiusMax, a reset)        | should-fix | confirmed (probe)                               | cdf37503d                              |
| N3 back in the scene, radiusMax not grown                       | should-fix | plausible                                       | cdf37503d (grows, never shrinks)       |
| S2 not remembered like the canvas's settings                    | should-fix | refuted for prism-me (no restore); spec wording | a958be226, 7c3931718; open: Prism TODO |
| S3 the draw test passed a layer drawn into the image            | should-fix | confirmed (mutant)                              | f6052aee8                              |
| S4, N2 an on-top-only commit not recorded, warmed, counted      | should-fix | confirmed / plausible                           | 49de8c99d                              |
| closures per frame and per pick in draw.ts, pick.ts             | nit        | confirmed                                       | open (the pass's own pattern)          |
| a clear and a copy per frame while the layer has hidden objects | nit        | mostly refuted                                  | open                                   |
| getByteCount counts the lazy target                             | nit        | refuted                                         | -                                      |
| on-top handles dimmed by the scene's marker average             | nit        | confirmed, not a regression                     | open                                   |
| setHandleLook writes the look directly                          | nit        | confirmed, intended (Decided)                   | -                                      |
| markIndex.set in setOnTop                                       | nit        | confirmed                                       | cdf37503d                              |
| VisualSet's doc: "in its bounds"                                | nit        | confirmed                                       | f081bd8fc                              |

Reviewer: 2 must-fix, 4 should-fix, 7 nits; skeptic: 13 confirmed, 3 plausible, 4 refuted or mostly, 3 new.
