## Graphics: transparent outlines far from the camera

- Transparent outlines, and with them the ghosts of what clips cut, no longer vanish beyond about 500 times the near
  plane (a camera inside the scene's sphere, the near plane at its 1 Å minimum: a cellPACK model zoomed in): the outline
  target kept the transparent edge's reversed depth in 8 bits, which rounded to 0 there and read as no edge. An edge now
  counts by its type, whatever its depth; a transparent edge alone keeps its 16-bit depth, one beside an opaque edge the
  square root of its depth in 8 bits, and only that one is compared rounded with the opaque depth. An edge whose depth
  packed to 0 (the last Å before the far plane) is fogged as the farthest depth 16 bits hold. WebGPU and WebGL. (#30)
- A transparent edge behind the opaque surface at its own pixel is no longer outlined: a ghost behind a kept particle
  drew a band of its color over the particle's rim. (#30)
