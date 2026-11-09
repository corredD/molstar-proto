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
