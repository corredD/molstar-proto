/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { describe, expect, it } from 'vitest';
import { frameHandles } from '../frame.js';

// A frame moved by the transform handles: rigidly, about its origin; its rings those asked for.

const screen = { right: Vec3.create(1, 0, 0), up: Vec3.create(0, 1, 0), perPixel: 0.5 };

describe('frameHandles', () => {
  it('moves and turns a frame about its origin, its size kept', () => {
    const h = frameHandles();
    const turned = Mat4.fromQuat(Mat4(), Quat.setAxisAngle(Quat(), Vec3.create(0, 0, 1), Math.PI / 3));
    const from = { frame: Mat4.setTranslation(turned, Vec3.create(1, 2, 3)), size: 20 };
    const moved = h.apply(from, { kind: 'move' }, screen, 10, 0);
    expect(Array.from(Mat4.getTranslation(Vec3(), moved.frame))).toEqual([6, 2, 3]);
    expect(
      Mat4.areEqual(Mat4.extractRotation(Mat4(), moved.frame), Mat4.extractRotation(Mat4(), from.frame), 1e-6),
    ).toBe(true);
    expect(moved.size).toBe(20);
    expect(h.equal(from, moved)).toBe(false);
    expect(h.sameGeometry(from, moved)).toBe(true);
    const spun = h.apply(from, { kind: 'rotate', axis: Vec3.create(0, 1, 0) }, screen, 30, 0);
    expect(Array.from(Mat4.getTranslation(Vec3(), spun.frame))).toEqual([1, 2, 3]);
    expect(h.equal(from, spun)).toBe(false);
  });

  it('draws the rings asked for: a plane tilts about X and Y', () => {
    const item = { key: 'a', label: 'A', value: { frame: Mat4.identity(), size: 10 } };
    const rings = (o?: Parameters<typeof frameHandles>[0]) =>
      frameHandles(o)
        .layout(item)!
        .groups.filter((g) => g.handle.kind === 'rotate').length;
    expect(rings()).toBe(3);
    expect(rings({ rotate: [0, 1] })).toBe(2);
  });
});
