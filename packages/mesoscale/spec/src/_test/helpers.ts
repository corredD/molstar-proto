/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoViewSpecDoc } from '../format/doc.js';
import { PlacementBuilder, type PlacementSet } from '../ir/placements.js';
import type { Resolver, ResolveJob } from '../runtime/resolver.js';
import { compile, type RuntimeOptions } from '../runtime/runtime.js';
import { DefaultResolvers } from '../resolvers/index.js';
import { ExosomeResources } from '../examples/exosome.js';

/** The resolvers, wrapped to count their `resolve` calls. */
export function countingResolvers(base: readonly Resolver<any>[] = DefaultResolvers) {
  const calls = new Map<string, number>();
  const resolvers = base.map((r) => ({
    ...r,
    resolve: (input: unknown, job: Parameters<Resolver['resolve']>[1]) => {
      calls.set(r.id, (calls.get(r.id) ?? 0) + 1);
      return r.resolve(input, job);
    },
  }));
  return { resolvers, calls, total: () => [...calls.values()].reduce((a, b) => a + b, 0) };
}

export function exosomeOptions(extra: Partial<RuntimeOptions> = {}): RuntimeOptions {
  return { resolvers: DefaultResolvers, load: (id) => ExosomeResources[id]?.(), ...extra };
}

export function compileExosome(doc: MesoViewSpecDoc, extra: Partial<RuntimeOptions> = {}) {
  return compile(doc, exosomeOptions(extra));
}

/** A shallow edit of one population. */
export function editPopulation(
  doc: MesoViewSpecDoc,
  id: string,
  edit: (p: MesoViewSpecDoc['populations'][number]) => MesoViewSpecDoc['populations'][number],
): MesoViewSpecDoc {
  return { ...doc, populations: doc.populations.map((p) => (p.id === id ? edit(p) : p)) };
}

/** A shallow edit of the session's view's looks. */
export function recolor(doc: MesoViewSpecDoc, population: string, color: string): MesoViewSpecDoc {
  const views = (doc.views ?? []).map((v) =>
    v.id === (doc.session?.view ?? doc.views?.[0]?.id)
      ? { ...v, looks: [...(v.looks ?? []), { select: `(population ${population})`, color }] }
      : v,
  );
  return { ...doc, views };
}

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
