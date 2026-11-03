## Formats: CryoET Data Portal ndjson

- CryoET Data Portal ndjson reads `instancePoint` records (InstanceSegmentation annotations); each particle keeps its
  `instance_id` as the `instance_id` attribute. The `xyz_rotation_matrix` convention (as given, not transposed) is
  measured on a tomogram and pinned by a test.

## prism-me: the CryoET Data Portal, direct

- A shipped, versioned index of portal datasets (10003, 10453, 10524; `tools/portal-index`) and the `cryoetPortal` area
  (`datasets`, `run`, `load`): a run's OME-Zarr tomogram (slices and a direct volume), masks (surfaces), oriented points
  at the index's voxel spacing decorated with a PDB, the EMDB average beside, GLB meshes; one history step, a size guard
  above 512 MB. + Open › CryoET Data Portal… (a card), `?portal-dataset=10003&portal-run=TS_08`, and a portal object's
  run page and DOIs in its right-click menu.
