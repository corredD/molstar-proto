/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { GrowPose, GrowPoses, GrowSurface, SurfaceHit } from '../grow.js';
import {
  type SymmetryGroup,
  symmetryContact,
  symmetryOperators,
  symmetryPoses,
  symmetryPosition,
} from '../grow-symmetry.js';

// Grow › Symmetry (progress/2026-11-13-symmetry.md): the point groups' operators and the copies' poses.

const orders: [SymmetryGroup, number, number][] = [
  ['c', 2, 2],
  ['c', 6, 6],
  ['c', 60, 60],
  ['d', 2, 4],
  ['d', 7, 14],
  ['d', 60, 120],
  ['t', 1, 12],
  ['o', 1, 24],
  ['i', 1, 60],
];

/** q and −q are the same turn */
const same = (a: Quat, b: Quat) => Math.abs(Quat.dot(a, b)) > 1 - 1e-9;

const pos = (p: GrowPoses, i: number) => Vec3.fromArray(Vec3(), p.positions, i * 3);
const rot = (p: GrowPoses, i: number) => Quat.fromArray(Quat(), p.rotations, i * 4);

/** The source and its copies' positions */
function points(source: GrowPose, made: GrowPoses) {
  const out = [Vec3.clone(source.position)];
  for (let i = 0; i < made.positions.length / 3; ++i) out.push(pos(made, i));
  return out;
}

/** The sorted distances from point i to the others */
function distancesFrom(ps: Vec3[], i: number) {
  return ps
    .filter((_, j) => j !== i)
    .map((p) => Vec3.distance(p, ps[i]))
    .sort((a, b) => a - b);
}

/** A source somewhere, turned somehow */
const source: GrowPose = {
  position: Vec3.create(12, -7, 30),
  rotation: Quat.normalize(Quat(), Quat.create(0.3, -0.5, 0.2, 0.8)),
};
const up = Vec3.create(0, 0, 1);

describe('symmetryOperators', () => {
  it.each(orders)('%s%i has %i operators, the identity first, all distinct', (group, n, order) => {
    const ops = symmetryOperators(group, n);
    expect(ops.length).toBe(order);
    expect(same(ops[0], Quat.identity())).toBe(true);
    for (let i = 0; i < ops.length; ++i) {
      for (let j = i + 1; j < ops.length; ++j) expect(same(ops[i], ops[j])).toBe(false);
    }
  });

  it.each(orders)('%s%i is closed: every product is one of them', (group, n) => {
    const ops = symmetryOperators(group, n);
    const ab = Quat();
    for (const a of ops) {
      for (const b of ops) {
        Quat.multiply(ab, a, b);
        expect(ops.some((g) => same(g, ab))).toBe(true);
      }
    }
  });

  it("Cn turns about z only; Dn's others are 2-folds in the xy plane", () => {
    const axis = Vec3();
    for (const g of symmetryOperators('c', 7)) {
      if (same(g, Quat.identity())) continue;
      Quat.getAxisAngle(axis, g);
      expect(Math.abs(axis[2])).toBeCloseTo(1, 9);
    }
    const twofolds = symmetryOperators('d', 7).filter((g) => Math.abs(g[3]) < 1e-9);
    // C7 has no 2-fold (odd): the seven of D7 are the xy plane's
    expect(twofolds.length).toBe(7);
    for (const g of twofolds) expect(Math.abs(g[2])).toBeLessThan(1e-9);
  });
});

describe('symmetryPosition', () => {
  it.each(orders)("%s%i's general position is on none of its axes: |G| points apart", (group, n, order) => {
    const u = symmetryPosition(group, n);
    expect(Vec3.magnitude(u)).toBeCloseTo(1, 12);
    const seen = symmetryOperators(group, n).map((g) => Vec3.transformQuat(Vec3(), u, g));
    for (let i = 0; i < order; ++i) {
      for (let j = i + 1; j < order; ++j) expect(Vec3.distance(seen[i], seen[j])).toBeGreaterThan(0.05);
    }
    // the nearest two of its points apart by the contact distance
    let min = Infinity;
    for (let i = 0; i < order; ++i)
      for (let j = i + 1; j < order; ++j) min = Math.min(min, Vec3.distance(seen[i], seen[j]));
    expect(symmetryContact(group, n)).toBeCloseTo(min, 12);
  });

  it('Cn: on the equator; Dn: off it (two rings, a barrel)', () => {
    expect(symmetryPosition('c', 6)[2]).toBe(0);
    expect(symmetryPosition('d', 7)[2]).toBeGreaterThan(0.3);
  });

  it('T and O: the copies spread over the sphere (review M1: not trimers about a 3-fold)', () => {
    // the best spreads are about 1.05 (T) and 0.74 (O)
    expect(symmetryContact('t', 1)).toBeGreaterThan(0.6);
    expect(symmetryContact('o', 1)).toBeGreaterThan(0.6);
  });
});

