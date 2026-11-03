## Volumes: OME-Zarr

- OME-Zarr (Zarr v2, NGFF 0.4 `multiscales`) volumes from a URL: `Open OME-Zarr` (a root action: URL, level, max
  size), or the transforms `OmeZarrFromUrl` (the metadata) and `VolumeFromOmeZarr` (one level, the coarsest by
  default; a level that needs more than `maxSizeMB` (512 by default; its voxels and one decoded chunk) is refused before any chunk is read). Placed in Å from the NGFF
  scale and translation as CCP4 places the same grid, so a level overlays the MRC of the same tomogram; a 0/1 mask
  shows as an isosurface at 0.5. Read by plain GETs (no `Range`), so the CryoET Data Portal's files load in a browser
- `@molstar/io/reader/zarr`: a Zarr v2 reader (`ZarrStore` over HTTP or a file map, `openOmeZarr`,
  `readOmeZarrLevel`) and a blosc1/LZ4 decoder in TypeScript (lz4, lz4hc, zlib, byte shuffle; about 700 MB/s on a
  256³ float chunk), loaded only when a Zarr opens (4.4 KB at start in the Prism viewer, 12 KB lazy)
- `fetchData` throws `DownloadStatusError` (with its `status`) for an HTTP error; the message is unchanged
