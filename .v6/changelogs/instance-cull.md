## Close up, only the particles in view

- GPU culling tests each instance of a drawn cell by its own sphere: the frustum, the distance ranges, each level, the
  depth pyramid. CellPack HIV zoomed to 0.1 of the distance on an M1 (WebGPU, Chrome): 83 → 12 ms a frame.
- The GPU occlusion test reads a level finer and clamps a rectangle to the view (after a turn, unless a part beyond the
  pyramid's view is in view), and tests against the newest pyramid: what a change at a still view reveals is drawn
  again, and a canvas draws the frames that settle it after the camera rests.
- `gpuCulling: 'auto'` also culls on the GPU from 10 M vertices at full detail and 30 instances (PetWorld's proteins).
- `Canvas3D` `motion` (`lodScale`, `holdMs`): levels of detail by size on screen coarser while the camera moves, full
  detail once it rests (`Renderer.setLodScale`); `motion.pixelScale`, a lower resolution while moving (the canvas and
  input resized through `Canvas3DContext.setMotionPixelScale`, the trackball's drags unchanged:
  `TrackballControls.setResolutionScale`). Off by default; the Mesoscale Explorer keeps full detail and draws at 0.5 of
  the resolution while moving (0.35 on a 2x display).
- A draw list replays no recording of other levels of detail at the same camera (the view's scale is part of it).
- Large members (512 spheres or more) draw level 0 by clusters of spheres, each culled per instance on the GPU
  (`cluster-copy`); each level's spheres in space order.
- Culled spheres grow by how far wiggle and tumble move them (GPU and CPU).
- CPU culling (WebGL2) tests the instances of a cut cell one by one for objects with levels of detail; draw lists grow
  where they need more room.
- Two-phase occlusion of the objects culled on the GPU (with order-independent transparency, on by default with
  `hiZ.gpu`): the instances visible last frame first, then this frame's depth pyramid tests the rest; exact while the
  camera moves.
