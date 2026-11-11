## prism-me: a streamed MesoViewSpec document

- A streamed document loads its copies where the camera looks: once the camera rests, the tiles nearest its target
  load, within the budget, and the farthest leave.
- The budget is in Settings, Behaviors: "Streamed copies" (3000 by default). Changing it is one History step, and Undo
  sets it back.
- Tiles loading and leaving are not History steps. Undo restores the document and leaves the tiles where the camera
  is; Undo of a look edit while tiles stream undoes their looks too. Undo of Close streams where the camera still
  looks.
- Close, Undo of the open, or another open while a tile is arriving leaves nothing behind: no tile on screen, and the
  next open frames its camera as a first open does.
- Tiles arriving or leaving no longer re-center the camera (Mol*'s canvas re-framed the scene when a tile landed at
  its edge), so after a pan the camera stays where you left it and the tiles load there. Reset camera still frames
  the whole scene.
- `mesoviewspec.open` with `example: 'tiled'` opens the streaming fixture (32 tiles of 400 copies).
- For extensions: the runtime's `TileStreamer.step(ir, focus?)` plans from a focus the viewer gives (its canvas camera)
  instead of the document's camera. `MesoSession.setFocus` and `MesoDocumentModel.setFocus` take it; a new session
  can start with one (`SessionOptions.focus`).
- An edit that changes a resource's address draws the new resource in that edit, and Undo and Redo load the
  resources of the document they go back to. A list an edit draws names its new entities and compartments on hover.
