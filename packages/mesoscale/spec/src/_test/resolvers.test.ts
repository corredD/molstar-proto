/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { PlacementBuilder, type PlacementSet } from '../ir/placements.js';
import { MesoFiberResolver } from '../resolvers/fiber.js';
import { sdfGrid, shapeSampler } from '../resolvers/geometry.js';
import { MesoRelaxResolver } from '../resolvers/relax.js';
import { createRandom } from '../runtime/random.js';
import type { ResolveJob, ResolveOutput } from '../runtime/resolver.js';

// The resolvers' review-gate findings (progress/2026-11-08-mesoviewspec.md, the gate): each a resolver run on a small
// hand-made job, what it must hold.

const entity = (id: string) => ({ id, label: id });

/** A resolve job from populations and compartments (the compartments' `children` default to none). */
export function job(pops: any[], comps: Record<string, any>, extra: any = {}): ResolveJob {
  return {
    model: {
      id: extra.model ?? 'm',
      kind: 'procedural',
      method: 'x',
      populations: pops.map((p) => p.id),
      params: extra.params,
    },
    populations: pops.map((p) => ({ entity: entity(`e.${p.id}`), minFraction: 1, minDistances: [], ...p })),
    compartments: new Map(Object.entries(comps).map(([k, v]) => [k, { id: k, label: k, children: [], ...v }])),
    inputs: new Map(),
    obstacles: extra.obstacles ?? [],
    seed: extra.seed ?? 1,
    relations: extra.relations ?? [],
    upstream: extra.upstream,
  } as unknown as ResolveJob;
}

/** One placement set of `n` copies of one type, from a position function. */
export function setOf(
  n: number,
  at: (i: number) => [number, number, number],
  type: { population: string; compartment: string; radius: number },
  model = 'm.up',
): PlacementSet {
  const b = new PlacementBuilder(n);
  for (let i = 0; i < n; i++) b.push(0, ...at(i), [0, 0, 0, 1]);
  return b.finish({
    key: `${model}#0`,
    model,
    frame: 'world',
    typeTable: [{ index: 0, entity: `e.${type.population}`, label: type.population, ...type }],
  });
}

const run = <T>(r: { project(j: ResolveJob): T; resolve(i: T, j: ResolveJob): unknown }, j: ResolveJob) =>
  r.resolve(r.project(j), j) as ResolveOutput;

describe('meso.relax', () => {
  it('relaxes 150 000 copies (no argument spread over the bodies)', () => {
    const n = 150_000;
    const r = createRandom(7);
    const up = setOf(n, () => [r.range(-3000, 3000), r.range(-3000, 3000), r.range(-3000, 3000)], {
      population: 'p',
      compartment: 'c',
      radius: 10,
    });
    const j = job(
      [{ id: 'p', compartment: 'c', location: 'interior', requested: n, radius: 10, arrangement: { kind: 'random' } }],
      { c: { shape: { kind: 'box', center: [0, 0, 0], size: [7000, 7000, 7000] } } },
      { params: { iterations: 1, tolerance: 1 }, upstream: { sets: [up], achieved: { p: n } } },
    );
    expect(() => run(MesoRelaxResolver, j)).not.toThrow();
  });
});

const xs = (s: PlacementSet) => Array.from({ length: s.count }, (_, i) => s.positions[3 * i]);
const line = (step: number, n: number) => Array.from({ length: n + 1 }, (_, i) => [step * i, 0, 0] as const);
const bigSphere = { c: { shape: { kind: 'sphere', center: [0, 0, 0], radius: 1e4 } } };
const strand = (id: string, requested: number, path: readonly (readonly number[])[]) => ({
  id,
  compartment: 'c',
  location: 'interior',
  requested,
  radius: 5,
  arrangement: { kind: 'fiber', rise: 10, twist: 0, path },
});

