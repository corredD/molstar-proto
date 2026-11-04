## prism-me: live slice sliders

- The tomogram slice sliders (Slice and Contrast, an oblique slice's X, Y, Z, tilts and Contrast, a slice's
  Representation form) and a segmentation mesh's Opacity follow the pointer during a drag: each step runs as soon as
  the last landed, the newest value winning; a drag is one undo step. They waited for the drag to pause (a 60 ms
  debounce re-armed every frame).
- `@molstar/prism-viewer/sources/gesture-steps` is exported (`gestureSteps`), for an extension's sliders.
