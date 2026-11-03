## prism-me: a volume's Direct volume section

- A volume's properties gain Direct volume, after Isosurface (now its isosurfaces only): each direct volume's Lighting
  on a line of its own (Local, Volumetric, Neural; one step), Prism's transfer function editor (the opacity curve over
  the map's histogram, its colors, presets, Colors at peaks), then the rest of its form, without Lighting and the bare
  control points graph; none: Add a direct volume. A direct volume's own row shows the same in Representation.
- Prism's transfer function editor: ×½ and ×2 scale every point's opacity at once, one step: a volume looks denser or
  thinner as a whole, where its opacity stops at 1. The curve keeps its shape until a point reaches 1; zero stays zero,
  and ×½ takes a point at the axis's floor to zero.
- `@molstar/prism-viewer` exports `sources/volume-transfer` (`createVolumeTransfer`) and `views/volume/volume-transfer`
  (`VolumeTransfer`), for an app's own properties.
