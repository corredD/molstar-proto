/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { PickResult } from '@molstar/graphics/canvas3d/passes/pick';
import { isMembranePath, membraneFrame, SurfacePoint, surfaceAt, type Identify } from '../pick-surface.js';
import { cellpackLike } from './fixtures.js';

// The surface under the pointer (progress/2026-11-08-paint.md, Tests: pick normal), on a fake pick of an analytic
// sphere: radius 50 Å at the origin seen down -z, 1 Å a pixel, the canvas's centre at (100, 100).

const R = 50;
const eye = Vec3.create(0, 0, 1000);
const sphere: Identify = (x, y) => {
  const wx = x - 100;
  const wy = 100 - y;
  const h = R * R - wx * wx - wy * wy;
  if (h < 0) return undefined;
  return { id: { objectId: 1, instanceId: 0, groupId: 0 }, position: Vec3.create(wx, wy, Math.sqrt(h)) } as PickResult;
};
const angle = (a: Vec3, b: Vec3) => (Vec3.angle(a, b) * 180) / Math.PI;

describe('surfaceAt', () => {
  it("gives the sphere's normal at its centre and off it, within 10°", () => {
    const out = SurfacePoint();
    for (const [x, y] of [
      [100, 100],
      [120, 90],
      [70, 130],
      [140, 100],
    ]) {
      expect(surfaceAt(sphere, x, y, 2, eye, out)).toBe(true);
      const analytic = Vec3.normalize(Vec3(), out.position);
      expect(angle(out.normal, analytic)).toBeLessThan(10);
      expect(Vec3.magnitude(out.normal)).toBeCloseTo(1, 6);
    }
  });

  it('near the edge (a neighbour off the sphere) still gives a normal facing the viewer', () => {
    const out = SurfacePoint();
    expect(surfaceAt(sphere, 149, 100, 2, eye, out)).toBe(true);
    expect(Vec3.dot(out.normal, Vec3.create(0, 0, 1))).toBeGreaterThanOrEqual(0);
    expect(angle(out.normal, Vec3.normalize(Vec3(), out.position))).toBeLessThan(30);
  });

  it("is pending while the pick is read, false where nothing is; a lone pixel's normal faces the viewer", () => {
    const out = SurfacePoint();
    expect(surfaceAt(() => 'pending', 100, 100, 2, eye, out)).toBe('pending');
    expect(surfaceAt(sphere, 0, 0, 2, eye, out)).toBe(false);
    const lone: Identify = (x, y) =>
      x === 10 && y === 10 ? ({ id: {}, position: Vec3.create(1, 2, 3) } as PickResult) : undefined;
    expect(surfaceAt(lone, 10, 10, 2, eye, out)).toBe(true);
    expect(angle(out.normal, Vec3.sub(Vec3(), eye, Vec3.create(1, 2, 3)))).toBeLessThan(1e-3);
  });
});

describe('membraneFrame', () => {
  it('on a membrane particle, its +z and the point on its mid-plane; on any other, nothing', () => {
    const list = cellpackLike();
    // particle 0 (compartment root.envelope.membrane) at (0, 0, 0), turned so +z is +x
    const q = Quat.setAxisAngle(Quat(), Vec3.create(0, 1, 0), Math.PI / 2);
    const rotations = new Float32Array(list.count * 4);
    for (let i = 0; i < list.count; ++i) rotations[i * 4 + 3] = 1;
    rotations.set(q, 0);
    const turned = { ...list, rotations };
    const out = SurfacePoint();
    Vec3.set(out.position, 20, 5, 0);
    expect(membraneFrame(turned, 0, out)).toBe(true);
    expect(Vec3.distance(out.normal, Vec3.create(1, 0, 0))).toBeLessThan(1e-6);
    expect(Vec3.distance(out.position, Vec3.create(0, 5, 0))).toBeLessThan(1e-5);
    // particle 6 has no compartment
    Vec3.set(out.position, 20, 5, 0);
    expect(membraneFrame(turned, 6, out)).toBe(false);
    expect(Vec3.distance(out.position, Vec3.create(20, 5, 0))).toBe(0);
    expect(isMembranePath('exosome.membrane')).toBe(true);
    expect(isMembranePath('root.envelope.capsid.surface')).toBe(true);
    expect(isMembranePath('exosome.interior')).toBe(false);
  });
});
