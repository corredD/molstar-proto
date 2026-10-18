/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Sphere3D } from '@molstar/core/math/geometry';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { clipObjectOf, cutGuideMesh, cutOf, defaultCut, flipCut, rotationTo, slideCut } from '../cuts.js';

const turnUp = (normal: Vec3) => {
  const r = rotationTo(normal);
  const q = Quat.setAxisAngle(Quat(), r.axis, (r.angle * Math.PI) / 180);
  return Vec3.transformQuat(Vec3(), Vec3.create(0, 1, 0), q);
};

describe('cuts', () => {
  it.each([[[0, 1, 0]], [[0, -1, 0]], [[1, 0, 0]], [[0, 0, 1]], [[0.6, -0.8, 0]]] as [[number, number, number]][])(
    'turns up onto the normal %j',
    (normal) => {
      const n = turnUp(Vec3.create(...normal));
      for (let i = 0; i < 3; ++i) expect(n[i]).toBeCloseTo(normal[i], 6);
    },
  );

  it('places a plane through the center facing the camera, and a window on the near side', () => {
    const bounds = Sphere3D.create(Vec3.create(10, 0, 0), 20);
    const view = Vec3.create(0, 0, -1); // the camera looks down -z: it is on +z
    const plane = defaultCut('plane', bounds, view);
    expect(plane.center).toEqual([10, 0, 0]);
    expect(plane.normal).toEqual([-0, -0, 1]);
    const sphere = defaultCut('sphere', bounds, view);
    expect(sphere.center[2]).toBeCloseTo(18);
    expect(sphere.radius).toBeCloseTo(12);
  });

  it('reads back the cut it writes as a clip object', () => {
    const bounds = Sphere3D.create(Vec3.create(1, 2, 3), 10);
    for (const shape of ['plane', 'sphere', 'box'] as const) {
      const cut = defaultCut(shape, bounds, Vec3.create(1, 0, 0));
      const back = cutOf(clipObjectOf(cut), cut.radius)!;
      expect(back.shape).toBe(shape);
      for (let i = 0; i < 3; ++i) {
        expect(back.center[i]).toBeCloseTo(cut.center[i], 5);
        expect(back.normal[i]).toBeCloseTo(cut.normal[i], 5);
      }
      if (shape !== 'plane') expect(back.radius).toBeCloseTo(cut.radius, 5);
    }
  });

  it('slides along the normal and flips', () => {
    const cut = defaultCut('plane', Sphere3D.create(Vec3.create(0, 0, 0), 5), Vec3.create(0, 0, -1));
    expect(slideCut(cut, 2).center).toEqual([0, 0, 2]);
    expect(flipCut(cut).normal).toEqual([0, 0, -1]);
    const sphere = defaultCut('sphere', Sphere3D.create(Vec3.create(0, 0, 0), 5), Vec3.create(0, 0, -1));
    expect(flipCut(sphere).invert).toBe(true);
  });

  it('draws a guide for each shape', () => {
    for (const shape of ['plane', 'sphere', 'box'] as const) {
      const mesh = cutGuideMesh(defaultCut(shape, Sphere3D.create(Vec3.create(0, 0, 0), 5), Vec3.create(0, 0, -1)));
      expect(mesh.triangleCount).toBeGreaterThan(10);
    }
  });
});
