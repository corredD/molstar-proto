/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { slicePlane } from '../fit.js';
import { SurfaceHit } from '../grow.js';
import { planeSurface } from '../slice-surface.js';
import { gridOf } from './density.js';

// A slice as a surface (slice-constraint, Ludo 2026-11-14): its plane, bounded by the volume's box (its voxels' centers:
// a 10 × 20 × 30 grid of 2 Å from (5, −3, 2) spans x 5–23, y −3–35, z 2–60). A point projected onto it along a line or
// straight; none outside the box or beyond the reach; its normal the plane's; its triangles the plane inside the box.

const grid = gridOf(
  Tensor.Space([10, 20, 30], [2, 1, 0], Float32Array),
  new Float32Array(6000),
  Vec3.create(5, -3, 2),
  2,
);
const zero = Vec3();

/** The area and the farthest a vertex is off the plane and outside the box (Å) of triangles */
function measure(t: { positions: ArrayLike<number> }, point: Vec3, normal: Vec3) {
  let area = 0;
  let off = 0;
  let outside = 0;
  const v = t.positions;
  const [a, b, c] = [Vec3(), Vec3(), Vec3()];
  for (let i = 0; i < v.length; i += 9) {
    Vec3.fromArray(a, v, i);
    Vec3.fromArray(b, v, i + 3);
    Vec3.fromArray(c, v, i + 6);
    area += 0.5 * Vec3.magnitude(Vec3.cross(Vec3(), Vec3.sub(Vec3(), b, a), Vec3.sub(Vec3(), c, a)));
    for (const p of [a, b, c]) {
      off = Math.max(off, Math.abs(Vec3.dot(Vec3.sub(Vec3(), p, point), normal)));
      outside = Math.max(outside, 5 - p[0], p[0] - 23, -3 - p[1], p[1] - 35, 2 - p[2], p[2] - 60);
    }
  }
  return { area, off, outside };
}

describe('a slice as a surface', () => {
  const z = slicePlane(grid, { mode: 'grid', dimension: { name: 'z', params: 12 } })!;
  const surface = planeSurface(z, grid);

  it('projects a point onto the plane straight or along a line, within the reach; its normal the plane’s', () => {
    const hit = SurfaceHit();
    expect(surface.project(hit, Vec3.create(10, 10, 30), zero, 5)).toBe(true);
    expect(Array.from(hit.position)).toEqual([10, 10, 26]);
    expect(Array.from(hit.normal)).toEqual([0, 0, 1]);
    expect(surface.project(hit, Vec3.create(10, 10, 30), zero, 3)).toBe(false);
    // along a line at 45°: 4 Å along x too, 5.7 Å away
    const along = Vec3.normalize(Vec3(), Vec3.create(1, 0, 1));
    expect(surface.project(hit, Vec3.create(10, 10, 30), along, 6)).toBe(true);
    expect(Vec3.distance(hit.position, Vec3.create(6, 10, 26))).toBeLessThan(1e-6);
    // the line's point beyond the reach: the nearest point (`GrowSurface.project`)
    expect(surface.project(hit, Vec3.create(10, 10, 30), along, 5)).toBe(true);
    expect(Array.from(hit.position)).toEqual([10, 10, 26]);
    // a line along the plane meets it nowhere: the nearest point
    expect(surface.project(hit, Vec3.create(10, 10, 27), Vec3.create(1, 0, 0), 2)).toBe(true);
    expect(Array.from(hit.position)).toEqual([10, 10, 26]);
  });

  it('ends where the volume’s box does', () => {
    const hit = SurfaceHit();
    expect(surface.project(hit, Vec3.create(23, 35, 27), zero, 2)).toBe(true);
    expect(surface.project(hit, Vec3.create(23.5, 10, 27), zero, 2)).toBe(false);
    expect(surface.project(hit, Vec3.create(10, -4, 27), zero, 2)).toBe(false);
    // a line meeting the plane outside the box, its point's foot inside: the foot (review 7)
    const along = Vec3.normalize(Vec3(), Vec3.create(-1, 0, -1));
    expect(surface.project(hit, Vec3.create(5.5, 10, 27), along, 2)).toBe(true);
    expect(Array.from(hit.position)).toEqual([5.5, 10, 26]);
    // a slice outside the box along its normal: none of it
    const out = planeSurface({ point: Vec3.create(0, 0, 70), normal: Vec3.create(0, 0, 1) }, grid);
    expect(out.project(hit, Vec3.create(10, 10, 70), zero, 2)).toBe(false);
  });

  it('an oblique slice (plane mode): its point and normal, bounded by the box', () => {
    const n = Vec3.normalize(Vec3(), Vec3.create(1, 1, 1));
    const center = Vec3.create(14, 16, 31);
    const oblique = planeSurface(slicePlane(grid, { mode: 'plane', plane: { point: center, normal: n } })!, grid);
    const hit = SurfaceHit();
    expect(oblique.project(hit, Vec3.scaleAndAdd(Vec3(), center, n, 3), zero, 4)).toBe(true);
    expect(Vec3.distance(hit.position, center)).toBeLessThan(1e-6);
    expect(Math.abs(Vec3.dot(hit.normal, n))).toBeCloseTo(1, 10);
    // on the plane, far along it: outside the box
    const t = Vec3.normalize(Vec3(), Vec3.create(1, -1, 0));
    expect(oblique.project(hit, Vec3.scaleAndAdd(Vec3(), center, t, 30), zero, 1)).toBe(false);
    // its triangles: on the plane, inside the box, the box's section (a hexagon) within the ball
    const tri = oblique.triangles(center, 200);
    const m = measure(tri, center, n);
    expect(m.area).toBeGreaterThan(0);
    expect(m.off).toBeLessThan(1e-6);
    expect(m.outside).toBeLessThan(1e-6);
    for (let i = 0; i < tri.normals.length; i += 3) {
      expect(Math.abs(Vec3.dot(Vec3.fromArray(Vec3(), tri.normals, i), n))).toBeCloseTo(1, 10);
    }
  });

  it('its triangles: the plane inside the box, a slice on the box’s face too', () => {
    // the first z slice, on the box's face: the whole face, 18 × 38 Å
    const face = slicePlane(grid, { mode: 'grid', dimension: { name: 'z', params: 0 } })!;
    const m = measure(planeSurface(face, grid).triangles(Vec3.create(14, 16, 2), 100), face.point, face.normal);
    expect(m.area).toBeCloseTo(18 * 38, 6);
    expect(m.outside).toBeLessThan(1e-6);
    // a ball short of the box: the triangles near it only (the grow keeps those that meet it)
    const near = measure(surface.triangles(Vec3.create(14, 16, 26), 5), z.point, z.normal);
    expect(near.area).toBeGreaterThan(Math.PI * 25 - 1e-6);
    expect(near.area).toBeLessThan(18 * 38);
  });
});
