/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { exosomeDoc } from '../examples/exosome.js';
import { validate } from '../format/validate.js';
import { placementSets, walk } from '../ir/ir.js';
import { compileExosome, countingResolvers } from './helpers.js';

// Application composition (design.md §6.7): a rigid-body placement fed to a refine stage; both reconcile the same
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

  it('no two copies overlap by more than the tolerance; the picks did not move', async () => {
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
    // membrane proteins sit fixed in the membrane: interior copies settle against them within the tolerance
    expect(worst).toBeLessThanOrEqual(1.5);
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
