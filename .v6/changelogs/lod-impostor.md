## Graphics: impostors for far particles

- Particle structure targets far away are drawn as octahedral impostors (`structure.lodImpostor`, on): each copy its
  protein's silhouette from the nearest of 81 views made at load, with depth, its color, flat far away; the last
  spheres cross-fade into them by a dither over half an octave (`.v6/plans/gl/lod-impostor.md`). cellpack-mg, two
  cells far: 21 → 16 ms a frame (WebGPU, M1 Pro); close up the spheres cost about 25% more (WebGPU), 45% (WebGL2).
