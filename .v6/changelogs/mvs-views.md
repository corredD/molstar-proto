## prism-me: a MesoViewSpec document's views, tours and labels

- A document's Views row in the Scene tree lists its views and its tours. A click on a view shows it: its camera and
  its looks. Showing a view is not a History step, and it does not change the document. Undo shows again the view that
  was shown with the scene it restores.
- The eye, Color… and Show only of a document row change the view shown, so another view keeps its own looks.
- A tour plays its views one after the other, each held for its duration, its caption shown on the tour's row. Stop, or
  Undo, ends it on the view it reached. The assistant asks once for a whole tour.
- New view from here makes a view with the current camera and the shown view's looks, and shows it. Update camera sets
  the shown view's camera to the current one. Open with this view sets the view a saved document opens on. Each is one
  step, saved with the document.
- Add a label on a document row adds an annotation to the view shown. It is drawn as a label in 3D while that view is
  shown, and it is saved with the document. A view's own annotations are drawn the same way.
- For extensions: the runtime's `updateView(doc, ir, view?)` and `compile`'s `view` option take the view shown, and
  `shownViewOf` resolves it. The `mesoviewspec` area adds `view`, `tour.play`, `tour.stop`, `newView`, `updateCamera`,
  `openWith` and `label`. Its tree state gains `views`.
