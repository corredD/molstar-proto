## prism-me: Mesoscale

- Paint and grow on a mesh: a paint stroke over a file mesh (OBJ, PLY, VTP) puts its copies on its surface, turned to
  its normal; the Grow section's On picks a mesh of the scene (the one the source was painted on by default), and
  Tiling (ring by ring over the surface, a point closer than 0.8 × Spacing to one kept dropped, its Count), Random
  walk and Sphere grow on it, each copy's axis along the surface's normal. Crystal grows in space.
  `mesoscale.grow { …, mesh }`.
