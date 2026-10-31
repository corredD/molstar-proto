/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { calcInstanceGrid, type InstanceGrid } from '@molstar/core/math/geometry/instance-grid';
import { Frustum3D } from '@molstar/core/math/geometry/primitives/frustum3d';
import { Plane3D } from '@molstar/core/math/geometry/primitives/plane3d';
import { Sphere3D } from '@molstar/core/math/geometry/primitives/sphere3d';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { Vec4 } from '@molstar/core/math/linear-algebra/3d/vec4';
import { ValueCell } from '@molstar/core/util/value-cell';
import {
  type CullValues,
  createSegmentedMdbList,
  type LodLevelsValue,
  LodView,
  ZeroCullSegment,
} from '../renderable.js';
import { createGraphicsStats } from '../stats.js';

/** 20^3 instances 10 Å apart, of spheres of radius 2, in cells of 20 Å, batches of 64 Å (up to 27 cells) */
function createGrid(): InstanceGrid {
  const n = 20;
  const count = n * n * n;
  const transform = new Float32Array(count * 16);
  const instance = new Float32Array(count);
  for (let i = 0; i < count; ++i) {
    const m = Mat4.fromTranslation(
      Mat4(),
      Vec3.create((i % n) * 10, (Math.floor(i / n) % n) * 10, Math.floor(i / (n * n)) * 10),
    );
    Mat4.toArray(m, transform, i * 16);
    instance[i] = i;
  }
  return calcInstanceGrid(
    { instanceCount: count, instance, transform, invariantBoundingSphere: Sphere3D.create(Vec3(), 2) },
    20,
    64,
  );
}

function view(eye: Vec3, target: Vec3) {
  const t = Math.tan(Math.PI / 8);
  const projection = Mat4.perspective(Mat4(), -t, t, t, -t, 1, 2000);
  const viewMatrix = Mat4.lookAt(Mat4(), eye, target, Vec3.create(0, 1, 0));
  const frustum = Frustum3D();
  Frustum3D.fromProjectionMatrix(frustum, Mat4.mul(Mat4(), projection, viewMatrix));
  const cameraPlane = Plane3D();
  Plane3D.copy(cameraPlane, frustum[Frustum3D.PlaneIndex.Near]);
  cameraPlane.constant -= Plane3D.distanceToPoint(cameraPlane, eye);
  return { frustum, cameraPlane };
}

/** The draws per level as the cells give them one by one (contiguous ranges joined) */
function referenceDraws(grid: InstanceGrid, levels: LodLevelsValue, frustum: Frustum3D, cameraPlane: Plane3D) {
  const draws: number[][] = levels.map(() => []);
  const s = Sphere3D();
  for (let c = 0; c < grid.cellCount; ++c) {
    const begin = grid.cellOffsets[c];
    const count = grid.cellOffsets[c + 1] - begin;
    if (count === 0) continue;
    Sphere3D.fromArray(s, grid.cellSpheres, c * 4);
    if (!Frustum3D.intersectsSphere3D(frustum, s)) continue;
    const d = Plane3D.distanceToPoint(cameraPlane, s.center);
    for (let j = 0; j < levels.length; ++j) {
      if (d + s.radius < levels[j][0] || d - s.radius > levels[j][1]) continue;
      const list = draws[j];
      const last = list.length - 2;
      if (last >= 0 && list[last] + list[last + 1] === begin) list[last + 1] += count;
      else list.push(begin, count);
    }
  }
  return draws;
}

/** The draws per level by each instance's own sphere (radius 2, consecutive instances joined) */
function referenceInstanceDraws(grid: InstanceGrid, levels: LodLevelsValue, frustum: Frustum3D, cameraPlane: Plane3D) {
  const draws: number[][] = levels.map(() => []);
  const s = Sphere3D.create(Vec3(), 2);
  const count = grid.cellOffsets[grid.cellCount];
  for (let i = 0; i < count; ++i) {
    Vec3.set(
      s.center,
      grid.cellTransform[i * 16 + 12],
      grid.cellTransform[i * 16 + 13],
      grid.cellTransform[i * 16 + 14],
    );
    if (!Frustum3D.intersectsSphere3D(frustum, s)) continue;
    const d = Plane3D.distanceToPoint(cameraPlane, s.center);
    for (let j = 0; j < levels.length; ++j) {
      if (d + s.radius < levels[j][0] || d - s.radius > levels[j][1]) continue;
      const list = draws[j];
      const last = list.length - 2;
      if (last >= 0 && list[last] + list[last + 1] === i) list[last + 1] += 1;
      else list.push(i, 1);
    }
  }
  return draws;
}

