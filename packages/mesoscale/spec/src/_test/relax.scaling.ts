/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { it } from 'vitest';
import { checkLinear, quadraticControl, scaling } from '../../../../sequences/core/_test/model/scaling.js';
import { MesoRelaxResolver } from '../resolvers/relax.js';
import type { ResolveJob } from '../runtime/resolver.js';
import { job, setOf } from './helpers.js';

// `meso.relax` over N copies (`test:scaling`): its overlap grid's cell is sized by the copies it moves, not by one
// large avoided copy, and a cell's list grows in place. Copies (r 10) on a jittered 60 Å grid, one avoided copy of
// r 3000 far away: with the cell sized by the largest radius every copy shares one cell and the pairs read ×16. A
// negative tolerance keeps every phase on (the iterations, the exact phase's 80 rounds, the drop phase, whose cells
// were rebuilt by a copy of the list per insert).

function relaxJob(n: number): ResolveJob {
  const side = Math.ceil(Math.cbrt(n));
  const at = (i: number): [number, number, number] => [
    60 * (i % side) + ((i * 7) % 11),
    60 * (Math.floor(i / side) % side) + ((i * 5) % 13),
    60 * Math.floor(i / (side * side)) + ((i * 3) % 7),
  ];
  const up = setOf(n, at, { population: 'p', compartment: 'c', radius: 10 });
  const far = setOf(1, () => [1e5, 0, 0], { population: 'x', compartment: 'c', radius: 3000 }, 'm.x');
  return job(
    [{ id: 'p', compartment: 'c', location: 'interior', requested: n, radius: 10, arrangement: { kind: 'random' } }],
    { c: { shape: { kind: 'box', center: [0, 0, 0], size: [1e6, 1e6, 1e6] } } },
    {
      model: 'm.relax',
      params: { iterations: 2, tolerance: -1, insert: false },
      upstream: { sets: [up], achieved: { p: n } },
      obstacles: [far],
    },
  );
}

const relaxCase = {
  setup: relaxJob,
  run: (j: ResolveJob) => {
    MesoRelaxResolver.resolve(MesoRelaxResolver.project(j), j);
  },
};

it('the positive control (a copy per item) is caught', () => {
  checkLinear('quadratic control', scaling(quadraticControl, 2000), false);
});

it('meso.relax over N copies, one large avoided copy', () => {
  checkLinear('meso.relax, N copies', scaling(relaxCase, 1000, { reps: 3 }));
});
