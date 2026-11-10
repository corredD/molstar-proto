/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { exosomeDoc } from '../examples/exosome.js';
import { placementSets } from '../ir/ir.js';
import { contentHash } from '../ir/hash.js';
import { MesoPackResolver } from '../resolvers/meso-pack.js';
import { MesoRelaxResolver } from '../resolvers/relax.js';
import { drive, SliceMs } from '../runtime/cancel.js';
import type { ResolveJob, ResolveOutput } from '../runtime/resolver.js';
import { compile } from '../runtime/runtime.js';
import { compileExosome, countingResolvers, exosomeOptions, job, setOf } from './helpers.js';

// A resolution that can be stopped (prism.md §7.2: a model edit is one step however long it takes; a cancelled one
// restores the checkpoint). `RuntimeOptions.signal` is checked between models, and the packers yield to the event loop
// now and then so the check can see an abort; with no signal they run as they always did, in one go.

const aborted = (e: unknown) => (e as { name?: string })?.name === 'AbortError';
const digest = (r: Awaited<ReturnType<typeof compileExosome>>) =>
  placementSets(r.ir!).map((s) => contentHash([s.positions, s.rotations, s.types]));

describe('compile with a signal', () => {
  it('a signal aborted before it starts: no resolver runs, the compile rejects', async () => {
    const counting = countingResolvers();
    const ctl = new AbortController();
    ctl.abort();
    const r = compile(exosomeDoc(), exosomeOptions({ resolvers: counting.resolvers, signal: ctl.signal }));
    await expect(r).rejects.toSatisfy(aborted);
    expect(counting.total()).toBe(0);
  });

  it('aborted between models: it rejects with no partial result; the next compile runs what is left, to the same IR', async () => {
    const cache = new Map();
    const ctl = new AbortController();
    const seen: string[] = [];
    const first = compile(
      exosomeDoc(),
      exosomeOptions({
        cache,
        signal: ctl.signal,
        onProgress: (p) => {
          seen.push(p.model);
          if (seen.length === 2) ctl.abort();
        },
      }),
    );
    await expect(first).rejects.toSatisfy(aborted);
    // the models before the abort are the cache's (they finished), the rest never ran
    expect(seen.length).toBe(2);
    expect(cache.size).toBe(1);

    const counting = countingResolvers();
    const again = await compile(exosomeDoc(), exosomeOptions({ cache, resolvers: counting.resolvers }));
    expect(again.stats).toMatchObject({ resolverRuns: 2, cacheHits: 1 });
    expect(digest(again)).toEqual(digest(await compileExosome(exosomeDoc())));
  });

  it('progress names each model before it resolves, with how many are done of how many', async () => {
    const seen: { model: string; done: number; total: number }[] = [];
    await compileExosome(exosomeDoc(), { onProgress: (p) => seen.push({ ...p }) });
    expect(seen.map((p) => p.done)).toEqual([0, 1, 2]);
    expect(new Set(seen.map((p) => p.total))).toEqual(new Set([3]));
    expect(seen.map((p) => p.model)).toContain('m.recipe');
  });

  it('a resolver that stops for the signal is not a resolver.failed: the compile rejects', async () => {
    const ctl = new AbortController();
    const resolvers = countingResolvers().resolvers.map((r) => ({
      ...r,
      resolve: (input: unknown, j: ResolveJob) => {
        ctl.abort();
        j.signal?.throwIfAborted();
        return r.resolve(input, j);
      },
    }));
    await expect(compile(exosomeDoc(), exosomeOptions({ resolvers, signal: ctl.signal }))).rejects.toSatisfy(aborted);
  });

  // The last model is the one with no check after it: a stop there must still keep the partial IR from standing.
  const stoppedAtLast = (stop: (ctl: AbortController) => void) => {
    const ctl = new AbortController();
    let last = false;
    const resolvers = countingResolvers().resolvers.map((r) => ({
      ...r,
      resolve: (input: unknown, j: ResolveJob) => {
        if (last) stop(ctl);
        return r.resolve(input, j);
      },
    }));
    const onProgress = (p: { done: number; total: number }) => {
      last = p.done === p.total - 1;
    };
    return compile(exosomeDoc(), exosomeOptions({ resolvers, signal: ctl.signal, onProgress }));
  };

  it('an abort whose reason is not an AbortError, the resolver failing with another error: the compile rejects', async () => {
    const r = stoppedAtLast((ctl) => {
      ctl.abort(new Error('closed'));
      throw new TypeError('cannot read the upstream');
    });
    await expect(r).rejects.toSatisfy(aborted);
  });

  it('an abort during the last model, the resolver finishing anyway: the compile rejects', async () => {
    await expect(stoppedAtLast((ctl) => ctl.abort())).rejects.toSatisfy(aborted);
  });

  it('the signal is not part of a model’s key: the same document with and without one is the same IR', async () => {
    const ctl = new AbortController();
    const a = await compileExosome(exosomeDoc(), { signal: ctl.signal });
    const b = await compileExosome(exosomeDoc());
    expect(digest(a)).toEqual(digest(b));
    expect(a.stats.models.map((m) => m.key)).toEqual(b.stats.models.map((m) => m.key));
  });
});

