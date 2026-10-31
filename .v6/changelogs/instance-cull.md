## Close up, only the particles in view

- GPU culling tests each instance of a drawn cell by its own sphere: the frustum, the distance ranges, each level, the
  depth pyramid. CellPack HIV zoomed to 0.1 of the distance on an M1 (WebGPU, Chrome): 83 → 12 ms a frame.
- The GPU occlusion test reads a level finer and clamps a rectangle to the view (after a turn, unless a part beyond the
  pyramid's view is in view), and tests against the newest pyramid: what a change at a still view reveals is drawn
  again, and a canvas draws the frames that settle it after the camera rests.
- `gpuCulling: 'auto'` also culls on the GPU from 10 M vertices at full detail and 30 instances (PetWorld's proteins).
- `Canvas3D` `motion` (`lodScale`, `holdMs`): levels of detail by size on screen coarser while the camera moves, full
  detail once it rests (`Renderer.setLodScale`); off by default, the Mesoscale Explorer sets 4.
- A draw list replays no recording of other levels of detail at the same camera (the view's scale is part of it).
