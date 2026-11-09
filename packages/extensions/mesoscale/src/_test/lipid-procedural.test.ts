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
import {
  cellEntry,
  cellSide,
  cutterCounts,
  cutterRegions,
  cutterTable,
  eachCellHit,
  eachHit,
  emptyCut,
  kindCounts,
  triangleCut,
} from '../lipids/cutter.js';
import { parsePatchPdb } from '../lipids/patch.js';
import {
  createLipidSelection,
  enterPx,
  estimateLipids,
  poolCapacities,
  type SelectionInput,
  unitSlots,
  WholeTriangle,
  wholeTriangles,
} from '../lipids/procedural.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';

// The pool and the selection of a membrane made per view (lipid-procedural; round 5: below the triangle): a flat sheet
// in z = 0 in memory, cut by the synthetic patch, seen from above. A small triangle is a unit whole, a large one's cells
// are units; a view takes the units in view whose lipids are large enough on screen, of the leaflet facing it, nearest
// first within each member's capacity; the slots' accounting exact.

const { text, box } = syntheticPatchPdb();
const table = cutterTable(parsePatchPdb(text, { box }).outer, 2);
const kinds = kindCounts(table, cutterRegions(new Float32Array(9), new Uint32Array(3), 7).cells);

/** an n × n grid of quads (two triangles each) of side `edge` Å in z = 0, its normals +z */
function sheet(n: number, edge: number) {
  const positions: number[] = [];
  for (let j = 0; j <= n; ++j) for (let i = 0; i <= n; ++i) positions.push(i * edge, j * edge, 0);
  const indices: number[] = [];
  for (let j = 0; j < n; ++j) {
    for (let i = 0; i < n; ++i) {
      const a = j * (n + 1) + i;
      indices.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function input(n: number, edge: number, side = 1): SelectionInput {
  const { positions, indices } = sheet(n, edge);
  const regions = cutterRegions(positions, indices, 7);
  const { wholeOf, count } = wholeTriangles(positions, indices, regions, table.box);
  const M = table.members.length;
  const all = cutterCounts(table, positions, indices, regions);
  const T = indices.length / 3;
  const wholeCounts = new Uint32Array(M * count);
  for (let t = 0; t < T; ++t) {
    if (wholeOf[t] < 0) continue;
    for (let m = 0; m < M; ++m) wholeCounts[m * count + wholeOf[t]] = all[m * T + t];
  }
  return { positions, indices, regions, box: table.box, members: M, kinds, wholeOf, wholeCounts, side };
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

const Params = { lipidSize: 8, enterPx: 2, keep: 0.8, facing: 60 };
const full = (i: SelectionInput) => Uint32Array.from(unitSlots(i), (n) => n);

describe('a membrane made per view: the pool and the selection', () => {
  it('sizes each member from the budget: whole where it fits, a share past it', () => {
    const totals = [Uint32Array.of(100, 300), Uint32Array.of(600)];
    expect(poolCapacities(totals, 2000).map((t) => Array.from(t))).toEqual([[100, 300], [600]]);
    // 1000 lipids, a budget of 500: half each (+10 %)
    expect(poolCapacities(totals, 500).map((t) => Array.from(t))).toEqual([[55, 165], [330]]);
    expect(enterPx('texture', 2, 0.5)).toBe(2);
    expect(enterPx('both', 2, 0.5)).toBe(0.5);
  });

  it('cuts a small triangle whole and a large one by cells', () => {
    const C = cellSide(table.box);
    expect(wholeTriangles(sheet(4, 50).positions, sheet(4, 50).indices, input(4, 50).regions, table.box).count).toBe(
      32,
    );
    const large = input(2, 20 * C);
    expect(wholeTriangles(large.positions, large.indices, large.regions, table.box).count).toBe(0);
    // a cell's lipids: its kind's slots; the triangle's own are eachHit's, cell by cell, in its order
    const cut = emptyCut();
    expect(triangleCut(large.positions, large.indices, 0, large.regions, table.box, cut)).toBe(true);
    const M = table.members.length;
    for (let m = 0; m < M; ++m) {
      const want: number[] = [];
      eachHit(table, cut, m, (l, x, y) => want.push(l, Math.fround(x), Math.fround(y)));
      const got: number[] = [];
      for (let cx = Math.floor(cut.pmin[0] / C); cx <= Math.floor(cut.pmax[0] / C); ++cx) {
        for (let cy = Math.floor(cut.pmin[1] / C); cy <= Math.floor(cut.pmax[1] / C); ++cy) {
          let n = 0;
          eachCellHit(table, cut, cx, cy, m, (l, x, y, owned) => {
            n += 1;
            if (owned) got.push(l, Math.fround(x), Math.fround(y));
          });
          expect(n).toBe(kinds[cellEntry(cut.region, cx, cy) * M + m]);
        }
      }
      expect(got).toEqual(want);
    }
    // the count about right without a pass over the lipids
    const exact = cutterCounts(table, large.positions, large.indices, large.regions).reduce((a, b) => a + b, 0);
    expect(Math.abs(estimateLipids(large) - exact) / exact).toBeLessThan(0.05);
  });

  it('takes the cells in view only (a large triangle), of the leaflet facing the camera', () => {
    const C = cellSide(table.box);
    const i = input(2, 40 * C);
    const selection = createLipidSelection(i, full(i));
    // 400 Å above a triangle's middle, fov 60°: about 460 Å across, a few cells (a cell's sphere of margin)
    const v = view(Vec3.create(25 * C, 10 * C, 400));
    expect(selection.select(v.plane, v.frustum, v.depthScale, 0, Params)).toBe(true);
    const n = selection.count;
    expect(n).toBeGreaterThan(4);
    expect(n).toBeLessThan(((460 + 4 * C) / C) ** 2);
    for (let k = 0; k < n; ++k) {
      expect(selection.units[k * 3 + 1]).not.toBe(WholeTriangle);
      const x = (selection.units[k * 3 + 1] + 0.5) * C;
      expect(Number.isFinite(x)).toBe(true);
    }
    // the slots: its kinds' counts, in key order
    let live = 0;
    for (const s of selection.live) live += s;
    expect(live).toBeGreaterThan(0);
    // the inner leaflet from above: behind the outer, none taken; with facing off (a clip) taken
    const inner = createLipidSelection(input(2, 40 * C, -1), full(i));
    inner.select(v.plane, v.frustum, v.depthScale, 0, Params);
    expect(inner.count).toBe(0);
    inner.select(v.plane, v.frustum, v.depthScale * 1.0001, 0, { ...Params, facing: 0 });
    expect(inner.count).toBeGreaterThan(4);
  });

  it('leaves no hole: every lipid in view is in a cell taken (a close view over a large triangle)', () => {
    const C = cellSide(table.box);
    const i = input(2, 40 * C);
    const selection = createLipidSelection(i, full(i));
    const eye = Vec3.create(20 * C, 30 * C, 200);
    const v = view(eye, Vec3.create(21 * C, 31 * C, 0));
    selection.select(v.plane, v.frustum, v.depthScale, 0, Params);
    const taken = new Set<string>();
    for (let k = 0; k < selection.count; ++k) {
      taken.add(`${selection.units[k * 3]},${selection.units[k * 3 + 1]},${selection.units[k * 3 + 2]}`);
    }
    const cut = emptyCut();
    let inView = 0;
    let missed = 0;
    for (let t = 0; t < i.indices.length / 3; ++t) {
      triangleCut(i.positions, i.indices, t, i.regions, table.box, cut);
      for (let m = 0; m < i.members; ++m) {
        eachHit(table, cut, m, (_l, x, y) => {
          const w = Vec3.create(cut.o[0] + x * cut.e1[0] + y * cut.e2[0], cut.o[1] + x * cut.e1[1] + y * cut.e2[1], 0);
          if (!Frustum3D.intersectsSphere3D(v.frustum, { center: w, radius: 0 })) return;
          inView += 1;
          // its cell: p = off + Rz(θ) q
          const px = cut.ox + cut.cos * x - cut.sin * y;
          const py = cut.oy + cut.sin * x + cut.cos * y;
          if (!taken.has(`${t},${Math.floor(px / C)},${Math.floor(py / C)}`)) missed += 1;
        });
      }
    }
    expect(inView).toBeGreaterThan(100);
    expect(missed).toBe(0);
  });

  it('takes small triangles whole, their slots their counts', () => {
    const i = input(16, 50);
    const selection = createLipidSelection(i, full(i));
    const v = view(Vec3.create(200, 200, 300));
    selection.select(v.plane, v.frustum, v.depthScale, 0, Params);
    const n = selection.count;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(512);
    const W = i.wholeCounts.length / i.members;
    for (let m = 0; m < i.members; ++m) {
      let sum = 0;
      for (let k = 0; k < n; ++k) {
        expect(selection.units[k * 3 + 1]).toBe(WholeTriangle);
        expect(selection.bases[m * selection.maxUnits + k]).toBe(sum);
        sum += i.wholeCounts[m * W + i.wholeOf[selection.units[k * 3]]];
      }
      expect(selection.live[m]).toBe(sum);
    }
  });

  it('takes nothing again for the same view, and the same view gives the same units from the same start', () => {
    const C = cellSide(table.box);
    const i = input(2, 40 * C);
    const a = createLipidSelection(i, full(i));
    const b = createLipidSelection(i, full(i));
    const v = view(Vec3.create(500, 700, 900), Vec3.create(1500, 1500, 0));
    expect(a.select(v.plane, v.frustum, v.depthScale, 0, Params)).toBe(true);
    expect(a.select(v.plane, v.frustum, v.depthScale, 0, Params)).toBe(false);
    b.select(v.plane, v.frustum, v.depthScale, 0, Params);
    expect(b.count).toBeGreaterThan(0);
    expect(Array.from(b.units.subarray(0, b.count * 3))).toEqual(Array.from(a.units.subarray(0, a.count * 3)));
  });

  it('takes lipids at their size on screen, and keeps them down to the hysteresis', () => {
    const i = input(16, 50);
    const selection = createLipidSelection(i, full(i));
    // the whole sheet in view; a lipid 8 Å at 2 px for 1000 px and 60°: at depth 8 / (2 × depthScale) ≈ 3464 Å
    const far = view(Vec3.create(400, 400, 6000));
    selection.select(far.plane, far.frustum, far.depthScale, 0, Params);
    expect(selection.count).toBe(0);
    const near = view(Vec3.create(400, 400, 3000));
    selection.select(near.plane, near.frustum, near.depthScale, 0, Params);
    expect(selection.count).toBe(512);
    // past the switch but within the hysteresis (3464 / 0.8 ≈ 4330 Å): kept; a fresh selection takes none
    const between = view(Vec3.create(400, 400, 3900));
    selection.select(between.plane, between.frustum, between.depthScale, 0, Params);
    expect(selection.count).toBe(512);
    const fresh = createLipidSelection(i, full(i));
    fresh.select(between.plane, between.frustum, between.depthScale, 0, Params);
    expect(fresh.count).toBe(0);
  });

  it('takes the nearest first within each capacity', () => {
    const C = cellSide(table.box);
    const i = input(2, 40 * C);
    const cap = full(i).map((n) => Math.ceil(n / 40));
    const selection = createLipidSelection(i, cap);
    // from the side, looking along +x and down: depth grows with x
    const v = view(Vec3.create(-600, 40 * C, 600), Vec3.create(2000, 40 * C, 0));
    selection.select(v.plane, v.frustum, v.depthScale, 0, Params);
    const n = selection.count;
    expect(n).toBeGreaterThan(0);
    for (let m = 0; m < i.members; ++m) expect(selection.live[m]).toBeLessThanOrEqual(cap[m]);
    const all = createLipidSelection(i, full(i));
    all.select(v.plane, v.frustum, v.depthScale, 0, Params);
    expect(all.count).toBeGreaterThan(n);
    // the taken ones nearer than any left out (a cell, the buckets' slack)
    let farthest = -Infinity;
    const taken = new Set<string>();
    for (let k = 0; k < n; ++k) {
      taken.add(`${selection.units[k * 3]},${selection.units[k * 3 + 1]},${selection.units[k * 3 + 2]}`);
    }
    const x = (s: typeof selection, k: number) => {
      const cut = emptyCut();
      triangleCut(i.positions, i.indices, s.units[k * 3], i.regions, table.box, cut);
      const px = (s.units[k * 3 + 1] + 0.5) * C - cut.ox;
      const py = (s.units[k * 3 + 2] + 0.5) * C - cut.oy;
      const qx = cut.cos * px + cut.sin * py;
      const qy = -cut.sin * px + cut.cos * py;
      return cut.o[0] + qx * cut.e1[0] + qy * cut.e2[0];
    };
    for (let k = 0; k < n; ++k) farthest = Math.max(farthest, x(selection, k));
    for (let k = 0; k < all.count; ++k) {
      const key = `${all.units[k * 3]},${all.units[k * 3 + 1]},${all.units[k * 3 + 2]}`;
      if (!taken.has(key)) expect(x(all, k)).toBeGreaterThanOrEqual(farthest - 2 * C);
    }
  });

  it('generates nothing of a hidden member', () => {
    const i = input(16, 50);
    const selection = createLipidSelection(i, full(i));
    selection.shown[0] = 0;
    selection.reset();
    const v = view(Vec3.create(200, 200, 300));
    selection.select(v.plane, v.frustum, v.depthScale, 0, Params);
    expect(selection.count).toBeGreaterThan(0);
    expect(selection.live[0]).toBe(0);
    expect(selection.live[1]).toBeGreaterThan(0);
  });
});
