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
import { Frustum3D } from '@molstar/core/math/geometry/primitives/frustum3d';
import { Plane3D } from '@molstar/core/math/geometry/primitives/plane3d';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import {
  cutterCounts,
  cutterRegions,
  cutterTable,
  eachCellHit,
  eachHit,
  emptyCut,
  hitAffine,
  kindCounts,
  triangleCut,
} from '../lipids/cutter.js';
import { createLipidCutter } from '../lipids/cutter-kernel.js';
import { createLipidSelection, unitSlots, WholeTriangle, wholeTriangles } from '../lipids/procedural.js';
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
  it('equals the TypeScript reference unit for unit: the whole triangles’ counts, each hit’s affine, the dead slots', async () => {
    const device = await requestWebGPUDevice('default', gpu);
    if (!device) throw new Error('no WebGPU device');
    const graphics = createWebGPUContext(device, { width: 4, height: 4 });
    try {
      const compute = graphics.compute!;
      const { text, box } = syntheticPatchPdb();
      const table = cutterTable(parsePatchPdb(text, { box }).outer, 2);
      const M = table.members.length;
      // small triangles (cut whole) and large ones (cut by cells: round 5)
      for (const [radius, edge, whole] of [
        [300, 70, true],
        [2500, 1500, false],
      ] as const) {
        const mesh = icosphere(radius, edge);
        const T = mesh.indices.length / 3;
        const regions = cutterRegions(mesh.positions, mesh.indices, 0xdeadbeef);
        const { wholeOf, count: W } = wholeTriangles(mesh.positions, mesh.indices, regions, table.box);
        expect(W).toBe(whole ? T : 0);
        const list = new Uint32Array(W);
        for (let t = 0; t < T; ++t) if (wholeOf[t] >= 0) list[wholeOf[t]] = t;
        const kinds = kindCounts(table, regions.cells);
        const cutter = await createLipidCutter(
          compute,
          () => graphics.flush(),
          table,
          mesh.positions,
          mesh.indices,
          regions,
          list,
          kinds,
        );
        // f32 on the GPU: a head on a triangle's edge may land either side; none in this mesh
        const reference = cutterCounts(table, mesh.positions, mesh.indices, regions);
        for (let m = 0; m < M; ++m) {
          for (let w = 0; w < W; ++w) expect(cutter.counts[m * W + w]).toBe(reference[m * T + list[w]]);
        }
        const input = {
          positions: mesh.positions,
          indices: mesh.indices,
          regions,
          box: table.box,
          members: M,
          kinds,
          wholeOf,
          wholeCounts: cutter.counts,
          side: 1,
        };
        const capacity = Uint32Array.from(unitSlots(input), (n) => n);
        const selection = createLipidSelection(input, capacity);
        // every unit: a view of the whole sphere from afar, at any size (enter 0), both sides
        const eye = Vec3.create(0, 0, radius * 10);
        const projection = Mat4.perspective(Mat4(), -0.5, 0.5, 0.5, -0.5, 1, 1e7);
        const frustum = Frustum3D();
        Frustum3D.fromProjectionMatrix(
          frustum,
          Mat4.mul(Mat4(), projection, Mat4.lookAt(Mat4(), eye, Vec3.zero(), Vec3.create(0, 1, 0))),
        );
        const plane = Plane3D.create(Vec3.create(0, 0, -1), radius * 10);
        selection.select(plane, frustum, 1e-3, 0, { lipidSize: 8, enterPx: 0, keep: 0.8, facing: 0 });
        expect(selection.count).toBeGreaterThan(whole ? T / 2 : 50);
        let all = 0;
        for (let m = 0; m < M; ++m) all += selection.live[m];
        expect(all).toBeGreaterThan(1000);
        const offset = 5;
        const identityBase = all + offset;
        const instanceData = compute.createBuffer((all + offset) * InstanceDataVec4s * 16);
        const transforms = compute.createBuffer((identityBase + all + offset) * 3 * 16);
        let base = offset;
        const bases: number[] = [];
        for (let m = 0; m < M; ++m) {
          bases.push(base);
          const live = cutter.writer(m, selection)(compute, {
            instanceData,
            transforms,
            instanceBase: base,
            identityBase,
            count: selection.live[m],
          });
          expect(live).toBe(selection.live[m]);
          base += selection.live[m];
        }
        graphics.flush();
        const data = new Float32Array(await instanceData.readAsync());
        const rows = new Float32Array(await transforms.readAsync());
        let maxError = 0;
        let dead = 0;
        let edges = 0;
        const want = new Float32Array(16);
        const cut = emptyCut();
        for (let m = 0; m < M; ++m) {
          let s = 0;
          const check = (deadSlot: boolean) => {
            // f32 on the GPU, f64 here: a head on a triangle's edge owned by the other side (one in a million)
            const gpuDead = data[(bases[m] + s) * InstanceDataVec4s * 4 + 3] === Math.fround(1e30);
            if (gpuDead !== deadSlot) {
              edges += 1;
              s += 1;
              return;
            }
            for (let r = 0; r < 3; ++r) {
              for (let c = 0; c < 4; ++c) {
                const w = deadSlot ? (c === 3 ? 1e30 : 0) : want[c * 4 + r];
                const a = data[((bases[m] + s) * InstanceDataVec4s + r) * 4 + c];
                const b = rows[((identityBase + bases[m] + s) * 3 + r) * 4 + c];
                if (deadSlot) maxError = Math.max(maxError, Math.abs(a - w) / (c === 3 ? 1e30 : 1));
                else maxError = Math.max(maxError, Math.abs(a - w), Math.abs(b - w));
              }
            }
            s += 1;
          };
          for (let i = 0; i < selection.count; ++i) {
            const t = selection.units[i * 3];
            expect(selection.bases[m * selection.maxUnits + i]).toBe(s);
            triangleCut(mesh.positions, mesh.indices, t, regions, table.box, cut);
            if (selection.units[i * 3 + 1] === WholeTriangle) {
              eachHit(table, cut, m, (l, x, y) => {
                hitAffine(table, cut, l, x, y, want, 0);
                check(false);
              });
            } else {
              eachCellHit(table, cut, selection.units[i * 3 + 1], selection.units[i * 3 + 2], m, (l, x, y, owned) => {
                if (owned) hitAffine(table, cut, l, x, y, want, 0);
                else dead += 1;
                check(!owned);
              });
            }
          }
          expect(s).toBe(selection.live[m]);
        }
        expect(edges).toBeLessThanOrEqual(2);
        // f32 on the GPU, f64 in the reference, positions of up to 2500 Å
        expect(maxError).toBeLessThan(whole ? 2e-3 : 1e-2);
        if (!whole) expect(dead).toBeGreaterThan(0);
        instanceData.destroy();
        transforms.destroy();
        cutter.destroy();
      }
      expect(graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      graphics.destroy();
    }
  });
});
