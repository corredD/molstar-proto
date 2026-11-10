/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Column } from '@molstar/core/data/db';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { getFiberParticleMask, getParticleTargetGroups } from '@molstar/model/model/particles/particle-list';
import {
  brushIdOf,
  fiberConventionOf,
  fiberRotations,
  fiberSettingsOf,
  fiberUnits,
  makeFiber,
  parseRange,
  resamplePath,
  isFiberBrush,
  type PaintStroke,
  paintParticles,
  paintRotations,
} from '../paint.js';
import { cellpackLike } from './fixtures.js';
import { FiberBankHelix, fiberUnitSites } from '../fiber-units.js';

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

describe('fibres (Round 2, Decided 4)', () => {
  /** NC (target 2, particles 3, 4, 5, along x 10 Å apart) as a fibre: its +z along x, turned 30° a point about it */
  const withFiber = () => {
    const list = cellpackLike();
    const q0 = Quat.rotationTo(Quat(), Vec3.create(0, 0, 1), Vec3.create(1, 0, 0));
    const rotations = new Float32Array(list.count * 4);
    for (let i = 0; i < list.count; ++i) rotations[i * 4 + 3] = 1;
    for (let j = 0; j < 3; ++j) {
      const twist = Quat.setAxisAngle(Quat(), Vec3.create(0, 0, 1), (30 * j * Math.PI) / 180);
      rotations.set(Quat.multiply(Quat(), q0, twist), (3 + j) * 4);
    }
    const fibers = { count: 1, offsets: Int32Array.of(0, 3), indices: Int32Array.of(3, 4, 5) };
    return { ...list, rotations, fibers };
  };

  it("a fibre stroke appends its copies and one fibre through them, in order; the input's fibres kept", () => {
    const list = withFiber();
    // a path a rise (the fibre's step, 10 Å) a point: its points those
    const line = { target: 2, fiber: true, positions: [0, 0, 0, 10, 0, 0, 20, 0, 0], rotations: [] };
    const out = paintParticles(list, [stroke(), stroke(line)]);
    expect(out.count).toBe(12);
    expect(out.fibers!.count).toBe(2);
    expect(Array.from(out.fibers!.offsets)).toEqual([0, 3, 6]);
    expect(Array.from(out.fibers!.indices)).toEqual([3, 4, 5, 9, 10, 11]);
    // the painted list's own fibre mask, not the input's (cached on it)
    expect(getFiberParticleMask(list)!.length).toBe(7);
    const mask = getFiberParticleMask(out)!;
    expect(mask.length).toBe(12);
    expect(Array.from(mask.slice(7))).toEqual([0, 0, 1, 1, 1]);
    // a list without fibres gets its first
    const first = paintParticles(cellpackLike(), [stroke({ fiber: true })], { 1: { rise: 10, twist: 0, jitter: 0 } });
    expect(Array.from(first.fibers!.offsets)).toEqual([0, 2]);
    expect(Array.from(first.fibers!.indices)).toEqual([7, 8]);
    // a click (one point) is a copy, not a fibre: no polyline of one point (review S4)
    const click = paintParticles(cellpackLike(), [stroke({ fiber: true, positions: [0, 0, 0], rotations: [] })]);
    expect(click.count).toBe(8);
    expect(click.fibers).toBeUndefined();
  });

  it('reads the twist whatever the sign of the stored turns, with a bend (review S5)', () => {
    const list = withFiber();
    const r = list.rotations;
    // the second point's turn stored with the opposite sign (the same turn), and the third point off the line
    for (let c = 0; c < 4; ++c) r[4 * 4 + c] = -r[4 * 4 + c];
    list.coordinates[5 * 3 + 1] = 2;
    expect(fiberConventionOf(list, 2)!.twist).toBeCloseTo(30, 3);
    // a bent first segment: the twist part of a turn about an axis off the fibre stays small, not near ±180
    const bent = withFiber();
    bent.coordinates[4 * 3 + 1] = 3;
    const t = fiberConventionOf(bent, 2)!.twist;
    expect(Math.abs(t)).toBeLessThan(31);
  });

  it("reads a brush's fibres: the axis along them, the twist a point, the step; none for a brush without", () => {
    const list = withFiber();
    expect(isFiberBrush(list, 2)).toBe(true);
    expect(isFiberBrush(list, 1)).toBe(false);
    expect(fiberConventionOf(list, 1)).toBeUndefined();
    const c = fiberConventionOf(list, 2)!;
    expect(c.axis[2]).toBeCloseTo(1, 5);
    expect(c.twist).toBeCloseTo(30, 3);
    expect(c.step).toBeCloseTo(10, 5);
  });

  it("turns a new fibre's points as the brush's fibres are: its axis along the way, the twist a point", () => {
    const list = withFiber();
    const c = fiberConventionOf(list, 2)!;
    // the same way as the existing fibre: the same orientations
    const r = fiberRotations([30, 0, 0, 40, 0, 0, 50, 0, 0], c);
    for (let j = 0; j < 3; ++j) {
      const q = Quat.create(r[j * 4], r[j * 4 + 1], r[j * 4 + 2], r[j * 4 + 3]);
      const o = list.rotations.subarray((3 + j) * 4);
      expect(Math.abs(Quat.dot(q, Quat.create(o[0], o[1], o[2], o[3])))).toBeCloseTo(1, 4);
    }
    // a bend: each point's axis toward the next, the last from the one before
    const z = Vec3.create(0, 0, 1);
    const bent = fiberRotations([0, 0, 0, 0, 10, 0, 10, 10, 0], { axis: z, twist: 0 });
    expect(axisOf(bent, 0, z)[1]).toBeCloseTo(1, 5);
    expect(axisOf(bent, 1, z)[0]).toBeCloseTo(1, 5);
    expect(axisOf(bent, 2, z)[0]).toBeCloseTo(1, 5);
  });
});

