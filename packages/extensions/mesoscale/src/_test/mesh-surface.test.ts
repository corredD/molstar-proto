/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { SurfaceHit } from '../grow.js';
import { meshSurface } from '../mesh-surface.js';
import { sphereMesh } from './fixtures.js';

// The mesh projector (progress/2026-11-13-grow-mesh.md, Tests: the projector): a point off a mesh brought onto it, its
// normal the mesh's there, in the scene's frame (the mesh's instance transform and scale both ways).

/** The largest distance of an icosphere's faces inside its radius (detail 3: about 0.6 % of it) */
const ChordError = 0.007;

describe('meshSurface', () => {
  it('brings a point off a unit sphere onto it, its normal radial; along a line, or to the nearest point', () => {
    const surface = meshSurface(sphereMesh(1, 3));
    const hit = SurfaceHit();
    for (const p of [Vec3.create(1.2, 0.3, -0.1), Vec3.create(-0.2, 0.7, 0.4), Vec3.create(0, 0, -1.3)]) {
      const radial = Vec3.normalize(Vec3(), p);
      // along the radial line, and with no line (the nearest point)
      for (const along of [radial, Vec3()]) {
        expect(surface.project(hit, p, along, 1)).toBe(true);
        expect(Vec3.magnitude(hit.position)).toBeGreaterThan(1 - ChordError);
        expect(Vec3.magnitude(hit.position)).toBeLessThanOrEqual(1 + 1e-6);
        expect(Math.abs(Vec3.magnitude(hit.normal) - 1)).toBeLessThan(1e-6);
        // the vertex normals interpolated: radial within a degree or so
        expect(Math.abs(Vec3.dot(hit.normal, Vec3.normalize(Vec3(), hit.position)))).toBeGreaterThan(0.999);
      }
    }
    // nothing within reach
    expect(surface.project(hit, Vec3.create(3, 0, 0), Vec3.create(1, 0, 0), 1)).toBe(false);
  });

  it('works in the scene for a mesh moved and scaled (a mesh in pixels at its pixel size)', () => {
    const m = Mat4.mul(
      Mat4(),
      Mat4.fromTranslation(Mat4(), Vec3.create(50, -20, 10)),
      Mat4.fromScaling(Mat4(), Vec3.create(8, 8, 8)),
    );
    const surface = meshSurface(sphereMesh(10, 3), m);
    const centre = Vec3.create(50, -20, 10);
    const hit = SurfaceHit();
    const p = Vec3.create(50 + 90, -20 + 10, 10 - 5);
    expect(surface.project(hit, p, Vec3(), 20)).toBe(true);
    const r = Vec3.distance(hit.position, centre);
    expect(r).toBeGreaterThan(80 * (1 - ChordError));
    expect(r).toBeLessThanOrEqual(80 + 1e-3);
    const radial = Vec3.normalize(Vec3(), Vec3.sub(Vec3(), hit.position, centre));
    expect(Math.abs(Vec3.dot(hit.normal, radial))).toBeGreaterThan(0.999);
    // its reach is the scene's (Å), not the mesh's units
    expect(surface.project(hit, Vec3.create(50 + 95, -20, 10), Vec3(), 20)).toBe(true);
    expect(surface.project(hit, Vec3.create(50 + 95, -20, 10), Vec3(), 10)).toBe(false);
  });

  it("gives the triangles within a radius, in the scene, each with its vertices' normals", () => {
    const m = Mat4.fromScaling(Mat4(), Vec3.create(2, 2, 2));
    const surface = meshSurface(sphereMesh(50, 3), m);
    const near = surface.triangles(Vec3.create(100, 0, 0), 20);
    expect(near.positions.length).toBeGreaterThan(0);
    expect(near.positions.length % 9).toBe(0);
    expect(near.normals.length).toBe(near.positions.length);
    for (let i = 0; i < near.positions.length; i += 3) {
      const v = Vec3.fromArray(Vec3(), near.positions, i);
      expect(Vec3.magnitude(v)).toBeCloseTo(100, 3);
      // a triangle within 20 Å reaches no further than 20 Å and a triangle's size
      expect(Vec3.distance(v, Vec3.create(100, 0, 0))).toBeLessThan(20 + 15);
    }
    expect(surface.triangles(Vec3.create(300, 0, 0), 20).positions.length).toBe(0);
  });
});
