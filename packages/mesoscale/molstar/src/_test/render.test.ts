/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */
// @module-tag medium

import { compile, updateView } from '@molstar/meso-spec/runtime/runtime';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers/index';
import { exosomeDoc, ExosomeResources } from '@molstar/meso-spec/examples/exosome';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import { describe, expect, it } from 'vitest';
import { PrismMesoAdapter } from '../prism-adapter.js';
import { tryGl } from './gl.js';

// The integration lane's rendered check (design.md §12): the exosome drawn by Mol* through Prism with a WebGL context
// (`gl`, Node), the image not empty, and a color edit changing pixels without a new list. Skipped without `gl`.

const gl = tryGl();

describe('the Prism adapter, rendered', () => {
  (gl ? it : it.skip)(
    'draws the exosome; a color edit changes the image, not the lists',
    { tags: ['medium'] },
    async () => {
      const v = await createPrismViewerHeadless({
        spec: createMesoscaleExplorerSpec(''),
        plugin: (s) => new HeadlessPluginContext({ gl: gl! }, s, { width: 160, height: 120 }, {}),
      });
      try {
        const adapter = new PrismMesoAdapter(v);
        const r = await compile(exosomeDoc(), { resolvers: DefaultResolvers, load: (id) => ExosomeResources[id]?.() });
        const t0 = performance.now();
        await adapter.commit(r.ir!);
        const plugin = v.plugin as HeadlessPluginContext;
        const img0 = await plugin.getImageRaw({ width: 160, height: 120 });
        const t1 = performance.now();
        const background = [img0.data[0], img0.data[1], img0.data[2]];
        let drawn = 0;
        for (let i = 0; i < img0.data.length; i += 4)
          if (
            img0.data[i] !== background[0] ||
            img0.data[i + 1] !== background[1] ||
            img0.data[i + 2] !== background[2]
          )
            drawn++;
        expect(drawn / (160 * 120)).toBeGreaterThan(0.05);

        const doc = {
          ...exosomeDoc(),
          views: exosomeDoc().views!.map((x) => ({
            ...x,
            looks: [...(x.looks ?? []), { select: { compartments: ['medium', 'c.exosome'] }, color: '#00ff00' }],
          })),
        };
        const report = await adapter.commit(updateView(doc, r.ir!));
        const img1 = await plugin.getImageRaw({ width: 160, height: 120 });
        expect(report.added).toEqual([]);
        let changed = 0;
        for (let i = 0; i < img0.data.length; i += 4) if (img0.data[i + 1] !== img1.data[i + 1]) changed++;
        expect(changed).toBeGreaterThan(100);
        console.log(
          `[meso] first commit + draw ${(t1 - t0).toFixed(0)} ms; color commit ${report.ms.total.toFixed(1)} ms (looks ${report.ms.looks?.toFixed(1)} ms)`,
        );
      } finally {
        await v.dispose();
      }
    },
  );
});
