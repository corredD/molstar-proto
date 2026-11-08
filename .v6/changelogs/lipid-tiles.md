## prism-me: lipid membranes made on the GPU

- `mesoscale.wrapMembrane` wraps a mesh, a compartment of a particle list (a sphere fitted to its particles) or a sphere
  with a lipid bilayer, one history step; prism-me's right-click on a mesh or a compartment's group offers Wrap with
  lipids. WebGPU only: on WebGL2 the object is made and the status line says it is not drawn.
- The bilayer is tiles of a flat patch (a CHARMM-GUI PDB, or a built-in synthetic one): an equilateral template whose
  edges are cut from shared strips, so two tiles meeting at an edge hold its lipids once; the surface is remeshed to
  near-equilateral triangles, one surface a leaflet. A compute kernel picks each triangle's tile and writes its affine
  transform straight into the renderer's GPU-culled instances: no transform crosses back to the CPU.
- Graphics: a merged render object's member may carry `gpuInstances`, a writer that fills its instances' transforms on
  the GPU (the GPU culler calls it after its own writes).
- Ludo's first try (a cow mesh ×100): the tiles' edge now suits the surface (it was a fixed 200 Å: a 1,000 Å cow became
  20 chords inside its body), the right-click wraps with CHARMM-GUI's 14-species patch (a static file fetched on the
  first wrap, not the synthetic lattice), up to 8 interior variants a tile, atoms at 2 Å, lipids 3 Å across a seam's
  ends (no gaps at small tiles' vertices), the mesh hidden under its membrane, and a mesh too small is refused with
  "scale it first".