describe('fibres by rise and twist (Round 3)', () => {
  const z = Vec3.create(0, 0, 1);
  /** The turn about the fibre's axis (+z here, along x) of point `i` from point 0, in (-180, 180] */
  const turnOf = (r: ArrayLike<number>, i: number) => {
    const x = axisOf(r, i, Vec3.create(1, 0, 0));
    const x0 = axisOf(r, 0, Vec3.create(1, 0, 0));
    const along = axisOf(r, 0, z);
    const cross = Vec3.cross(Vec3(), x0, x);
    return (Math.atan2(Vec3.dot(cross, along), Vec3.dot(x0, x)) * 180) / Math.PI;
  };

  it('puts a point every rise along a bent path, by its length', () => {
    // an L: 10 Å along x, then 10 Å along y
    const p = resamplePath([0, 0, 0, 10, 0, 0, 10, 10, 0], 4);
    expect(p.length / 3).toBe(6);
    expect(p.slice(3, 6)).toEqual([4, 0, 0]);
    expect(p.slice(6, 9)).toEqual([8, 0, 0]);
    // 12 and 16 Å along: 2 and 6 past the bend
    for (const [k, v] of [10, 2, 0].entries()) expect(p[9 + k]).toBeCloseTo(v, 6);
    for (const [k, v] of [10, 6, 0].entries()) expect(p[12 + k]).toBeCloseTo(v, 6);
    // a path a rise a point keeps its last point
    expect(resamplePath([0, 0, 0, 3.4, 0, 0, 6.8, 0, 0], 3.4).length).toBe(9);
  });

  it('turns each point by the twist from the one before, exactly, without jitter (a DNA)', () => {
    const line = Array.from({ length: 11 }, (_, i) => [i * 3.4, 0, 0]).flat();
    const r = fiberRotations(line, { axis: z, twist: 34.3, jitter: 0 }, 7);
    for (let i = 1; i <= 5; ++i) expect(turnOf(r, i)).toBeCloseTo(34.3 * i, 3);
  });

  it('turns each step within ±jitter of the twist, the same for the same seed (an RNA)', () => {
    const line = Array.from({ length: 40 }, (_, i) => [i * 6, 0, 0]).flat();
    const a = fiberRotations(line, { axis: z, twist: 30, jitter: 20 }, 3);
    expect(fiberRotations(line, { axis: z, twist: 30, jitter: 20 }, 3)).toEqual(a);
    expect(fiberRotations(line, { axis: z, twist: 30, jitter: 20 }, 4)).not.toEqual(a);
    const steps = [];
    for (let i = 1; i < 40; ++i) {
      const d = ((turnOf(a, i) - turnOf(a, i - 1) + 540) % 360) - 180;
      steps.push(d);
      expect(d).toBeGreaterThanOrEqual(10 - 1e-3);
      expect(d).toBeLessThanOrEqual(50 + 1e-3);
    }
    // not all the same: a jitter
    expect(Math.max(...steps) - Math.min(...steps)).toBeGreaterThan(5);
  });

  it("makes every painted fibre of an entity again by its settings; another entity's and the copies as they were", () => {
    const list = { ...cellpackLike(), entities: cellpackLike().targets };
    const path = [0, 0, 0, 20, 0, 0];
    const strokes = [
      stroke({ fiber: true, positions: path, rotations: [], seed: 1 }),
      stroke({ fiber: true, positions: [0, 10, 0, 0, 30, 0], rotations: [], seed: 2 }),
      stroke({ target: 2, entity: 2, fiber: true, positions: path, rotations: [], seed: 3 }),
      stroke({ positions: [5, 5, 5] }),
    ];
    const settings = (rise: number) => ({
      1: { rise, twist: 36, jitter: 0 },
      2: { rise: 10, twist: 0, jitter: 0 },
    });
    const coarse = paintParticles(list, strokes, settings(10));
    const fine = paintParticles(list, strokes, settings(5));
    // entity 1's two fibres: 3 points each at 10 Å, 5 at 5 Å; entity 2's 3 points both times; the copy one
    expect(coarse.count).toBe(7 + 3 + 3 + 3 + 1);
    expect(fine.count).toBe(7 + 5 + 5 + 3 + 1);
    expect(Array.from(fine.fibers!.offsets)).toEqual([0, 5, 10, 13]);
    expect(Array.from(fine.coordinates.slice(7 * 3, 12 * 3).filter((_, i) => i % 3 === 0))).toEqual([0, 5, 10, 15, 20]);
    // entity 2's fibre the same points either way
    const two = (o: typeof fine, at: number) => Array.from(o.coordinates.slice(at * 3, (at + 3) * 3));
    expect(two(fine, 17)).toEqual(two(coarse, 13));
    // the copy last, as painted
    expect(Array.from(fine.coordinates.slice(-3))).toEqual([5, 5, 5]);
  });

  it("defaults to the entity's own fibres' step and twist, else touching points, no twist", () => {
    // withFiber's NC (target 2): 10 Å, 30°
    const list = cellpackLike();
    const q0 = Quat.rotationTo(Quat(), z, Vec3.create(1, 0, 0));
    const rotations = new Float32Array(list.count * 4);
    for (let i = 0; i < list.count; ++i) rotations[i * 4 + 3] = 1;
    for (let j = 0; j < 3; ++j) {
      const t = Quat.setAxisAngle(Quat(), z, (30 * j * Math.PI) / 180);
      rotations.set(Quat.multiply(Quat(), q0, t), (3 + j) * 4);
    }
    const fibered = {
      ...list,
      rotations,
      fibers: { count: 1, offsets: Int32Array.of(0, 3), indices: Int32Array.of(3, 4, 5) },
    };
    const own = fiberSettingsOf(fibered, 2, 2);
    expect(own.rise).toBeCloseTo(10, 5);
    expect(own.twist).toBeCloseTo(30, 3);
    expect(own.jitter).toBe(0);
    const given = { rise: 3.4, twist: 34.3, jitter: 0 };
    expect(fiberSettingsOf(fibered, 2, 2, { 2: given })).toEqual({ ...given, axis: 'auto', offset: 0, bank: 'none' });
    const none = fiberSettingsOf(list, 1, 1);
    expect(none.twist).toBe(0);
    expect(none.rise).toBeGreaterThan(0);
    // a stroke's brush: its entity where the list has entities, else its target
    expect(brushIdOf({ ...list, entityInfo: new Map() }, { entity: 5, target: 1 })).toBe(1);
  });
});

