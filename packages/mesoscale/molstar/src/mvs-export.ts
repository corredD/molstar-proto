/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createMVSBuilder } from '@molstar/mvs-builder/tree/mvs/mvs-builder';
import type { MVSData } from '@molstar/mvs-builder';
import { type IR, type IRLook, placementSets } from '@molstar/meso-spec/ir/ir';
import { flattenInstances } from '@molstar/meso-spec/runtime/instancing';

// Compiling the IR to MolViewSpec (design.md §6.6), to measure that path: per placement type, one `primitives` group
// with one ellipsoid at the origin and the copies as its `instances` (4×4 matrices). MVS has no particle or placement
// node, so a copy costs 16 numbers of JSON, and a change to any copy rewrites its group (its instance list is one param).
// Superstructure instances are expanded first (`flattenInstances`, as the Prism adapter does): the copies exported are
// the copies drawn, in the world frame. Looks: the whole-type look of each copy's type, then the partial looks (copy
// runs) over their copies, in order; a group is one type in one color and transparency.

type Look = Pick<IRLook, 'color' | 'visible' | 'transparency'>;
const over = (a: Look, b: Look): Look => ({
  color: b.color ?? a.color,
  visible: b.visible ?? a.visible,
  transparency: b.transparency ?? a.transparency,
});

export function irToMolViewSpec(
  source: IR,
  options: { readonly maxCopies?: number } = {},
): { data: MVSData; copies: number; truncated: boolean } {
  const ir = flattenInstances(source).ir;
  const builder = createMVSBuilder();
  const whole = new Map<string, Look>();
  for (const l of ir.view.looks) if (!l.runs) for (const t of l.types) whole.set(`${l.set}:${t}`, l);
  let copies = 0;
  let truncated = false;
  const max = options.maxCopies ?? Infinity;
  for (const set of placementSets(ir)) {
    const wholeOf = (t: number): Look => whole.get(`${set.key}:${t}`) ?? {};
    // the copies a partial look covers, with their look composed
    const partial = new Map<number, Look>();
    for (const l of ir.view.looks) {
      if (l.set !== set.key || !l.runs) continue;
      for (let k = 0; k < l.runs.length; k += 2)
        for (let i = l.runs[k]; i < l.runs[k + 1] && i < set.count; i++)
          if (l.types.includes(set.types[i])) partial.set(i, over(partial.get(i) ?? wholeOf(set.types[i]), l));
    }
    const groups = new Map<string, { type: number; look: Look; instances: number[][] }>();
    for (let i = 0; i < set.count; i++) {
      if (copies >= max) {
        truncated = true;
        break;
      }
      const t = set.types[i];
      const look = partial.get(i) ?? wholeOf(t);
      if (look.visible === false) continue;
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
      const key = `${t}|${look.color ?? ''}|${look.transparency ?? 0}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { type: t, look, instances: [] }));
      g.instances.push(m);
      copies++;
    }
    for (const { type: t, look, instances } of groups.values()) {
      const type = set.typeTable[t];
      const color = `#${(look.color ?? 0xcccccc).toString(16).padStart(6, '0')}`;
      builder
        .primitives({
          color: color as `#${string}`,
          opacity: 1 - (look.transparency ?? 0),
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
