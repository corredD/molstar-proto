## Graphics

- `gpuCulling: 'auto'` also culls on the GPU from 10,000,000 spheres with 30 instances per draw on any device
  (`AutoGpuCullingMinSpheres`, a fifth argument of `resolveGpuCulling`: master's rule extended, its 20k-instance floor
  waived by the sphere count): mesoscale models of few instances of large members (PetWorld) are tested per instance
  again on devices without the sphere raster (Apple GPUs: no `atomic-vec2u-min-max`). M1 Pro, WebGPU, PetWorld HIV at
  1 / 0.1 / 0.02 of the camera's distance: 25.2 / 71.1 / 47.4 -> 17.2 / 34.9 / 30.9 ms a frame
- Particle target signatures count the spheres of structure targets drawn as impostors, so the programs prepared ahead
  for them follow the sphere rules (the raster's too)