describe('fibres by an axis and an offset (Round 4)', () => {
  const z = Vec3.create(0, 0, 1);
  /** A straight path along world x, 40 Å */
  const line = [0, 0, 0, 40, 0, 0];
  const point = (p: ArrayLike<number>, i: number) => Vec3.create(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);

  it("puts the unit's chosen axis along the path, whatever the entity's own", () => {
    for (const [axis, local] of [
      ['x', Vec3.create(1, 0, 0)],
      ['y', Vec3.create(0, 1, 0)],
      ['z', z],
    ] as const) {
      const f = makeFiber(line, { rise: 10, twist: 25, jitter: 0, axis, offset: 0 }, z, 0);
      for (let i = 0; i < 5; ++i) {
        const along = axisOf(f.rotations, i, local);
        expect(along[0]).toBeCloseTo(1, 5);
      }
    }
  });

  it('moves each point the offset off the path, along a perpendicular of the axis turned with it (a helix)', () => {
    // a half turn a point: the offsets of two points in a row opposite
    const f = makeFiber(line, { rise: 10, twist: 180, jitter: 0, axis: 'z', offset: 3 }, z, 0);
    expect(f.positions.length / 3).toBe(5);
    for (let i = 0; i < 5; ++i) {
      const p = point(f.positions, i);
      // still a rise along the path, 3 Å off it
      expect(p[0]).toBeCloseTo(i * 10, 5);
      expect(Math.hypot(p[1], p[2])).toBeCloseTo(3, 5);
      // the unit's x (z's perpendicular), turned: the way it is moved
      const x = axisOf(f.rotations, i, Vec3.create(1, 0, 0));
      expect(p[1]).toBeCloseTo(3 * x[1], 5);
      expect(p[2]).toBeCloseTo(3 * x[2], 5);
    }
    const p0 = point(f.positions, 0);
    const p1 = point(f.positions, 1);
    expect(p1[1]).toBeCloseTo(-p0[1], 5);
    expect(p1[2]).toBeCloseTo(-p0[2], 5);
    // a quarter turn: perpendicular offsets
    const q = makeFiber(line, { rise: 10, twist: 90, jitter: 0, axis: 'z', offset: 3 }, z, 0);
    const a = point(q.positions, 0);
    const b = point(q.positions, 1);
    expect(a[1] * b[1] + a[2] * b[2]).toBeCloseTo(0, 5);
  });

  it("reads Round 3's settings (no axis, no offset) as auto and none", () => {
    const old = makeFiber(line, { rise: 10, twist: 30, jitter: 5 }, z, 9);
    expect(makeFiber(line, { rise: 10, twist: 30, jitter: 5, axis: 'auto', offset: 0 }, z, 9)).toEqual(old);
    expect(Array.from(old.positions)).toEqual([0, 0, 0, 10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0]);
    const list = cellpackLike();
    const s = fiberSettingsOf(list, 1, 1);
    expect(s.axis).toBe('auto');
    expect(s.offset).toBe(0);
  });
});

