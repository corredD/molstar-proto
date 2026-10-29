## prism-me: the graphics modes change the levels of detail

- `mesoscale.graphics` (Graphics & Motion, ⌘K, `?graphics-mode=`, the agent) writes a mode's levels of detail by size on
  screen, `Spheres.LodPixelPresets[mode]` (the levels and `lodPixelSize`: Ultra 1.5 px, Quality 3, Balanced 4,
  Performance 6), to particle lists and spacefill structures. It wrote the distance presets, which a particle list
  ignores at its default 3 px: a mode changed the strides only.
- An object's mode is read back by the levels and the pixel size; one at other levels lights none.
