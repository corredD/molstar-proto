/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */
import { writeFileSync } from 'node:fs';
import v8 from 'node:v8';
import vm from 'node:vm';
import { tiledFixture } from '@molstar/meso-spec/examples';
import { placementBytes } from '@molstar/meso-spec/ir';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers';
import { compile, streamNode, tileSet, updateView, withTiles } from '@molstar/meso-spec/runtime';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import { afterEach, describe, expect, it } from 'vitest';
import { PrismMesoAdapter } from '../prism-adapter.js';
import { tryGl } from './gl.js';

// The R5 cases (design.md §6.8.7), defined for the test files that run them, in files of their own (run after the other heavy adapter tests in one worker, the 1,000-list case was killed, most likely for memory;
// alone it passes).

const out: Record<string, unknown> = {};
const record = (k: string, v: unknown) => {
  out[k] = v;
  console.log(`[meso-perf] ${k} ${JSON.stringify(v)}`);
  if (process.env.MESO_PERF_OUT) writeFileSync(process.env.MESO_PERF_OUT, JSON.stringify(out, null, 1));
};
const gl = tryGl();

// a collection between cases: the scenes of the earlier cases are garbage, and a worker that keeps them is killed
function collect() {
  v8.setFlagsFromString('--expose-gc');
  (vm.runInNewContext('gc') as () => void)();
}

export function defineR5(splits: readonly number[]) {
  describe('R5: one list per placement set', () => {
    afterEach(collect);

    // R5 (renderer-recommendations.md): one list and representation per placement set. 1,000,000 copies of one population
    // as 1, 10, 100 and 1,000 sets (equal tiles), committed whole through the adapter; then a stream step (one set out,
    // the same set back in, the looks rewritten) and a color edit.
    for (const sets of splits) {
      it(
        `R5: 1M copies in ${sets} placement sets`,
        { tags: ['heavy'] },
        async () => {
          const total = 1_000_000;
          const { doc, provider } = tiledFixture({ grid: [sets, 1, 1], perTile: { 'p.a': total / sets, 'p.b': 0 } });
          const r = await compile(doc, { resolvers: DefaultResolvers, tiles: () => provider });
          const node = streamNode(r.ir!)!;
          const signal = new AbortController().signal;
          const loaded = new Map<string, ReturnType<typeof tileSet>>();
          for (const t of node.params.tiles) loaded.set(t.id, tileSet(node, t, await provider.load(t.id, 1, signal)));
          const all = [...loaded.values()];
          const copies = all.reduce((n, x) => n + x.count, 0);
          const placement_MB = all.reduce((n, x) => n + placementBytes(x), 0) / 2 ** 20;
          const ir = (m: ReadonlyMap<string, ReturnType<typeof tileSet>>, d = doc) =>
            updateView(d, withTiles(r.ir!, m));
          const heap = () => {
            (globalThis as { gc?: () => void }).gc?.();
            return process.memoryUsage().heapUsed;
          };
          const v = await createPrismViewerHeadless({
            spec: createMesoscaleExplorerSpec(''),
            plugin: gl ? (s) => new HeadlessPluginContext({ gl }, s, { width: 400, height: 300 }, {}) : undefined,
          });
          try {
            const adapter = new PrismMesoAdapter(v);
            const frame = async () => {
              const t = performance.now();
              await (v.plugin as HeadlessPluginContext).getImageRaw({ width: 400, height: 300 });
              return performance.now() - t;
            };
            const hasGc = typeof (globalThis as { gc?: unknown }).gc === 'function';
            const h0 = heap();
            const commit = await adapter.commit(ir(loaded));
            const h1 = heap();
            let first_frame_ms: number | undefined;
            let steady_frame_ms: number | undefined;
            if (gl) {
              first_frame_ms = await frame();
              let sum = 0;
              for (let i = 0; i < 10; i++) sum += await frame();
              steady_frame_ms = sum / 10;
            }
            const without = new Map(loaded);
            without.delete(node.params.tiles[0].id);
            const out1 = await adapter.commit(ir(without));
            // the add brings the tile back as a set built afresh (a load's arrival), not the object that left
            const back = new Map(without);
            const first = node.params.tiles[0];
            back.set(first.id, tileSet(node, first, await provider.load(first.id, 1, signal)));
            const in1 = await adapter.commit(ir(back));
            const recolored = {
              ...doc,
              views: doc.views!.map((x) =>
                x.id === doc.session!.view ? { ...x, looks: [{ select: '(population p.a)', color: '#d0453a' }] } : x,
              ),
            };
            const look = await adapter.commit(ir(back, recolored));
            const round = (x: number | undefined, d = 1) => (x === undefined ? undefined : +x.toFixed(d));
            record(`r5_${sets}_sets`, {
              sets,
              copies,
              gl: !!gl,
              commit_ms: Math.round(commit.ms.total),
              commit_ms_per_set: round(commit.ms.total / sets, 2),
              first_frame_ms: round(first_frame_ms),
              steady_frame_ms: round(steady_frame_ms),
              placement_MB: round(placement_MB),
              adapter_MB: round((copies * 8) / 2 ** 20),
              heap_delta_MB: hasGc ? round((h1 - h0) / 2 ** 20) : 'not measured (no --expose-gc)',
              stream_remove_ms: round(out1.ms.total),
              stream_add_ms: round(in1.ms.total),
              stream_remove_looks_written: out1.looksWritten,
              stream_add_looks_written: in1.looksWritten,
              color_commit_ms: round(look.ms.total),
            });
            expect(copies).toBe(total);
            const tile = (k: string) => k.startsWith('m.tiles@');
            expect(commit.added.filter(tile).length).toBe(sets);
            expect(out1.removed.filter(tile).length).toBe(1);
            expect(in1.added.filter(tile).length).toBe(1);
            expect(look.added).toEqual([]);
          } finally {
            await v.dispose();
          }
        },
        600_000,
      );
    }
  });
}
