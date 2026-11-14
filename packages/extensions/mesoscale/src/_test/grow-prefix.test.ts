/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import {
  crystalPoses,
  type GrowPose,
  type HelixParams,
  helixPath,
  spherePoses,
  spiralPath,
  tilingPoses,
  walkPath,
} from '../grow.js';
import { meshSurface } from '../mesh-surface.js';
import { makeFiber } from '../paint.js';
import { flatMesh, sphereMesh, tubeMesh } from './fixtures.js';

// The count of a grow is prefix-stable (grow-helix round 2, Ludo 2026-11-13: "more will continue the distribution,
// less will remove the excedent copies"): its rule grown with more (Steps, Turns, Rings, Count) keeps the first ones
// bit for bit and adds the next ones; with fewer, it is the first ones. Crystal's cells are nested sets.

const z = Vec3.create(0, 0, 1);
const turned = Quat.setAxisAngle(Quat(), Vec3.normalize(Vec3(), Vec3.create(1, 2, 3)), 0.7);
const source: GrowPose = { position: Vec3.create(10, -5, 3), rotation: turned };

/** `few` is the first part of `many`, bit for bit, and `many` is longer */
function prefix(few: ArrayLike<number>, many: ArrayLike<number>) {
  expect(many.length).toBeGreaterThan(few.length);
  expect(few.length).toBeGreaterThan(0);
  expect(Array.from(many).slice(0, few.length)).toEqual(Array.from(few));
}

const fiber = { rise: 6, twist: 20, jitter: 10 };

describe('a grow continues with more and is cut with fewer', () => {
  it('Random walk: Steps, in space and on a mesh', () => {
    prefix(
      walkPath(source, z, 8, { steps: 10, persistence: 30 }, 3),
      walkPath(source, z, 8, { steps: 25, persistence: 30 }, 3),
    );
    const ball = { surface: meshSurface(sphereMesh(100, 4)), reach: 20 };
    const north: GrowPose = { position: Vec3.create(0, 0, 100), rotation: Quat.identity() };
    const [n1, n2]: number[][] = [[], []];
    const a = walkPath(north, z, 8, { steps: 10, persistence: 30 }, 3, ball, n1)!;
    const b = walkPath(north, z, 8, { steps: 25, persistence: 30 }, 3, ball, n2)!;
    prefix(a, b);
    prefix(n1, n2);
  });

  it("Helix: Turns, its path and its fiber's units (their positions; turns but the last's, turned to the next)", () => {
    const p: HelixParams = { pitch: 30, turns: 2, hand: 'right', direction: 'up', radius: 12 };
    const few = helixPath(source, z, 4, p);
    const many = helixPath(source, z, 4, { ...p, turns: 3.5 });
    prefix(few, many);
    const fewer = helixPath(source, z, 4, { ...p, turns: 1.25 });
    prefix(fewer, few);
    const settings = { ...fiber, axis: 'auto' as const };
    const [u1, u2] = [makeFiber(few, settings, z, 5), makeFiber(many, settings, z, 5)];
    prefix(u1.positions, u2.positions);
    prefix(u1.rotations.slice(0, -4), u2.rotations);
    // on a mesh, normals too
    const on = {
      surface: meshSurface(tubeMesh(50, 50, 400, 128, 80)),
      reach: 20,
      line: { center: Vec3(), direction: z },
    };
    const from: GrowPose = { position: Vec3.create(50, 0, -150), rotation: Quat.identity() };
    const [n1, n2]: number[][] = [[], []];
    const a = helixPath(from, z, 4, { ...p, pitch: 40 }, on, n1)!;
    const b = helixPath(from, z, 4, { ...p, pitch: 40, turns: 3.5 }, on, n2)!;
    prefix(a, b);
    prefix(n1, n2);
  });

  it("Spiral: Count, its fiber's units (positions, turns but the last's) and its normals, in space and on a mesh", () => {
    const settings = { ...fiber, rise: 5, axis: 'auto' as const };
    const p = { spacing: 20, step: 5, hand: 'right' as const };
    const [a, b] = [spiralPath(source, z, { ...p, count: 30 }), spiralPath(source, z, { ...p, count: 70 })];
    const [u1, u2] = [makeFiber(a, settings, z, 5), makeFiber(b, settings, z, 5)];
    prefix(u1.positions, u2.positions);
    prefix(u1.rotations.slice(0, -4), u2.rotations);
    const on = { surface: meshSurface(flatMesh(60, 10)), reach: 10 };
    const center: GrowPose = { position: Vec3.create(0, 0, 0), rotation: Quat.identity() };
    const [n1, n2]: number[][] = [[], []];
    const c = spiralPath(center, z, { ...p, count: 30 }, on, n1)!;
    const d = spiralPath(center, z, { ...p, count: 70 }, on, n2)!;
    const [v1, v2] = [makeFiber(c, settings, z, 5, n1), makeFiber(d, settings, z, 5, n2)];
    prefix(v1.positions, v2.positions);
    prefix(v1.rotations.slice(0, -4), v2.rotations);
  });

  it('Tiling: Rings on a plane, Count on a mesh', () => {
    const t = (rings: number) => tilingPoses(source, z, { pattern: 'hex', spacing: 10, rings });
    prefix(t(2).positions, t(4).positions);
    prefix(t(2).rotations, t(4).rotations);
    const sq = (rings: number) => tilingPoses(source, z, { pattern: 'square', spacing: 10, rings });
    prefix(sq(1).positions, sq(3).positions);
    const on = { surface: meshSurface(sphereMesh(100, 4)), reach: 20, axis: z };
    const north: GrowPose = { position: Vec3.create(0, 0, 100), rotation: Quat.identity() };
    const m = (count: number) => tilingPoses(north, z, { pattern: 'hex', spacing: 10, rings: 3, count }, on)!;
    prefix(m(20).positions, m(90).positions);
    prefix(m(20).rotations, m(90).rotations);
  });

  it('Sphere: Count, in space and on a mesh', () => {
    const s = (count: number) => spherePoses(source, { count, radius: 30, turn: 'random' }, 7);
    prefix(s(10).positions, s(40).positions);
    prefix(s(10).rotations, s(40).rotations);
    const on = { surface: meshSurface(sphereMesh(100, 4)), reach: 20, axis: z };
    const north: GrowPose = { position: Vec3.create(0, 0, 100), rotation: Quat.identity() };
    const m = (count: number) => spherePoses(north, { count, radius: 30, turn: 'random' }, 7, on)!;
    prefix(m(10).positions, m(40).positions);
    prefix(m(10).rotations, m(40).rotations);
  });

  it("Crystal: a cell more along a, b or c keeps every cell's copy where it was", () => {
    const cell = { a: 10, b: 12, c: 14, alpha: 90, beta: 90, gamma: 90 };
    const key = (ps: number[], i: number) => ps.slice(i * 3, i * 3 + 3).join(' ');
    const set = (ps: number[]) => new Set(Array.from({ length: ps.length / 3 }, (_, i) => key(ps, i)));
    const few = set(crystalPoses(source, { ...cell, na: 2, nb: 3, nc: 1 })!.positions);
    for (const more of [
      { na: 3, nb: 3, nc: 1 },
      { na: 2, nb: 4, nc: 2 },
    ]) {
      const many = set(crystalPoses(source, { ...cell, ...more })!.positions);
      for (const p of few) expect(many.has(p)).toBe(true);
    }
  });
});
