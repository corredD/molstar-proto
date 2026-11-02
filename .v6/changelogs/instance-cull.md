## Close up, only the particles in view

(Since the merge of master with #2061, see `merge-master.md`: the per-instance GPU culling and the two phases are
master's; prism-me's clusters, space order, clamped occlusion rectangles, CPU culling by instance and 10 M vertex auto
rule are gone.)

- `Canvas3D` `motion` (`lodScale`, `holdMs`): levels of detail by size on screen coarser while the camera moves, full
  detail once it rests (`Renderer.setLodScale`); `motion.pixelScale`, a lower resolution while moving (the canvas and
  input resized through `Canvas3DContext.setMotionPixelScale`, the trackball's drags unchanged:
  `TrackballControls.setResolutionScale`). Off by default; the Mesoscale Explorer keeps full detail and draws at 0.5 of
  the resolution while moving (0.35 on a 2x display).
- A draw list replays no recording of other levels of detail at the same camera (the view's scale is part of it).
- Culled spheres grow by how far wiggle and tumble move them (the GPU's cells and instances, the CPU's batches and
  cells).