describe('culling a segment', () => {
  const grid = createGrid();
  const values: CullValues = {
    drawCount: ValueCell.create(6000),
    instanceCount: ValueCell.create(grid.cellOffsets[grid.cellCount]),
    uLod: ValueCell.create(Vec4()),
    instanceGrid: ValueCell.create(grid),
    boundingSphere: ValueCell.create(Sphere3D.create(Vec3.create(95, 95, 95), 170)),
  };

  it.each([
    ['whole, one level', [0, 0, -400], [[0, 1e7, 0, 600, 1]]],
    [
      'whole, levels',
      [95, 95, -300],
      [
        [0, 380, 0, 600, 1],
        [380, 450, 0, 60, 2],
        [450, 1e7, 0, 6, 4],
      ],
    ],
    [
      'inside, levels',
      [95, 95, 40],
      [
        [0, 60, 0, 600, 1],
        [60, 120, 0, 60, 2],
        [120, 1e7, 0, 6, 4],
      ],
    ],
    [
      'partly outside the view',
      [300, 95, -100],
      [
        [0, 250, 0, 600, 1],
        [250, 1e7, 0, 60, 2],
      ],
    ],
  ] as const)('draws what the cells give one by one: %s', (_, eye, levels) => {
    const { frustum, cameraPlane } = view(Vec3.create(eye[0], eye[1], eye[2]), Vec3.create(95, 95, 95));
    const value = levels.map((l) => [...l]) as unknown as LodLevelsValue;
    const lodLevels = ValueCell.create(value);
    const mdb = createSegmentedMdbList();
    const prepared = mdb.prepare(lodLevels, grid.cellCount, false, LodView());
    mdb.cullSegment(
      { ...values, lodLevels },
      ZeroCullSegment,
      prepared,
      cameraPlane,
      frustum,
      null,
      createGraphicsStats(),
      false,
    );
    const draws = mdb.list.map((l) => {
      const out: number[] = [];
      for (let i = 0; i < l.count; ++i) out.push(l.baseInstances[i], l.instanceCounts[i]);
      return out;
    });
    const reference = referenceDraws(grid, value, frustum, cameraPlane);
    expect(draws).toEqual(reference);
    // something drawn, and in the views with levels at more than one level
    expect(reference.flat().length).toBeGreaterThan(0);
  });

  it.each([
    [
      'partly outside the view',
      [300, 95, -100],
      [
        [0, 250, 0, 600, 1],
        [250, 1e7, 0, 60, 2],
      ],
    ],
    [
      'inside, levels',
      [95, 95, 40],
      [
        [0, 60, 0, 600, 1],
        [60, 120, 0, 60, 2],
        [120, 1e7, 0, 6, 4],
      ],
    ],
  ] as const)(
    "with the instances' spheres, draws each instance whose own sphere is in view and range: %s",
    (_, eye, levels) => {
      const { frustum, cameraPlane } = view(Vec3.create(eye[0], eye[1], eye[2]), Vec3.create(95, 95, 95));
      const value = levels.map((l) => [...l]) as unknown as LodLevelsValue;
      const lodLevels = ValueCell.create(value);
      const mdb = createSegmentedMdbList();
      const prepared = mdb.prepare(lodLevels, grid.cellOffsets[grid.cellCount], false, LodView());
      const invariantBoundingSphere = ValueCell.create(Sphere3D.create(Vec3(), 2));
      mdb.cullSegment(
        { ...values, lodLevels, invariantBoundingSphere, padding: ValueCell.create(0) },
        ZeroCullSegment,
        prepared,
        cameraPlane,
        frustum,
        null,
        createGraphicsStats(),
        false,
      );
      const draws = mdb.list.map((l) => {
        const out: number[] = [];
        for (let i = 0; i < l.count; ++i) out.push(l.baseInstances[i], l.instanceCounts[i]);
        return out;
      });
      const reference = referenceInstanceDraws(grid, value, frustum, cameraPlane);
      expect(draws).toEqual(reference);
      // fewer instances than the cells give
      const cells = referenceDraws(grid, value, frustum, cameraPlane);
      const sum = (d: number[][]) =>
        d.reduce((a, l) => a + l.filter((_, i) => i % 2 === 1).reduce((x, y) => x + y, 0), 0);
      expect(sum(reference)).toBeLessThan(sum(cells));
    },
  );
});
