/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createMVSBuilder } from '@molstar/mvs-builder/tree/mvs/mvs-builder';
import type { MVSData } from '@molstar/mvs-builder';
import { type IR, placementSets } from '@molstar/meso-spec/ir/ir';

// Compiling the IR to MolViewSpec (design.md §6.6), to measure that path: per placement type, one `primitives` group
// with one ellipsoid at the origin and the copies as its `instances` (4×4 matrices). MVS has no particle or placement
// node, so a copy costs 16 numbers of JSON, and a change to any copy rewrites its group (its instance list is one param).

export function irToMolViewSpec(
  ir: IR,
  options: { readonly maxCopies?: number } = {},
): { data: MVSData; copies: number; truncated: boolean } {
  const builder = createMVSBuilder();
  const looks = new Map(ir.view.looks.map((l) => [`${l.set}:${l.types[0]}`, l]));
  let copies = 0;
  let truncated = false;
  const max = options.maxCopies ?? Infinity;
  for (const set of placementSets(ir)) {
    const byType = new Map<number, number[][]>();
    for (let i = 0; i < set.count; i++) {
      if (copies >= max) {
        truncated = true;
        break;
      }
      const t = set.types[i];
      const look = looks.get(`${set.key}:${t}`);
      if (look?.visible === false) continue;
      const [x, y, z, w] = set.rotations.subarray(4 * i, 4 * i + 4);
      const p = set.positions.subarray(3 * i, 3 * i + 3);
      // column-major rotation and translation
      const m = [
        1 - 2 * (y * y + z * z),
        2 * (x * y + z * w),
        2 * (x * z - y * w),
        0,
        2 * (x * y - z * w),
        1 - 2 * (x * x + z * z),
        2 * (y * z + x * w),
        0,
        2 * (x * z + y * w),
        2 * (y * z - x * w),
        1 - 2 * (x * x + y * y),
        0,
        p[0],
        p[1],
        p[2],
        1,
      ].map((v) => Math.round(v * 1000) / 1000);
      let list = byType.get(t);
      if (!list) byType.set(t, (list = []));
      list.push(m);
      copies++;
    }
    for (const [t, instances] of byType) {
      const type = set.typeTable[t];
      const look = looks.get(`${set.key}:${t}`);
      const color = `#${(look?.color ?? 0xcccccc).toString(16).padStart(6, '0')}`;
      builder
        .primitives({
          color: color as `#${string}`,
          opacity: 1 - (look?.transparency ?? 0),
          tooltip: type.label,
          instances,
        })
        .ellipsoid({ center: [0, 0, 0], radius: type.radius });
    }
  }
  const cam = ir.view.camera;
  if (cam)
    builder.camera({
      position: cam.position as [number, number, number],
      target: cam.target as [number, number, number],
      up: cam.up as [number, number, number],
    });
  return { data: builder.getState() as MVSData, copies, truncated };
}
