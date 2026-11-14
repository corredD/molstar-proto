/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { type GrowPose, type SpiralParams, spiralPath, spiralTurns } from '../grow.js';
import { meshSurface } from '../mesh-surface.js';
import { fiberOffsetDirection, makeFiber } from '../paint.js';
import { flatMesh, sphereMesh, tubeMesh } from './fixtures.js';

// Grow › Spiral (grow-helix round 3; Ludo 2026-11-13: "can we also have spiral", then "Archimedean spiral need also the
// copy/count slider … the distance between arms, and the distance along the path between instances"): a flat
// Archimedean spiral from the source (its center) outward: Count copies, Step apart along it (the first a Step from the
// source), its arms Arm spacing apart, Hand; on a mesh rolled over the surface.

const at = (xs: ArrayLike<number>, i: number) => Vec3.create(xs[i * 3], xs[i * 3 + 1], xs[i * 3 + 2]);
const z = Vec3.create(0, 0, 1);

/** The arc length of r = b·θ from 0 to θ */
const arcOf = (b: number, t: number) => (b / 2) * (t * Math.sqrt(1 + t * t) + Math.asinh(t));

/** Each point's distance from `c` in the plane of normal `n` (unit), its angle from `u` (unwrapped about n) */
function polar(path: ArrayLike<number>, c: Vec3, n: Vec3, u: Vec3) {
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

/** The copies of a spiral path: its fiber's units, Step apart along it */
const copies = (path: number[], step: number) => makeFiber(path, { rise: step, twist: 0, jitter: 0 }, z, 1).positions;

describe('spiral in space', () => {
  const rotation = Quat.normalize(Quat(), Quat.create(0.2, -0.4, 0.1, 0.9));
  const source: GrowPose = { position: Vec3.create(5, -3, 2), rotation };
  const p: SpiralParams = { spacing: 20, step: 6, count: 60, hand: 'right' };
  const n = Vec3.transformQuat(Vec3(), z, rotation);
  const u = Vec3.transformQuat(Vec3(), fiberOffsetDirection(Vec3(), 'auto', z), rotation);
  const b = p.spacing / (2 * Math.PI);

  it("Count copies in the source's plane, copy k k × Step along the arc from the source, its arms Arm spacing apart", () => {
    const path = spiralPath(source, z, p);
    const units = copies(path, p.step);
    expect(units.length / 3).toBe(60);
    const c = polar(units, source.position, n, u);
    for (const [k, { r, phi, h }] of c.entries()) {
      expect(h).toBeCloseTo(0, 9);
      // on the Archimedean spiral r = Arm spacing × θ / 2π
      expect(Math.abs(r - b * phi)).toBeLessThan(2e-3 * p.spacing);
      // copy k + 1 (the source copy 0) at (k + 1) × Step along it
      expect(Math.abs(arcOf(b, phi) - (k + 1) * p.step)).toBeLessThan(5e-3 * (k + 1) * p.step);
    }
    // the arm a turn out: Arm spacing farther at the same angle
    const out = polar(path, source.position, n, u);
    const last = out[out.length - 1];
    const back = last.phi - 2 * Math.PI;
    const turnBack = out.reduce((best, x) => (Math.abs(x.phi - back) < Math.abs(best.phi - back) ? x : best));
    expect(last.r - turnBack.r).toBeCloseTo(p.spacing, 0);
    expect(spiralPath(source, z, p)).toEqual(path);
  });

  it('turns counterclockwise about its normal for Hand right, clockwise for left', () => {
    for (const [hand, sign] of [
      ['right', 1],
      ['left', -1],
    ] as const) {
      const path = spiralPath(source, z, { ...p, hand });
      for (let i = 0; i + 1 < path.length / 3; ++i) {
        const r = Vec3.sub(Vec3(), at(path, i), source.position);
        const t = Vec3.sub(Vec3(), at(path, i + 1), at(path, i));
        expect(Math.sign(Vec3.dot(Vec3.cross(Vec3(), r, t), n))).toBe(sign);
      }
    }
  });

  it('with more copies continues outward, with fewer is cut: the first copies bit for bit', () => {
    const few = copies(spiralPath(source, z, { ...p, count: 25 }), p.step);
    const many = copies(spiralPath(source, z, { ...p, count: 70 }), p.step);
    expect(few.length / 3).toBe(25);
    expect(many.length / 3).toBe(70);
    expect(many.slice(0, few.length)).toEqual(few);
  });

  it('reports the turns it reaches (spiralTurns)', () => {
    const info = { turns: 0 };
    spiralPath(source, z, p, undefined, undefined, info);
    // its length: 60 × 6 Å along it (and half a Step past its last copy)
    expect(arcOf(b, info.turns * 2 * Math.PI)).toBeCloseTo(60 * 6 + 3, -1);
    expect(spiralTurns(p.spacing, 60 * 6)).toBeCloseTo(info.turns, 1);
  });
});

describe('spiral on a mesh', () => {
  it("equals the space spiral on a flat mesh, ends where it ends, its normals the mesh's", () => {
    const plane = meshSurface(flatMesh(40, 10));
    const source: GrowPose = { position: Vec3.create(0, 0, 0), rotation: Quat.identity() };
    const p: SpiralParams = { spacing: 20, step: 6, count: 60, hand: 'right' };
    const normals: number[] = [];
    const onPlane = spiralPath(source, z, p, { surface: plane, reach: 10 }, normals)!;
    const inSpace = spiralPath(source, z, p);
    expect(onPlane.length).toBe(inSpace.length);
    for (let i = 0; i < inSpace.length; ++i) expect(onPlane[i]).toBeCloseTo(inSpace[i], 6);
    expect(normals.length).toBe(onPlane.length);
    for (let i = 0; i < normals.length / 3; ++i) expect(normals[i * 3 + 2]).toBeCloseTo(1, 9);
    // 3000 copies on a 400 Å square: past its edge (200 Å) it ends
    const out = spiralPath(source, z, { ...p, count: 3000 }, { surface: plane, reach: 10 })!;
    const last = at(out, out.length / 3 - 1);
    expect(Math.max(Math.abs(last[0]), Math.abs(last[1]))).toBeLessThanOrEqual(200 + 1e-6);
    expect(Math.max(Math.abs(last[0]), Math.abs(last[1]))).toBeGreaterThan(190);
    expect(copies(out, 6).slice(0, 180)).toEqual(copies(onPlane, 6));
  });

  it('on a cylinder (developable) is the space spiral rolled onto it', () => {
    const R = 50;
    const tube = meshSurface(tubeMesh(R, R, 1200, 256, 400));
    const side: GrowPose = { position: Vec3.create(R, 0, 0), rotation: Quat.identity() };
    const p: SpiralParams = { spacing: 15, step: 5, count: 200, hand: 'right' };
    const path = spiralPath(side, z, p, { surface: tube, reach: 10 })!;
    // unrolled: (the arc about z, z), r = b × θ (before it wraps round)
    let before = 0;
    const b = p.spacing / (2 * Math.PI);
    for (let i = 0; i < path.length / 3; ++i) {
      const q = at(path, i);
      expect(Math.abs(Math.hypot(q[0], q[1]) - R)).toBeLessThan(0.05);
      const x = R * Math.atan2(q[1], q[0]);
      let phi = Math.atan2(q[2], x);
      while (phi - before > Math.PI) phi -= 2 * Math.PI;
      while (phi - before < -Math.PI) phi += 2 * Math.PI;
      before = phi;
      if (i > 3 && Math.hypot(x, q[2]) < 0.9 * Math.PI * R) {
        expect(Math.abs(Math.hypot(x, q[2]) - b * Math.abs(phi))).toBeLessThan(0.2);
      }
    }
  });

  it("wrapping round a tube: skips the copies that would land on an earlier arm's, and goes on to Count (round 3b)", () => {
    const R = 50;
    const tube = meshSurface(tubeMesh(R, R, 2400, 256, 800));
    const side: GrowPose = { position: Vec3.create(R, 0, 0), rotation: Quat.identity() };
    const p: SpiralParams = { spacing: 15, step: 5, count: 1500, hand: 'right' };
    const info = { turns: 0, copies: 0, skip: [] as number[] };
    const path = spiralPath(side, z, p, { surface: tube, reach: 10 }, undefined, info)!;
    expect(info.copies).toBe(1500);
    expect(info.skip.length).toBeGreaterThan(0);
    const all = copies(path, p.step);
    const skipped = new Set(info.skip);
    const kept = Array.from({ length: all.length / 3 }, (_, i) => i).filter((i) => !skipped.has(i));
    expect(kept.length).toBe(1500);
    // its last unit is a copy kept
    expect(kept[kept.length - 1]).toBe(all.length / 3 - 1);
    // no copy within 0.6 × Arm spacing of a copy more than 2 Arm spacings behind along it
    for (const i of kept) {
      for (const j of kept) {
        if (j >= i || (i - j) * p.step <= 2 * p.spacing) continue;
        expect(Vec3.distance(at(all, i), at(all, j))).toBeGreaterThanOrEqual(0.6 * p.spacing);
      }
    }
    // more copies continue it, fewer cut it: the copies kept and the ones skipped bit for bit
    const few = { turns: 0, copies: 0, skip: [] as number[] };
    const fewer = spiralPath(side, z, { ...p, count: 900 }, { surface: tube, reach: 10 }, undefined, few)!;
    const someCopies = copies(fewer, p.step);
    expect(all.slice(0, someCopies.length)).toEqual(someCopies);
    expect(info.skip.slice(0, few.skip.length)).toEqual(few.skip);
    expect(few.copies).toBe(900);
  });

  it('on a vesicle: every point on it; its arms close up, crowded copies skipped, and it ends at its bound', () => {
    const R = 100;
    const vesicle = meshSurface(sphereMesh(R, 4));
    const north: GrowPose = { position: Vec3.create(0, 0, R), rotation: Quat.identity() };
    const p: SpiralParams = { spacing: 20, step: 5, count: 5000, hand: 'right' };
    const normals: number[] = [];
    const info = { turns: 0, copies: 0, skip: [] as number[] };
    const path = spiralPath(north, z, p, { surface: vesicle, reach: 20 }, normals, info)!;
    for (let i = 0; i < path.length / 3; ++i) expect(Math.abs(Vec3.magnitude(at(path, i)) - R)).toBeLessThan(0.5);
    for (let i = 0; i < normals.length / 3; ++i) {
      expect(Vec3.dot(at(normals, i), Vec3.normalize(Vec3(), at(path, i)))).toBeGreaterThan(0.99);
    }
    // the vesicle full before 5000: it ends at its bound (4 × Count × Step along it), its copies those it made
    expect(info.copies).toBeLessThan(5000);
    expect(info.copies).toBeGreaterThan(50);
    expect(copies(path, p.step).length / 3 - info.skip.length).toBe(info.copies);
    let length = 0;
    for (let i = 1; i < path.length / 3; ++i) length += Vec3.distance(at(path, i), at(path, i - 1));
    expect(length).toBeLessThanOrEqual(4 * 5000 * 5 + 1e-6);
  });

  it('has a bounded number of points, whatever Step and Arm spacing (second review 1, N1)', () => {
    const center: GrowPose = { position: Vec3.create(0, 0, 0), rotation: Quat.identity() };
    // a long Step over thin arms: its points follow its turns, not 8 a Step
    const long = spiralPath(center, z, { spacing: 1, step: 500, count: 2000, hand: 'right' });
    expect(long.length / 3).toBeLessThan(100000);
    expect(copies(long, 500).length / 3).toBe(2000);
    // a short Step over wide arms: a few points a Step
    const short = spiralPath(center, z, { spacing: 1000, step: 0.5, count: 2000, hand: 'right' });
    expect(short.length / 3).toBeLessThan(5 * 2000);
    expect(copies(short, 0.5).length / 3).toBe(2000);
  });

  it('is undefined for a source off the mesh', () => {
    const plane = meshSurface(flatMesh(4, 10));
    const far: GrowPose = { position: Vec3.create(0, 0, 50), rotation: Quat.identity() };
    expect(
      spiralPath(far, z, { spacing: 10, step: 5, count: 5, hand: 'right' }, { surface: plane, reach: 5 }),
    ).toBeUndefined();
  });
});
