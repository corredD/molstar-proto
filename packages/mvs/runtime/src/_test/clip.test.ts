/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { clippingForNode } from '../load-helpers.js';

/** A representation node with one plane clip of `normal` */
function planeClipped(normal: [number, number, number]) {
  return {
    kind: 'representation',
    params: { type: 'cartoon' },
    children: [{ kind: 'clip', params: { type: 'plane', point: [0, 0, 0], normal, variant: 'pixel' } }],
  } as unknown as Parameters<typeof clippingForNode>[0];
}

/** The normal Mol*'s plane gets: up (0, 1, 0) turned by the clip object's rotation, as `Clip.getClip` does */
function planeNormal(normal: [number, number, number]) {
  const { rotation } = clippingForNode(planeClipped(normal))!.objects[0];
  const axis = Vec3.normalize(Vec3(), rotation.axis);
  const q = Quat.setAxisAngle(Quat(), axis, (rotation.angle * Math.PI) / 180);
  return Vec3.transformQuat(Vec3(), Vec3.create(0, 1, 0), q);
}

describe('MVS plane clip', () => {
  it.each([[[0, 1, 0]], [[0, -1, 0]], [[1, 0, 0]], [[0, 0, -1]], [[0.6, -0.8, 0]]] as [[number, number, number]][])(
    'turns up onto the normal %j',
    (normal) => {
      const n = planeNormal(normal);
      for (let i = 0; i < 3; ++i) expect(n[i]).toBeCloseTo(normal[i], 6);
    },
  );
});
