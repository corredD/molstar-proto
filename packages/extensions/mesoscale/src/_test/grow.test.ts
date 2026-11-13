/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import {
  crystalPoses,
  type GrowPose,
  latticeVectors,
  poseToScene,
  rotationsToListFrame,
  spherePoses,
  tilingPoses,
  walkPath,
} from '../grow.js';
import { toListFrame } from '../paint.js';

// The grow engine (progress/2026-11-11-grow.md, Tests): each mode's copies from a source's pose, the source not one.

const turned = Quat.setAxisAngle(Quat(), Vec3.normalize(Vec3(), Vec3.create(1, 2, 3)), 0.7);
const source: GrowPose = { position: Vec3.create(10, -5, 3), rotation: turned };
const at = (xs: number[], i: number) => Vec3.create(xs[i * 3], xs[i * 3 + 1], xs[i * 3 + 2]);
const quat = (qs: number[], i: number) => Quat.create(qs[i * 4], qs[i * 4 + 1], qs[i * 4 + 2], qs[i * 4 + 3]);
const local = (p: Vec3) =>
  Vec3.transformQuat(Vec3(), Vec3.sub(Vec3(), p, source.position), Quat.conjugate(Quat(), source.rotation));

describe('crystal', () => {
  it('puts na·nb·nc − 1 copies at X + R·(i·a + j·b + k·c) about the source, each turned as it', () => {
    const p = { a: 30, b: 40, c: 50, alpha: 90, beta: 90, gamma: 90, na: 3, nb: 3, nc: 2 };
    const out = crystalPoses(source, p)!;
    expect(out.positions.length / 3).toBe(3 * 3 * 2 - 1);
    const seen = new Set<string>();
    for (let i = 0; i < out.positions.length / 3; ++i) {
      const l = local(at(out.positions, i));
      const [u, v, w] = [l[0] / 30, l[1] / 40, l[2] / 50];
      for (const x of [u, v, w]) expect(Math.abs(x - Math.round(x))).toBeLessThan(1e-6);
      expect([-1, 0, 1]).toContain(Math.round(u));
      expect([0, 1]).toContain(Math.round(w));
      seen.add(`${Math.round(u)},${Math.round(v)},${Math.round(w)}`);
      expect(Quat.equals(quat(out.rotations, i), turned)).toBe(true);
    }
    expect(seen.has('0,0,0')).toBe(false);
    expect(seen.size).toBe(17);
  });

  it('makes a cell of its angles (a along x, b in xy), none of impossible angles', () => {
    const [a, b, c] = latticeVectors({ a: 10, b: 10, c: 10, alpha: 90, beta: 90, gamma: 120 })!;
    expect(Vec3.distance(a, Vec3.create(10, 0, 0))).toBeLessThan(1e-9);
    expect((Math.acos(Vec3.dot(a, b) / 100) * 180) / Math.PI).toBeCloseTo(120, 6);
    expect(Vec3.dot(a, c)).toBeCloseTo(0, 6);
    expect(Vec3.magnitude(c)).toBeCloseTo(10, 6);
    expect(latticeVectors({ a: 1, b: 1, c: 1, alpha: 10, beta: 10, gamma: 170 })).toBeUndefined();
    expect(crystalPoses(source, { a: 1, b: 1, c: 1, alpha: 0, beta: 90, gamma: 90, na: 2, nb: 1, nc: 1 })).toBe(
      undefined,
    );
  });
});

describe('tiling', () => {
  const normal = Vec3.create(0, 0, 1);
  it('tiles Hex in rings: 1 + 3r(r+1) points with the source, in its plane, each a spacing from a neighbour', () => {
    for (const rings of [1, 2, 3]) {
      const out = tilingPoses(source, normal, { pattern: 'hex', spacing: 20, rings });
      const k = out.positions.length / 3;
      expect(k + 1).toBe(1 + 3 * rings * (rings + 1));
      const all = [Vec3.create(0, 0, 0), ...Array.from({ length: k }, (_, i) => local(at(out.positions, i)))];
      for (const p of all) expect(Math.abs(p[2])).toBeLessThan(1e-6);
      for (let i = 0; i < all.length; ++i) {
        let nearest = Infinity;
        for (let j = 0; j < all.length; ++j) if (i !== j) nearest = Math.min(nearest, Vec3.distance(all[i], all[j]));
        expect(nearest).toBeCloseTo(20, 6);
      }
      for (let i = 0; i < k; ++i) expect(Quat.equals(quat(out.rotations, i), turned)).toBe(true);
    }
  });

  it('tiles Square in rings: (2r+1)² points with the source, ring by ring', () => {
    const out = tilingPoses(source, Vec3.create(1, 1, 0), { pattern: 'square', spacing: 15, rings: 2 });
    expect(out.positions.length / 3 + 1).toBe(25);
    // the first ring first: its 8 within √2 spacings
    for (let i = 0; i < 8; ++i)
      expect(Vec3.magnitude(local(at(out.positions, i)))).toBeLessThan(15 * Math.SQRT2 + 1e-6);
    const n = Vec3.normalize(Vec3(), Vec3.create(1, 1, 0));
    for (let i = 0; i < 24; ++i) expect(Math.abs(Vec3.dot(local(at(out.positions, i)), n))).toBeLessThan(1e-6);
  });
});

