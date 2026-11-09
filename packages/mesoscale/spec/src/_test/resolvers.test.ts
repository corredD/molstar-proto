/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { PlacementBuilder, type PlacementSet } from '../ir/placements.js';
import { MesoFiberResolver } from '../resolvers/fiber.js';
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
