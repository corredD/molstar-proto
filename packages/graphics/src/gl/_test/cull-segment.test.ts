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
import { Clip } from '@molstar/core/util/clip';
import {
  type CullValues,
  createSegmentedMdbList,
  getAnimationSlack,
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

/**
 * The draws per level as the cells give them one by one (contiguous ranges joined); without the cells `clip` clips
 * whole
 */
function referenceDraws(
  grid: InstanceGrid,
  levels: LodLevelsValue,
  frustum: Frustum3D,
  cameraPlane: Plane3D,
  clip?: Clip.Objects,
  slack = 0,
) {
  const draws: number[][] = levels.map(() => []);
  const s = Sphere3D();
  for (let c = 0; c < grid.cellCount; ++c) {
    const begin = grid.cellOffsets[c];
    const count = grid.cellOffsets[c + 1] - begin;
    if (count === 0) continue;
    Sphere3D.fromArray(s, grid.cellSpheres, c * 4);
    s.radius += slack;
    if (!Frustum3D.intersectsSphere3D(frustum, s)) continue;
    if (clip && Clip.classifySphere(clip, s) === Clip.SphereClass.All) continue;
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
function referenceInstanceDraws(
  grid: InstanceGrid,
  levels: LodLevelsValue,
  frustum: Frustum3D,
  cameraPlane: Plane3D,
  slack = 0,
) {
  const draws: number[][] = levels.map(() => []);
  const s = Sphere3D.create(Vec3(), 2 + slack);
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
      0,
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

  it('with wiggling atoms, draws the cells whose spheres grown by the wiggle reach into view', () => {
    const { frustum, cameraPlane } = view(Vec3.create(300, 95, -100), Vec3.create(95, 95, 95));
    const value = [[0, 1e7, 0, 600, 1]] as unknown as LodLevelsValue;
    const lodLevels = ValueCell.create(value);
    // wiggle up to 5 Å an axis (its speed and frequency on)
    const animation = {
      uWiggleAmplitude: ValueCell.create(5),
      uWiggleSpeed: ValueCell.create(1),
      uWiggleFrequency: ValueCell.create(1),
    };
    const cull = (v: CullValues) => {
      const mdb = createSegmentedMdbList();
      const prepared = mdb.prepare(lodLevels, grid.cellCount, false, LodView());
      const slack = v.animation ? getAnimationSlack(v.animation) : 0;
      mdb.cullSegment(v, ZeroCullSegment, prepared, cameraPlane, frustum, null, createGraphicsStats(), false, slack);
      return mdb.list.map((l) => {
        const out: number[] = [];
        for (let i = 0; i < l.count; ++i) out.push(l.baseInstances[i], l.instanceCounts[i]);
        return out;
      });
    };
    const draws = cull({ ...values, lodLevels, animation });
    expect(draws).toEqual(referenceDraws(grid, value, frustum, cameraPlane, undefined, Math.sqrt(3) * 5));
    expect(draws).not.toEqual(referenceDraws(grid, value, frustum, cameraPlane));
    // still: as before
    expect(cull({ ...values, lodLevels })).toEqual(referenceDraws(grid, value, frustum, cameraPlane));
  });

  // rework: CPU culling by instance for objects with levels of detail (07dbe3a12, 8c5e17359; dropped in the merge of
  // master: `cullSegment` culls by cell, the instances' own spheres and `padding` are not read)
  it.skip.each([
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
      // room for one draw: the lists grow for the draws per instance (renderables prepare one per cell)
      const prepared = mdb.prepare(lodLevels, 1, false, LodView());
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
        0,
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

  // rework: the wiggle and tumble allowance of CPU culling by instance (4ac650258; cells and batches grow by it, the
  // test above, not instances: there is no culling by instance)
  it.skip('with wiggling atoms, draws the instances whose spheres grown by the wiggle reach into view', () => {
    const { frustum, cameraPlane } = view(Vec3.create(300, 95, -100), Vec3.create(95, 95, 95));
    const value = [[0, 1e7, 0, 600, 1]] as unknown as LodLevelsValue;
    const lodLevels = ValueCell.create(value);
    const mdb = createSegmentedMdbList();
    const prepared = mdb.prepare(lodLevels, 1, false, LodView());
    // wiggle up to 5 Å an axis (its speed and frequency on)
    const animation = {
      uWiggleAmplitude: ValueCell.create(5),
      uWiggleSpeed: ValueCell.create(1),
      uWiggleFrequency: ValueCell.create(1),
    };
    mdb.cullSegment(
      {
        ...values,
        lodLevels,
        invariantBoundingSphere: ValueCell.create(Sphere3D.create(Vec3(), 2)),
        padding: ValueCell.create(0),
        animation,
      },
      ZeroCullSegment,
      prepared,
      cameraPlane,
      frustum,
      null,
      createGraphicsStats(),
      false,
      0,
    );
    const draws = mdb.list.map((l) => {
      const out: number[] = [];
      for (let i = 0; i < l.count; ++i) out.push(l.baseInstances[i], l.instanceCounts[i]);
      return out;
    });
    expect(draws).toEqual(referenceInstanceDraws(grid, value, frustum, cameraPlane, Math.sqrt(3) * 5));
    expect(draws).not.toEqual(referenceInstanceDraws(grid, value, frustum, cameraPlane));
  });

  // clip objects without a clipping layer cull the cells and batches they clip whole (`clip-culling.md`), from classes
  // cached per grid and clip version
  it('leaves out what clip objects clip whole, as the cells give it, and follows a clip change', () => {
    const { frustum, cameraPlane } = view(Vec3.create(95, 95, -300), Vec3.create(95, 95, 95));
    const level = [[0, 1e7, 0, 600, 1]] as unknown as LodLevelsValue;
    const lodLevels = ValueCell.create(level);
    const clip = (y: number, angle: number) =>
      Clip.getClip({
        variant: 'pixel',
        objects: [
          {
            type: 'plane',
            invert: false,
            position: Vec3.create(95, y, 95),
            rotation: { axis: Vec3.create(1, 0, 0), angle },
            scale: Vec3.create(1, 1, 1),
            transform: Mat4.identity(),
          },
        ],
      } as Clip.Props).objects;
    const clipObjects = ValueCell.create(clip(95, 20));
    const clipped: CullValues = {
      ...values,
      lodLevels,
      dClipObjects: ValueCell.create(true),
      dClipping: ValueCell.create(false),
      clipObjects,
    };
    const cull = (v: CullValues) => {
      const mdb = createSegmentedMdbList();
      const prepared = mdb.prepare(lodLevels, grid.cellCount, false, LodView());
      mdb.cullSegment(v, ZeroCullSegment, prepared, cameraPlane, frustum, null, createGraphicsStats(), false, 0);
      const out: number[] = [];
      for (let i = 0; i < mdb.list[0].count; ++i) out.push(mdb.list[0].baseInstances[i], mdb.list[0].instanceCounts[i]);
      return out;
    };
    const instances = (draws: number[]) => draws.reduce((sum, v, i) => (i % 2 ? sum + v : sum), 0);

    const all = cull({ ...values, lodLevels });
    const half = cull(clipped);
    expect(half).toEqual(referenceDraws(grid, level, frustum, cameraPlane, clipObjects.ref.value)[0]);
    expect(instances(half)).toBeLessThan(instances(all) * 0.8);
    expect(instances(half)).toBeGreaterThan(0);

    // the same objects moved (a new version): classified again
    Object.assign(clipObjects.ref.value, clip(40, -30));
    ValueCell.update(clipObjects, clipObjects.ref.value);
    const moved = cull(clipped);
    expect(moved).toEqual(referenceDraws(grid, level, frustum, cameraPlane, clipObjects.ref.value)[0]);
    expect(moved).not.toEqual(half);

    // with a clipping layer (its flags exempt groups) nothing is culled by the clip objects
    expect(cull({ ...clipped, dClipping: ValueCell.create(true) })).toEqual(all);
  });

  // instance clipping tests an instance's center: the cells' and batches' spheres shrunk to their centers
  it('culls by the instance centers for instance clipping', () => {
    const { frustum, cameraPlane } = view(Vec3.create(95, 95, -300), Vec3.create(95, 95, 95));
    const lodLevels = ValueCell.create([[0, 1e7, 0, 600, 1]] as unknown as LodLevelsValue);
    // above y 94 clipped: the cells of the rows at 100 and 110 (centered at 105, 11 away) reach it with their spheres
    // (radius 12.1), not with their centers (10.1 less the instances' radius)
    const objects = Clip.getClip({
      variant: 'instance',
      objects: [
        {
          type: 'plane',
          invert: false,
          position: Vec3.create(95, 94, 95),
          rotation: { axis: Vec3.create(1, 0, 0), angle: 0 },
          scale: Vec3.create(1, 1, 1),
          transform: Mat4.identity(),
        },
      ],
    } as Clip.Props).objects;
    const clipped = (variant: 'pixel' | 'instance'): CullValues => ({
      ...values,
      lodLevels,
      dClipObjects: ValueCell.create(true),
      dClipping: ValueCell.create(false),
      clipObjects: ValueCell.create(objects),
      dClipVariant: ValueCell.create(variant),
      invariantBoundingSphere: ValueCell.create(Sphere3D.create(Vec3(), 2)),
    });
    const drawn = (v: CullValues) => {
      const mdb = createSegmentedMdbList();
      const prepared = mdb.prepare(lodLevels, grid.cellCount, false, LodView());
      mdb.cullSegment(v, ZeroCullSegment, prepared, cameraPlane, frustum, null, createGraphicsStats(), false, 0);
      const slots = new Uint8Array(grid.cellOffsets[grid.cellCount]);
      const l = mdb.list[0];
      for (let i = 0; i < l.count; ++i) slots.fill(1, l.baseInstances[i], l.baseInstances[i] + l.instanceCounts[i]);
      return slots;
    };
    const pixel = drawn(clipped('pixel'));
    const instance = drawn(clipped('instance'));
    const count = (slots: Uint8Array) => slots.reduce((sum, v) => sum + v, 0);
    expect(count(instance)).toBeLessThan(count(pixel));
    // every instance left out has its center clipped (the view holds them all)
    const center = Vec3();
    for (let i = 0; i < instance.length; ++i) {
      if (instance[i]) continue;
      Vec3.fromArray(center, grid.cellTransform, i * 16 + 12);
      expect(center[1]).toBeGreaterThanOrEqual(94);
    }
  });
});
