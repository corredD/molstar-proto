## prism-me: lipid membranes made per view

- Wrap with lipids (the cutter, now the default) makes its lipids per view: only on the triangles in view whose lipids
  are large enough on screen, nearest first within a pool (2 M lipids by default), made again in the renderer's frame
  when the view changes and never at rest. Far away the membrane is two surfaces, one a leaflet at its heads, each
  point coloured as the species the cutter puts there. The cutter cuts each region by cells under the patch's box,
  each its own spin and offset: no part of the patch repeats at its period on a large triangle.
- A tiles membrane has the same Look (species shown, hidden or coloured; colorBy; far surfaces; Levels), without
  Texture. A membrane, either method, takes Prism's clips (right-click › Add clip…).
- `mesoscale.membraneDetail { far, atomsPx, spheresPx, budget }`: the far look (spheres, texture or both) and where it
  switches, live in the membrane's Look; `mesoscale.membraneSpecies`: a species shown, hidden (not generated) or
  coloured; `mesoscale.graphics` on a membrane: its levels' preset.
- `mesoscale.exportMembrane`: the full build only at export, a RELION STAR particle list (right-click › Export lipids).
- Graphics: a GPU-written member of a merged object may be a pool: its writer returns how many instances are live
  (the GPU culler skips the rest) and may carry a view hook the culler calls where the view changed, before it culls.
- A cut membrane's far surface takes over from its spheres without a seam: coloured as the switch's sphere level shows
  the patch from above, at that level's tops, dithered in by distance over a px band (round 4c).
- A membrane of a billion lipids (model_vertexcolor at x600) wraps in about a second and flies at the texture's cost
  far away: a large triangle is cut by cells made in view only (the leaflet facing the camera), nothing O(lipids) at
  the wrap; the far look is the patch's top view as a mipmapped texture on the mesh's own triangles (any scale), from
  2 px a lipid by default. Colours by zoom go down to each atom by element. Tiles are refused past 50 M lipids (the
  message names Wrap with lipids). Graphics: a mesh's patch texture mapped by planes and cells (`dPatchTexture`,
  WebGPU), and a repeat mipmap sampler.
- A cut membrane's far texture shows each lipid's species where that lipid stands on a curved mesh (it slid by up to
  the lift times a crease's angle). The cutter refuses meshes past 2,097,152 triangles (decimate first). Graphics: a
  mesh's patch texture shifted per vertex (`tPatchTable`'s texels after the cells), read in the colour variants only.
- A lipid membrane is coloured as a particle list: `mesoscale.style`, `mesoscale.colors` and `mesoscale.colorLevels`
  take it as `particles` (its species its entities; colours by zoom: its colour far, its species' near); the explorer's
  Look and right-click › Color… on it.
- A cell's membranes wrap as one: right-click › Wrap all N meshes with lipids (`mesoscale.wrapMembrane { meshes }`), one
  step; a membrane inside a closed one is neither selected nor drawn while the eye is outside it (and is under a clip,
  or once its encloser is hidden). A view's selection descends a sphere tree over the triangles (the
  yeast cell's 1.08 M triangles: under 5 ms a view). + Open reads the yeast cell viewer's `organelle_meshes.bin`
  (`.bin.gz`): a mesh a membrane, named, in Å.
- Each membrane of a wrapped cell is a row under the membrane in the tree, its eye and colour
  (`mesoscale.style { parts, visible, color }`, `mesoscale.colors { parts }`, one step each, never cut again): a hidden
  part draws no lipid and no surface; a part's colour is its far colour by zoom (its species and atoms still close),
  all of it with By zoom off. Each part has its own lipid mix (the yeast membranes: the PM's leaflets, the mito IM's
  cardiolipin, the LD a monolayer; stand-ins from the CHARMM-GUI patch, a source per number) and its own pools, the
  budget water-filled across them (a small membrane whole, the large ones alike; no longer nearest first across the
  cell). The export numbers a class by the membrane's species and a triangle by the whole mesh. The slab
  (`yeast_slab_z600nm.bcif`) and the organelle meshes share one frame: opened together they line up.
- A lipid membrane's colours by zoom on three levels in both methods: far its colour, then its species', close each
  atom's by element (the tiles' too). `mesoscale.colorLevels` takes `far` (the membrane's far colour alone) and `atoms`
  (`element`, or `carbon-species`: carbons the species' colour); its Look shows the Species and Atoms edges (no
  Chain), Far and Atoms, one step each; an edge moved redraws nothing (no rebuild). `mesoscale.theme` (a category's
  color theme) colours a membrane: by object, one colour, by entity, generated, By zoom.
- A theme whose membrane redraw fails (past the device's buffers, a cancel) fails cleanly: nothing changed, no undo
  step. A membrane's Reset and a category's theme leave its parts' colours and eyes. A cell's membranes upload each
  part's own regions only (about 6× less GPU memory on a cell of nine membranes) and show and fade their surfaces once
  a view, not once a part and leaflet.
- A cut lipid membrane's middle distance, switched live in its Look (Far › Middle: Coarse or Parallax, Atoms down to;
  `mesoscale.membraneDetail { middle, middlePx }`): Parallax draws the lipids as atoms down to 11 px, then the far
  surface's relief from the patch's heads' heights (its texture's alpha), lit by their profile. A patch mesh (WebGPU)
  gains `dPatchMiddle` (shells, beneath, parallax), `uPatchShells` and `uPatchMiddle`.
