## Graphics: grid slices from a GPU window of planes

- A grid slice (`slice` representation, `mode: 'grid'`) colored by `uniform` or `volume-value` is drawn from a window of
  32 planes of raw values in a 3d texture (WebGL 2, WebGPU), colored in the shader: a step within the window is a
  uniform, a step at its edge one plane copied, a jump the plane shown (the rest in idle time). Other themes, periodic
  volumes of several tiles and devices without 3d textures keep the CPU image. A 512 × 720 × 225 tomogram's Z slice:
  a step through the state 65 ms → 7 ms; a step of the representation itself 0.1 ms (within the window), under 2 ms at
  its edge, a jump 1 ms (was 23–43 ms with a refill).
- A hidden slice frees its window after 5 s, made again when shown. A volume of 2^28 voxels or more (1 GiB of floats)
  is binned 2× in the background once a slice is shown; a slice moved out of its window shows the binned plane, exactly
  where the full one is, and the full-resolution plane 150 ms after it rests: a 1.5 GB map's X slice dragged end to end,
  0 frames over 33 ms (was 15). `binGrid` yields in its averaging pass too.
- `Texture.loadLayer`: a plane written into one layer of a 3d texture. `VolumeVisualBuilder.updateGeometry`: a volume
  visual's geometry updated in place instead of made again. `getVolumeValueDomain`: the volume-value palette's domain in
  the volume's values.
- Mesoscale Explorer (Cryo-ET): the Slice slider's drag moves the slice outside the state, one frame at a time, and
  commits once on release (one undo step): Ludo's tomogram dragged end to end, 0–1 frames over 33 ms (was 24–27), 1
  state commit (was 24).
