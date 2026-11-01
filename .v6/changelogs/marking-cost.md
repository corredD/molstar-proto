## Graphics: sphere impostors skip what a pass discards whole (#33)

- A sphere a pass would discard in every fragment now leaves in the vertex stage, before its projection: an unmarked
  sphere in the marking mask, a sphere the opaque pass (its transparency at or above the 0.09 cutoff) or the transparent
  passes (below it) would discard. Only where alpha is that value alone: alpha 1, no alpha thickness, not x-ray, not
  opaque back faces, not a per-vertex transparency; never in the marking depth (unmarked spheres occlude there). Meshes,
  cylinders and lines are unchanged: a triangle's vertices can differ.
- The image is unchanged (WebGL2: 0 pixels differ in 78 images of CellPack HIV and PetWorld HIV; WebGPU: within the
  frame-to-frame noise of its order-independent transparency). A hover in CellPack HIV at a tenth of the camera
  distance: 14.8 to 11.9 ms on WebGPU at dpr 1 (11.5 with nothing marked), 41.5 to 32.9 at dpr 2, 237 to 190 on WebGL2
  at dpr 2; an entity at transparency 0.5: 15.1 to 12.2, 43.0 to 32.5, 251 to 186.
- `dNoVertexSkip` (spheres) projects every sphere, for tests that compare the images.
