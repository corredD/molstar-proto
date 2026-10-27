# Handles drawn on top (2026-10-26, lane `handles-on-top`)

## Brief

- **Asked** (Ludo, 2026-10-26, before the other `Next` items): an option for the handle geometry to be drawn on top of
  everything, with a toggle. **Check:** show an object's handles (right-click › Move and turn) inside or behind a model:
  toggle On top on: the handles show through everything and are grabbed through it (a press on a handle drags it, not
  the object in front); toggle off: they hide behind as now. The same for a clip's handles, the oblique slice and a
  particle's handle. Dragging and one-undo still work in both modes; the toggle itself is no undo step.
- **Defaults taken by the coordinator** (Ludo did not choose; say so in the PR): one viewer-wide toggle that every
  handle follows (not one per handle), off by default; only the handles one grabs are on top, a gizmo's translucent body
  (a clip's plane, a slice's frame) stays depth-tested so it still shows where it cuts.
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

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
