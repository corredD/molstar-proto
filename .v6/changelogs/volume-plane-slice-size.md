## Volumes: a plane slice as wide as the volume

- Fix: a slice in `plane` mode was sized by the grid's diagonal in voxels, used as Å: a volume of 1.4 Å voxels lost
  the corners of its oblique cuts, a tomogram of 10 Å voxels showed a patch in its middle. The plane is now as wide as
  the volume (its bounding sphere), a pixel a voxel as before.
