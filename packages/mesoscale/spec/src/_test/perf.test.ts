/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */
// @module-tag heavy

import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scaleDoc } from '../examples/scale.js';
import { placementSets } from '../ir/ir.js';
import { BytesPerPlacement, placementBytes } from '../ir/placements.js';
import { planCommit } from '../runtime/adapter.js';
import { compile, updateView } from '../runtime/runtime.js';
import { DefaultResolvers } from '../resolvers/index.js';

// The performance lane (design.md §8; opt-in: `pnpm test:heavy packages/mesoscale`): resolution scaling by size,
// memory per copy, and the cost of the edits that must not depend on N. Wall-clock bounds are generous (a laptop on
// battery passes); the ratios are what catch quadratic work. Results print as `[meso-perf]` lines, and go to the file
// in MESO_PERF_OUT when set.

const results: Record<string, unknown> = {};
const record = (k: string, v: unknown) => {
  results[k] = v;
  console.log(`[meso-perf] ${k} ${JSON.stringify(v)}`);
  if (process.env.MESO_PERF_OUT) writeFileSync(process.env.MESO_PERF_OUT, JSON.stringify(results, null, 1));
};
const time = async <T>(f: () => Promise<T>) => {
  const t = performance.now();
  const v = await f();
  return [v, performance.now() - t] as const;
};

describe('performance', () => {
  it('packing scales near linearly: 16× the copies, well under 16² the time', { tags: ['heavy'] }, async () => {
    const sizes = [5_000, 20_000, 80_000];
    const ms: number[] = [];
    for (const n of sizes) {
      const [r, t] = await time(() => compile(scaleDoc('pack', n), { resolvers: DefaultResolvers }));
      expect(r.issues.filter((i) => i.code === 'constraint.unmet')).toEqual([]);
      ms.push(t);
    }
    record('pack.resolve_ms', Object.fromEntries(sizes.map((n, i) => [n, Math.round(ms[i])])));
    const perCopy = ms.map((t, i) => t / sizes[i]);
    record('pack.us_per_copy', perCopy.map((x) => +(1000 * x).toFixed(2)));
    expect(perCopy[2] / perCopy[0]).toBeLessThan(3);
  });

  it('a million lipids: 36 bytes a copy, no copy of the buffers', { tags: ['heavy'] }, async () => {
    const before = process.memoryUsage().arrayBuffers;
    const [r, t] = await time(() => compile(scaleDoc('bilayer', 1_000_000), { resolvers: DefaultResolvers }));
    const after = process.memoryUsage().arrayBuffers;
    const [s] = placementSets(r.ir!);
    record('bilayer1M', { copies: s.count, resolve_ms: Math.round(t), placement_MB: +(placementBytes(s) / 2 ** 20).toFixed(1), arrayBuffers_delta_MB: +((after - before) / 2 ** 20).toFixed(1) });
    expect(placementBytes(s)).toBe(s.count * BytesPerPlacement);
    // allocated once, exactly: no growth, no trim (the buffers are the set's, not a view of a larger one)
    expect(s.positions.buffer.byteLength).toBe(s.count * 12);
    expect(s.rotations.buffer.byteLength).toBe(s.count * 16);
    expect(t).toBeLessThan(5000);
  });

  it('on a million copies, a view edit and a cached compile do not depend on N', { tags: ['heavy'] }, async () => {
    const doc = scaleDoc('bilayer', 1_000_000);
    const cache = new Map();
    const [first] = await time(() => compile(doc, { resolvers: DefaultResolvers, cache }));
    const recolored = { ...doc, views: [{ ...doc.views![0], looks: [{ select: { compartments: ['c.cell'] }, color: '#d0453a' }] }] };
    const [ir, viewMs] = await time(async () => updateView(recolored, first.ir!));
    const [again, cachedMs] = await time(() => compile(recolored, { resolvers: DefaultResolvers, cache }));
    const [plan, planMs] = await time(async () => planCommit(first.ir, ir));
    record('edits1M', { view_edit_ms: +viewMs.toFixed(2), cached_compile_ms: +cachedMs.toFixed(1), plan_ms: +planMs.toFixed(2) });
    expect(again.stats.resolverRuns).toBe(0);
    expect(plan.add).toEqual([]);
    expect(viewMs).toBeLessThan(20);
    expect(planMs).toBeLessThan(20);
    expect(cachedMs).toBeLessThan(200);
  });
});
