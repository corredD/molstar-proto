## prism-me: a volume's Data section, an OME-Zarr read at another level

- A volume's properties start with Data: its source, grid, voxel and decoded size; for an OME-Zarr of several levels, a
  Level slider coarsest to finest at the level read, each step its binning, voxel and size ("4× · 27.2 Å · 24 MB").
  Released on a step, the volume is read at that level in place, one step: its slices stay at their place in Å, their
  gray windows and the direct volumes' transfer functions at the same σ, its isosurfaces, clips, position and
  visibility as they were. A level over the size guard asks first. An MRC map shows the facts only.
- `cryoet.level` (volume, level, large): the operation, with its command.
- `@molstar/prism-viewer` exports `api/volume` (`volumeStats`, `gridText`, `voxelText`); the plugin's OME-Zarr format
  exports `omeZarrLevelNeeds`, the bytes its `maxSizeMB` guard bounds.
