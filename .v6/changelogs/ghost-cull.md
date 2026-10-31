## Graphics: transparent outlines far from the camera

- Transparent outlines, and with them the ghosts of what clips cut, no longer vanish beyond about 500 times the near
  plane (a camera inside the scene's sphere, the near plane at its 1 Å minimum: a cellPACK model zoomed in): the outline
  target kept the transparent edge's reversed depth in 8 bits, which rounded to 0 there and read as no edge. A
  transparent edge alone now reads the 16 bits it already wrote, one beside an opaque edge the square root of its depth
  in 8; an edge counts by its flag, whatever its depth. WebGPU and WebGL.
