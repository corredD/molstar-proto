## Graphics: 3D gizmos

- `Canvas3D.setOnTop(repr, onTop)`: a representation drawn on top of the scene (its own layer, `Helper.onTop`, drawn
  after the scene with a depth of its own and copied over the image), so it shows through what is in front of it, and
  picked after the scene with the pick depth cleared, so a pick on it wins; not occlusion tested
  (`Renderer.withoutOcclusion`). Its render objects move between the layers, not made again; the camera stays.
- `VisualSet.setOnTop`: all of a set's representations on top, those added later too.
- `GizmoLook.xray` is now `onTop` and works: every gizmo on the canvas (handles and bodies) on top while it is set.
- The hovered gizmo handle turns yellow (in place, its color in the handles' render object), on top or not, and stays
  so while dragged.
- Prism's `canvas.handles` (`onTop`, `scale`): one setting for every handle on the canvas, a view setting (no history
  step); ⌘K "Handles on top" flips it; `canvas.get` reads it (`handles`). The Mesoscale Explorer has On top in Position
  and in a clip's line.
