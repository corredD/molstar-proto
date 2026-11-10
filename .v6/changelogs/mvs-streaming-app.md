## prism-me: a streamed MesoViewSpec document

- A streamed document loads its copies where the camera looks: once the camera rests, the tiles nearest its target
  load, within the budget, and the farthest leave.
- The budget is in Settings, Behaviors: "Streamed copies" (3000 by default). Changing it is one History step, and Undo
  sets it back.
- Tiles loading and leaving are not History steps. Undo restores the document and leaves the tiles where the camera
  is; Undo of a look edit while tiles stream undoes their looks too.
- `mesoviewspec.open` with `example: 'tiled'` opens the streaming fixture (32 tiles of 400 copies).
- For extensions: the runtime's `TileStreamer.step(ir, focus?)` plans from a focus the viewer gives (its canvas camera)
  instead of the document's camera. `MesoSession.setFocus` and `MesoDocumentModel.setFocus` take it.
