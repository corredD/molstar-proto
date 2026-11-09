/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Frustum3D } from '@molstar/core/math/geometry/primitives/frustum3d';
import { Plane3D } from '@molstar/core/math/geometry/primitives/plane3d';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { createLipidSelection, enterPx, poolCapacities } from '../lipids/procedural.js';

// The pool and the selection of a membrane made per view (lipid-procedural): a flat sheet of triangles in z = 0 in
// memory, two members, seen from above. What a view takes: the triangles in view whose lipids are large enough on
// screen, nearest first within each member's capacity; the slots' accounting exact.

/** an n × n grid of quads (two triangles each) of side `edge` Å in z = 0, its regions 4 × 4 quads */
function sheet(n: number, edge: number) {
  const positions: number[] = [];
  for (let j = 0; j <= n; ++j) for (let i = 0; i <= n; ++i) positions.push(i * edge, j * edge, 0);
  const indices: number[] = [];
  const regionOf: number[] = [];
  const regionsAcross = Math.ceil(n / 4);
  for (let j = 0; j < n; ++j) {
    for (let i = 0; i < n; ++i) {
      const a = j * (n + 1) + i;
      indices.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
      const g = Math.floor(j / 4) * regionsAcross + Math.floor(i / 4);
      regionOf.push(g, g);
    }
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    regionOf: new Uint32Array(regionOf),
    regions: regionsAcross * regionsAcross,
  };
}

/** a camera at `eye` looking at `at` (down -z by default; fov 60°, square): its plane, frustum, depth scale */
function view(eye: Vec3, at = Vec3.create(eye[0], eye[1], 0), height = 1000) {
  const fov = Math.PI / 3;
  const h = Math.tan(fov / 2);
  const projection = Mat4.perspective(Mat4(), -h, h, h, -h, 1, 1e6);
  const lookAt = Mat4.lookAt(Mat4(), eye, at, Vec3.create(0, 0, 1));
  if (at[0] === eye[0] && at[1] === eye[1]) Mat4.lookAt(lookAt, eye, at, Vec3.create(0, 1, 0));
  const frustum = Frustum3D();
  Frustum3D.fromProjectionMatrix(frustum, Mat4.mul(Mat4(), projection, lookAt));
  const dir = Vec3.normalize(Vec3(), Vec3.sub(Vec3(), at, eye));
  const plane = Plane3D.create(dir, -Vec3.dot(dir, eye));
  // `LodView.set`: Å per pixel per Å of depth
  const depthScale = (2 * Math.tan(fov / 2)) / height;
  return { plane, frustum, depthScale };
}

const Params = { lipidSize: 8, enterPx: 2, keep: 0.8 };

function setup(n = 16, edge = 100, capacity?: number[]) {
  const s = sheet(n, edge);
  const T = s.indices.length / 3;
  // member 0: 2 lipids a triangle, member 1: 3
  const counts = new Uint32Array(2 * T);
  counts.fill(2, 0, T);
  counts.fill(3, T, 2 * T);
  const cap = Uint32Array.from(capacity ?? [2 * T, 3 * T]);
  const selection = createLipidSelection(s.positions, s.indices, s.regionOf, s.regions, counts, cap);
  return { s, T, counts, selection };
}

