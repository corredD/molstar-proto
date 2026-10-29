## Graphics: clipping

- A clipping table (`Clipping.table`, `Clipping.Cell`): per part (a row) and clip object, a mode (cut, ignore, keep a
  layer of a band inside, cut a band wider), the band in Å and a fuzziness that thins the band toward its edge, the
  same instances every frame (a stable hash of the instance, `Clipping.random`). Read by the instance clip on WebGPU
  and WebGL2 (`tClipTable`, `dClipTable`); with a table an instance's clipping value is its row, so a representation's
  parts can ignore any of its 16 clip objects, not 6 (the pixel clip too, its graded modes cutting plainly).
