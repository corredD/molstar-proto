# Handles that move things

`GizmoHandles` (`src/sources/gizmos/handles.ts`, exported as `@molstar/prism-viewer/sources/gizmos`): the one host of
the gizmo library's controller (`@molstar/graphics/util/gizmo/controller`) for anything Prism or an extension moves by
hand: a structure ([structure-move.md](structure-move.md)), a cut ([clipping.md §4](clipping.md)), an extension's
object.

- **A host gives a binding, the class does the rest.** The binding is the library's (`layout`, `apply`, `preview`,
  `commit`, `cancel`, …) with its items read from the state (`items()`), not a stream: the class reads them again at
  each state change (or at the host's own `changes`) and on `publish()`. It owns the controller, shows and hides it,
  claims its clicks (`InteractivityManager.clickOwners`). Why: a host's rules in one place (the clicks, the publish, the
  cancel on a change, the frames held), each host only what it moves.
- **A drag previews outside the state, its release is one commit.** The commit is the host's (one operation, one history
  step); the class holds the canvas's frames until it is done (`holdFrames`, 3 s at most), as the drawing and the state
  would otherwise show the item moved twice or not at all. A commit not taken or failed: the binding's `cancel` puts the
  item back (the library's rule).
- **What a drag starts from changing cancels it** (an undo, another edit): the cells the binding names for the item
  (`cells(key)`, default its key), every cell under them and every cell above them (a decorator under a structure, a
  volume's transform above a slice, a mesh's shape provider), compared by their params as at the press. Its release then
  commits nothing.
- **A placement comes ready** (`PlacementHandles`: `layout`, `sameGeometry`, `equal`, `apply`): a transform on top of
  where a thing was loaded and its center (a structure, an extension's object), its scale kept under the turn.
- **A frame comes ready** (`frameHandles(options)`, the same): a rigid frame and a size (a slice's plane, a particle),
  the rings those asked for.
- **Tests** drive a fake canvas on a headless viewer's plugin (`src/testing/gizmo-canvas.ts`: hover a handle, drag,
  release, Esc); a release outside the window is the canvas's own (`interactionEnd`) and is not faked.
