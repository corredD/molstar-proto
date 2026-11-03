## Graphics: volumetric lighting of direct volumes

- Direct volumes' `lighting` gains `neural` (experimental): the descriptors of `volumetric` through a small network (14
  → 16 → 16 → 2, its WGSL generated from the weights) trained on path-traced EMDB maps and tomograms, for the key
  light's and the ambient light's in-scatter: the phase and multiple scattering `volumetric` lacks. It shadows the
  traced molecules as `volumetric` does. On held-out maps against path-traced references its brightness ratio is
  0.94–1.00 (`volumetric` 0.74–0.96) and its relative RMSE a half to two thirds of `volumetric`'s; M1, 1920x1080: +60–70
  % a frame over `volumetric` (a 256³ map 3.56 → 5.74 ms). Details: `volume-lighting.md` §C.
- `tools/volume-lighting/`: the Python reference tracer (checked against closed forms and Mitsuba 3), the training data
  and the network's training, not shipped.
