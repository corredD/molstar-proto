/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { dragMatrix, movedClipObject } from '../move.js';

const frame = { right: Vec3.create(1, 0, 0), up: Vec3.create(0, 1, 0), pixel: 2 };

describe('move', () => {
  it('moves in the screen plane by the drag (Å per pixel), up the screen when dragged up', () => {
    const m = dragMatrix('move', 10, -5, frame, Vec3.create(0, 0, 0));
    const p = Vec3.transformMat4(Vec3(), Vec3.create(1, 1, 1), m);
    expect(Array.from(p)).toEqual([21, 11, 1]);
  });

  it('turns about the center: the center stays, a point beside it turns about the screen up', () => {
    const center = Vec3.create(10, 0, 0);
    // across by 180 px: 90° about up
    const m = dragMatrix('rotate', 180, 0, frame, center);
    const c = Vec3.transformMat4(Vec3(), center, m);
    for (let i = 0; i < 3; i++) expect(c[i]).toBeCloseTo(center[i], 6);
    const p = Vec3.transformMat4(Vec3(), Vec3.create(11, 0, 0), m);
    expect(p[0]).toBeCloseTo(10, 6);
    expect(Math.abs(p[2])).toBeCloseTo(1, 6);
  });

  it('places a clip object with what it cuts: moved, and turned with it', () => {
    const o = {
      type: 'plane' as const,
      invert: false,
      position: Vec3.create(0, 0, 0),
      rotation: { axis: Vec3.create(1, 0, 0), angle: 0 },
      scale: Vec3.create(1, 1, 1),
      transform: Mat4.identity(),
    };
    const turned = movedClipObject(o, Mat4.fromRotation(Mat4(), Math.PI / 2, Vec3.create(0, 0, 1)));
    expect(turned.rotation.angle).toBeCloseTo(90, 4);
    expect(Math.abs(turned.rotation.axis[2])).toBeCloseTo(1, 4);
    const moved = movedClipObject(o, Mat4.fromTranslation(Mat4(), Vec3.create(0, 5, 0)));
    expect(Array.from(moved.position)).toEqual([0, 5, 0]);
  });
});
