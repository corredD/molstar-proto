## Graphics: impostors for far particles

- Particle structure targets far away are drawn as octahedral impostors (`structure.lodImpostor`, on): each copy its
  protein's silhouette from the nearest of 81 views made at load, with depth, its color, flat far away; the last
  spheres cross-fade into them by a dither over half an octave (`.v6/plans/gl/lod-impostor.md`). cellpack-mg, two
  cells far: 21 → 16 ms a frame (WebGPU, M1 Pro); close up the spheres cost about 25% more (WebGPU), 45% (WebGL2).
- Every structure target can be a silhouette (lipids and ions too). Far copies thin out (`structure.lodImpostorThin`,
  8 px, 0 off): below that size a stable share is kept, larger, the area kept (stochastic simplification). The switch
  by distance defaults to where a median protein is 12 px across; its slider starts at 100 Å and shows the distance
  applied. Atlases up to 8192 a side (thousands of targets).
