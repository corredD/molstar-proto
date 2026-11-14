/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { it } from 'vitest';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { checkLinear, quadraticControl, scaling } from '../../../../../test-harness/src/scaling.js';
import { envelopeOf, fitGrown, fitMapOf } from '../fit.js';
import { crnAtoms, crnSites, density } from './density.js';

// N grown copies fitted and kept (`test:scaling`; apps/prism-me/AGENTS.md, no accidental quadratic; density-fit): each
// fit a fixed cost, each kept copy's spacing checked against its neighbours only (a grid), at n and 4n copies, every
// one kept (a map with a copy of 1CRN at every candidate).

const atoms = crnAtoms();
const envelope = envelopeOf({ kind: 'sites', sites: crnSites() }, 0);
const rotation = Quat.identity();
const side = 12;
const sites = Array.from({ length: side * side }, (_, i) => ({
  position: Vec3.create(30 + 35 * (i % side), 30 + 35 * Math.floor(i / side), 30),
  rotation,
}));
const map = fitMapOf(
  density(atoms, sites, { origin: Vec3(), size: [300, 300, 40], voxel: 1.5, blur: 1.5, noise: 0.05, seed: 2 }).grid,
)!;

it('the positive control (a copy per item) is caught', () => {
  checkLinear('quadratic control', scaling(quadraticControl, 2000), false);
});

it('N grown copies fitted and kept', () => {
  const s = scaling(
    {
      setup: (n) => ({
        positions: sites.slice(0, n).flatMap((x) => [x.position[0] + 1, x.position[1], x.position[2]]),
        rotations: sites.slice(0, n).flatMap(() => [0, 0, 0, 1]),
        n,
      }),
      run: (poses) => {
        const kept = fitGrown(map, envelope, poses, {
          reach: 3,
          turn: 7.5,
          contrast: 'dark',
          threshold: 0.5,
          apart: 15,
        });
        if (kept.positions.length / 3 < poses.n) throw new Error('not all kept');
      },
    },
    (side * side) / 4,
  );
  checkLinear('fitGrown, N copies', s);
});
