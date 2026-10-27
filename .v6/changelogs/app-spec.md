## prism-me: Stage tools

- The clip whole/atoms toggle is stage-tools' `stage.clipWhole` and `stage.clipWholeState` (was the app's
  `explorer.clipWhole`), typed by the target representation's props.
- `stage.label` takes `radius`, the named part's radius: the label is sized to it and to its object, as the explorer
  sized it; without it, as before.
- `stage.pickedAt(click)` (and `stagePicked(loci)`) say what a click is on: an object and its part, a distance, a label
  (under the pointer first), a shape's representation. The explorer makes its row of it; the stage's menu pick is made
  of the same read.
