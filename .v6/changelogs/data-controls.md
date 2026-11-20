## prism-me: CryoET

- An MRC's Level in its Data section: 1×, 2×, 4× (8× over 1000 voxels a side), binned from the map loaded (each voxel
  the mean of a block, at the block's center in Å), the slices at their place and the gray windows in σ, one step, kept
  in sessions. `cryoet.level { level: "2" }` on an MRC; `VolumeFromCcp4`'s optional `bin`; `binGrid` in model.
- A VTP's Color by in its Look: Uniform (the picker) or Array (a point or cell array, a color scale, a range: Auto or
  Custom). `cryoet.mesh { array, colorList, range }`; `cryoet.meshes` lists a mesh's arrays and its Color by. A VTP's
  one color was not written before (its theme is `colorTheme`, not `coloring`).
