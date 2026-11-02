## GPU occlusion culling zoomed in

- The GPU's occlusion test clamps a sphere's screen rectangle to the view where the depth pyramid is of the view
  being culled (the second phase, a still camera): before, a sphere whose rectangle reached past the view was never
  occluded, which zoomed into a packed scene is most of what is hidden. CellPack HIV on WebGPU without the sphere
  raster: still frames at 0.1 and 0.02 of the distance about 3 and 2 times faster, turning frames about 20 % faster;
  the image the same as without occlusion, moving or still, with one phase or two