describe('sphere', () => {
  it('puts Count copies within Radius of the source; the same seed, the same copies', () => {
    const p = { count: 50, radius: 40, turn: 'random' as const };
    const a = spherePoses(source, p, 7);
    expect(a.positions.length / 3).toBe(50);
    for (let i = 0; i < 50; ++i) expect(Vec3.distance(at(a.positions, i), source.position)).toBeLessThanOrEqual(40);
    expect(spherePoses(source, p, 7)).toEqual(a);
    expect(spherePoses(source, p, 8).positions).not.toEqual(a.positions);
    // turned at random, unit quaternions; As the source: the source's
    for (let i = 0; i < 50; ++i) expect(Quat.magnitude(quat(a.rotations, i))).toBeCloseTo(1, 6);
    const same = spherePoses(source, { ...p, turn: 'source' }, 7);
    expect(same.positions).toEqual(a.positions);
    for (let i = 0; i < 50; ++i) expect(Quat.equals(quat(same.rotations, i), turned)).toBe(true);
  });
});

describe('random walk', () => {
  const axis = Vec3.create(0, 0, 1);
  it('walks Steps points a rise apart from the source, along its axis first, each turn within Persistence', () => {
    const path = walkPath(source, axis, 8, { steps: 20, persistence: 30 }, 3);
    expect(path.length / 3).toBe(20);
    const first = Vec3.sub(Vec3(), at(path, 0), source.position);
    expect(Vec3.magnitude(first)).toBeCloseTo(8, 6);
    const along = Vec3.transformQuat(Vec3(), axis, turned);
    expect(Vec3.dot(Vec3.normalize(first, first), along)).toBeCloseTo(1, 6);
    let turnedSome = false;
    for (let i = 1; i < 20; ++i) {
      const d = Vec3.sub(Vec3(), at(path, i), at(path, i - 1));
      expect(Vec3.magnitude(d)).toBeCloseTo(8, 6);
      if (i > 1) {
        const before = Vec3.sub(Vec3(), at(path, i - 1), at(path, i - 2));
        const angle = (Vec3.angle(d, before) * 180) / Math.PI;
        expect(angle).toBeLessThanOrEqual(30 + 1e-6);
        if (angle > 1) turnedSome = true;
      }
    }
    expect(turnedSome).toBe(true);
    expect(walkPath(source, axis, 8, { steps: 20, persistence: 30 }, 3)).toEqual(path);
    // no persistence: a straight line
    const straight = walkPath(source, axis, 8, { steps: 5, persistence: 0 }, 3);
    expect(Vec3.distance(at(straight, 4), Vec3.scaleAndAdd(Vec3(), source.position, along, 40))).toBeLessThan(1e-6);
  });
});

describe('frames', () => {
  it("lifts a list's pose to the scene and brings poses back, as the list's move and scale draw them", () => {
    const move = {
      transform: Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), Vec3.create(100, 0, 0)), Mat4.rotY90),
      scale: 2,
    };
    const scene = poseToScene(move, source);
    const positions = [scene.position[0], scene.position[1], scene.position[2]];
    const rotations = [scene.rotation[0], scene.rotation[1], scene.rotation[2], scene.rotation[3]];
    toListFrame(move, positions, undefined);
    rotationsToListFrame(move, rotations);
    expect(Vec3.distance(at(positions, 0), source.position)).toBeLessThan(1e-9);
    expect(Quat.equals(quat(rotations, 0), turned)).toBe(true);
  });
});
