/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoViewSpecDoc } from '../format/doc.js';
import type { Resolver } from '../runtime/resolver.js';
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
export function editPopulation(doc: MesoViewSpecDoc, id: string, edit: (p: MesoViewSpecDoc['populations'][number]) => MesoViewSpecDoc['populations'][number]): MesoViewSpecDoc {
  return { ...doc, populations: doc.populations.map((p) => (p.id === id ? edit(p) : p)) };
}

/** A shallow edit of the session's view's looks. */
export function recolor(doc: MesoViewSpecDoc, population: string, color: string): MesoViewSpecDoc {
  const views = (doc.views ?? []).map((v) =>
    v.id === (doc.session?.view ?? doc.views?.[0]?.id) ? { ...v, looks: [...(v.looks ?? []), { select: { populations: [population] }, color }] } : v,
  );
  return { ...doc, views };
}
