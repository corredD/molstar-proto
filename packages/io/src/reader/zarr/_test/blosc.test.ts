/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SyncRuntimeContext } from '@molstar/core/task/execution/synchronous';
import { bloscDecode, bloscHeader } from '../blosc.js';
import { lz4DecodeBlock } from '../lz4.js';

const Dir = path.join(import.meta.dirname, 'fixtures', 'blosc');

interface Case {
  name: string;
  kind: 'smooth' | 'random';
  dtype: string;
  n: number;
  flags: number;
}
const Cases: Case[] = JSON.parse(fs.readFileSync(path.join(Dir, 'index.json'), 'utf8'));

/** `values` of make-fixtures.py: integers, exact in every dtype. */
function values(kind: 'smooth' | 'random', n: number) {
  const out = new Array<number>(n);
  let x = 2463534242;
  for (let i = 0; i < n; i++) {
    if (kind === 'smooth') {
      out[i] = ((i >> 4) % 251) + ((i * 7) % 3);
    } else {
      x = (x ^ (x << 13)) >>> 0;
      x = (x ^ (x >>> 17)) >>> 0;
      x = (x ^ (x << 5)) >>> 0;
      out[i] = x & 0xff;
    }
  }
  return out;
}

const Ctors: Record<string, { new (n: number): ArrayLike<number> & { buffer: ArrayBuffer } }> = {
  '<f4': Float32Array,
  '<f8': Float64Array,
  '<i2': Int16Array,
  '<u2': Uint16Array,
  '|u1': Uint8Array,
};

function expected(c: Case) {
  if (c.dtype === 'V32') return Uint8Array.from(values(c.kind, c.n * 32));
  const a = new Ctors[c.dtype](c.n) as unknown as number[];
  const v = values(c.kind, c.n);
  for (let i = 0; i < c.n; i++) a[i] = v[i];
  return new Uint8Array((a as unknown as { buffer: ArrayBuffer }).buffer);
}

function read(name: string) {
  return new Uint8Array(fs.readFileSync(path.join(Dir, `${name}.bin`)));
}

describe('bloscDecode', () => {
  const decoded = Cases.filter((c) => !/bitshuffle|zstd|blosclz/.test(c.name));

  it('covers split and unsplit blocks, leftover blocks, stored streams and memcpyed buffers', () => {
    // the vectors take the paths they are named for (flags as numcodecs wrote them)
    const flags = (name: string) => Cases.find((c) => c.name === name)!.flags;
    expect(flags('lz4-shuffle-f4') & 0x10).toBe(0);
    expect(flags('lz4-tiny-f8') & 0x10).toBe(0x10);
    expect(flags('memcpyed-f4') & 0x2).toBe(0x2);
    expect(flags('zlib-shuffle-f4') >> 5).toBe(3);
    const h = bloscHeader(read('lz4-blocks-f4'));
    expect(h.nbytes % h.blocksize).toBeGreaterThan(0);
    expect(h.nbytes / h.blocksize).toBeGreaterThan(1);
  });

  it.each(decoded.map((c) => [c.name, c]))('decodes %s as numcodecs encoded it', async (_, c) => {
    const want = expected(c);
    const out = new Uint8Array(want.length);
    expect(await bloscDecode(SyncRuntimeContext, read(c.name), out)).toBe(out);
    expect(out).toEqual(want);
  });

  it.each([
    ['bitshuffle-f4', 'bitshuffle is not supported'],
    ['zstd-f4', 'the zstd codec is not supported'],
    ['blosclz-f4', 'the blosclz codec is not supported'],
  ])('refuses %s', async (name, message) => {
    await expect(bloscDecode(SyncRuntimeContext, read(name), new Uint8Array(4000))).rejects.toThrow(message);
  });

  it('refuses an output of another size and a truncated buffer', async () => {
    const src = read('lz4-shuffle-f4');
    await expect(bloscDecode(SyncRuntimeContext, src, new Uint8Array(10))).rejects.toThrow('decodes to 32000 bytes');
    await expect(bloscDecode(SyncRuntimeContext, src.slice(0, 100), new Uint8Array(32000))).rejects.toThrow(
      'the header says',
    );
  });
});

describe('lz4DecodeBlock', () => {
  it('repeats an overlapping match (offset < length), short and long', () => {
    for (const len of [7, 300]) {
      // literal "ab", then a match of offset 2 and length `len` (token 0x2f, extended length bytes)
      const extra = len - 4 - 15;
      const ext = extra < 0 ? [] : [...new Array(Math.floor(extra / 255)).fill(255), extra % 255];
      const token = (2 << 4) | Math.min(len - 4, 15);
      // and a last literal "z"
      const src = Uint8Array.from([token, 97, 98, 2, 0, ...ext, 0x10, 122]);
      const dst = new Uint8Array(2 + len + 1);
      expect(lz4DecodeBlock(src, 0, src.length, dst, 0, dst.length)).toBe(dst.length);
      const want = Array.from({ length: 2 + len }, (_, i) => (i % 2 ? 98 : 97));
      expect(Array.from(dst)).toEqual([...want, 122]);
    }
  });

  it('refuses a match before the start of its output and a block that overruns its output', () => {
    // a match of offset 3 after one literal
    const src = Uint8Array.from([0x10, 97, 3, 0, 0x10, 122]);
    expect(() => lz4DecodeBlock(src, 0, src.length, new Uint8Array(10), 0, 10)).toThrow('match offset out of range');
    const lit = Uint8Array.from([0x50, 1, 2, 3, 4, 5]);
    expect(() => lz4DecodeBlock(lit, 0, lit.length, new Uint8Array(4), 0, 4)).toThrow('literals out of range');
  });
});
