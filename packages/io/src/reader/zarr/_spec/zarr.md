# Zarr v2 and OME-Zarr

`reader/zarr/`: Zarr v2 arrays and their OME-NGFF 0.4 `multiscales`, read into one typed array per level. Built for the
CryoET Data Portal's tomograms and segmentation masks (blosc-lz4, byte shuffle, 256³ chunks, `/` separator, `<f4` and
`|i1`), general where it costs nothing. The volume is `@molstar/model`'s (`formats/volume/ome-zarr.ts`), the state
transforms the plugin's (`state/formats/volume/ome-zarr.ts`).

| File          | What                                                                                 |
| ------------- | ------------------------------------------------------------------------------------ |
| `store.ts`    | `ZarrStore`: `get(key) → bytes or undefined`; `fromUrl`, `fromMap`                   |
| `metadata.ts` | `.zarray` (`parseZarrArray`) and NGFF `.zattrs` (`parseNgffMultiscales`), validated  |
| `blosc.ts`    | blosc1 decoder; `lz4.ts` the LZ4 block decoder                                       |
| `array.ts`    | `readZarrArray`: chunks fetched, decoded, cropped into one array                     |
| `ome-zarr.ts` | `openOmeZarr` (metadata only), `readOmeZarrLevel`; `ReaderResult`s as every reader's |

## 1. Store

- A key is `/`-separated from the hierarchy's root (`.zattrs`, `2/.zarray`, `2/0/0/0`). `get` gives `undefined` for a
  key the store does not hold: a missing chunk is the fill value (Zarr v2 does not write chunks that are all fill).
- `fromUrl(root, fetch)`: `root/key` by `fetch` (default core `fetchData`; the plugin passes its asset manager). Only a
  404 (`DownloadStatusError`) is a missing key; a 403 or a network error throws, or a broken store would read as zeros.
- **No header, no `Range`.** A cross-origin request with a `Range` header is preflighted, and S3-style hosts such as
  `files.cryoetdataportal.cziscience.com` answer the preflight 403 while a plain GET carries
  `Access-Control-Allow-Origin: *`. Chunks are read whole.
- `fromMap`: keys to bytes or `Blob`s (the files of a picked folder).

## 2. Arrays

- `zarr_format` 2, `order` `C`, `filters` null (or empty). Refused, with the reason: other formats, `F` order, filters,
  compressors other than §3's.
- `dtype`: `|i1 |u1 <i2 <u2 <i4 <u4 <f4 <f8` and their `>` forms (byte-swapped per chunk, `flipByteOrder`). `|` only for
  one byte.
- `dimension_separator` `.` (the default when absent) or `/`. `fill_value` a number, `NaN`, `±Infinity`; `null` is 0.
- Edge chunks are stored whole (padded); the reader crops them.

## 3. Codecs

- `null` (raw), `zlib` (core `inflate`), `gzip` (core `ungzip`), `blosc`.
- **Blosc** is c-blosc 1.x's format (what numcodecs writes): a 16-byte header (version, flags, typesize, nbytes,
  blocksize, cbytes), then one int32 start per block, then the blocks. Flags: `0x1` byte shuffle (only for typesize >
  1), `0x2` memcpyed (the bytes follow the header), `0x4` bitshuffle, `0x10` do not split, `>> 5` the codec. A block is
  split in `typesize` streams unless `0x10` is set or it is the last, leftover block; each stream is an int32 size and
  its bytes, stored as they are when the size is the stream's decoded size.
- **A chunk is untrusted input.** A header whose block is larger than its data is refused (it would only size an
  allocation). zlib (inside blosc or as the compressor) is checked as zlib's `uncompress` checks it: the 2-byte header,
  the exact length, the Adler-32, which core's `inflate` leaves to its caller (`zlibDecode`); an empty deflate stream
  (`03 00`) decodes to nothing, never to the buffer given. A failure names its chunk key and its cause.
- Codecs inside blosc: LZ4 and LZ4HC (one stream format), zlib. Refused by name: bitshuffle, blosclz, snappy, zstd, and
  blosc format versions other than 1 and 2.
- Pure TypeScript, no WASM, no dependency: the portal's data is LZ4, and an LZ4 block decoder is about 60 lines.
- **Hot path.** The output is preallocated (one chunk-sized buffer for a whole level, §5); no allocation per byte or per
  sequence below 16 literal bytes; matches of 32 bytes or more by `copyWithin` (an overlapping one, offset < length, by
  doubling copies, since `copyWithin` is a memmove); unshuffle of 4-byte types by one aligned 32-bit write per element
  on little-endian machines (×1.3 the byte loop). Measured (`_test/bench-blosc.mjs`, M-series laptop, Node 22): the
  TS_08 256³ `<f4` chunk (23.5 MB, 67 MB decoded) at about 700 MB/s at level 2 and 500 MB/s at level 0; numcodecs' C,
  one thread, about 930 MB/s.

## 4. OME-NGFF

- The first `multiscales` entry; its `datasets` are the levels, finest first. 3 space axes, named `x`, `y`, `z` in any
  order, the last three of the array; axes before them (time, channel) must have one element when read.
- Units: angstrom, nanometer, micrometer, millimeter, picometer, the same on the three axes, to Å. No unit is a warning
  and Å.
- Per level: `scale` (required) and `translation` (optional) per array axis, then the multiscale's own
  `coordinateTransformations` after them: `x = (i·s + t)·S + T`. A transformation by `path` is refused. The level gives
  them in x, y, z order, in Å: voxel `i` sits at `translation + i·scale` (NGFF's voxel centres), which is where Mol\*'s
  grid puts voxel `i` (the model's spacegroup-cell grid, as CCP4's).

## 5. Reading a level

- One typed array of the level's dtype, in the array's C order (x fastest for z, y, x): the same layout as a CCP4 map
  with `MAPC/MAPR/MAPS` = 1, 2, 3, so no transpose.
- Chunks are fetched 4 at a time and decoded one at a time into one chunk-sized buffer, then copied row by row (a whole
  plane at a time when a chunk's rows span the array) into the output. Memory: the output, one decoded chunk, up to 4
  compressed chunks.
- A nonzero fill value fills the output first; missing chunks then need nothing.
- `OmeZarrLevel.bytes` (the voxels) and `chunkBytes` (one decoded chunk) are known before any chunk: the caller's size
  guard (the plugin's, 512 MB by default) counts both and refuses before reading. A coarse level often keeps the fine
  levels' chunk shape: TS_08 level 2 is 24 MB of voxels and a 67 MB chunk. The compressed chunks in flight (up to 4) are
  not counted.
