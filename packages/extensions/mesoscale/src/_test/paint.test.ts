/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Column } from '@molstar/core/data/db';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { getParticleTargetGroups } from '@molstar/model/model/particles/particle-list';
import { type PaintStroke, paintParticles, paintRotations } from '../paint.js';
import { cellpackLike } from './fixtures.js';

// The painted decorator's data (progress/2026-11-08-paint.md, Tests: decorator) and the copies' orientations.

const stroke = (over: Partial<PaintStroke> = {}): PaintStroke => ({
  target: 1,
  entity: 1,
  compartment: 1,
  positions: [100, 0, 0, 110, 0, 0],
  rotations: [0, 0, 0, 1, 0, 0, 0, 1],
  ...over,
});

const axisOf = (rotations: ArrayLike<number>, i: number, local: Vec3) =>
  Vec3.transformQuat(
    Vec3(),
    local,
    Quat.create(rotations[i * 4], rotations[i * 4 + 1], rotations[i * 4 + 2], rotations[i * 4 + 3]),
  );

describe('paintParticles', () => {
  it('returns the list itself for no stroke, or strokes with no copy', () => {
    const list = cellpackLike();
    expect(paintParticles(list, [])).toBe(list);
    expect(paintParticles(list, [stroke({ positions: [], rotations: [] })])).toBe(list);
  });

  it('appends each stroke after the input, keys after its largest, targets, entities, compartments extended', () => {
    const list = { ...cellpackLike(), keys: Int32Array.of(0, 1, 2, 3, 40, 5, 6), entities: cellpackLike().targets };
    const out = paintParticles(list, [
      stroke(),
      stroke({ target: 2, entity: 2, compartment: 2, positions: [1, 2, 3] }),
    ]);
    expect(out.count).toBe(10);
    expect(Array.from(out.keys.slice(7))).toEqual([41, 42, 43]);
    expect(new Set(out.keys).size).toBe(10);
    expect(Array.from(out.targets.slice(7))).toEqual([1, 1, 2]);
    expect(Array.from(out.entities!.slice(7))).toEqual([1, 1, 2]);
    expect(Array.from(out.compartments!.slice(7))).toEqual([1, 1, 2]);
    expect(Array.from(out.coordinates.slice(21))).toEqual([100, 0, 0, 110, 0, 0, 1, 2, 3]);
    // the input's particles as they were
    expect(Array.from(out.coordinates.slice(0, 21))).toEqual(Array.from(list.coordinates));
    expect(Array.from(out.targets.slice(0, 7))).toEqual(Array.from(list.targets));
    // the targets' objects and the input untouched
    expect(out.targetMapping).toBe(list.targetMapping);
    expect(list.count).toBe(7);
  });

  it('writes no entities or compartments where the input has none per particle', () => {
    const { entities: _e, compartments: _c, ...plain } = cellpackLike();
    const out = paintParticles(plain as ReturnType<typeof cellpackLike>, [stroke()]);
    expect(out.entities).toBeUndefined();
    expect(out.compartments).toBeUndefined();
    expect(out.count).toBe(9);
  });

  it('gives the input identity orientations when it had none, the copies theirs', () => {
    const list = cellpackLike();
    const q = Quat.setAxisAngle(Quat(), Vec3.create(1, 0, 0), Math.PI / 2);
    const out = paintParticles(list, [stroke({ positions: [0, 0, 0], rotations: Array.from(q) })]);
    expect(Array.from(out.rotations!.slice(0, 4))).toEqual([0, 0, 0, 1]);
    expect(Array.from(out.rotations!.slice(28))).toEqual(Array.from(Float32Array.from(q)));
  });

  it('leaves the fibres as they are, gives each copy its target radius, attributes not present for the copies', () => {
    const fibers = { count: 1, offsets: Int32Array.of(0, 3), indices: Int32Array.of(2, 3, 4) };
    const radii = Float32Array.of(1, 1, 7, 9, 9, 9, 3);
    const cc = Column.ofArray({ array: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], schema: Column.Schema.float });
    const attributes = new Map([['cc', { column: cc, label: 'cc', min: 0.1, max: 0.7 }]]);
    const out = paintParticles({ ...cellpackLike(), fibers, radii, attributes }, [stroke(), stroke({ target: 2 })]);
    expect(out.fibers).toBe(fibers);
    expect(Array.from(out.radii!.slice(7))).toEqual([7, 7, 9, 9]);
    const column = out.attributes!.get('cc')!.column;
    expect(column.rowCount).toBe(11);
    expect(column.value(3)).toBeCloseTo(0.4);
    expect(column.valueKind(3)).toBe(Column.ValueKinds.Present);
    expect(column.valueKind(9)).toBe(Column.ValueKinds.NotPresent);
  });

  it('labels the copies by their entity and has fresh computed properties (the groups count them)', () => {
    const list = { ...cellpackLike(), entities: cellpackLike().targets };
    expect(getParticleTargetGroups(list).sets.length).toBe(4);
    const out = paintParticles(list, [stroke()]);
    expect(out.getParticleLabel(7)).toBe('CA · painted 1');
    expect(out.getParticleLabel(0)).toBe('0');
    const groups = getParticleTargetGroups(out);
    expect(Array.from(groups.targetIds)).toEqual([0, 1, 2, 3]);
    expect(groups.sets[groups.groupOfTarget.get(1)!]).toBeDefined();
    expect(Array.from({ length: 3 }, (_, i) => out.targets[[2, 7, 8][i]])).toEqual([1, 1, 1]);
  });
});

