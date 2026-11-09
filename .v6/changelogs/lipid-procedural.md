## prism-me: lipid membranes made per view

- Wrap with lipids (the cutter, now the default) makes its lipids per view: only on the triangles in view whose lipids
  are large enough on screen, nearest first within a pool (2 M lipids by default), made again in the renderer's frame
  when the view changes and never at rest. Far away the membrane is two surfaces, one a leaflet at its heads, each
  point coloured as the species the cutter puts there. The cutter cuts each region by cells under the patch's box,
  each its own spin and offset: no part of the patch repeats at its period on a large triangle.
- A tiles membrane has the same Look (species shown, hidden or coloured; colorBy; far surfaces; Levels), without
  Texture. A membrane, either method, takes Prism's clips (right-click › Add clip…).
- `mesoscale.membraneDetail { far, atomsPx, spheresPx, budget }`: the far look (spheres, texture or both) and where it
  switches, live in the membrane's Look; `mesoscale.membraneSpecies`: a species shown, hidden (not generated) or
  coloured; `mesoscale.graphics` on a membrane: its levels' preset.
- `mesoscale.exportMembrane`: the full build only at export, a RELION STAR particle list (right-click › Export lipids).
- Graphics: a GPU-written member of a merged object may be a pool: its writer returns how many instances are live
  (the GPU culler skips the rest) and may carry a view hook the culler calls where the view changed, before it culls.
- A cut membrane's far surface takes over from its spheres without a seam: coloured as the switch's sphere level shows
  the patch from above, at that level's tops, dithered in by distance over a px band (round 4c).
- A lipid membrane is coloured as a particle list: `mesoscale.style`, `mesoscale.colors` and `mesoscale.colorLevels`
  take it as `particles` (its species its entities; colours by zoom: its colour far, its species' near); the explorer's
  Look and right-click › Color… on it.
