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
import { TestTargetList, setTestTargetStructure } from './fixtures.js';

// `mesoscale.colorLevels` over N particle lists drawn as targets (`test:scaling`; packages/prism/AGENTS.md, bulk
// operations are one change): one commit for every representation, an edge changed every run. A commit or a lookup
// per list would read about ×16.

it('mesoscale.colorLevels over N particle lists', async () => {
  let chain = 10;
  const s = await scalingAsync(
    {
      setup: async (n) => {
        const base = DefaultPrismViewerSpec();
        const v = await createPrismViewerHeadless({
          spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
        });
        const crn = readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url));
        expect((await v.api.load.files({ files: [new File([crn], '1crn.cif')] })).ok).toBe(true);
        setTestTargetStructure(v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data);
        const b = v.plugin.build();
        for (let i = 0; i < n; i++) b.toRoot().apply(TestTargetList);
        await b.commit();
        for (const l of v.plugin.managers.particles.hierarchy.current.lists) {
          const r = await v.api.particles.representation({ type: 'target', particles: l.cell.transform.ref });
          expect(r.ok).toBe(true);
        }
        return { v };
      },
      run: async ({ v }: { v: PrismViewer }) => {
        // a change every run, so each measures the write
        chain = chain === 10 ? 12 : 10;
        const r = await v.api.run('mesoscale.colorLevels', { chain });
        if (!r.ok) throw new Error(r.message);
      },
      teardown: ({ v }) => v.dispose(),
    },
    50,
  );
  checkLinear('mesoscale.colorLevels, N particle lists', s);
}, 600_000);
