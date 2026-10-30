/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import {
  type ParticleCutProps,
  type ParticleLayerProps,
  particleCutClipping,
  particleLayerState,
} from '@molstar/plugin/state/transforms/particles/layers';
import { it } from 'vitest';
import { checkLinear, scaling } from '../../../../../ui/src/_test/scaling.js';

// The loops over particles of a particle look (`test:scaling`; packages/prism/AGENTS.md, bulk operations are one
// change): the rows of the cuts' clipping table (a lookup per particle and object with cuts, never a scan of the rows)
// and the share shown (a hash per particle), each about linear in the particles.

/** `n` particles in 16 targets, round robin */
function particles(n: number): ParticleList {
  const targets = new Int32Array(n);
  for (let i = 0; i < n; ++i) targets[i] = i % 16;
  const targetInfo = new Map(Array.from({ length: 16 }, (_, t) => [t, { name: `t${t}` }]));
  const list = { count: n, keys: new Int32Array(n), targets, targetInfo };
  return { ...list, customProperties: new CustomProperties(), _propertyData: {} } as unknown as ParticleList;
}

const none = { entities: [] as number[], compartments: [] as number[] };
const objects = Array.from({ length: 16 }, (_, i) => ({ tag: `c${i}` }));
/** 16 cuts, each of four targets its way: many distinct rows */
const cuts: ParticleCutProps[] = objects.map(({ tag }, i) => ({
  ...none,
  tag,
  targets: [i, (i + 1) % 16, (i + 5) % 16, (i + 7) % 16],
  mode: (['cut', 'keep', 'wider'] as const)[i % 3],
  band: 10 + i,
  fuzziness: i / 16,
}));
const shown: ParticleLayerProps[] = Array.from({ length: 4 }, (_, i) => ({
  ...none,
  targets: [i, i + 4],
  visible: true,
  color: null,
  transparency: null,
  emissive: null,
  shown: 0.3,
}));

it('the rows of 16 cuts over N particles', () => {
  const s = scaling({ setup: (n) => particles(n), run: (p) => particleCutClipping(cuts, p, objects) }, 50_000);
  checkLinear('particle cuts, the clipping table rows', s);
});

it('the share shown of 8 targets over N particles', () => {
  const s = scaling({ setup: (n) => particles(n), run: (p) => particleLayerState(shown, p) }, 50_000);
  checkLinear('particle layers, the share shown', s);
});
