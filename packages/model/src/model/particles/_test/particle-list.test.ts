/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Sphere3D } from '@molstar/core/math/geometry';
import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { CustomProperties } from '../../custom-property.js';
import { OrderedSet } from '@molstar/core/data/int';
import { Column } from '@molstar/core/data/db';
import { lociLabel } from '../../label.js';
import {
  getParticleSpacingRadius,
  getParticleTargetGroups,
  getParticleTransforms,
  Particle,
  ParticleList,
} from '../particle-list.js';

function createParticles(coordinates: Float32Array, rotations?: Float32Array): ParticleList {
  const count = coordinates.length / 3;
  return {
    count,
    keys: Int32Array.from({ length: count }, (_, i) => i),
    targets: new Int32Array(count),
    targetInfo: new Map([[0, {}]]),
    coordinates,
    rotations,
    getParticleLabel: (index) => `${index}`,
    sourceData: { kind: 'test', name: 'test', data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}

describe('getParticleTransforms', () => {
  it('uses identity bases without rotations', () => {
    const particles = createParticles(new Float32Array([1, 2, 3, 4, 5, 6]));
    const t = getParticleTransforms(particles);

    const expected = Mat4.fromTranslation(Mat4(), Vec3.create(1, 2, 3));
    for (let j = 0; j < 16; ++j) expect(t[j]).toBeCloseTo(expected[j], 6);
    expect(t[16 + 12]).toBe(4);
    expect(t[16 + 13]).toBe(5);
    expect(t[16 + 14]).toBe(6);
  });

  it('matches Mat4.fromQuat for rotated particles', () => {
    // deterministic LCG so the test is reproducible
    let seed = 3;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

    const count = 25;
    const coordinates = new Float32Array(count * 3);
    const rotations = new Float32Array(count * 4);
    const q = Quat();
    for (let i = 0; i < count; ++i) {
      coordinates[i * 3] = rand() * 100;
      coordinates[i * 3 + 1] = rand() * 100;
      coordinates[i * 3 + 2] = rand() * 100;
      Quat.set(q, rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5);
      Quat.normalize(q, q);
      rotations.set(q, i * 4);
    }

    const particles = createParticles(coordinates, rotations);
    const t = getParticleTransforms(particles);

    const m = Mat4();
    for (let i = 0; i < count; ++i) {
      Quat.set(q, rotations[i * 4], rotations[i * 4 + 1], rotations[i * 4 + 2], rotations[i * 4 + 3]);
      Mat4.fromQuat(m, q);
      m[12] = coordinates[i * 3];
      m[13] = coordinates[i * 3 + 1];
      m[14] = coordinates[i * 3 + 2];
      for (let j = 0; j < 16; ++j) {
        expect(t[i * 16 + j]).toBeCloseTo(m[j], 5);
      }
    }
  });

  it('caches the result on the particle list', () => {
    const particles = createParticles(new Float32Array([1, 2, 3]));
    expect(getParticleTransforms(particles)).toBe(getParticleTransforms(particles));
  });
});

describe('Particle.withTargetsFromAttribute', () => {
  function withClasses(classes: (number | undefined)[]) {
    const particles = createParticles(new Float32Array(classes.length * 3));
    const column = Column.ofArray({
      array: classes.map((c) => c ?? 0),
      schema: Column.Schema.float,
      valueKind: (i) => (classes[i] === undefined ? Column.ValueKinds.NotPresent : Column.ValueKinds.Present),
    });
    return { ...particles, attributes: new Map([['class', { column, label: 'Class', min: 0, max: 9 }]]) };
  }

  it('makes one target per value, in ascending order, and one for the particles without a value', () => {
    const particles = withClasses([3, 1, 3, undefined, 2]);
    const out = Particle.withTargetsFromAttribute(particles, 'class');
    expect(Array.from(out.targets)).toEqual([2, 0, 2, 3, 1]);
    expect(Array.from(out.targetInfo)).toEqual([
      [0, { name: 'Class 1' }],
      [1, { name: 'Class 2' }],
      [2, { name: 'Class 3' }],
      [3, { name: 'No class' }],
    ]);
  });

  it('drops the reference objects and the target groups computed for the old targets', () => {
    const particles = withClasses([1, 2, 1]);
    const groups = getParticleTargetGroups(particles);
    expect(Array.from(groups.targetIds)).toEqual([0]);
    const out = Particle.withTargetsFromAttribute(
      { ...particles, targetMapping: new Map([[0, { kind: 'shape' } as any]]) },
      'class',
    );
    expect(out.targetMapping).toBeUndefined();
    expect(Array.from(getParticleTargetGroups(out).targetIds)).toEqual([0, 1]);
    // the source list keeps its own
    expect(getParticleTargetGroups(particles)).toBe(groups);
  });

  it('fails for an attribute the list does not have', () => {
    expect(() => Particle.withTargetsFromAttribute(withClasses([1]), 'score')).toThrow(/no attribute 'score'/);
  });
});

describe('Particle.selectLoci', () => {
  // four particles: targets 0, 1, 1, 2; target 1 is entity 5, particle 3 has its own entity 7; compartments 0, 0, 1, -1
  const particles: ParticleList = {
    ...createParticles(new Float32Array(12)),
    targets: Int32Array.from([0, 1, 1, 2]),
    targetInfo: new Map([
      [0, {}],
      [1, { entity: 5 }],
      [2, {}],
    ]),
    compartments: Int32Array.from([0, 0, 1, -1]),
  };
  const select = (selector: Particle.Selector) => OrderedSet.toArray(Particle.selectLoci(particles, selector).indices);

  it('picks every particle without criteria', () => {
    expect(select({})).toEqual([0, 1, 2, 3]);
  });

  it('picks by target, by compartment, and by entity through the target', () => {
    expect(select({ targets: [1, 2] })).toEqual([1, 2, 3]);
    expect(select({ compartments: [0] })).toEqual([0, 1]);
    expect(select({ entities: [5] })).toEqual([1, 2]);
  });

  it('prefers a particle own entity, and intersects the criteria', () => {
    // a list of its own: its computed properties (the entity groups) are its own
    const own = {
      ...particles,
      entities: Int32Array.from([-1, 5, 7, 7]),
      customProperties: new CustomProperties(),
      _propertyData: Object.create(null),
    };
    expect(OrderedSet.toArray(Particle.selectLoci(own, { entities: [7] }).indices)).toEqual([2, 3]);
    expect(select({ entities: [5], compartments: [1] })).toEqual([2]);
  });
});

describe('getParticleSpacingRadius', () => {
  it('is half the distance to the nearest particle, for particles on a lattice', () => {
    const coords: number[] = [];
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++) for (let k = 0; k < 6; k++) coords.push(i * 10, j * 10, k * 10);
    const list = createParticles(new Float32Array(coords));
    expect(getParticleSpacingRadius(list)).toBeCloseTo(5, 4);
    // cached
    expect(getParticleSpacingRadius(list)).toBe(getParticleSpacingRadius(list));
  });

  it('is 1 for a single particle or particles all at one point', () => {
    expect(getParticleSpacingRadius(createParticles(new Float32Array([1, 2, 3])))).toBe(1);
    expect(getParticleSpacingRadius(createParticles(new Float32Array([1, 2, 3, 1, 2, 3])))).toBe(1);
  });
});

describe('a particle loci label', () => {
  it('says the particle in bold, its list beneath, the list name escaped', () => {
    const list = { ...createParticles(new Float32Array([0, 0, 0, 5, 0, 0])), label: 'picks <1>.em' };
    const one = lociLabel(Particle.Loci(list, OrderedSet.ofSingleton(1)));
    expect(one).toBe('<b>1</b></br><small>picks &lt;1&gt;.em</small>');
    expect(lociLabel(Particle.Loci(list, OrderedSet.ofBounds(0, 2)))).toBe(
      '<b>2 particles</b></br><small>picks &lt;1&gt;.em</small>',
    );
  });

  it('is plain text when asked (no tags, nothing escaped)', () => {
    const list = { ...createParticles(new Float32Array([0, 0, 0, 5, 0, 0])), label: 'picks <1>.em' };
    expect(lociLabel(Particle.Loci(list, OrderedSet.ofSingleton(1)), { htmlStyling: false })).toBe('1 | picks <1>.em');
  });
});

describe('Particle.getBoundingSphere', () => {
  it('fills the given sphere for the whole list, and leaves the cached boundary as it was', () => {
    const list = createParticles(new Float32Array([0, 0, 0, 10, 0, 0]));
    const all = Particle.Loci(list, OrderedSet.ofBounds(0, 2));
    const fresh = Particle.getBoundingSphere(all);
    const expected = { center: Vec3.clone(fresh.center), radius: fresh.radius };
    // a reused sphere holding an earlier answer, as callers pass one
    const out = Sphere3D.create(Vec3.create(100, 100, 100), 1);
    const res = Particle.getBoundingSphere(all, out);
    expect(res).toBe(out);
    expect(Vec3.distance(out.center, expected.center)).toBeCloseTo(0, 5);
    expect(out.radius).toBeCloseTo(expected.radius, 5);
    const again = Particle.getBoundingSphere(all);
    expect(Vec3.distance(again.center, expected.center)).toBeCloseTo(0, 5);
    expect(again.radius).toBeCloseTo(expected.radius, 5);
  });
});
