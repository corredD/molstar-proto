/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { type GrowPose, type SpiralParams, spiralPath } from '../grow.js';
import { meshSurface } from '../mesh-surface.js';
import { fiberOffsetDirection, makeFiber } from '../paint.js';
import { flatMesh, sphereMesh, tubeMesh } from './fixtures.js';

// Grow › Spiral (grow-helix round 3, Ludo 2026-11-13: "can we also have spiral"): a flat Archimedean spiral from the
// source, its center, outward: Spacing between arms, Turns, Hand; on a mesh carried over the surface as the walk.

const at = (xs: ArrayLike<number>, i: number) => Vec3.create(xs[i * 3], xs[i * 3 + 1], xs[i * 3 + 2]);
const z = Vec3.create(0, 0, 1);

/** Each point's distance from `c` in the plane of normal `n` (unit) and its angle from `u` (unwrapped, about n) */
function polar(path: number[], c: Vec3, n: Vec3, u: Vec3) {
  const w = Vec3.cross(Vec3(), n, u);
  const out: { r: number; phi: number; h: number }[] = [];
  let before = 0;
  for (let i = 0; i < path.length / 3; ++i) {
    const v = Vec3.sub(Vec3(), at(path, i), c);
    let phi = Math.atan2(Vec3.dot(v, w), Vec3.dot(v, u));
    while (phi - before > Math.PI) phi -= 2 * Math.PI;
    while (phi - before < -Math.PI) phi += 2 * Math.PI;
    before = phi;
    out.push({ r: Math.hypot(Vec3.dot(v, u), Vec3.dot(v, w)), phi, h: Vec3.dot(v, n) });
  }
  return out;
}

describe('spiral in space', () => {
  const rotation = Quat.normalize(Quat(), Quat.create(0.2, -0.4, 0.1, 0.9));
  const source: GrowPose = { position: Vec3.create(5, -3, 2), rotation };
  const p: SpiralParams = { spacing: 20, turns: 4, hand: 'right' };
  const n = Vec3.transformQuat(Vec3(), z, rotation);
  const u = Vec3.transformQuat(Vec3(), fiberOffsetDirection(Vec3(), 'auto', z), rotation);

  it("lies in the source's plane, its radius Spacing a turn from 0 at the source, a rise past it, Turns turns", () => {
    const path = spiralPath(source, z, 4, p);
    const c = polar(path, source.position, n, u);
    for (const [i, { r, phi, h }] of c.entries()) {
      expect(h).toBeCloseTo(0, 9);
      // the first point on a chord near the center (where a 5° chord is far from the curve): within 1 % of Spacing
      if (i === 0) {
        expect(Math.abs(r - (p.spacing * phi) / (2 * Math.PI))).toBeLessThan(0.01 * p.spacing);
        continue;
      }
      // Archimedean: r = Spacing × θ / 2π (chords within 0.1 % of it)
      expect(Math.abs(r - (p.spacing * phi) / (2 * Math.PI))).toBeLessThan(1e-3 * Math.max(r, 1) + 1e-9);
      expect(phi).toBeGreaterThan(0);
    }
    expect(c[c.length - 1].phi).toBeCloseTo(4 * 2 * Math.PI, 6);
    expect(c[c.length - 1].r).toBeCloseTo(80, 6);
    // the first point a rise along it from the source (its arc: the chords from the source)
    const arc = Vec3.distance(source.position, at(path, 0));
    expect(arc).toBeLessThanOrEqual(4 + 1e-9);
    // (its chords near the center curl: the straight distance a little less)
    expect(arc).toBeGreaterThan(3);
    // its units a rise apart
    const units = makeFiber(path, { rise: 4, twist: 0, jitter: 0 }, z, 1).positions;
    for (let i = 1; i < units.length / 3; ++i)
      expect(Vec3.distance(at(units, i), at(units, i - 1))).toBeLessThan(4 + 1e-6);
    expect(spiralPath(source, z, 4, p)).toEqual(path);
  });

  it('turns counterclockwise about its normal for Hand right, clockwise for left', () => {
    for (const [hand, sign] of [
      ['right', 1],
      ['left', -1],
    ] as const) {
      const path = spiralPath(source, z, 4, { ...p, hand });
      for (let i = 0; i + 1 < path.length / 3; ++i) {
        const r = Vec3.sub(Vec3(), at(path, i), source.position);
        const t = Vec3.sub(Vec3(), at(path, i + 1), at(path, i));
        expect(Math.sign(Vec3.dot(Vec3.cross(Vec3(), r, t), n))).toBe(sign);
      }
    }
  });

  it('continues with more turns and is cut with fewer, bit for bit', () => {
    const few = spiralPath(source, z, 4, { ...p, turns: 2 });
    const many = spiralPath(source, z, 4, { ...p, turns: 3.5 });
    expect(many.length).toBeGreaterThan(few.length);
    expect(many.slice(0, few.length)).toEqual(few);
  });
});

