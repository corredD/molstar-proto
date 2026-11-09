/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createWebGPUContext, requestWebGPUDevice } from '@molstar/graphics/gl/webgpu/context';
import { InstanceDataVec4s } from '@molstar/graphics/gl/renderable/merged';
import { cutterBases, cutterCounts, cutterReference, cutterRegions, cutterTable } from '../lipids/cutter.js';
import { createLipidCutter } from '../lipids/cutter-kernel.js';
import { createLipidSelection } from '../lipids/procedural.js';
import { parsePatchPdb } from '../lipids/patch.js';
import { icosphere } from '../lipids/remesh.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';

/** Dawn's Node bindings (`pnpm native:install -- --webgpu`, run through `pnpm native:run`), else the test skips */
const webgpu = await (async () => {
  try {
    const path = createRequire(import.meta.url).resolve('webgpu');
    const module = await import(pathToFileURL(path).href);
    return (await module.create([]).requestAdapter()) ? module : undefined;
  } catch {
    return undefined;
  }
})();

/** the instance held by the module: collected while work is in flight, Dawn's Node bindings crash (SIGSEGV) */
const gpu = webgpu?.create([]);

describe.skipIf(!webgpu)('the lipid cutter on the GPU (Dawn)', () => {
  it('equals the TypeScript reference triangle for triangle: the counts and each hit’s affine', async () => {
    const device = await requestWebGPUDevice('default', gpu);
    if (!device) throw new Error('no WebGPU device');
    const graphics = createWebGPUContext(device, { width: 4, height: 4 });
    try {
      const compute = graphics.compute!;
      const { text, box } = syntheticPatchPdb();
      const table = cutterTable(parsePatchPdb(text, { box }).outer, 2);
      // triangles larger than the patch (images) and smaller
      const mesh = icosphere(300, 70);
      const regions = cutterRegions(mesh.positions, mesh.indices, 0xdeadbeef);
      // several regions (seams between them), several triangles a region (shared edges inside)
      expect(regions.count).toBeGreaterThan(10);
      expect(regions.count).toBeLessThan(mesh.indices.length / 3 / 2);
      const reference = cutterBases(cutterCounts(table, mesh.positions, mesh.indices, regions), table.members.length);
      const cutter = await createLipidCutter(
        compute,
        () => graphics.flush(),
        table,
        mesh.positions,
        mesh.indices,
        regions,
      );
      // f32 on the GPU: a head on a triangle's edge may land either side; none in this mesh
      expect(Array.from(cutter.totals)).toEqual(Array.from(reference.totals));
      const all = reference.totals.reduce((a, b) => a + b, 0);
      expect(all).toBeGreaterThan(1000);
      const offset = 5;
      const identityBase = all + offset;
      const instanceData = compute.createBuffer((all + offset) * InstanceDataVec4s * 16);
      const transforms = compute.createBuffer((identityBase + all + offset) * 3 * 16);
      let base = offset;
      const bases: number[] = [];
      for (let m = 0; m < table.members.length; ++m) {
        bases.push(base);
        cutter.writer(m)(compute, {
          instanceData,
          transforms,
          instanceBase: base,
          identityBase,
          count: cutter.totals[m],
        });
        base += cutter.totals[m];
      }
      graphics.flush();
      const data = new Float32Array(await instanceData.readAsync());
      const rows = new Float32Array(await transforms.readAsync());
      let maxError = 0;
      for (let m = 0; m < table.members.length; ++m) {
        const want = cutterReference(table, mesh.positions, mesh.indices, regions, m, reference.totals[m]);
        for (let s = 0; s < reference.totals[m]; ++s) {
          for (let r = 0; r < 3; ++r) {
            for (let c = 0; c < 4; ++c) {
              const w = want[s * 16 + c * 4 + r];
              const a = data[((bases[m] + s) * InstanceDataVec4s + r) * 4 + c];
              const b = rows[((identityBase + bases[m] + s) * 3 + r) * 4 + c];
              maxError = Math.max(maxError, Math.abs(a - w), Math.abs(b - w));
            }
          }
        }
      }
      // f32 on the GPU, f64 in the reference, positions of 300 Å
      expect(maxError).toBeLessThan(2e-3);
      // a view with none of member 0 (a pool): its slots dead, past any far plane, not zero rows (review M1)
      const none = createLipidSelection(
        mesh.positions,
        mesh.indices,
        regions.regionOf,
        regions.count,
        cutter.counts,
        cutter.totals,
      );
      const live = cutter.writer(0, none)(compute, {
        instanceData,
        transforms,
        instanceBase: bases[0],
        identityBase,
        count: cutter.totals[0],
      });
      expect(live).toBe(0);
      graphics.flush();
      const dead = new Float32Array(await transforms.readAsync());
      for (const s of [0, cutter.totals[0] - 1]) {
        const o = (identityBase + bases[0] + s) * 12;
        expect(Array.from(dead.subarray(o, o + 12))).toEqual(
          [0, 0, 0, 1e30, 0, 0, 0, 1e30, 0, 0, 0, 1e30].map(Math.fround),
        );
      }
      expect(graphics.takeErrors?.() ?? []).toEqual([]);
      cutter.destroy();
    } finally {
      graphics.destroy();
    }
  });
});