describe('paintRotations', () => {
  it('turns each copy +z onto its normal (a membrane protein upright), spun at random about it, the same each time', () => {
    const normals = [0, 0, 5, 1, 0, 0, 0, -1, 0];
    const r = paintRotations(normals, 'normal', 7);
    const n = [Vec3.create(0, 0, 1), Vec3.create(1, 0, 0), Vec3.create(0, -1, 0)];
    for (let i = 0; i < 3; ++i) {
      const z = axisOf(r, i, Vec3.create(0, 0, 1));
      expect(Vec3.distance(z, n[i])).toBeLessThan(1e-6);
    }
    expect(paintRotations(normals, 'normal', 7)).toEqual(r);
    // spun: two copies on one normal differ about it
    const two = paintRotations([0, 0, 1, 0, 0, 1], 'normal', 7);
    expect(Vec3.distance(axisOf(two, 0, Vec3.create(1, 0, 0)), axisOf(two, 1, Vec3.create(1, 0, 0)))).toBeGreaterThan(
      1e-3,
    );
  });

  it('spins by a fixed angle when given', () => {
    const r = paintRotations([0, 0, 1], 'normal', 1, { spin: 90 });
    expect(Vec3.distance(axisOf(r, 0, Vec3.create(1, 0, 0)), Vec3.create(0, 1, 0))).toBeLessThan(1e-6);
  });

  it('turns the principal axis onto the normal for `axis`', () => {
    const axis = Vec3.create(1, 1, 0);
    const r = paintRotations([0, 0, 1], 'axis', 3, { axis });
    expect(Vec3.distance(axisOf(r, 0, Vec3.normalize(Vec3(), axis)), Vec3.create(0, 0, 1))).toBeLessThan(1e-6);
  });

  it('gives unit, spread orientations for `random`', () => {
    const k = 200;
    const r = paintRotations(new Array(k * 3).fill(0), 'random', 11);
    let mean = Vec3();
    for (let i = 0; i < k; ++i) {
      const q = r.slice(i * 4, i * 4 + 4);
      expect(Math.hypot(...q)).toBeCloseTo(1, 6);
      mean = Vec3.add(mean, mean, axisOf(r, i, Vec3.create(0, 0, 1)));
    }
    // uniform: their +z average near the centre
    expect(Vec3.magnitude(mean) / k).toBeLessThan(0.2);
  });
});