describe('spiral on a mesh', () => {
  it('equals the space spiral on a flat mesh, and ends where it ends (no point stacked on its edge)', () => {
    const plane = meshSurface(flatMesh(40, 10));
    const source: GrowPose = { position: Vec3.create(0, 0, 0), rotation: Quat.identity() };
    const p: SpiralParams = { spacing: 20, turns: 4, hand: 'right' };
    const normals: number[] = [];
    const onPlane = spiralPath(source, z, 4, p, { surface: plane, reach: 10 }, normals)!;
    const inSpace = spiralPath(source, z, 4, p);
    expect(onPlane.length).toBe(inSpace.length);
    for (let i = 0; i < inSpace.length; ++i) expect(onPlane[i]).toBeCloseTo(inSpace[i], 6);
    expect(normals.length).toBe(onPlane.length);
    for (let i = 0; i < normals.length / 3; ++i) expect(normals[i * 3 + 2]).toBeCloseTo(1, 9);
    // 10 turns on a 400 Å square: past its edge (200 Å) it ends
    const out = spiralPath(source, z, 4, { ...p, turns: 20 }, { surface: plane, reach: 10 })!;
    const last = at(out, out.length / 3 - 1);
    expect(Math.max(Math.abs(last[0]), Math.abs(last[1]))).toBeLessThanOrEqual(200 + 1e-6);
    expect(Math.max(Math.abs(last[0]), Math.abs(last[1]))).toBeGreaterThan(190);
    expect(out.slice(0, onPlane.length)).toEqual(onPlane);
  });

  it('on a cylinder (developable) is the space spiral rolled onto it: unrolled, its radius Spacing a turn', () => {
    const R = 50;
    const tube = meshSurface(tubeMesh(R, R, 400, 256, 160));
    const side: GrowPose = { position: Vec3.create(R, 0, 0), rotation: Quat.identity() };
    const p: SpiralParams = { spacing: 15, turns: 3, hand: 'right' };
    const path = spiralPath(side, z, 4, p, { surface: tube, reach: 10 })!;
    // unrolled: (the arc about z, z)
    let before = 0;
    for (let i = 0; i < path.length / 3; ++i) {
      const q = at(path, i);
      expect(Math.abs(Math.hypot(q[0], q[1]) - R)).toBeLessThan(0.05);
      const x = R * Math.atan2(q[1], q[0]);
      let phi = Math.atan2(q[2], x);
      while (phi - before > Math.PI) phi -= 2 * Math.PI;
      while (phi - before < -Math.PI) phi += 2 * Math.PI;
      before = phi;
      if (i > 0) expect(Math.abs(Math.hypot(x, q[2]) - (p.spacing * Math.abs(phi)) / (2 * Math.PI))).toBeLessThan(0.15);
    }
    expect(Math.abs(before)).toBeCloseTo(3 * 2 * Math.PI, 1);
  });

  it('on a vesicle: every point on it; rolled over it its arms close up, and it stops when they crowd', () => {
    const R = 100;
    const vesicle = meshSurface(sphereMesh(R, 4));
    const north: GrowPose = { position: Vec3.create(0, 0, R), rotation: Quat.identity() };
    const p: SpiralParams = { spacing: 20, turns: 40, hand: 'right' };
    const normals: number[] = [];
    const path = spiralPath(north, z, 4, p, { surface: vesicle, reach: 20 }, normals)!;
    for (let i = 0; i < path.length / 3; ++i) expect(Math.abs(Vec3.magnitude(at(path, i)) - R)).toBeLessThan(0.5);
    // outward from the pole (the planar spiral rolled over the sphere: its arms closer as it goes, as on any surface
    // curved both ways; exact on a plane, a cylinder or a cone), stopped well before its 40 turns where they crowd
    expect(path.length / 3).toBeLessThan(10 * 72);
    expect(path.length / 3).toBeGreaterThan(2 * 72);
    expect(Math.min(...Array.from({ length: path.length / 3 }, (_, i) => at(path, i)[2]))).toBeLessThan(0.9 * R);
    // where it stopped: its next point within 0.6 × Spacing of the arm three quarters of a turn and more behind (54
    // points), its last within a step more (crowded, not off the surface)
    const end = at(path, path.length / 3 - 1);
    let nearest = Infinity;
    for (let i = 0; i < path.length / 3 - 54; ++i) nearest = Math.min(nearest, Vec3.distance(at(path, i), end));
    expect(nearest).toBeLessThan(p.spacing);
    for (let i = 0; i < normals.length / 3; ++i) {
      expect(Vec3.dot(at(normals, i), Vec3.normalize(Vec3(), at(path, i)))).toBeGreaterThan(0.99);
    }
    // more turns: the same path (it had stopped)
    expect(spiralPath(north, z, 4, { ...p, turns: 60 }, { surface: vesicle, reach: 20 })).toEqual(path);
  });

  it('is undefined for a source off the mesh', () => {
    const plane = meshSurface(flatMesh(4, 10));
    const far: GrowPose = { position: Vec3.create(0, 0, 50), rotation: Quat.identity() };
    expect(
      spiralPath(far, z, 4, { spacing: 10, turns: 2, hand: 'right' }, { surface: plane, reach: 5 }),
    ).toBeUndefined();
  });
});