describe('a membrane made per view: the pool and the selection', () => {
  it('sizes each member from the budget: whole where it fits, a share past it', () => {
    const totals = [Uint32Array.of(100, 300), Uint32Array.of(600)];
    expect(poolCapacities(totals, 2000).map((t) => Array.from(t))).toEqual([[100, 300], [600]]);
    // 1000 lipids, a budget of 500: half each (+10 %)
    expect(poolCapacities(totals, 500).map((t) => Array.from(t))).toEqual([[55, 165], [330]]);
    expect(enterPx('texture', 2, 0.5)).toBe(2);
    expect(enterPx('both', 2, 0.5)).toBe(0.5);
  });

  it('takes the triangles in view only, and its lipids and slots are their counts', () => {
    const { T, selection } = setup();
    // above one corner of the 1600 Å sheet, close: a part of it in view
    const v = view(Vec3.create(200, 200, 300));
    expect(selection.select(v.plane, v.frustum, v.depthScale, 0, Params)).toBe(true);
    const n = selection.count;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(T);
    expect(selection.live[0]).toBe(2 * n);
    expect(selection.live[1]).toBe(3 * n);
    // in triangle order, member 1's slots by threes; a slot mapped back to its triangle and hit
    for (let i = 1; i < n; ++i) expect(selection.selected[i]).toBeGreaterThan(selection.selected[i - 1]);
    const at = { triangle: -1, index: -1 };
    expect(selection.lipidAt(1, 7, at)).toBe(true);
    expect(at).toEqual({ triangle: selection.selected[2], index: 1 });
    expect(selection.lipidAt(1, 3 * n, at)).toBe(false);
  });

  it('takes nothing again for the same view, and the same view gives the same triangles from the same start', () => {
    const a = setup().selection;
    const b = setup().selection;
    const v = view(Vec3.create(500, 700, 900));
    expect(a.select(v.plane, v.frustum, v.depthScale, 0, Params)).toBe(true);
    expect(a.select(v.plane, v.frustum, v.depthScale, 0, Params)).toBe(false);
    b.select(v.plane, v.frustum, v.depthScale, 0, Params);
    expect(Array.from(b.selected.subarray(0, b.count))).toEqual(Array.from(a.selected.subarray(0, a.count)));
  });

  it('takes lipids at their size on screen, and keeps them down to the hysteresis', () => {
    const { T, selection } = setup();
    // the whole sheet in view; a lipid 8 Å at 2 px for 1000 px and 60°: at depth 8 / (2 × depthScale) ≈ 3464 Å
    const far = view(Vec3.create(800, 800, 6000));
    selection.select(far.plane, far.frustum, far.depthScale, 0, Params);
    expect(selection.count).toBe(0);
    const near = view(Vec3.create(800, 800, 3000));
    selection.select(near.plane, near.frustum, near.depthScale, 0, Params);
    expect(selection.count).toBe(T);
    // past the switch but within the hysteresis (3464 / 0.8 ≈ 4330 Å): kept; a fresh selection takes none
    const between = view(Vec3.create(800, 800, 3900));
    selection.select(between.plane, between.frustum, between.depthScale, 0, Params);
    expect(selection.count).toBe(T);
    const fresh = setup().selection;
    fresh.select(between.plane, between.frustum, between.depthScale, 0, Params);
    expect(fresh.count).toBe(0);
  });

  it('takes the nearest first within each capacity', () => {
    // capacity for 20 triangles of member 1 (3 each)
    const { s, T, selection } = setup(16, 100, [1000, 60]);
    // from the side, beyond x = 0, looking along +x and down: depth grows with x
    const v = view(Vec3.create(-600, 800, 600), Vec3.create(800, 800, 0));
    selection.select(v.plane, v.frustum, v.depthScale, 0, Params);
    expect(selection.count).toBe(20);
    expect(selection.live[1]).toBe(60);
    // the taken ones nearer than any left out that the view would take (a quad, 100 Å, the buckets' slack)
    const x = (t: number) => {
      let sum = 0;
      for (let k = 0; k < 3; ++k) sum += s.positions[s.indices[t * 3 + k] * 3] / 3;
      return sum;
    };
    const taken = new Set(selection.selected.subarray(0, selection.count));
    let farthestTaken = -Infinity;
    for (const t of taken) farthestTaken = Math.max(farthestTaken, x(t));
    const all = setup(16, 100).selection;
    all.select(v.plane, v.frustum, v.depthScale, 0, Params);
    expect(all.count).toBeGreaterThan(20);
    for (let i = 0; i < all.count; ++i) {
      const t = all.selected[i];
      if (!taken.has(t)) expect(x(t)).toBeGreaterThanOrEqual(farthestTaken - 100);
    }
    expect(T).toBe(512);
  });

  it('generates nothing of a hidden member', () => {
    const { selection } = setup();
    selection.shown[0] = 0;
    selection.reset();
    const v = view(Vec3.create(200, 200, 300));
    selection.select(v.plane, v.frustum, v.depthScale, 0, Params);
    expect(selection.live[0]).toBe(0);
    expect(selection.live[1]).toBe(3 * selection.count);
  });
});
