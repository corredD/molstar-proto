/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import type { ComputeContext } from '@molstar/graphics/gl/compute';
import { cutterTable } from '../lipids/cutter.js';
import { createLipidCutter } from '../lipids/cutter-kernel.js';
import { parsePatchPdb } from '../lipids/patch.js';
import { icosphere } from '../lipids/remesh.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';

describe('the lipid cutter', () => {
  it('says a mesh is too large for one count pass, not a WebGPU error (review S4)', async () => {
    const { text, box } = syntheticPatchPdb();
    const table = cutterTable(parsePatchPdb(text, { box }).outer, 2);
    const mesh = icosphere(300, 70);
    const buffer = { write() {}, destroy() {}, readAsync: async () => new ArrayBuffer(0) };
    // a device whose storage buffers hold less than a count a member and triangle
    const compute = {
      maxStorageBufferSize: 1024,
      maxWorkgroupsPerDimension: 65535,
      createBuffer: () => buffer,
      createKernel: () => ({ dispatch() {}, destroy() {} }),
      beginComputePass() {},
      endComputePass() {},
    } as unknown as ComputeContext;
    await expect(createLipidCutter(compute, () => {}, table, mesh.positions, mesh.indices, 1)).rejects.toThrow(
      /too many triangles/,
    );
  });
});
