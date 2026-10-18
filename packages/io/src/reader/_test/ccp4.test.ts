/**
 * Copyright (c) 2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { describe, expect, it } from 'vitest';
import * as CCP4 from '../ccp4/parser.js';

function createCcp4Data() {
  const data = new Uint8Array(4 * 256 + 6);

  const dv = new DataView(data.buffer);

  dv.setInt8(52 * 4, 'M'.charCodeAt(0));
  dv.setInt8(52 * 4 + 1, 'A'.charCodeAt(0));
  dv.setInt8(52 * 4 + 2, 'P'.charCodeAt(0));
  dv.setInt8(52 * 4 + 3, ' '.charCodeAt(0));

  dv.setUint8(53 * 4, 17);
  dv.setUint8(53 * 4 + 1, 17);

  dv.setInt32(0 * 4, 1); // NC
  dv.setInt32(1 * 4, 2); // NR
  dv.setInt32(2 * 4, 3); // NS

  dv.setInt32(3 * 4, 0); // MODE

  return data;
}

describe('ccp4 reader', () => {
  it('basic', async () => {
    const data = createCcp4Data();
    const parsed = await CCP4.parse(data, 'test.ccp4').run();

    if (parsed.isError) {
      throw new Error(parsed.message);
    }

    const ccp4File = parsed.result;
    const { header } = ccp4File;

    expect(header.NC).toBe(1);
    expect(header.NR).toBe(2);
    expect(header.NS).toBe(3);
  });

  /** A 1×2×3 little-endian map of `mode` whose values are written by `write(view, offset, index)` */
  function createModeData(mode: number, byteSize: number, write: (dv: DataView, offset: number, i: number) => void) {
    const out = new Uint8Array(4 * 256 + 6 * byteSize);
    out.set(createCcp4Data().subarray(0, 4 * 256));
    const dv = new DataView(out.buffer);
    dv.setInt32(0 * 4, 1, true);
    dv.setInt32(1 * 4, 2, true);
    dv.setInt32(2 * 4, 3, true);
    dv.setInt32(3 * 4, mode, true);
    // MACHST: little-endian
    dv.setUint8(53 * 4, 0x44);
    dv.setUint8(53 * 4 + 1, 0x41);
    for (let i = 0; i < 6; ++i) write(dv, 4 * 256 + i * byteSize, i);
    return out;
  }

  it('reads mode 6 (unsigned 16-bit integers)', async () => {
    const data = createModeData(6, 2, (dv, o, i) => dv.setUint16(o, 40000 + i, true));
    const parsed = await CCP4.parse(data, 'test.mrc').run();
    if (parsed.isError) throw new Error(parsed.message);
    expect(Array.from(parsed.result.values)).toEqual([40000, 40001, 40002, 40003, 40004, 40005]);
  });

  it('reads mode 12 (16-bit floats) as 32-bit floats', async () => {
    // half floats: 1, -2, 0.5, 65504 (the largest), 2^-24 (the smallest subnormal), 0
    const halfs = [0x3c00, 0xc000, 0x3800, 0x7bff, 0x0001, 0x0000];
    const data = createModeData(12, 2, (dv, o, i) => dv.setUint16(o, halfs[i], true));
    const parsed = await CCP4.parse(data, 'test.mrc').run();
    if (parsed.isError) throw new Error(parsed.message);
    expect(parsed.result.values).toBeInstanceOf(Float32Array);
    expect(Array.from(parsed.result.values)).toEqual([1, -2, 0.5, 65504, 2 ** -24, 0]);
  });
});
