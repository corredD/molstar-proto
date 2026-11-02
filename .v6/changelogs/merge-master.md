## Master's culling in prism-me (merge of #2061)

- GPU culling, two-phase occlusion and the `gpuCulling: 'auto'` rule are master's (#2061): two phases with
  `hiZ.twoPhase` (on by default), also with blended transparency (not drawn straight to the drawing buffer); `auto`
  culls on the GPU from 20k instances with 30 per draw, or from 100,000 spheres where the device has the sphere raster;
  prism-me's rule from 10 M vertices is replaced by one condition in master's rule: 10 M spheres also meet the 20k
  instance floor, on any device, with 30 instances per draw (#34, `no-raster-auto.md`), so PetWorld is GPU-culled on
  the M1 again
- No longer in prism-me: clusters of spheres per instance (meshlet culling), space order within the levels, and CPU
  culling by instance (WebGL2): measured not needed after the merge (#34, #35), so the frame times of
  `2026-10-31-instance-cull.md` do not hold. The occlusion rectangle is clamped at the view's edges again, on
  master's two phases and only where the pyramid is of the view culled (#35, `webgpu-zoom-regression.md`)
- `Canvas3D` `motion` stays (a lower resolution while the camera moves, coarser levels by `lodScale`); occlusion is no
  longer turned off while moving: master's two phases are exact
- GPU culling (cells, instances) and CPU culling (batches, cells) keep the allowance for wiggle and tumble at the
  view's edges
- Ghosts with master's clip culling: clip objects with a ghosted one cull nothing, so the ghost pass draws all they cut
- The sphere raster (devices with `atomicMinMax64`) draws color levels; objects with a clipping table (graded cuts) stay
  with the impostors
