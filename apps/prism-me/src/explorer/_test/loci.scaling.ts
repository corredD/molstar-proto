/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { CustomProperties } from '@molstar/model/model/custom-property';
import { type ParticleList, Particle } from '@molstar/model/model/particles/particle-list';
import { expect, it } from 'vitest';
import { checkLinear, quadraticControl, scaling } from '../../../../../packages/sequences/core/_test/model/scaling.js';

// `Particle.selectLoci` over every entity of a list (`test:scaling`; A7): what a group row's hover and pick ask for.
// Merging the entities' sets one at a time is O(entities x particles): 2.2 s at 16k entities, on a pointer event.

const PerEntity = 20;

function list(entities: number): ParticleList {
  const count = entities * PerEntity;
  return {
    label: 'big',
    count,
    keys: Int32Array.from({ length: count }, (_, i) => i),
    // interleaved, so every entity's particles are spread over the whole list
    targets: Int32Array.from({ length: count }, (_, i) => i % entities),
    targetInfo: new Map(Array.from({ length: entities }, (_, e) => [e, { entity: e }] as const)),
    entityInfo: new Map(Array.from({ length: entities }, (_, e) => [e, { name: `e${e}` }] as const)),
    compartments: undefined,
    compartmentInfo: new Map(),
    coordinates: new Float32Array(count * 3),
    getParticleLabel: (i: number) => `${i}`,
    sourceData: { kind: 'test', name: 'test', data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  } as unknown as ParticleList;
}

it('the positive control (a copy per item) is caught', () => {
  checkLinear('quadratic control', scaling(quadraticControl, 2000), false);
});

it('Particle.selectLoci over every entity of a list', () => {
  const s = scaling(
    {
      setup: (n) => {
        const data = list(n);
        // the groups are computed once per list (cached): not what is measured
        Particle.selectLoci(data, { entities: [0] });
        return { data, entities: Array.from({ length: n }, (_, i) => i) };
      },
      run: ({ data, entities }) => {
        const loci = Particle.selectLoci(data, { entities });
        if (Particle.lociSize(loci) !== data.count) throw new Error('not every particle');
      },
    },
    1000,
  );
  checkLinear('Particle.selectLoci, N entities', s);
  expect(s.n).toBe(1000);
}, 300_000);
