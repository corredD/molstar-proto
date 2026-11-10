/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { particlesMovedOnly } from '../target/common.js';

// a commit's list is the old one with its frames moved (`offsetParticles`); one with a line of moves (`movedFrom`, a
// decorated list) and one without (prism-me's ops drop it) are still the same list moved: the `unmoved` path
describe('particlesMovedOnly', () => {
  const base = { count: 1, coordinates: new Float32Array(3), label: 'p' } as unknown as ParticleList;
  const decorated = { ...base, movedFrom: { particles: base, transform: Mat4.identity() } } as ParticleList;
  const { movedFrom: _, ...moved } = { ...decorated, coordinates: new Float32Array([1, 0, 0]) };

  it('takes a list whose line of moves was dropped or added as moved only', () => {
    expect(particlesMovedOnly(decorated, moved as ParticleList)).toBe(true);
    expect(particlesMovedOnly(moved as ParticleList, decorated)).toBe(true);
  });

  it('takes a list with another field as changed', () => {
    expect(particlesMovedOnly(decorated, { ...decorated, label: 'q' } as ParticleList)).toBe(false);
    expect(particlesMovedOnly(base, { ...base, extra: 1 } as unknown as ParticleList)).toBe(false);
  });
});
