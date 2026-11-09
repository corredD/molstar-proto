/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { exosomeDoc } from '../examples/exosome.js';
import type { MesoViewSpecDoc } from '../format/doc.js';
import { validate } from '../format/validate.js';
import { placementSets, walk } from '../ir/ir.js';
import { DefaultResolvers } from '../resolvers/index.js';
import type { Resolver } from '../runtime/resolver.js';
import { compile } from '../runtime/runtime.js';
import { compileExosome, countingResolvers } from './helpers.js';

// Application composition (_spec/runtime.md): a rigid-body placement fed to a refine stage; both reconcile the same
// constraints, the refiner's result replaces the one it refines, and the stage before is a cache hit.

describe('refine stages', () => {
  it('the relax stage meets the catalase count the packing could not', async () => {
    const plain = await compileExosome(exosomeDoc());
    expect(plain.issues.some((i) => i.code === 'constraint.unmet' && i.ids?.[0] === 'p.catalase')).toBe(true);
    const relaxed = await compileExosome(exosomeDoc({ relax: true }));
    expect(validate(exosomeDoc({ relax: true })).filter((i) => i.severity === 'error')).toEqual([]);
    expect(relaxed.issues.filter((i) => i.code === 'constraint.unmet')).toEqual([]);
    expect(relaxed.counts['p.catalase']).toEqual({ requested: 506, achieved: 506 });
    expect((relaxed.reports['m.relax'] as { largestOverlap: number }).largestOverlap).toBeLessThanOrEqual(1);
  });

  it('no two copies overlap by more than the 1 Å tolerance after the last step; all inside the membrane, exactly', async () => {
    const r = await compileExosome(exosomeDoc({ relax: true }));
    const sets = placementSets(r.ir!);
    const picks = sets.find((s) => s.model === 'm.picks')!;
    const rel = sets.find((s) => s.model === 'm.relax')!;
    expect(sets.some((s) => s.model === 'm.recipe')).toBe(false);
    const all: [number, number, number, number][] = [];
    for (const s of [picks, rel])
      for (let i = 0; i < s.count; i++)
        all.push([s.positions[3 * i], s.positions[3 * i + 1], s.positions[3 * i + 2], s.typeTable[s.types[i]].radius]);
    let worst = 0;
    const cell = 80;
    const grid = new Map<string, number[]>();
    all.forEach((a, i) => {
      const k = `${Math.floor(a[0] / cell)},${Math.floor(a[1] / cell)},${Math.floor(a[2] / cell)}`;
      grid.set(k, [...(grid.get(k) ?? []), i]);
    });
    all.forEach((a, i) => {
      for (let u = -1; u <= 1; u++)
        for (let v = -1; v <= 1; v++)
          for (let w = -1; w <= 1; w++)
            for (const j of grid.get(
              `${Math.floor(a[0] / cell) + u},${Math.floor(a[1] / cell) + v},${Math.floor(a[2] / cell) + w}`,
            ) ?? []) {
              if (j <= i) continue;
              const b = all[j];
              worst = Math.max(worst, a[3] + b[3] - Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
            }
    });
    // measured after the last step, every pair (lipids aside: the bilayer is drawn without proteins' footprints)
    expect(worst).toBeLessThanOrEqual(1);
    // and every interior copy inside the segmented membrane by the exact mesh test, with its margin
    expect((r.reports['m.relax'] as { outsideExact: number }).outsideExact).toBe(0);
  });

  it('adding the stage reruns only the stage: the packing is a cache hit, and its resolve node is superseded', async () => {
    const counting = countingResolvers();
    const cache = new Map();
    await compileExosome(exosomeDoc(), { resolvers: counting.resolvers, cache });
    const r = await compileExosome(exosomeDoc({ relax: true }), { resolvers: counting.resolvers, cache });
    expect(counting.calls.get('cellpack-gpu')).toBe(1);
    expect(counting.calls.get('meso.relax')).toBe(1);
    const recipe = [...walk(r.ir!.root)].map(([n]) => n).find((n) => n.ref === 'm.recipe/resolve')!;
    expect(recipe.params).toMatchObject({ refinedBy: 'm.relax' });
    expect(recipe.children ?? []).toEqual([]);
  });
});

// Chains of refine stages and models around them (review gate R5, R6, R7): a refiner of a refiner keeps the original's
// `avoid`; a model that avoids a refined model avoids the refined result; a failed refiner leaves the upstream drawn.
describe('refine chains', () => {
  const base = (models: MesoViewSpecDoc['models']): MesoViewSpecDoc => ({
    format: 'meso_view_spec',
    version: '0.2.0',
    metadata: { title: 'chain' },
    units: { length: 'nm' },
    entities: [
      { id: 'e.a', label: 'a', kind: 'protein', radius: 2 },
      { id: 'e.b', label: 'b', kind: 'protein', radius: 2 },
    ],
    compartments: [{ id: 'c', label: 'c', kind: 'cell', geometry: { kind: 'sphere', radius: 100 } }],
    populations: [
      { id: 'p.a', entity: 'e.a', compartment: 'c', location: 'interior', abundance: { count: 20 } },
      { id: 'p.b', entity: 'e.b', compartment: 'c', location: 'interior', abundance: { count: 5 } },
    ],
    instances: [{ id: 'i.a', entity: 'e.a', compartment: 'c', pose: { translation: [0, 0, 0] } }],
    models,
  });
  /** A stage that records the obstacles it is given, and (refining) moves the upstream copies by `shift` Å in x. */
  const stage = (id: string, seen: Map<string, number[]>, o: { shift?: number; fail?: boolean } = {}): Resolver => ({
    id,
    version: '0',
    description: id,
    arrangements: ['random'],
    locations: ['interior'],
    project: (job) => ({ m: job.model.id, obstacles: job.obstacles.map((s) => s.key), shift: o.shift }),
    resolve: (_i, job) => {
      seen.set(
        job.model.id,
        job.obstacles.flatMap((s) => Array.from({ length: s.count }, (_, k) => s.positions[3 * k])),
      );
      if (o.fail) throw new Error('boom');
      if (job.upstream)
        return {
          ...job.upstream,
          sets: job.upstream.sets.map((s) => ({
            ...s,
            positions: s.positions.map((v, k) => (k % 3 === 0 ? v + (o.shift ?? 0) : v)),
          })),
        };
      const pop = job.populations[0];
      const positions = new Float32Array(3 * (pop.requested ?? 0));
      return {
        sets: [
          {
            key: '',
            model: job.model.id,
            frame: 'world',
            count: pop.requested ?? 0,
            positions,
            rotations: new Float32Array(4 * (pop.requested ?? 0)).map((_, k) => (k % 4 === 3 ? 1 : 0)),
            types: new Int32Array(pop.requested ?? 0),
            ordinals: Int32Array.from({ length: pop.requested ?? 0 }, (_, k) => k),
            typeTable: [{ index: 0, population: pop.id, entity: pop.entity.id, compartment: 'c', radius: 20 }],
          },
        ],
        achieved: { [pop.id]: pop.requested ?? 0 },
      };
    },
  });

  it('a refiner of a refiner keeps the avoid of the model at the head of the chain (the instances)', async () => {
    const seen = new Map<string, number[]>();
    const doc = base([
      { id: 'm.pack', kind: 'procedural', method: 'meso.pack', populations: ['p.a'] },
      { id: 'm.r1', kind: 'procedural', method: 'gate.r1', refines: 'm.pack', populations: [] },
      { id: 'm.r2', kind: 'procedural', method: 'gate.r2', refines: 'm.r1', populations: [] },
    ]);
    const r = await compile(doc, {
      resolvers: [...DefaultResolvers, stage('gate.r1', seen), stage('gate.r2', seen)],
    });
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(seen.get('m.r1')!.length).toBe(1);
    expect(seen.get('m.r2')!.length).toBe(1);
  });
  it('a model that avoids a refined model avoids the refined result, and its key follows the refiner', async () => {
    const run = async (shift: number, cache: Map<string, any>) => {
      const seen = new Map<string, number[]>();
      const doc = base([
        { id: 'm.pack', kind: 'procedural', method: 'gate.pack', populations: ['p.a'] },
        { id: 'm.b', kind: 'procedural', method: 'gate.b', populations: ['p.b'], avoid: ['m.pack'] },
        { id: 'm.r1', kind: 'procedural', method: 'gate.r1', refines: 'm.pack', populations: [] },
      ]);
      const r = await compile(doc, {
        resolvers: [
          ...DefaultResolvers,
          stage('gate.pack', seen),
          stage('gate.b', seen),
          stage('gate.r1', seen, { shift }),
        ],
        cache,
      });
      return { r, seen };
    };
    const cache = new Map();
    const { r, seen } = await run(500, cache);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const drawn = placementSets(r.ir!).find((s) => s.model === 'm.r1')!;
    expect(drawn.positions[0]).toBe(500);
    // the instance (x 0) and the 20 refined copies (x 500), never the superseded packing (x 0)
    expect(seen.get('m.b')!.sort((a, b) => a - b)).toEqual([0, ...new Array(20).fill(500)]);
    const key = (x: typeof r) => x.stats.models.find((m) => m.model === 'm.b')!.key;
    const again = await run(600, cache);
    expect(key(again.r)).not.toBe(key(r));
    expect(again.seen.get('m.b')!.filter((x) => x === 600).length).toBe(20);
  });

  it('a refiner that fails leaves the model it refines drawn and counted, without a refinedBy', async () => {
    const seen = new Map<string, number[]>();
    const doc = base([
      { id: 'm.pack', kind: 'procedural', method: 'gate.pack', populations: ['p.a'] },
      { id: 'm.r1', kind: 'procedural', method: 'gate.r1', refines: 'm.pack', populations: [] },
    ]);
    const r = await compile(doc, {
      resolvers: [...DefaultResolvers, stage('gate.pack', seen), stage('gate.r1', seen, { fail: true })],
    });
    expect(r.issues.some((i) => i.code === 'resolver.failed' && i.ids?.[0] === 'm.r1')).toBe(true);
    const pack = [...walk(r.ir!.root)].map(([n]) => n).find((n) => n.ref === 'm.pack/resolve')!;
    expect(pack.params).not.toHaveProperty('refinedBy');
    expect(placementSets(r.ir!).find((s) => s.model === 'm.pack')?.count).toBe(20);
    expect(r.counts['p.a']).toEqual({ requested: 20, achieved: 20 });
  });
});
