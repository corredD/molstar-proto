## Graphics: faster volume grid slices

- A grid slice's image builds about 3x faster, every pixel the same: the pixel-to-cell index (only read to mark loci)
  is computed from a cell's coordinates instead of a Map of an array per pixel filled with every image (made on its
  first lookup for a periodic volume and for plane and frame slices), a uniform color theme is called once, and a
  pixel's position is the affine transform inlined (the same bits). TS_08 level 0 (928×928 Z slice, volume-value
  color), one slice step: 273 → 87 ms (image build 260 → 73 ms).
