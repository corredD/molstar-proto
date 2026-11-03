/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

/** Literal runs shorter than this are copied by a loop: a `subarray` view costs more than the bytes (zarr.md §3). */
const MinSetLiteral = 16;
/** Matches shorter than this are copied by a loop, longer ones by `copyWithin` (zarr.md §3). */
const MinCopyWithinMatch = 32;

function corrupt(what: string): never {
  throw new Error(`LZ4: corrupt block (${what})`);
}

/**
 * Decodes one raw LZ4 block (the block format, no frame) `src[srcStart, srcEnd)` into `dst[dstStart, dstEnd)` and
 * returns the bytes written. A match reaches back only into this block's own output (from `dstStart`); a block that
 * reads or writes out of its ranges throws.
 */
export function lz4DecodeBlock(
  src: Uint8Array,
  srcStart: number,
  srcEnd: number,
  dst: Uint8Array,
  dstStart: number,
  dstEnd: number,
): number {
  let ip = srcStart;
  let op = dstStart;
  while (ip < srcEnd) {
    const token = src[ip++];

    let len = token >>> 4;
    if (len === 15) {
      let b = 255;
      while (b === 255) {
        if (ip >= srcEnd) corrupt('literal length');
        b = src[ip++];
        len += b;
      }
    }
    if (len > 0) {
      if (ip + len > srcEnd || op + len > dstEnd) corrupt('literals out of range');
      if (len < MinSetLiteral) {
        for (let k = 0; k < len; k++) dst[op + k] = src[ip + k];
      } else {
        dst.set(src.subarray(ip, ip + len), op);
      }
      ip += len;
      op += len;
    }
    // the last sequence is literals only
    if (ip >= srcEnd) break;

    if (ip + 2 > srcEnd) corrupt('match offset');
    const offset = src[ip] | (src[ip + 1] << 8);
    ip += 2;
    if (offset === 0 || offset > op - dstStart) corrupt('match offset out of range');

    len = token & 15;
    if (len === 15) {
      let b = 255;
      while (b === 255) {
        if (ip >= srcEnd) corrupt('match length');
        b = src[ip++];
        len += b;
      }
    }
    len += 4;
    const end = op + len;
    if (end > dstEnd) corrupt('match out of range');

    const m = op - offset;
    if (len < MinCopyWithinMatch) {
      // forward, byte by byte: an overlapping match (offset < len) repeats its last `offset` bytes
      for (let k = m; op < end; ) dst[op++] = dst[k++];
    } else if (offset >= len) {
      dst.copyWithin(op, m, m + len);
      op = end;
    } else {
      // overlapping: `copyWithin` is a memmove, so copy the period from `m`, doubling it, until the match is full
      while (op < end) {
        const n = Math.min(op - m, end - op);
        dst.copyWithin(op, m, m + n);
        op += n;
      }
    }
  }
  return op - dstStart;
}
