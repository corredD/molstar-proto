/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { checkLinear, scalingAsync } from '../../../../sequences/core/_test/model/scaling.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { TestParticleList } from './fixtures.js';

// `mesoscale.theme` over N objects (`test:scaling`; packages/prism/AGENTS.md, bulk operations are one change): N
// particle lists, generated colors and by object in turn, so each run writes every list's look colors (generated, then
// cleared) as well as their themes: one transaction, a constant number of tree updates, each object found in one
// index. A lookup, a nested run or a commit per object would read about ×16.

it('mesoscale.theme over N particle lists', async () => {
  let theme: 'object' | 'generate' = 'object';
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
        theme = theme === 'object' ? 'generate' : 'object';
        const r = await v.api.run('mesoscale.theme', { objects, theme });
        if (!r.ok) throw new Error(r.message);
      },
      teardown: ({ v }) => v.dispose(),
    },
    50,
  );
  checkLinear('mesoscale.theme, N particle lists', s);
}, 600_000);

it('mesoscale.theme over N structures, each with its own colors', async () => {
  let theme: 'entity' | 'chain' = 'entity';
  const crn = readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url));
  const s = await scalingAsync(
    {
      setup: async (n) => {
        const base = DefaultPrismViewerSpec();
        const v = await createPrismViewerHeadless({
          spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
        });
        const files = Array.from({ length: n }, (_, i) => new File([crn], `s${i}.cif`));
        const r = await v.api.load.files({ files });
        if (!r.ok) throw new Error(r.message);
        const objects = v.plugin.managers.structure.hierarchy.current.structures.map((x) => x.cell.transform.ref);
        for (const structure of objects) {
          const c = await v.api.run('representation.color', { target: 'all', structure, color: 'red' });
          if (!c.ok) throw new Error(c.message);
        }
        return { v, objects };
      },
      // by entity and by chain in turn: each run writes every structure's themes
      run: async ({ v, objects }: { v: PrismViewer; objects: string[] }) => {
        theme = theme === 'entity' ? 'chain' : 'entity';
        const r = await v.api.run('mesoscale.theme', { objects, theme });
        if (!r.ok) throw new Error(r.message);
      },
      teardown: ({ v }) => v.dispose(),
    },
    8,
  );
  checkLinear('mesoscale.theme, N structures', s);
}, 600_000);
