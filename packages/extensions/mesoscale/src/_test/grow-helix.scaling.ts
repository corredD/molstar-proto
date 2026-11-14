/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { it } from 'vitest';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { checkLinear, quadraticControl, scaling } from '../../../../sequences/core/_test/model/scaling.js';
import { type GrowPose, type HelixParams, helixPath, spiralPath } from '../grow.js';
import { meshSurface } from '../mesh-surface.js';
import { flatMesh, tubeMesh } from './fixtures.js';

// A helix on a mesh of N turns (`test:scaling`; apps/prism-me/AGENTS.md, no accidental quadratic; grow-helix review
// S3): a point every 5°, each projected onto the tube (a pick each), its normals kept and its first rise cut off, at n
// and 4n turns. Its cost is its points' projections, whatever the rise. A spiral on a mesh of N copies (round 3,
// review M1): its steps bounded by arc length, so its picks' reach does not grow as it goes out.

const z = Vec3.create(0, 0, 1);
// a tube of radius 50, long enough for 4n turns of 1 Å
const tube = meshSurface(tubeMesh(50, 50, 2000, 128, 400));
const on = { surface: tube, reach: 20, line: { center: Vec3(), direction: z } };
const source: GrowPose = { position: Vec3.create(50, 0, -990), rotation: Quat.identity() };

it('the positive control (a copy per item) is caught', () => {
  checkLinear('quadratic control', scaling(quadraticControl, 2000), false);
});

it('a helix of N turns on a mesh', () => {
  const s = scaling(
    {
      setup: (n) => ({ turns: n }),
      run: ({ turns }) => {
        const p: HelixParams = { pitch: 1, turns, hand: 'right', direction: 'up', radius: 0 };
        const normals: number[] = [];
        const path = helixPath(source, z, 10, p, on, normals);
        if (!path || path.length / 3 < 70 * turns) throw new Error('short');
      },
    },
    20,
  );
  checkLinear('helixPath on a mesh, N turns', s);
});

it('a spiral of N copies on a mesh', () => {
  const plane = meshSurface(flatMesh(400, 5));
  const center: GrowPose = { position: Vec3.create(0, 0, 0), rotation: Quat.identity() };
  const s = scaling(
    {
      setup: (n) => ({ count: n }),
      run: ({ count }) => {
        const path = spiralPath(center, z, { spacing: 5, step: 5, count, hand: 'right' }, { surface: plane, reach: 5 });
        if (!path || path.length / 3 < 7 * count) throw new Error('short');
      },
    },
    500,
  );
  checkLinear('spiralPath on a mesh, N copies', s);
});
