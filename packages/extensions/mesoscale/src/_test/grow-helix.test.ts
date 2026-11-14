/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { type GrowPose, type GrowSurface, type HelixLine, type HelixParams, helixPath } from '../grow.js';
import { meshAxis, meshSurface } from '../mesh-surface.js';
import { fiberOffsetDirection } from '../paint.js';
import { sphereMesh, tubeMesh } from './fixtures.js';

// Grow › Helix (apps/prism-me/progress/2026-11-13-grow-helix.md, Tests): in space a cylindrical helix about the
// source's Fiber Axis; on a mesh, about an axis through its center, each point brought onto the surface toward it.

const at = (xs: ArrayLike<number>, i: number) => Vec3.create(xs[i * 3], xs[i * 3 + 1], xs[i * 3 + 2]);
const z = Vec3.create(0, 0, 1);

/**
 * A path about a line (`foot`, the source's foot on it; `d`, unit, the way it advances; `e1`, unit, from the foot to
 * the source): each point's height along d, its distance to the line and its angle about d (unwrapped, from e1)
 */
function cylindrical(path: number[], foot: Vec3, d: Vec3, e1: Vec3) {
  const e2 = Vec3.cross(Vec3(), d, e1);
  const out: { h: number; r: number; phi: number }[] = [];
  let before = 0;
  for (let i = 0; i < path.length / 3; ++i) {
    const v = Vec3.sub(Vec3(), at(path, i), foot);
    const h = Vec3.dot(v, d);
    const x = Vec3.dot(v, e1);
    const y = Vec3.dot(v, e2);
    let phi = Math.atan2(y, x);
    while (phi - before > Math.PI) phi -= 2 * Math.PI;
    while (phi - before < -Math.PI) phi += 2 * Math.PI;
    before = phi;
    out.push({ h, r: Math.hypot(x, y), phi });
  }
  return out;
}

/** The sign of (r × t) · d at each point but the last: + for a right-handed helix advancing along d */
function hands(path: number[], foot: Vec3, d: Vec3) {
  const out: number[] = [];
  for (let i = 0; i + 1 < path.length / 3; ++i) {
    const p = at(path, i);
    const v = Vec3.sub(Vec3(), p, foot);
    const r = Vec3.scaleAndAdd(Vec3(), v, d, -Vec3.dot(v, d));
    const t = Vec3.sub(Vec3(), at(path, i + 1), p);
    out.push(Math.sign(Vec3.dot(Vec3.cross(Vec3(), r, t), d)));
  }
  return out;
}

describe('helix in space', () => {
  const rotation = Quat.normalize(Quat(), Quat.create(0.2, -0.4, 0.1, 0.9));
  const source: GrowPose = { position: Vec3.create(5, -3, 2), rotation };
  const p: HelixParams = { pitch: 30, turns: 3, hand: 'right', direction: 'up', radius: 12 };
  const d = Vec3.transformQuat(Vec3(), z, rotation);
  // the source a Radius from the axis: its foot along the turned offset direction of its axis
  const e = Vec3.transformQuat(Vec3(), fiberOffsetDirection(Vec3(), 'auto', z), rotation);
  const foot = Vec3.scaleAndAdd(Vec3(), source.position, e, p.radius);
  const e1 = Vec3.negate(Vec3(), e);

  it('winds on the cylinder of Radius about the Fiber Axis, Pitch a turn, Turns turns, from a rise past the source', () => {
    const path = helixPath(source, z, 4, p);
    const c = cylindrical(path, foot, d, e1);
    for (const { h, r, phi } of c) {
      expect(r).toBeCloseTo(12, 6);
      // the source at angle 0, height 0: every point Pitch higher a turn
      expect(h).toBeCloseTo((p.pitch * phi) / (2 * Math.PI), 6);
    }
    // the first point a rise along the helix from the source (the source on it, not a copy)
    const perRad = Math.hypot(p.radius, p.pitch / (2 * Math.PI));
    expect(c[0].phi * perRad).toBeCloseTo(4, 1);
    expect(c[c.length - 1].phi).toBeCloseTo(2 * Math.PI * 3, 6);
    expect(hands(path, foot, d).every((s) => s === 1)).toBe(true);
    // deterministic
    expect(helixPath(source, z, 4, p)).toEqual(path);
  });

  it('flips its sense with Hand; Direction down goes down the axis, its hand kept', () => {
    const up = helixPath(source, z, 4, p);
    const left = helixPath(source, z, 4, { ...p, hand: 'left' });
    expect(hands(left, foot, d).every((s) => s === -1)).toBe(true);
    const down = helixPath(source, z, 4, { ...p, direction: 'down' });
    const back = Vec3.negate(Vec3(), d);
    expect(hands(down, foot, back).every((s) => s === 1)).toBe(true);
    const [cu, cd] = [cylindrical(up, foot, d, e1), cylindrical(down, foot, d, e1)];
    expect(cd.length).toBe(cu.length);
    for (let i = 0; i < cu.length; ++i) {
      expect(cd[i].h).toBeCloseTo(-cu[i].h, 6);
      expect(cd[i].r).toBeCloseTo(12, 6);
    }
    const leftDown = helixPath(source, z, 4, { ...p, hand: 'left', direction: 'down' });
    expect(hands(leftDown, foot, back).every((s) => s === -1)).toBe(true);
  });
});

