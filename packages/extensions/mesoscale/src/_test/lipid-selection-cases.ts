/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Frustum3D } from '@molstar/core/math/geometry/primitives/frustum3d';
import { Plane3D } from '@molstar/core/math/geometry/primitives/plane3d';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { cutterCounts, cutterRegions, cutterTable, kindCounts } from '../lipids/cutter.js';
import { parsePatchPdb } from '../lipids/patch.js';
import { type SelectionInput, unitSlots, wholeTriangles } from '../lipids/procedural.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';

// The selection's cases (lipid-procedural.test.ts, lipid-selection.quick.ts): a flat sheet in z = 0 in memory, cut by
// the synthetic patch, seen from above.

export const { text, box } = syntheticPatchPdb();
export const table = cutterTable(parsePatchPdb(text, { box }).outer, 2);
export const kinds = kindCounts(table, cutterRegions(new Float32Array(9), new Uint32Array(3), 7).cells);

/** an n × n grid of quads (two triangles each) of side `edge` Å in z = 0, its normals +z */
export function sheet(n: number, edge: number) {
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

export function input(n: number, edge: number, side = 1): SelectionInput {
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
export function view(eye: Vec3, at = Vec3.create(eye[0], eye[1], 0), height = 1000) {
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

export const Params = { lipidSize: 8, enterPx: 2, keep: 0.8, facing: 60 };
export const full = (i: SelectionInput) => Uint32Array.from(unitSlots(i), (n) => n);
