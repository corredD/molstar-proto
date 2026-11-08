## Graphics

- GPU culling of a merged object with more than 4.2M instances (65535 workgroups of 64) no longer throws
  `kernel 'cell-cull': … workgroups exceed 65535 per dimension` every frame: the cell, instance and record kernels
  dispatch their workgroups in rows past the device's `maxComputeWorkgroupsPerDimension` (a 600 nm slab of the whole
  yeast cell: 6.7M instances, 104k workgroups). `ComputeContext.maxWorkgroupsPerDimension` gives the limit.
