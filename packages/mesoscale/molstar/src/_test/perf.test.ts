/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */
// @module-tag heavy

import { writeFileSync } from 'node:fs';
import { scaleDoc } from '@molstar/meso-spec/examples/scale';
import { placementSets } from '@molstar/meso-spec/ir/ir';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers/index';
import { compile, updateView } from '@molstar/meso-spec/runtime/runtime';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import { describe, expect, it } from 'vitest';
import { irToMolViewSpec } from '../mvs-export.js';
import { PrismMesoAdapter } from '../prism-adapter.js';
import { tryGl } from './gl.js';

// The adapter's side of the performance lane (design.md §8): committing large scenes into Prism (with a GL context
// when `gl` is installed, the first image included), a color edit on them, and the size of the MolViewSpec path.

const out: Record<string, unknown> = {};
const record = (k: string, v: unknown) => {
  out[k] = v;
  console.log(`[meso-perf] ${k} ${JSON.stringify(v)}`);
  if (process.env.MESO_PERF_OUT) writeFileSync(process.env.MESO_PERF_OUT, JSON.stringify(out, null, 1));
};
const gl = tryGl();

describe('adapter performance', () => {
  for (const [kind, n] of [['pack', 50_000], ['bilayer', 1_000_000]] as const) {
    it(`${kind} ${n}: commit, first image, color edit`, { tags: ['heavy'] }, async () => {
      const v = await createPrismViewerHeadless({
        spec: createMesoscaleExplorerSpec(''),
        plugin: gl ? (s) => new HeadlessPluginContext({ gl }, s, { width: 400, height: 300 }, {}) : undefined,
      });
      try {
        const adapter = new PrismMesoAdapter(v);
        const doc = scaleDoc(kind, n);
        const r = await compile(doc, { resolvers: DefaultResolvers });
        const commit = await adapter.commit(r.ir!);
        let imageMs: number | undefined;
        if (gl) {
          const t = performance.now();
          await (v.plugin as HeadlessPluginContext).getImageRaw({ width: 400, height: 300 });
          imageMs = performance.now() - t;
        }
        const recolored = { ...doc, views: [{ ...doc.views![0], looks: [{ select: { compartments: ['c.cell'] }, color: '#d0453a' }] }] };
        const look = await adapter.commit(updateView(recolored, r.ir!));
        let image2Ms: number | undefined;
        if (gl) {
          const t = performance.now();
          await (v.plugin as HeadlessPluginContext).getImageRaw({ width: 400, height: 300 });
          image2Ms = performance.now() - t;
        }
        const copies = placementSets(r.ir!).reduce((s, x) => s + x.count, 0);
        record(`${kind}${n}`, {
          copies,
          gl: !!gl,
          resolve_ms: Math.round(r.stats.ms.resolve),
          commit_ms: Math.round(commit.ms.total),
          first_image_ms: imageMs && Math.round(imageMs),
          color_commit_ms: +look.ms.total.toFixed(1),
          image_after_color_ms: image2Ms && Math.round(image2Ms),
        });
        expect(look.added).toEqual([]);
      } finally {
        await v.dispose();
      }
    });
  }

  it('the MolViewSpec path: bytes a copy', { tags: ['heavy'] }, async () => {
    const r = await compile(scaleDoc('pack', 50_000), { resolvers: DefaultResolvers });
    const t = performance.now();
    const { data, copies } = irToMolViewSpec(r.ir!);
    const json = JSON.stringify(data);
    record('mvs50k', { copies, export_ms: Math.round(performance.now() - t), json_MB: +(json.length / 2 ** 20).toFixed(1), bytes_per_copy: Math.round(json.length / copies) });
  });
});
