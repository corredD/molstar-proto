/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createWebGPUContext, requestWebGPUDevice } from '@molstar/graphics/gl/webgpu/context';
import { assignReference, assignSlots, variantCount } from '../lipids/assign.js';
import { createLipidTileAssigner } from '../lipids/assign-kernel.js';
import { icosphere } from '../lipids/remesh.js';

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

describe.skipIf(!webgpu)('lipid tile assignment on the GPU (Dawn)', () => {
  it('equals the TypeScript reference tile for tile: the variant and the affine of each slot', async () => {
    const device = await requestWebGPUDevice('default', gpu);
    if (!device) throw new Error('no WebGPU device');
    const graphics = createWebGPUContext(device, { width: 4, height: 4 });
    try {
      const compute = graphics.compute!;
      const kinds = { edgeTypes: 2, vertexColors: 2, variants: 2, seed: 0xdeadbeef };
      const L = 100;
      const mesh = icosphere(500, L);
      const slots = assignSlots(kinds, mesh.indices);
      const reference = assignReference(kinds, L, mesh.positions, mesh.indices, slots);
      const total = mesh.indices.length / 3;
      // the culler's data (\`CulledData\`: three vec4s an instance's rows), the instances after an offset (another member
      // first) and before another's (a guard)
      const offset = 7;
      const data = compute.createBuffer((total + offset + 1) * 3 * 16);
      const assigner = createLipidTileAssigner(compute, kinds, L, mesh.positions, mesh.indices, slots);
      for (let v = 0; v < variantCount(kinds); ++v) {
        const count = slots.counts[v];
        if (count === 0) continue;
        assigner.writer(v)(compute, { data, instanceBase: offset + slots.starts[v], count, cpuWrites: 0 });
      }
      graphics.flush();
      const check = new Uint32Array(await assigner.check.readAsync(0, total * 4));
      const rows = new Float32Array(await data.readAsync());
      let variantMismatches = 0;
      let maxError = 0;
      for (let s = 0; s < total; ++s) {
        if (check[s] !== slots.variant[slots.order[s]]) variantMismatches += 1;
        for (let r = 0; r < 3; ++r) {
          for (let c = 0; c < 4; ++c) {
            const want = reference[s * 16 + c * 4 + r];
            const a = rows[((offset + s) * 3 + r) * 4 + c];
            maxError = Math.max(maxError, Math.abs(a - want));
          }
        }
      }
      expect(variantMismatches).toBe(0);
      // f32 on the GPU, f64 in the reference, positions of 500 Å
      expect(maxError).toBeLessThan(1e-3);
      // the other members' rows untouched (zero here)
      expect(rows.subarray(0, offset * 12).every((x) => x === 0)).toBe(true);
      expect(rows.subarray((offset + total) * 12).every((x) => x === 0)).toBe(true);
      expect(graphics.takeErrors?.() ?? []).toEqual([]);
      assigner.destroy();
    } finally {
      graphics.destroy();
    }
  });
});
