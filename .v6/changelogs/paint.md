## prism-me: Paint

- Paint copies of a mesoscale entity onto a surface (cellPAINT in the explorer): an entity's right-click › Paint with …,
  then a drag on the canvas paints a stroke, a copy every spacing, previewed as discs on the surface; the release is one
  undo step. A membrane protein stands upright in the membrane (its +z along the surface, on the membrane's mid-plane),
  anything else is turned at random; the principal axis or the view direction on request; the side and the spin. The
  entity's Paint section sets the brush.
- `mesoscale.paint` (a command and an agent tool, `paint_mesoscale_copies`): copies of an entity at points with their
  normals, one stroke a run; the strokes are a particle list decorator, `ParticleListPainted` (mesoscale extension),
  saved in sessions and carried by a later move of the list. On the exosome model (88k particles) a stroke of 8 CD9
  copies paints in about 0.1 s headless.
- While painting, Alt with the usual gestures moves the camera (Alt+drag turns, Alt+right drag pans, Alt+wheel zooms).
- A soluble entity paints at the pointer's tip, at a depth along its ray (from the camera's focus; the wheel moves it);
  a membrane protein stays on the surface. The Paint section's Place overrides either way.
- A copy of the brush follows the pointer, where a click puts it and turned as it will be; a click paints that copy.
- Paint a fibre: a stroke with an entity that has fibres (or Fibre on) becomes a new fibre of the list, its points the
  entity's fibre step apart, each turned along it as the entity's own fibres are (its axis and twist).
  `mesoscale.paint` takes `fiber`.
- Fibres by rise and twist (round 3): a painted fibre keeps its path, and its points are made from the entity's fibre
  settings, a point every Rise (Å) along the path, each turned by the Twist (°) from the one before plus a random turn
  within ±Jitter (°, seeded). The settings are in the entity's Fibre section (and the Paint section);
  `mesoscale.fiber` sets them, one step, and every painted fibre of the entity is made again (the file's fibres stay).
  Default: the entity's own fibres' step and twist. A DNA: 3.4 Å, 34.3°, 0; an RNA: its rise, Jitter 180.
- Fibres by an axis and an offset (round 4): the entity's Fibre settings choose the unit's own axis along the path
  (Auto, X, Y, Z; Auto: its fibres', else its principal axis) and an Offset (Å) off the path, along a perpendicular of
  that axis that turns with the unit (with a twist: a helix about the path). `mesoscale.fiber` takes `axis`, `offset`.
- The copy under the pointer is drawn in the scene (round 4), depth-tested: seen behind or inside what is in front of
  it, where a copy at a depth goes; the wheel keeps that depth inside the camera's near and far planes.
