## Graphics: impostors for far particles

- Particle structure targets far away are drawn as octahedral impostors (`structure.lodImpostor`, on): each copy its
  protein's silhouette from the nearest of 81 views made at load, with depth, its color, flat far away; the last
  spheres cross-fade into them by a dither over half an octave (`.v6/plans/gl/lod-impostor.md`). cellpack-mg, two
  cells far: 21 → 16 ms a frame (WebGPU, M1 Pro); close up the spheres cost about 25% more (WebGPU), 45% (WebGL2).
- Every structure target can be a silhouette (lipids and ions too). Far copies thin out (`structure.lodImpostorThin`,
  8 px, 0 off): below that size a stable share is kept, larger, the area kept (stochastic simplification). The switch
  by distance defaults to where a median protein is 12 px across; its slider starts at 100 Å and shows the distance
  applied. Atlases up to 8192 a side (thousands of targets).
- Big copies no longer jump as the camera turns: every copy switches at its own size on screen (the radius cap is the
  largest target's; with lipids it had fallen to 17 Å, a ribosome a silhouette below 125 px), and each view is read at
  the ray's front (parallax), so the three views agree for elongated proteins. Mid distances cost more (cellpack-mg
  × 2.2: 10 → 15 ms) since proteins keep their spheres down to 12 px.
- Graphics & Motion › Far proteins: Thin below (0–16 px, off) and Kept grow (0–1.5: how much the kept copies are
  enlarged; `structure.lodImpostorThinScale`), also `mesoscale.impostors` `thin`, `thinScale`.
