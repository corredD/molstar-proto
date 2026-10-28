## Prism: clipping

- `clipping.previewCut(from, next)` and `endPreview()`: a view's gesture on a cut's numbers (a slider) shows the cut as
  it goes on its representations, outside the state (no history step), as a handle's drag does; the release is the
  view's one `clipping.update`. `clipping.boundsOf(cut)` (what it cuts, one sphere) and `clipping.cone` (a cone's
  half-angle from its scale and back) for views.
- The Mesoscale Explorer: a clip's line in the properties has a numbers toggle (beside its handles and On top): its
  place (X, Y, Z), turn (Turn X, Y, Z) and its shape's size (a sphere's diameter, a box's edges, a cylinder's diameter
  and height, a cone's half-angle) as sliders, previewed as they go, one step at the release.
