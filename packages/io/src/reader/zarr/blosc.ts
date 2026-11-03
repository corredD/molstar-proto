/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { RuntimeContext } from '@molstar/core/task';
import { adler } from '@molstar/core/util/zip/checksum';
import { inflate } from '@molstar/core/util/zip/zip';
import { IsNativeEndianLittle } from '../../common/binary.js';
import { lz4DecodeBlock } from './lz4.js';

/** The blosc1 header (16 bytes; c-blosc 1.x, what numcodecs writes): zarr.md §3. */
export interface BloscHeader {
  readonly version: number;
  readonly flags: number;
  readonly typesize: number;
  /** Bytes decoded. */
  readonly nbytes: number;
  readonly blocksize: number;
  /** Bytes of the buffer, header included. */
  readonly cbytes: number;
}

const HeaderSize = 16;
const enum Flag {
  Shuffle = 0x1,
  Memcpyed = 0x2,
  BitShuffle = 0x4,
  DontSplit = 0x10,
}
/** The codec of the blocks, flags >> 5. */
const Codecs = ['blosclz', 'lz4', 'snappy', 'zlib', 'zstd'];
const enum Codec {
  Lz4 = 1,
  Zlib = 3,
}

function int32(src: Uint8Array, p: number) {
  return src[p] | (src[p + 1] << 8) | (src[p + 2] << 16) | (src[p + 3] << 24);
}

export function bloscHeader(src: Uint8Array): BloscHeader {
  if (src.length < HeaderSize) throw new Error(`Blosc: ${src.length} bytes, less than a header`);
  const h = {
    version: src[0],
    flags: src[2],
    typesize: src[3],
    nbytes: int32(src, 4),
    blocksize: int32(src, 8),
    cbytes: int32(src, 12),
  };
  if (h.version < 1 || h.version > 2) throw new Error(`Blosc: format version ${h.version} is not supported (1 or 2)`);
  if (h.cbytes !== src.length)
    throw new Error(`Blosc: the header says ${h.cbytes} bytes, the buffer has ${src.length}`);
  // c-blosc never writes a block larger than the data: a larger one would only size an allocation
  if (h.nbytes < 0 || h.typesize < 1 || (h.nbytes > 0 && (h.blocksize < 1 || h.blocksize > h.nbytes))) {
    throw new Error('Blosc: corrupt header');
  }
  return h;
}

/**
 * Decodes a blosc1 buffer into `out` (exactly the decoded size) and returns it. Codecs: LZ4 (and LZ4HC, the same
 * stream) and zlib (core's `inflate`), byte shuffle or none, memcpyed; bitshuffle, blosclz, snappy and zstd throw.
 */
