# Handles that move things

`GizmoHandles` (`src/sources/gizmos/handles.ts`, exported as `@molstar/prism-viewer/sources/gizmos`): a host of the
gizmo library's controller (`@molstar/graphics/util/gizmo/controller`) for what an extension moves by hand: a particle,
a slice's plane, a stage object. Prism's own move ([move.md](move.md)) and cuts ([clipping.md §4](clipping.md)) run the
controller themselves.

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
  cancel every drag. Its release then commits nothing. While a cancel waits for a preview in flight, no drag starts (the
  controller's: it would start from the preview the cancel reverts).
- **A placement comes ready** (`PlacementHandles`: `layout`, `sameGeometry`, `equal`, `apply`): a transform on top of
  where a thing was loaded and its center (a structure, an extension's object), its scale kept under the turn.
- **A frame comes ready** (`frameHandles(options)`, the same): a rigid frame and a size (a slice's plane, a particle),
  the rings those asked for.
- **Over the scene, always** (the gizmo library's overlay layer): every gizmo is drawn above the scene, its handles on
  top and its body (a cut's plane, a slice's frame) x-ray (`GizmoLayout.occludedAlpha`, `DefaultOccludedAlpha`), because
  a handle one cannot see cannot be grabbed (Ludo, 2026-10-26); the handles are picked through the scene, a body stays
  not pickable. No setting: a host that wants other depth gives its layout's `occludedAlpha`.
- **The size, one setting for every handle** (`canvas.handles`: `scale`): the gizmo library's look of the canvas
  (`GizmoAppearance`), which every controller follows, Prism's hosts and an extension's alike; no option per host. The
  handles are drawn at their frame times the scale, a body as it is (it is what is edited). A view setting (no history
  step), kept with the canvas: not in the light restore (journal.md §6), which brings the canvas's props back where a
  host keeps one (`persist.restore`); 1 by default.
- **A hovered handle is marked** (the gizmo library's controller): Mol*'s highlight and the handles' glow, and the parts
  shown on hover (`when.hover`: a trackball's fill).
- **Tests** drive a fake canvas on a headless viewer's plugin (`src/testing/gizmo-canvas.ts`: hover a handle, drag,
  release, Esc); a release outside the window is the canvas's own (`interactionEnd`) and is not faked.
