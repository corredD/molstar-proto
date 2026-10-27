## Prism: handles that move things

- `GizmoHandles` (`@molstar/prism-viewer/sources/gizmos`): one host of the gizmo library's controller for Prism's and
  extensions' handles: shown and hidden, its clicks claimed, its items read from the state, a commit's frames held, and
  a drag cancelled when the cells it starts from change (an undo during a drag). `PlacementHandles` (a placement's
  transform handles) and `frameHandles` (a rigid frame's) give the gestures; a drag no longer makes the handles' meshes
  at each pointer move (about 750 KB each).
- The structure move's and the cuts' handles run on it; a cut's commit now holds the canvas's frames as a structure's
  does.
- A scaled placement's pose is its turn alone: a drag on a structure placed with a scale no longer jumps.
