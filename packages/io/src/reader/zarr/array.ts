/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { RuntimeContext } from '@molstar/core/task';
import { inflate, ungzip } from '@molstar/core/util/zip/zip';
import { flipByteOrder, IsNativeEndianLittle } from '../../common/binary.js';
import { bloscDecode } from './blosc.js';
import type { ZarrArrayMeta, ZarrTypedArray } from './metadata.js';
import type { ZarrStore } from './store.js';

/** Chunks downloaded at once; they decode one at a time into one buffer (zarr.md §5). */
const Concurrency = 4;

/** The decoded bytes of a chunk: `scratch`, or the chunk itself when it is not compressed. */
async function decodeChunk(
  ctx: RuntimeContext,
  meta: ZarrArrayMeta,
  bytes: Uint8Array<ArrayBuffer>,
  scratch: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const c = meta.compressor;
  let out: Uint8Array<ArrayBuffer>;
  if (c === null) out = bytes;
  else if (c.id === 'blosc') out = await bloscDecode(ctx, bytes, scratch);
  else if (c.id === 'zlib') out = await inflate(ctx, bytes, scratch);
  else out = await ungzip(ctx, bytes, scratch);
  if (out.length !== scratch.length)
    throw new Error(`Zarr: a chunk decodes to ${out.length} bytes, not ${scratch.length}`);
  return out;
}

/**
 * Reads a whole array whose last three axes are its volume and whose other axes have one element (zarr.md §5): one
 * typed array of those three in the array's C order. Missing chunks are the fill value.
 */
export async function readZarrArray(
  ctx: RuntimeContext,
  store: ZarrStore,
  path: string,
  meta: ZarrArrayMeta,
): Promise<ZarrTypedArray> {
  const { shape, chunks, dtype, separator } = meta;
  const rank = shape.length;
  if (rank < 3 || shape.slice(0, rank - 3).some((n) => n !== 1)) {
    throw new Error(`Zarr: shape ${shape.join('x')} is not a volume (axes before the last three must be 1)`);
  }
  const [Z, Y, X] = shape.slice(rank - 3);
  const [Cz, Cy, Cx] = chunks.slice(rank - 3);
  const out = new dtype.ctor(Z * Y * X);
  if (out.length === 0) return out;
  if (meta.fillValue !== 0) out.fill(meta.fillValue);

  const nx = Math.ceil(X / Cx);
  const ny = Math.ceil(Y / Cy);
  const count = Math.ceil(Z / Cz) * ny * nx;
  const prefix = `${path ? `${path}/` : ''}${'0'.concat(separator).repeat(rank - 3)}`;
  // a chunk is stored whole (edge chunks padded), leading axes included
  const scratch = new Uint8Array(chunks.reduce((a, b) => a * b, 1) * dtype.size);
  const flip = dtype.size > 1 && dtype.littleEndian !== IsNativeEndianLittle;

  const copy = (raw: Uint8Array<ArrayBuffer>, c: number) => {
    let buffer: ArrayBufferLike = raw.buffer;
    let offset = raw.byteOffset;
    if (flip) {
      buffer = flipByteOrder(raw, dtype.size);
      offset = 0;
    } else if (offset % dtype.size !== 0) {
      scratch.set(raw);
      buffer = scratch.buffer;
      offset = 0;
    }
    const src = new dtype.ctor(buffer, offset, raw.length / dtype.size);
    const cx = c % nx;
    const cy = Math.floor(c / nx) % ny;
    const cz = Math.floor(c / (nx * ny));
    const x0 = cx * Cx;
    const y0 = cy * Cy;
    const z0 = cz * Cz;
    const w = Math.min(Cx, X - x0);
    const h = Math.min(Cy, Y - y0);
    const d = Math.min(Cz, Z - z0);
    for (let z = 0; z < d; z++) {
      if (Cx === X) {
        // whole rows: the chunk's rows of this plane are contiguous in the array too
        const s = z * Cy * Cx;
        out.set(src.subarray(s, s + h * X), ((z0 + z) * Y + y0) * X);
        continue;
      }
      for (let y = 0; y < h; y++) {
        const s = (z * Cy + y) * Cx;
        out.set(src.subarray(s, s + w), ((z0 + z) * Y + y0 + y) * X + x0);
      }
    }
  };

  let next = 0;
  let done = 0;
  let failed = false;
  // the decode of one chunk at a time into `scratch`: a chain each fetched chunk waits its turn on
  let decoding = Promise.resolve();
  const worker = async () => {
    while (!failed && next < count) {
      const c = next++;
      const cx = c % nx;
      const cy = Math.floor(c / nx) % ny;
      const cz = Math.floor(c / (nx * ny));
      const bytes = await store.get(`${prefix}${cz}${separator}${cy}${separator}${cx}`, ctx);
      if (bytes) {
        const turn = decoding.then(async () => {
          if (!failed) copy(await decodeChunk(ctx, meta, bytes, scratch), c);
        });
        decoding = turn.catch(() => {});
        await turn;
      }
      done++;
      if (ctx.shouldUpdate) await ctx.update({ message: 'Reading Zarr chunks...', current: done, max: count });
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(Concurrency, count) }, worker));
  } catch (e) {
    failed = true;
    throw e;
  }
  return out;
}
