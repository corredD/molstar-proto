## Graphics: hidden instances do not make an object transparent

- An object whose instances are mostly hidden (a layer's transparency 1) is drawn by the opaque pass only: hidden
  instances are left out of `transparencyAverage`, so it no longer takes the transparent pass and the blended passes.
  An object with every instance hidden is drawn by neither pass (`checkOpaque`, `checkTransparent` move to
  `draw-table.ts`). CellPack MG, 90 % of the particles hidden: WebGPU 58 ms to MEASURED ms a frame.