const packJob = (n: number, signal?: AbortSignal): ResolveJob => ({
  ...job(
    [{ id: 'p', compartment: 'c', location: 'interior', requested: n, radius: 1, arrangement: { kind: 'random' } }],
    { c: { shape: { kind: 'box', center: [0, 0, 0], size: [1e4, 1e4, 1e4] } } },
    { model: 'm.pack' },
  ),
  ...(signal ? { signal } : {}),
});

describe('drive gives the event loop back without a timer', () => {
  // A timer is clamped to 4 ms after a few nested ones, and to a second or more in a background tab: a slice yield
  // through `setTimeout` would make a long resolution crawl. With the timers faked (none ever fires), a slice still ends.
  const realSetTimeout = globalThis.setTimeout;
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a generator that crosses slices resolves with no timer firing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    function* steps(): Generator<void, number, void> {
      for (let slice = 0; slice < 3; slice++) {
        const t0 = performance.now();
        while (performance.now() - t0 < SliceMs + 2) {
          // busy: past a slice
        }
        yield;
      }
      return 7;
    }
    const run = drive({ signal: new AbortController().signal }, steps()) as Promise<number>;
    const hung = new Promise((resolve) => realSetTimeout(() => resolve('hung'), 2000));
    expect(await Promise.race([run, hung])).toBe(7);
  });
});

describe('the packers and the signal', () => {
  it('meso.pack with no signal is synchronous, as it was; with a signal that never fires it gives the same copies', async () => {
    const j = packJob(3000);
    const sync = MesoPackResolver.resolve(MesoPackResolver.project(j), j);
    expect((sync as Promise<ResolveOutput>).then).toBeUndefined();
    const withSignal = packJob(3000, new AbortController().signal);
    const slow = MesoPackResolver.resolve(MesoPackResolver.project(withSignal), withSignal);
    expect(typeof (slow as Promise<ResolveOutput>).then).toBe('function');
    const out = await slow;
    const ref = sync as ResolveOutput;
    expect(out.achieved).toEqual(ref.achieved);
    expect(out.sets[0].positions).toEqual(ref.sets[0].positions);
    expect(out.sets[0].rotations).toEqual(ref.sets[0].rotations);
  });

  it('meso.pack stops mid-loop when the signal fires: a long packing is not waited out', async () => {
    const ctl = new AbortController();
    const j = packJob(5_000_000, ctl.signal);
    const t0 = performance.now();
    const run = MesoPackResolver.resolve(MesoPackResolver.project(j), j) as Promise<ResolveOutput>;
    setTimeout(() => ctl.abort(), 50);
    await expect(run).rejects.toSatisfy(aborted);
    // five million copies take many seconds; the abort is seen within a slice or two
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it('meso.relax stops mid-loop when the signal fires', async () => {
    const n = 4000;
    const side = Math.ceil(Math.cbrt(n));
    const up = setOf(
      n,
      (i) => [30 * (i % side), 30 * (Math.floor(i / side) % side), 30 * Math.floor(i / (side * side))],
      { population: 'p', compartment: 'c', radius: 20 },
    );
    const ctl = new AbortController();
    const j = {
      ...job(
        [
          {
            id: 'p',
            compartment: 'c',
            location: 'interior',
            requested: n,
            radius: 20,
            arrangement: { kind: 'random' },
          },
        ],
        { c: { shape: { kind: 'box', center: [0, 0, 0], size: [1e5, 1e5, 1e5] } } },
        {
          model: 'm.relax',
          params: { iterations: 1_000_000, tolerance: -1, insert: false },
          upstream: { sets: [up], achieved: { p: n } },
        },
      ),
      signal: ctl.signal,
    } as ResolveJob;
    const t0 = performance.now();
    const run = MesoRelaxResolver.resolve(MesoRelaxResolver.project(j), j) as Promise<ResolveOutput>;
    setTimeout(() => ctl.abort(), 50);
    await expect(run).rejects.toSatisfy(aborted);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