describe('symmetryPoses', () => {
  const radius = 50;
  const p = (group: SymmetryGroup, n = 1) => ({ group, n, radius, side: 'inside' as const });

  it.each(orders)('%s%i: |G| − 1 copies, the source not among them, all on a sphere of Radius', (group, n, order) => {
    const made = symmetryPoses(source, up, p(group, n))!;
    expect(made.positions.length / 3).toBe(order - 1);
    expect(made.rotations.length / 4).toBe(order - 1);
    // the center a Radius from the source, toward the inside: against its axis (+z turned by it)
    const a = Vec3.transformQuat(Vec3(), up, source.rotation);
    const center = Vec3.scaleAndAdd(Vec3(), source.position, a, -radius);
    for (const x of points(source, made)) expect(Vec3.distance(x, center)).toBeCloseTo(radius, 9);
    for (let i = 0; i < order - 1; ++i) expect(Vec3.distance(pos(made, i), source.position)).toBeGreaterThan(1);
  });

  it.each(orders)(
    "%s%i's copies are as the group's: the distances from each the same as from the source",
    (group, n) => {
      const ps = points(source, symmetryPoses(source, up, p(group, n))!);
      const from0 = distancesFrom(ps, 0);
      for (let i = 1; i < ps.length; ++i) {
        const d = distancesFrom(ps, i);
        for (let k = 0; k < d.length; ++k) expect(d[k]).toBeCloseTo(from0[k], 8);
      }
      // the nearest two at the group's contact distance times Radius
      expect(from0[0]).toBeCloseTo(symmetryContact(group, n) * radius, 8);
    },
  );

  it("each copy is the source's pose turned by an operator about the center (exact orientations)", () => {
    const made = symmetryPoses(source, up, p('i'))!;
    const a = Vec3.transformQuat(Vec3(), up, source.rotation);
    const center = Vec3.scaleAndAdd(Vec3(), source.position, a, -radius);
    const r = Vec3.sub(Vec3(), source.position, center);
    const back = Quat.invert(Quat(), source.rotation);
    for (let i = 0; i < 59; ++i) {
      // the turn of copy i from the source's, applied to the source about the center, gives its position
      const w = Quat.multiply(Quat(), rot(made, i), back);
      const x = Vec3.add(Vec3(), center, Vec3.transformQuat(Vec3(), r, w));
      expect(Vec3.distance(x, pos(made, i))).toBeLessThan(1e-9);
    }
  });

  it('Side outside: the center along the axis', () => {
    const made = symmetryPoses(source, up, { ...p('c', 6), side: 'outside' })!;
    const a = Vec3.transformQuat(Vec3(), up, source.rotation);
    const center = Vec3.scaleAndAdd(Vec3(), source.position, a, radius);
    for (const x of points(source, made)) expect(Vec3.distance(x, center)).toBeCloseTo(radius, 9);
  });

  it('Cn about a chosen axis: a ring in the plane across it, its center on it', () => {
    // the source's axis +x in the scene: the center 50 Å toward −x; the ring's axis z
    const flat: GrowPose = {
      position: Vec3.create(50, 0, 0),
      rotation: Quat.rotationTo(Quat(), up, Vec3.create(1, 0, 0)),
    };
    const made = symmetryPoses(flat, up, p('c', 6), Vec3.create(0, 0, 1))!;
    const ps = points(flat, made);
    const mean = Vec3();
    for (const x of ps) {
      expect(x[2]).toBeCloseTo(0, 9);
      Vec3.add(mean, mean, x);
    }
    Vec3.scale(mean, mean, 1 / ps.length);
    expect(Vec3.magnitude(mean)).toBeCloseTo(0, 9);
    // neighbours 60° apart: a side of Radius
    expect(distancesFrom(ps, 0)[0]).toBeCloseTo(50, 9);
  });

  it('Cn Auto: the axis across the source’s, so the ring passes through it', () => {
    const made = symmetryPoses(source, up, p('c', 6))!;
    const ps = points(source, made);
    const a = Vec3.transformQuat(Vec3(), up, source.rotation);
    const center = Vec3.scaleAndAdd(Vec3(), source.position, a, -radius);
    // the ring's normal: across two radii; the source's axis in the ring's plane
    const n = Vec3.normalize(
      Vec3(),
      Vec3.cross(Vec3(), Vec3.sub(Vec3(), ps[1], center), Vec3.sub(Vec3(), ps[2], center)),
    );
    expect(Vec3.dot(n, a)).toBeCloseTo(0, 9);
    for (const x of ps) expect(Vec3.dot(Vec3.sub(Vec3(), x, center), n)).toBeCloseTo(0, 9);
  });

  it('Dn: two rings at ± a height along its axis, Auto and about a chosen axis', () => {
    // Auto puts the source off the equator: a barrel
    const made = symmetryPoses(source, up, p('d', 7))!;
    const ps = points(source, made);
    const a = Vec3.transformQuat(Vec3(), up, source.rotation);
    const center = Vec3.scaleAndAdd(Vec3(), source.position, a, -radius);
    const heights = new Set<number>();
    // the principal axis: the mean of the upper ring's directions
    const axis = Vec3();
    for (let i = 0; i < 7; ++i) Vec3.add(axis, axis, Vec3.sub(Vec3(), ps[i], center));
    Vec3.normalize(axis, axis);
    for (const x of ps) heights.add(Math.round(Vec3.dot(Vec3.sub(Vec3(), x, center), axis) * 1e6) / 1e6);
    expect(heights.size).toBe(2);
    const [h1, h2] = [...heights];
    expect(h1).toBeCloseTo(-h2, 6);
    expect(Math.abs(h1)).toBeGreaterThan(0.3 * radius);
    // about a chosen axis (z), a source off its equator: two rings of 7 at ± its height along z (review S4)
    const t = Vec3.normalize(Vec3(), Vec3.create(1, 0, 0.5));
    const tilted: GrowPose = { position: Vec3.scale(Vec3(), t, radius), rotation: Quat.rotationTo(Quat(), up, t) };
    const about = points(tilted, symmetryPoses(tilted, up, p('d', 7), Vec3.create(0, 0, 1))!);
    expect(about.length).toBe(14);
    // the center at 0: the source a Radius along its axis from it
    const zs = about.map((x) => Math.round(x[2] * 1e6) / 1e6).sort((x, y) => x - y);
    expect(new Set(zs).size).toBe(2);
    expect(zs[0]).toBeCloseTo(-radius * t[2], 6);
    expect(zs[13]).toBeCloseTo(radius * t[2], 6);
    // each ring about z: its points a ring's radius from the axis
    for (const x of about) expect(Math.hypot(x[0], x[1])).toBeCloseTo(radius * t[0], 6);
  });

  it.each(orders)(
    '%s%i about a chosen axis across the source: grown, its copies apart (review NEW-1)',
    (group, n, order) => {
      const flat: GrowPose = {
        position: Vec3.create(50, 0, 0),
        rotation: Quat.rotationTo(Quat(), up, Vec3.create(1, 0, 0)),
      };
      for (const axis of [Vec3.create(0, 0, 1), Vec3.create(0, 1, 0)]) {
        const made = symmetryPoses(flat, up, p(group, n), axis);
        expect(made?.positions.length).toBe(3 * (order - 1));
        expect(distancesFrom(points(flat, made!), 0)[0]).toBeGreaterThan(1);
      }
    },
  );

  it('refuses a source on the principal axis (its copies would coincide)', () => {
    const along: GrowPose = { position: Vec3.create(0, 0, 50), rotation: Quat.identity() };
    expect(symmetryPoses(along, up, p('c', 6), Vec3.create(0, 0, 1))).toBeUndefined();
  });

  it('turns with the source: the same assembly turned (equivariance)', () => {
    const made = symmetryPoses(source, up, p('o'))!;
    const spin = Quat.setAxisAngle(Quat(), Vec3.normalize(Vec3(), Vec3.create(1, 2, 3)), 0.7);
    const turned: GrowPose = {
      position: Vec3.transformQuat(Vec3(), source.position, spin),
      rotation: Quat.multiply(Quat(), spin, source.rotation),
    };
    const again = symmetryPoses(turned, up, p('o'))!;
    for (let i = 0; i < 23; ++i) {
      expect(Vec3.distance(pos(again, i), Vec3.transformQuat(Vec3(), pos(made, i), spin))).toBeLessThan(1e-9);
      expect(same(rot(again, i), Quat.multiply(Quat(), spin, rot(made, i)))).toBe(true);
    }
  });

  it('I from a source 1CRN-sized: 59 copies apart by more than its diameter at the default (touching) Radius', () => {
    const diameter = 30;
    const r = diameter / symmetryContact('i', 1);
    const ps = points(source, symmetryPoses(source, up, { ...p('i'), radius: r })!);
    expect(ps.length).toBe(60);
    let min = Infinity;
    for (let i = 0; i < 60; ++i) for (let j = i + 1; j < 60; ++j) min = Math.min(min, Vec3.distance(ps[i], ps[j]));
    expect(min).toBeCloseTo(diameter, 9);
  });

  it('Snap on a surface: each copy projected along its line from the center, turned to the normal', () => {
    // a sphere of 40 Å about the center: copies at Radius 50 come in to 40, their axis along its outward normal
    const center = Vec3.scaleAndAdd(Vec3(), source.position, Vec3.transformQuat(Vec3(), up, source.rotation), -radius);
    const surface: GrowSurface = {
      project(out: SurfaceHit, x: Vec3) {
        const d = Vec3.normalize(Vec3(), Vec3.sub(Vec3(), x, center));
        Vec3.scaleAndAdd(out.position, center, d, 40);
        Vec3.copy(out.normal, d);
        return true;
      },
      triangles: () => ({ positions: [], normals: [] }),
    };
    const made = symmetryPoses(source, up, p('t'), undefined, { surface, reach: 60, axis: up })!;
    for (let i = 0; i < 11; ++i) {
      const x = pos(made, i);
      expect(Vec3.distance(x, center)).toBeCloseTo(40, 9);
      const a = Vec3.transformQuat(Vec3(), up, rot(made, i));
      const n = Vec3.normalize(Vec3(), Vec3.sub(Vec3(), x, center));
      expect(Vec3.dot(a, n)).toBeCloseTo(1, 9);
    }
  });

  it("Snap: a copy with no surface within reach stays exact; a normal the other way is turned to the copy's side", () => {
    const center = Vec3.scaleAndAdd(Vec3(), source.position, Vec3.transformQuat(Vec3(), up, source.rotation), -radius);
    const exact = symmetryPoses(source, up, p('t'))!;
    // a surface that never hits: the copies exact
    const none: GrowSurface = { project: () => false, triangles: () => ({ positions: [], normals: [] }) };
    expect(symmetryPoses(source, up, p('t'), undefined, { surface: none, reach: 60, axis: up })).toEqual(exact);
    // a sphere of 40 Å wound inward (its normals toward the center): the copies' axes still outward
    const inward: GrowSurface = {
      project(out: SurfaceHit, x: Vec3) {
        const d = Vec3.normalize(Vec3(), Vec3.sub(Vec3(), x, center));
        Vec3.scaleAndAdd(out.position, center, d, 40);
        Vec3.negate(out.normal, d);
        return true;
      },
      triangles: () => ({ positions: [], normals: [] }),
    };
    const made = symmetryPoses(source, up, p('t'), undefined, { surface: inward, reach: 60, axis: up })!;
    for (let i = 0; i < 11; ++i) {
      const n = Vec3.normalize(Vec3(), Vec3.sub(Vec3(), pos(made, i), center));
      expect(Vec3.dot(Vec3.transformQuat(Vec3(), up, rot(made, i)), n)).toBeCloseTo(1, 9);
    }
  });
});
