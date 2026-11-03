## Graphics: volumetric lighting of direct volumes

- Direct volumes have a `lighting` param: `local` (the default, as before) or `volumetric`, where dense regions shadow
  the key light and occlude the ambient light and thin ones let it through, from a pyramid of the extinction under the
  transfer function (WebGPU with `texture-formats-tier1`; `local` elsewhere). M1, 1920x1080: a 256³ map 3.74 →
  3.76 ms a frame, a 512x512x96 slab 3.76 → 4.07 ms.
- Direct volumes lit `volumetric` honor their clip objects: the part a clip removes no longer shadows what remains (the
  cut face is lit) nor the traced molecules.
- Illumination: a direct volume lit `volumetric` shadows the traced molecules (the light through its extinction), with
  or without the illumination's shadows; one light for both, the renderer's.
- WebGPU: textures with mip levels written one level at a time by compute kernels (`Texture.define`'s `levels`,
  `TextureLevel`), `r16float` storage under `texture-formats-tier1`.
