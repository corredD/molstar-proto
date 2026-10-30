/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { it } from 'vitest';
import { checkLinear, scalingAsync } from '../../../../../packages/sequences/core/_test/model/scaling.js';
import { MesoscaleExplorerExtensions } from '../../extensions.js';

// `explorer.clipUse` over N objects (`test:scaling`; AGENTS.md, bulk operations are one change): a category's Use a
// clip gives a clip every object in it, then takes them off again, each run one step. One commit for all of them; a
// commit per object (each reconciling the cuts' drawings over every cell) reads about ×16.

it('explorer.clipUse over N structures', async () => {
  const crn = readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url));
  const s = await scalingAsync(
    {
      setup: async (n) => {
        const base = DefaultPrismViewerSpec();
        const v = await createPrismViewerHeadless({
          spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
        });
        const files = Array.from({ length: n + 1 }, (_, i) => new File([crn], `s${i}.cif`));
        const r = await v.api.load.files({ files });
        if (!r.ok) throw new Error(r.message);
        const [first, ...objects] = v.plugin.managers.structure.hierarchy.current.structures.map(
          (x) => x.cell.transform.ref,
        );
        // the clip, on one more object (a clip cuts something)
        const c = await v.api.run('clipping.add', { shape: 'plane', node: `#${first}` });
        if (!c.ok) throw new Error(c.message);
        return { v, objects, tag: v.api.clipping.cuts.value[0].object.tag! };
      },
      run: async ({ v, objects, tag }: { v: PrismViewer; objects: string[]; tag: string }) => {
        // on, then off: a change every run
        const area = v.api.explorer!;
        const on = !v.api.clipping.cuts.value[0].targets.some((t) => area.isUnder(t.ref, objects[0]));
        const r = await v.api.run('explorer.clipUse', { tag, nodes: objects.map((ref) => ({ ref })), on });
        if (!r.ok || r.unchanged) throw new Error(r.ok ? 'unchanged' : r.message);
      },
      teardown: ({ v }) => v.dispose(),
    },
    24,
  );
  checkLinear('explorer.clipUse, N structures', s);
}, 600_000);
