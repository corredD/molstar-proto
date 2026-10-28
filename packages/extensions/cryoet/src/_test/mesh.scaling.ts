/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { it } from 'vitest';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import {
  checkLinear,
  quadraticControl,
  scaling,
  scalingAsync,
} from '../../../../sequences/core/_test/model/scaling.js';
import { CryoetExtension } from '../prism-viewer.js';

// `cryoet.mesh` coloring N meshes in one call (`test:scaling`; packages/prism/AGENTS.md, bulk operations are one
// change): the meshes indexed once, each entry found without a scan. An already-so call (no write) shows the lookups;
// a filter of every mesh per entry would read about ×16.

it('the positive control (a copy per item) is caught', () => {
  checkLinear('quadratic control', scaling(quadraticControl, 2000), false);
});

it('cryoet.mesh colors over N meshes', async () => {
  const s = await scalingAsync(
    {
      setup: async (n) => {
        const base = DefaultPrismViewerSpec();
        const v = await createPrismViewerHeadless({
          spec: { ...base, extensions: [...(base.extensions ?? []), CryoetExtension] },
        });
        const obj = 'v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n';
        const r = await v.api.load.files({ files: Array.from({ length: n }, (_, i) => new File([obj], `m${i}.obj`)) });
        if (!r.ok) throw new Error(r.message);
        const m = await v.api.run('cryoet.meshes', {});
        const colors = ((m as { value?: { ref: string }[] }).value ?? []).map((x) => ({
          mesh: x.ref,
          color: 'tomato',
        }));
        const first = await v.api.run('cryoet.mesh', { colors });
        if (!first.ok) throw new Error(first.message);
        return { v, colors };
      },
      run: async ({ v, colors }: { v: PrismViewer; colors: object[] }) => {
        const r = await v.api.run('cryoet.mesh', { colors });
        if (!r.ok || !r.unchanged) throw new Error('expected already');
      },
      teardown: ({ v }) => v.dispose(),
    },
    100,
  );
  checkLinear('cryoet.mesh colors, N meshes', s);
}, 600_000);
