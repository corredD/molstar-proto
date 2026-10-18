/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { CustomProperties } from '../../custom-property.js';
import { Column } from '@molstar/core/data/db';
import { getParticleTargetGroups, getParticleTransforms, Particle, ParticleList } from '../particle-list.js';

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
