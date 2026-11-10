## mesoscale: MesoLocation is a union, MesoLoci has its copies in `copies`

- `MesoLocation` is a discriminated union (`copy`, `label`, `voxel`, `point`, `face`, `arc`); only `copy` is produced,
  the others are declared for the region and point work. `MesoLoci` is `{ copies, labels?, voxels?, faces? }` with only
  `copies` filled, and `VoxelBox` is declared beside it.
- Code reading `evaluateMesoQL`'s loci as a map (`loci.get`, `for (… of loci)`) reads `loci.copies` now. Nothing a user
  sees changes: the eyes, Show only, looks and the camera select the same copies as before.
