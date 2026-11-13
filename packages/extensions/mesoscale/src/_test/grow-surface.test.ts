/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { type GrowPose, spherePoses, tilingPoses, walkPath } from '../grow.js';
import { meshSurface } from '../mesh-surface.js';
import { flatMesh, sphereMesh } from './fixtures.js';

// Grow on a mesh (progress/2026-11-13-grow-mesh.md, Tests): Tiling, Random walk and Sphere on a surface, each copy on
// it and its axis along the surface's normal.

const at = (xs: ArrayLike<number>, i: number) => Vec3.create(xs[i * 3], xs[i * 3 + 1], xs[i * 3 + 2]);
const quat = (qs: number[], i: number) => Quat.create(qs[i * 4], qs[i * 4 + 1], qs[i * 4 + 2], qs[i * 4 + 3]);
const z = Vec3.create(0, 0, 1);
/** A copy's axis (`axis` in its frame) in the scene */
const axisOf = (qs: number[], i: number, axis = z) => Vec3.transformQuat(Vec3(), axis, quat(qs, i));

/** A vesicle: radius 100 Å, its faces within 0.2 % of it (detail 4) */
const R = 100;
const vesicle = meshSurface(sphereMesh(R, 4));
const OnSphere = R * 0.997;
/** The source at its north pole, upright (+z out) */
const north: GrowPose = { position: Vec3.create(0, 0, R), rotation: Quat.identity() };

function nearestDistances(points: Vec3[]) {
  return points.map((p, i) => {
    let d = Infinity;
    for (let j = 0; j < points.length; ++j) if (j !== i) d = Math.min(d, Vec3.distance(p, points[j]));
    return d;
  });
}

describe('tiling on a mesh', () => {
  it('fills a vesicle: every copy on it, none closer than 0.8 × Spacing, each upright along its normal', () => {
    const s = 10;
    const out = tilingPoses(
      north,
      z,
      { pattern: 'hex', spacing: s, rings: 3, count: 20000 },
      {
        surface: vesicle,
        reach: 20,
      },
    )!;
    const k = out.positions.length / 3;
    const points = [north.position, ...Array.from({ length: k }, (_, i) => at(out.positions, i))];
    for (const p of points) {
      expect(Vec3.magnitude(p)).toBeGreaterThan(OnSphere);
      expect(Vec3.magnitude(p)).toBeLessThanOrEqual(R + 1e-3);
    }
    const nearest = nearestDistances(points);
    for (const d of nearest) expect(d).toBeGreaterThanOrEqual(0.8 * s - 1e-6);
    const sorted = [...nearest].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(1.1 * s);
    // the sphere full: about its area in hexagons of the spacing (4πr² / (√3/2 · s²) ≈ 1451)
    const hexagons = (4 * Math.PI * R * R) / ((Math.sqrt(3) / 2) * s * s);
    expect(points.length).toBeGreaterThan(0.85 * hexagons);
    expect(points.length).toBeLessThan(1.3 * hexagons);
    // no hole: every point of the sphere within a spacing of a copy
    for (let i = 0; i < 200; ++i) {
      const u = Vec3.normalize(Vec3(), Vec3.create(Math.sin(i * 1.7), Math.cos(i * 2.3), Math.sin(i * 0.9 + 1)));
      const p = Vec3.scale(u, u, R);
      expect(Math.min(...points.map((q) => Vec3.distance(p, q)))).toBeLessThan(s);
    }
    for (let i = 0; i < k; ++i) {
      const radial = Vec3.normalize(Vec3(), at(out.positions, i));
      expect(Vec3.dot(axisOf(out.rotations, i), radial)).toBeGreaterThan(0.999);
    }
  });

  it('stops at Count (the source counted), ring by ring; its axis along the normal from a tilted source', () => {
    // the source's axis (its principal axis, x) tilted 30° off the normal: its copies' along theirs
    const tilted = Quat.setAxisAngle(Quat(), Vec3.create(1, 1, 0), Math.PI / 6);
    const axis = Vec3.create(1, 0, 0);
    const rotation = Quat.multiply(Quat(), tilted, Quat.rotationTo(Quat(), axis, z));
    const out = tilingPoses(
      { position: north.position, rotation },
      axis,
      { pattern: 'hex', spacing: 10, rings: 3 },
      {
        surface: vesicle,
        reach: 20,
      },
    )!;
    // Count unset: the plane's 1 + 3r(r+1)
    expect(out.positions.length / 3).toBe(36);
    for (let i = 0; i < 36; ++i) {
      const radial = Vec3.normalize(Vec3(), at(out.positions, i));
      expect(Vec3.dot(axisOf(out.rotations, i, axis), radial)).toBeGreaterThan(0.999);
      // the first ring first: within a spacing and a bit of the source, the rest further
      if (i < 6) expect(Vec3.distance(at(out.positions, i), north.position)).toBeLessThan(10.5);
    }
    const ten = tilingPoses(
      north,
      z,
      { pattern: 'square', spacing: 10, rings: 3, count: 11 },
      {
        surface: vesicle,
        reach: 20,
      },
    )!;
    expect(ten.positions.length / 3).toBe(10);
  });

  it("equals the plane's tiling on a flat mesh, Hex and Square", () => {
    const plane = meshSurface(flatMesh(40, 5));
    const source: GrowPose = {
      position: Vec3.create(3, -2, 0),
      rotation: Quat.setAxisAngle(Quat(), z, 0.4),
    };
    for (const pattern of ['hex', 'square'] as const) {
      const p = { pattern, spacing: 10, rings: 3 };
      const flat = tilingPoses(source, z, p);
      const on = tilingPoses(source, z, p, { surface: plane, reach: 10 })!;
      expect(on.positions.length).toBe(flat!.positions.length);
      for (let i = 0; i < on.positions.length / 3; ++i) {
        const q = at(on.positions, i);
        let best = Infinity;
        for (let j = 0; j < flat!.positions.length / 3; ++j)
          best = Math.min(best, Vec3.distance(q, at(flat!.positions, j)));
        expect(best).toBeLessThan(1e-3);
        expect(Quat.equals(quat(on.rotations, i), source.rotation)).toBe(true);
      }
    }
  });

  it('is undefined for a source off the mesh', () => {
    const far: GrowPose = { position: Vec3.create(0, 0, 300), rotation: Quat.identity() };
    expect(tilingPoses(far, z, { pattern: 'hex', spacing: 10, rings: 1 }, { surface: vesicle, reach: 20 })).toBe(
      undefined,
    );
  });
});
