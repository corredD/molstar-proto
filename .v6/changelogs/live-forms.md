## prism-me: live forms

- The explorer's Representation forms of an isosurface, a direct volume and a particle list follow their sliders
  during a drag, as the slice's do: each step runs as soon as the last landed, the newest value winning; a drag is one
  undo step. They wrote 150 ms after the last change, so a drag showed nothing until it paused.
- Prism's sliders (`gestureSteps`: the map levels, the transfer function, the representation quick controls, the
  explorer's live sliders) take one history checkpoint a drag, at its start, not one per applied step: on a scene whose
  snapshot is over 50 ms one drag no longer turns undo off. A step refused mid-drag undoes the whole drag at its end.
