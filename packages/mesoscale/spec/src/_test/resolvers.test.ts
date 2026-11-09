/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { PlacementBuilder, type PlacementSet } from '../ir/placements.js';
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
