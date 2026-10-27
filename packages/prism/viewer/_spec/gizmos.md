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
- **A drag makes no meshes:** a binding with `frame(item)` keeps the last layout's meshes through a drag (a value of the
  same geometry: its frame moved), and lays an item out anew at rest (the controller may be making a gizmo then); the
  library lays an item out at each preview, and the transform handles' meshes are about 750 KB (`handles.scaling.ts`
  guards the drag).
- **What a drag starts from changing cancels it** (an undo, another edit): the cells the binding names for the item
  (`cells(key)`, default its key) and every cell under them, compared by their params as at the press; a cell above is
  named when it places the item (a mesh's shape provider). Not every cell above: a trajectory playing its frames would
  cancel every drag. Its release then commits nothing. A drag's cancel the controller runs late (after a preview in
  flight) is run at the next press instead, before that drag begins.
- **A placement comes ready** (`PlacementHandles`: `layout`, `sameGeometry`, `equal`, `apply`): a transform on top of
  where a thing was loaded and its center (a structure, an extension's object), its scale kept under the turn.
- **A frame comes ready** (`frameHandles(options)`, the same): a rigid frame and a size (a slice's plane, a particle),
  the rings those asked for.
- **On top, one setting for every handle** (`canvas.handles`: `onTop`, `scale`; ⌘K "Handles on top" flips it): the gizmo
  library's look of the canvas (`GizmoAppearance`), which every controller follows, Prism's hosts and an extension's
  alike; no option per host. On top, every part of a gizmo (its handles and its body: a cut's plane, a slice's frame) is
  drawn over the scene (Canvas3D's on-top layer, `setOnTop`), because a handle one cannot see cannot be grabbed (Ludo,
  2026-10-26); the handles are picked through the scene, a body stays not pickable. A view setting (no history step),
  kept with the canvas, not across reloads (as the canvas's own settings); off by default.
- **Tests** drive a fake canvas on a headless viewer's plugin (`src/testing/gizmo-canvas.ts`: hover a handle, drag,
  release, Esc; what is on top); a release outside the window is the canvas's own (`interactionEnd`) and is not faked.