describe('meso.fiber', () => {
  it('a grown filament has the persistence length asked: tangent correlation exp(-s/P)', () => {
    const P = 500;
    const grown = {
      ...strand('f', 20_000, []),
      radius: 1,
      arrangement: { kind: 'fiber', rise: 10, twist: 0, growth: { persistence: P, length: 2000, count: 100 } },
    };
    const out = run(
      MesoFiberResolver,
      job([grown], { c: { shape: { kind: 'sphere', center: [0, 0, 0], radius: 1e7 } } }),
    );
    const s = out.sets[0];
    const { offsets, indices } = s.fibers!;
    const tan = (k: number) => {
      const i = 3 * indices[k],
        j = 3 * indices[k + 1];
      const d = [0, 1, 2].map((c) => s.positions[j + c] - s.positions[i + c]);
      const l = Math.hypot(d[0], d[1], d[2]);
      return d.map((x) => x / l);
    };
    for (const lag of [1, 5, 10]) {
      let sum = 0,
        n = 0;
      for (let f = 0; f < s.fibers!.count; f++)
        for (let k = offsets[f]; k + lag + 1 < offsets[f + 1]; k++) {
          const a = tan(k),
            b = tan(k + lag);
          sum += a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
          n++;
        }
      const effective = (-lag * 10) / Math.log(sum / n);
      expect(effective / P).toBeGreaterThan(0.85);
      expect(effective / P).toBeLessThan(1.15);
    }
  });

  it('a traced path keeps copies one rise apart whatever its point spacing (the carry crosses short segments)', () => {
    for (const step of [2, 7, 25]) {
      const len = 200 - (200 % step);
      const n = Math.floor(len / 10) + 1;
      const out = run(MesoFiberResolver, job([strand('f', n, line(step, len / step))], bigSphere));
      expect(out.achieved.f).toBe(n);
      const x = xs(out.sets[0]);
      for (let i = 0; i < n; i++) expect(x[i]).toBeCloseTo(10 * i, 3);
    }
  });

  it("a binder's shortfall gives its own strand's length, not every strand's before it", () => {
    const binder = {
      id: 'b',
      compartment: 'c',
      location: 'interior',
      requested: 100,
      radius: 5,
      arrangement: { kind: 'random' },
    };
    const rel = {
      id: 'r',
      kind: 'binds',
      subjects: ['b'],
      objects: ['g'],
      entry: { position: [0, 0, 0] },
      spacing: 50,
    };
    const out = run(
      MesoFiberResolver,
      job([strand('f', 101, line(10, 100)), strand('g', 21, line(10, 20)), binder], bigSphere, { relations: [rel] }),
    );
    expect(out.shortfall?.b).toMatch(/the strand g is 200 Å long/);
  });
});

/** A cube of half-side `h` as a triangle mesh (outward winding): its face diagonals are shared edges. */
export function cubeMesh(h: number) {
  const v = [
    [-h, -h, -h],
    [h, -h, -h],
    [h, h, -h],
    [-h, h, -h],
    [-h, -h, h],
    [h, -h, h],
    [h, h, h],
    [-h, h, h],
  ];
  const f = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [2, 3, 7],
    [2, 7, 6],
    [1, 2, 6],
    [1, 6, 5],
    [0, 4, 7],
    [0, 7, 3],
  ];
  return { positions: new Float32Array(v.flat()), indices: new Uint32Array(f.flat()) };
}

describe('mesh compartments', () => {
  it('the inside test does not count a ray through a shared edge twice', () => {
    const s = shapeSampler({ kind: 'mesh' } as never, cubeMesh(100))!;
    for (const p of [
      [0, 0, 0],
      [0, 10, 10],
      [0, -30, -30],
      [50, 50, 50],
    ])
      expect(s.contains(p[0], p[1], p[2], 0)).toBe(true);
    const g = sdfGrid(s, createRandom(3), 41);
    let wrong = 0;
    for (let i = 0; i < g.n; i++)
      for (let j = 0; j < g.n; j++)
        for (let k = 0; k < g.n; k++) {
          const x = g.min[0] + i * g.cell,
            y = g.min[1] + j * g.cell,
            z = g.min[2] + k * g.cell;
          if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) < 90 && g.distance(x, y, z) > 0) wrong++;
        }
    expect(wrong).toBe(0);
  });
});
