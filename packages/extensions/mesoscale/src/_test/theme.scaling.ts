/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { expect, it } from 'vitest';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { checkLinear, scalingAsync } from '../../../../sequences/core/_test/model/scaling.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { TestParticleList } from './fixtures.js';

// `mesoscale.theme` over N objects (`test:scaling`; packages/prism/AGENTS.md, bulk operations are one change): N
// particle lists colored by object, one commit of their representations' themes, each object found in one index. A
// lookup or a commit per object would read about ×16.

it('mesoscale.theme over N particle lists', async () => {
  let theme: 'object' | 'uniform' = 'object';
  const s = await scalingAsync(
    {
      setup: async (n) => {
        const base = DefaultPrismViewerSpec();
        const v = await createPrismViewerHeadless({
          spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
        });
        const b = v.plugin.build();
        for (let i = 0; i < n; i++) b.toRoot().apply(TestParticleList);
        await b.commit();
        for (const l of v.plugin.managers.particles.hierarchy.current.lists) {
          const r = await v.api.particles.representation({ type: 'spacefill', particles: l.cell.transform.ref });
          expect(r.ok).toBe(true);
        }
        return { v, objects: v.plugin.managers.particles.hierarchy.current.lists.map((l) => l.cell.transform.ref) };
      },
      run: async ({ v, objects }: { v: PrismViewer; objects: string[] }) => {
        // a change every run (alternating), so each measures the write
        theme = theme === 'object' ? 'uniform' : 'object';
        const r = await v.api.run('mesoscale.theme', { objects, theme });
        if (!r.ok) throw new Error(r.message);
      },
      teardown: ({ v }) => v.dispose(),
    },
    50,
  );
  checkLinear('mesoscale.theme, N particle lists', s);
}, 600_000);