export async function bloscDecode(ctx: RuntimeContext, src: Uint8Array<ArrayBuffer>, out: Uint8Array<ArrayBuffer>) {
  const { flags, typesize, nbytes, blocksize } = bloscHeader(src);
  if (out.length !== nbytes) throw new Error(`Blosc: decodes to ${nbytes} bytes, ${out.length} expected`);
  if (flags & Flag.Memcpyed) {
    if (src.length !== HeaderSize + nbytes) throw new Error('Blosc: corrupt memcpyed buffer');
    out.set(src.subarray(HeaderSize));
    return out;
  }
  if (flags & Flag.BitShuffle) throw new Error('Blosc: bitshuffle is not supported');
  const codec = flags >>> 5;
  if (codec !== Codec.Lz4 && codec !== Codec.Zlib) {
    throw new Error(`Blosc: the ${Codecs[codec] ?? `#${codec}`} codec is not supported (lz4, zlib)`);
  }

  const shuffle = (flags & Flag.Shuffle) !== 0 && typesize > 1;
  const split = (flags & Flag.DontSplit) === 0;
  // a shuffled block decodes into `tmp`, then unshuffles into `out`
  const tmp = shuffle ? new Uint8Array(blocksize) : undefined;
  const nblocks = Math.ceil(nbytes / blocksize);
  if (HeaderSize + 4 * nblocks > src.length) throw new Error('Blosc: corrupt block starts');

  for (let b = 0; b < nblocks; b++) {
    const outStart = b * blocksize;
    const bsize = Math.min(blocksize, nbytes - outStart);
    // the last, leftover block is never split; the others in `typesize` streams unless the flag says not
    const nstreams = split && bsize === blocksize ? typesize : 1;
    const neblock = bsize / nstreams;
    if (!Number.isInteger(neblock)) throw new Error('Blosc: a block does not split into its streams');

    const dst = tmp ?? out;
    let dp = tmp ? 0 : outStart;
    let sp = int32(src, HeaderSize + 4 * b);
    for (let s = 0; s < nstreams; s++) {
      if (sp < 0 || sp + 4 > src.length) throw new Error('Blosc: corrupt block start');
      const cbytes = int32(src, sp);
      sp += 4;
      const end = sp + cbytes;
      if (cbytes < 0 || end > src.length) throw new Error('Blosc: corrupt stream size');
      if (cbytes === neblock) {
        // stored as it is: compressing did not shrink it
        dst.set(src.subarray(sp, end), dp);
      } else if (codec === Codec.Lz4) {
        if (lz4DecodeBlock(src, sp, end, dst, dp, dp + neblock) !== neblock) throw new Error('Blosc: short LZ4 stream');
      } else {
        await zlibDecode(ctx, src.subarray(sp, end), dst.subarray(dp, dp + neblock));
      }
      sp = end;
      dp += neblock;
    }
    if (tmp) unshuffle(typesize, bsize, tmp, out, outStart);
  }
  return out;
}

/**
 * Inflates the zlib (RFC 1950) stream `src` into exactly `into`, as zlib's `uncompress` (what c-blosc calls) would:
 * the header, the length and the Adler-32 are checked, which core's `inflate` leaves to its caller (zarr.md §3).
 */
export async function zlibDecode(ctx: RuntimeContext, src: Uint8Array<ArrayBuffer>, into: Uint8Array<ArrayBuffer>) {
  const n = src.length;
  if (n < 6 || (src[0] & 0x0f) !== 8 || ((src[0] << 8) | src[1]) % 31 !== 0) throw new Error('zlib: not a zlib stream');
  let got: Uint8Array;
  if (src[2] === 3 && src[3] === 0) {
    // an empty final block: core's `inflate` returns the whole buffer given for it, whatever it holds
    got = into.subarray(0, 0);
  } else {
    try {
      got = await inflate(ctx, src, into);
    } catch (e) {
      // the platform's decoder fails with an empty message
      throw new Error(`zlib: corrupt stream${e instanceof Error && e.message ? ` (${e.message})` : ''}`);
    }
  }
  if (got.length !== into.length || got.buffer !== into.buffer || got.byteOffset !== into.byteOffset) {
    throw new Error(`zlib: decodes to ${got.length} bytes, not ${into.length}`);
  }
  const sum = ((src[n - 4] << 24) | (src[n - 3] << 16) | (src[n - 2] << 8) | src[n - 1]) >>> 0;
  if (adler(into, 0, into.length) >>> 0 !== sum) throw new Error('zlib: Adler-32 mismatch');
}

/**
 * Byte unshuffle (blosc's `unshuffle`): `src` holds byte 0 of every element, then byte 1, …; `dst` the elements.
 * Bytes past the last whole element are copied as they are. Hot: one loop per common size, writes in order.
 */
function unshuffle(typesize: number, size: number, src: Uint8Array, dst: Uint8Array, dstStart: number) {
  const n = Math.floor(size / typesize);
  let o = dstStart;
  if (typesize === 4 && IsNativeEndianLittle && ((dst.byteOffset + dstStart) & 3) === 0) {
    // one aligned 32-bit write per element: about 1.3x the byte loop on a 256³ float chunk (zarr.md §3)
    const d32 = new Uint32Array(dst.buffer, dst.byteOffset + dstStart, n);
    for (let i = 0, b = n, c = 2 * n, d = 3 * n; i < n; i++) {
      d32[i] = src[i] | (src[b + i] << 8) | (src[c + i] << 16) | (src[d + i] << 24);
    }
    o += 4 * n;
  } else if (typesize === 4) {
    for (let i = 0, b = n, c = 2 * n, d = 3 * n; i < n; i++) {
      dst[o] = src[i];
      dst[o + 1] = src[b + i];
      dst[o + 2] = src[c + i];
      dst[o + 3] = src[d + i];
      o += 4;
    }
  } else if (typesize === 2) {
    for (let i = 0; i < n; i++) {
      dst[o] = src[i];
      dst[o + 1] = src[n + i];
      o += 2;
    }
  } else {
    for (let i = 0; i < n; i++) {
      for (let j = 0, k = i; j < typesize; j++, k += n) dst[o + j] = src[k];
      o += typesize;
    }
  }
  for (let k = n * typesize; k < size; k++) dst[o++] = src[k];
}
