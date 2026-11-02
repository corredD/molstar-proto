## Graphics

- `gpuCulling: 'auto'` also culls on the GPU from 1,000,000 spheres with 30 instances per draw where the device has no
  sphere raster (`AutoGpuCullingMinSpheres`, master's rule extended: the 20k-instance floor waived by the sphere
  count): mesoscale models of few instances of large members (PetWorld) are tested per instance again on Apple GPUs
  (no `atomic-vec2u-min-max`). M1 Pro, WebGPU, PetWorld HIV at 1 / 0.1 / 0.02 of the camera's distance: 25.2 / 71.1 /
  47.4 -> 17.1 / 34.8 / 30.9 ms a frame
- Particle target signatures count the spheres of structure targets, so the programs prepared ahead are those of
  objects culled on the GPU by the sphere rules (the raster's too)