describe('helix on a mesh', () => {
  const R = 50;
  // a cylinder of radius 50 along z from −200 to 200, open at both ends
  const tube = meshSurface(tubeMesh(R, R, 400, 128, 80));
  const line: HelixLine = { center: Vec3.create(0, 0, 0), direction: z };
  const source: GrowPose = { position: Vec3.create(R + 3, 0, -150), rotation: Quat.identity() };
  const p: HelixParams = { pitch: 40, turns: 5, hand: 'right', direction: 'up', radius: 0 };
  const foot = Vec3.create(0, 0, -150);
  const x = Vec3.create(1, 0, 0);

  it('winds on a cylinder: every point on it, Pitch along the axis a turn, its normals out', () => {
    const normals: number[] = [];
    const path = helixPath(source, z, 4, p, { surface: tube, reach: 20, line }, normals)!;
    const c = cylindrical(path, foot, z, x);
    for (const { h, r, phi } of c) {
      expect(Math.abs(r - R)).toBeLessThan(0.1);
      expect(h).toBeCloseTo((p.pitch * phi) / (2 * Math.PI), 3);
    }
    expect(c[c.length - 1].phi).toBeCloseTo(2 * Math.PI * 5, 3);
    expect(hands(path, foot, z).every((s) => s === 1)).toBe(true);
    expect(normals.length).toBe(path.length);
    for (let i = 0; i < path.length / 3; ++i) {
      const radial = Vec3.normalize(Vec3(), Vec3.create(path[i * 3], path[i * 3 + 1], 0));
      expect(Vec3.dot(at(normals, i), radial)).toBeGreaterThan(0.99);
    }
  });

  it('ends where the open mesh ends: no point past its rim, none stacked on it', () => {
    const path = helixPath(source, z, 4, { ...p, turns: 20 }, { surface: tube, reach: 20, line })!;
    const c = cylindrical(path, foot, z, x);
    const last = path[path.length - 1];
    expect(last).toBeLessThanOrEqual(200 + 1e-6);
    // it got to the rim: within a step's rise of it (5° of a 40 Å pitch)
    expect(last).toBeGreaterThan(200 - 1);
    for (const { r } of c) expect(Math.abs(r - R)).toBeLessThan(0.1);
    // fewer than 20 turns: 350 Å of 40 a turn
    expect(c[c.length - 1].phi / (2 * Math.PI)).toBeCloseTo(350 / 40, 1);
  });

  it('goes down the axis with Direction down, its hand kept', () => {
    const from: GrowPose = { position: Vec3.create(R, 0, 150), rotation: Quat.identity() };
    const path = helixPath(from, z, 4, { ...p, direction: 'down' }, { surface: tube, reach: 20, line })!;
    const c = cylindrical(path, Vec3.create(0, 0, 150), z, x);
    for (const { h, phi } of c) expect(h).toBeCloseTo((p.pitch * phi) / (2 * Math.PI), 3);
    expect(c[c.length - 1].h).toBeCloseTo(-200, 3);
    expect(hands(path, Vec3.create(0, 0, 150), Vec3.negate(Vec3(), z)).every((s) => s === 1)).toBe(true);
  });

  it("follows a cone's radius", () => {
    // radius 80 at z = −200 to 20 at z = 200
    const cone = meshSurface(tubeMesh(80, 20, 400, 128, 80));
    const radiusAt = (h: number) => 80 - (60 * (h + 200)) / 400;
    const from: GrowPose = { position: Vec3.create(radiusAt(-150), 0, -150), rotation: Quat.identity() };
    const path = helixPath(from, z, 4, p, { surface: cone, reach: 20, line })!;
    expect(path.length / 3).toBeGreaterThan(100);
    for (let i = 0; i < path.length / 3; ++i) {
      const q = at(path, i);
      expect(Math.abs(Math.hypot(q[0], q[1]) - radiusAt(q[2]))).toBeLessThan(0.15);
    }
    // all five turns: 200 Å up
    expect(path[path.length - 1]).toBeCloseTo(50, 1);
  });

  it('spirals over a sphere to its pole and ends there', () => {
    const S = 100;
    const sphere = meshSurface(sphereMesh(S, 4));
    const from: GrowPose = { position: Vec3.create(S, 0, 0), rotation: Quat.identity() };
    const path = helixPath(from, z, 4, { ...p, pitch: 20, turns: 20 }, { surface: sphere, reach: 20, line })!;
    for (let i = 0; i < path.length / 3; ++i) {
      expect(Math.abs(Vec3.magnitude(at(path, i)) - S)).toBeLessThan(0.5);
    }
    // up to the north pole, not past it: some 5 turns of the 20
    const last = at(path, path.length / 3 - 1);
    expect(last[2]).toBeGreaterThan(0.95 * S);
    const c = cylindrical(path, Vec3(), z, x);
    expect(c[c.length - 1].phi / (2 * Math.PI)).toBeLessThan(5.5);
  });

  it('is undefined for a source off the mesh, empty for a source on the axis', () => {
    // its point on the tube, (50, 0, −150), on a line along z through (50, 0, 0)
    const through: HelixLine = { center: Vec3.create(R, 0, 0), direction: z };
    expect(helixPath(source, z, 4, p, { surface: tube, reach: 20, line: through })).toEqual([]);
    const far: GrowPose = { position: Vec3.create(500, 0, 0), rotation: Quat.identity() };
    expect(helixPath(far, z, 4, p, { surface: tube, reach: 20, line })).toBeUndefined();
  });
});

