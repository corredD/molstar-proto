## prism-me: the graphics modes change the levels of detail

- `mesoscale.graphics` (Graphics & Motion, ⌘K, `?graphics-mode=`, the agent) writes a mode's levels of detail by size on
  screen, `Spheres.LodPixelPresets[mode]` (the levels and `lodPixelSize`: Ultra 1.5 px, Quality 3, Balanced 4,
  Performance 6), to every representation with levels of detail: a particle list's spacefill and target, a structure's
  spacefill or cartoon. It wrote the distance presets, which a target ignores at its default 3 px.
- A particle list's mode is read back by the levels and the pixel size, on the representations that have levels of
  detail: a cellPACK list's fibers (none) no longer make it read as mixed, so the mode picked stays lit. A state saved
  with the distance presets lights no mode until one is picked again.
