## prism-me: Cryo-ET

- A volume's Data section has a Pixel size (Å): a log slider and Reset to the file's value ("file: 13.36 Å"), for a file
  whose header is wrong. The map is scaled about the origin as if the header said so, before any move; its slices,
  isosurfaces, levels, Voxel line, density fit and Color by Volume follow (`cryoet.volume`, one step, kept by sessions).

## Core

- `VolumeTransform` has a `scale` (about the origin, before the move; 1: as the file says), as a particle list's.