describe('the axis of a mesh', () => {
  it("is through its center: Auto its longest axis (its largest part positive), View the view's, X, Y, Z", () => {
    // a tall tube along z, moved and turned as a shape's instance may be
    const move = Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), Vec3.create(10, 20, 30)), Mat4.rotX90);
    const mesh = tubeMesh(50, 50, 400, 64, 40);
    const auto = meshAxis(mesh, move, 'auto');
    const along = Vec3.transformMat4(Vec3(), z, Mat4.rotX90);
    expect(Math.abs(Vec3.dot(auto.direction, along))).toBeCloseTo(1, 4);
    expect(Math.max(...auto.direction)).toBeGreaterThan(Math.max(...auto.direction.map((v) => -v)));
    expect(Vec3.distance(auto.center, Vec3.create(10, 20, 30))).toBeLessThan(1);
    expect(meshAxis(mesh, move, 'x').direction).toEqual(Vec3.create(1, 0, 0));
    expect(meshAxis(mesh, move, 'z').direction).toEqual(Vec3.create(0, 0, 1));
    const view = meshAxis(mesh, move, 'view', Vec3.create(0, 3, 4));
    expect(Vec3.distance(view.direction, Vec3.create(0, 0.6, 0.8))).toBeLessThan(1e-6);
    expect(Vec3.distance(view.center, auto.center)).toBe(0);
  });
});

/** A cylinder of radius `r` about z as a surface, exactly (no mesh: a long helix without the cost of its picks) */
function cylinderSurface(r: number): GrowSurface {
  return {
    project(out, p) {
      const m = Math.hypot(p[0], p[1]);
      if (!(m > 0)) return false;
      Vec3.set(out.normal, p[0] / m, p[1] / m, 0);
      Vec3.set(out.position, out.normal[0] * r, out.normal[1] * r, p[2]);
      return true;
    },
    triangles: () => ({ positions: [], normals: [] }),
  };
}

describe('a long helix on a surface (review M1)', () => {
  it('keeps its normals for 1000 turns (no argument list of them) and stops at a length limit', () => {
    const on = { surface: cylinderSurface(50), reach: 20, line: { center: Vec3(), direction: z } };
    const source: GrowPose = { position: Vec3.create(50, 0, 0), rotation: Quat.identity() };
    const p: HelixParams = { pitch: 1, turns: 1000, hand: 'right', direction: 'up', radius: 0 };
    const normals: number[] = [];
    const path = helixPath(source, z, 100, p, on, normals)!;
    // 72000 points of 5° less the first rise's (some 23)
    expect(path.length / 3).toBeGreaterThan(71950);
    expect(normals.length).toBe(path.length);
    // a limit: the path no longer than it (and a step), however many turns
    const short = helixPath(source, z, 100, { ...p, limit: 1000 }, on)!;
    let length = 0;
    for (let i = 1; i < short.length / 3; ++i) length += Vec3.distance(at(short, i), at(short, i - 1));
    expect(length).toBeGreaterThan(1000 - 100);
    expect(length).toBeLessThan(1000 + 5);
  });
});
