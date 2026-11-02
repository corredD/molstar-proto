## GPU occlusion culling zoomed in

- The GPU's occlusion test clamps a sphere's screen rectangle to the view where the depth pyramid is of the view
  being culled (the second phase, a still camera): before, a sphere whose rectangle reached past the view was never
  occluded, which zoomed into a packed scene is most of what is hidden. On WebGPU without the sphere raster (Apple M1),
  still frames at 0.1 and 0.02 of the distance: CellPack HIV 25.1 / 16.2 to 7.5 / 7.6 ms, PetWorld HIV culled on the
  GPU 34.8 / 31.1 to 12.5 / 19.3 ms. Still frames are the same image as without occlusion; turning frames lose
  nothing that they drew before (with two phases, the default, the same image as without occlusion)
