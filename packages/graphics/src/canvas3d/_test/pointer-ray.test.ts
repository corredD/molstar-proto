/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Ray3D } from '@molstar/core/math/geometry/primitives/ray3d';
import { Vec3, Vec4 } from '@molstar/core/math/linear-algebra';
import { Camera } from '../camera.js';
import { Viewport } from '../camera/util.js';
import { pointerRay } from '../helper/interaction-events.js';

// The ray a mesh's triangle is looked for along (.v6/plans/gl/triangle-picking.md): rebuilt from the pick's depth point,
// it is the pointer's own ray (`Camera.getRay` at the pointer), in perspective and orthographic views

function camera(mode: 'perspective' | 'orthographic') {
  const c = new Camera(
    { mode, position: Vec3.create(10, -40, 25), target: Vec3.create(2, 3, -1), up: Vec3.create(0, 0, 1) },
    Viewport.create(0, 0, 800, 600),
  );
  c.update();
  return c;
}

describe('the pointer ray from a pick depth point', () => {
  for (const mode of ['perspective', 'orthographic'] as const) {
    it(`is the pointer's ray (${mode})`, () => {
      const c = camera(mode);
      // a point of the scene, where it is on the window, and back at its depth: the pick's depth point
      const world = Vec3.create(4, 1, 3);
      const win = c.project(Vec4(), world);
      const position = c.unproject(Vec3(), Vec3.create(win[0], win[1], win[2]));
      const ray = pointerRay(Ray3D(), c.state, position);
      const expected = c.getRay(Ray3D(), win[0], win[1]);
      for (let i = 0; i < 3; i++) expect(ray.direction[i]).toBeCloseTo(expected.direction[i], 4);
      // it reaches the point from before it
      const to = Vec3.sub(Vec3(), world, ray.origin);
      expect(Vec3.dot(to, ray.direction)).toBeGreaterThan(0);
      expect(Vec3.magnitude(Vec3.cross(Vec3(), to, ray.direction)) / Vec3.magnitude(to)).toBeLessThan(1e-3);
    });
  }
});