describe('fibres of a bank of units by a sequence (Round 5)', () => {
  const dna = { 2: { ...FiberBankHelix, jitter: 0, axis: 'z' as const, offset: 0, bank: 'dna' as const } };
  const rna = { 2: { ...FiberBankHelix, jitter: 0, axis: 'z' as const, offset: 0, bank: 'rna' as const } };
  /** A path along z of `n` points a rise apart */
  const path = (n: number) => [0, 0, 0, 0, 0, FiberBankHelix.rise * (n - 1)];
  const nc = (over: Partial<PaintStroke> = {}) =>
    stroke({ target: 2, entity: 2, fiber: true, positions: path(4), rotations: [], seed: 5, ...over });
  /** The painted points' units (their targets' sites' labels), from the input's count on */
  const unitsOf = (out: ReturnType<typeof paintParticles>, from: number) =>
    Array.from(out.targets.slice(from)).map((t) => {
      const target = out.targetMapping?.get(t);
      return target?.kind === 'sites' ? target.sites.label : `target ${t}`;
    });

  it("puts a unit a point by the stroke's sequence: DNA's pair of each letter, the entity's own", () => {
    const list = cellpackLike();
    const out = paintParticles(list, [nc({ sequence: { residues: 'atgc' } })], dna);
    expect(unitsOf(out, list.count)).toEqual(['dna:AT', 'dna:TA', 'dna:GC', 'dna:CG']);
    for (let i = list.count; i < out.count; ++i) {
      expect(out.targetInfo.get(out.targets[i])?.entity).toBe(2);
      // the unit's own radius
      expect(out.radii?.[i] ?? 1).toBeGreaterThan(0);
    }
    // the units are sites, the same objects every time
    expect(out.targetMapping!.get(out.targets[list.count])).toEqual({ kind: 'sites', sites: fiberUnitSites('dna:AT') });
    // the fibre's points still the entity's: its convention read from them
    expect(out.fibers!.count).toBe(1);
  });

  it('repeats a shorter sequence, reads a range of it (1-based, inclusive), and RNA a nucleotide a letter', () => {
    const list = cellpackLike();
    const short = paintParticles(list, [nc({ positions: path(5), sequence: { residues: 'GA' } })], dna);
    expect(unitsOf(short, list.count)).toEqual(['dna:GC', 'dna:AT', 'dna:GC', 'dna:AT', 'dna:GC']);
    const range = paintParticles(list, [nc({ sequence: { residues: 'GGGAUCGGG', start: 4, end: 7 } })], rna);
    expect(unitsOf(range, list.count)).toEqual(['rna:A', 'rna:U', 'rna:C', 'rna:G']);
  });

  it('picks the units at random without a sequence (and for a letter not in the bank), the same for the same seed', () => {
    const list = cellpackLike();
    const a = paintParticles(list, [nc({ positions: path(40) })], dna);
    expect(unitsOf(paintParticles(list, [nc({ positions: path(40) })], dna), list.count)).toEqual(
      unitsOf(a, list.count),
    );
    expect(new Set(unitsOf(a, list.count)).size).toBeGreaterThan(2);
    const n = unitsOf(paintParticles(list, [nc({ sequence: { residues: 'ANA' } })], dna), list.count);
    expect(n[0]).toBe('dna:AT');
    expect(n[1]).toMatch(/^dna:/);
    expect(n[2]).toBe('dna:AT');
  });

  it("keeps the list's targets as they are without a bank, and the same map again for the same units", () => {
    const list = { ...cellpackLike(), targetMapping: new Map() };
    expect(paintParticles(list, [nc()]).targetMapping).toBe(list.targetMapping);
    const strokes = [nc({ sequence: { residues: 'AT' } })];
    const one = paintParticles(list, strokes, dna);
    expect(paintParticles(list, strokes, dna).targetMapping).toBe(one.targetMapping);
    expect(paintParticles(list, strokes, dna).targetInfo).toBe(one.targetInfo);
  });

  it('paints the brush itself on a list without entities (its targets its entities: a unit would leave it)', () => {
    const list = { ...cellpackLike(), entityInfo: undefined, targetInfo: new Map([[2, {}]]) };
    const out = paintParticles(list, [nc({ sequence: { residues: 'AT' } })], dna);
    expect(Array.from(out.targets.slice(list.count))).toEqual([2, 2, 2, 2]);
  });
});

