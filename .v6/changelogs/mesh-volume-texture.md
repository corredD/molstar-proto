## prism-me: CryoET

- A mesh's Color by › Volume gets Detail: Vertex (as before, the colors at the vertices) or Texture: a color grid at
  the volume's voxels in the mesh's frame, read per pixel, so the colors show the volume's detail whatever the mesh's
  resolution (a decimated mesh too). Its cells near the surface are sampled as the vertices are (At surface, or
  Projected along the nearest surface point's normal within ±Depth); a change of colors, Range or Color order refills
  the grid without sampling again. Over 256³ cells the grid takes every k-th voxel, and the Look says so.
  `cryoet.mesh { detail }`; `cryoet.meshes` gives `detail`, and for Texture its `cell` side and `capped`.

## Graphics

- The grid color types read their grid per fragment with `ColorVolume.fragment` (the define `dColorGridFragment`), on
  WebGL and WebGPU: a triangle shows the grid's detail between its vertices.
- `Shape.colorGrid`: a mesh shape colored by a grid of RGBA cells in its own frame, which its representation uploads
  where it has a graphics context and reads per fragment, else trilinear at the vertices (`applyMeshColorGrid`).
