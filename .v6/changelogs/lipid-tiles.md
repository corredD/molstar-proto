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