describe('the review of rounds 3 to 5', () => {
  const dna = (id: number) => ({
    [id]: { ...FiberBankHelix, jitter: 0, axis: 'z' as const, offset: 0, bank: 'dna' as const },
  });
  const path = (n: number) => [0, 0, 0, 0, 0, FiberBankHelix.rise * (n - 1)];
  const fibre = (over: Partial<PaintStroke> = {}) =>
    stroke({ target: 2, entity: 2, fiber: true, positions: path(4), rotations: [], seed: 5, ...over });

  it("M2: never gives a unit a list's own target id: no bank for the entity -1 (no entity)", () => {
    const list = cellpackLike();
    const out = paintParticles(list, [fibre({ entity: -1, sequence: { residues: 'ATGC' } })], dna(-1));
    expect(Array.from(out.targets.slice(list.count))).toEqual([2, 2, 2, 2]);
    expect(out.targetInfo).toBe(list.targetInfo);
  });

  it("S1: the units' maps made again when the list's targets change, its mapping the same", () => {
    const mapping = new Map();
    const a = { ...cellpackLike(), targetMapping: mapping };
    const b = { ...a, targetInfo: new Map([...a.targetInfo, [50, { entity: 1 }]]) };
    const strokes = [fibre({ sequence: { residues: 'AT' } })];
    paintParticles(a, strokes, dna(2));
    const out = paintParticles(b, strokes, dna(2));
    for (let i = b.count; i < out.count; ++i) {
      expect(out.targetMapping!.has(out.targets[i])).toBe(true);
      expect(out.targetInfo.has(out.targets[i])).toBe(true);
    }
  });

  it('S2, X1: a unit point named by its entity and numbered by its place in the sequence; a random one by none', () => {
    const list = cellpackLike();
    const out = paintParticles(
      list,
      [fibre({ positions: path(5), sequence: { residues: 'ACGTACGT', start: 3, end: 4 } })],
      dna(2),
    );
    const labels = Array.from({ length: 5 }, (_, j) => out.getParticleLabel(list.count + j));
    expect(labels[0]).toBe('NC · painted 1 · G3');
    expect(labels.map((l) => l.split(' · ').pop())).toEqual(['G3', 'T4', 'G3', 'T4', 'G3']);
    const random = paintParticles(list, [fibre()], dna(2));
    expect(random.getParticleLabel(list.count)).toMatch(/^NC · painted 1 · [ATGC]$/);
  });

  it('N3: an RNA bank reads T as U; a FASTA header and what is not a letter are left out', () => {
    expect(fiberUnits('rna', { residues: 'TTTT' }, 4, 1).units).toEqual(['rna:U', 'rna:U', 'rna:U', 'rna:U']);
    expect(fiberUnits('dna', { residues: '>seq1 test\nAC GT\n' }, 4, 1).letters).toBe('ACGT');
  });

  it('S4: reads a range, refusing 0 and an end before the start', () => {
    expect(parseRange('3-120')).toEqual({ start: 3, end: 120 });
    expect(parseRange('0-5')).toEqual({ end: 5 });
    expect(parseRange('9-3')).toEqual({});
    expect(parseRange('-9')).toEqual({ end: 9 });
    expect(parseRange('abc')).toEqual({});
  });
});
