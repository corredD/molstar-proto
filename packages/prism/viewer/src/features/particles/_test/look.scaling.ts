/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { Color } from '@molstar/core/util/color';
import { ParticleRepresentation3DLayers } from '@molstar/plugin/state/transforms/particles/layers';
import { it } from 'vitest';
import { checkLinear, quadraticControl, scaling, scalingAsync } from '../../../../../ui/src/_test/scaling.js';
import { expectOk, headlessViewer } from '../../../_test/harness.js';
import { patchParticleLook } from '../../../sources/particles/look.js';
import type { PrismViewer } from '../../../viewer.js';

// A looks patch of N layers over a cell of N layers grows about linearly (`test:scaling`; packages/prism/AGENTS.md,
// bulk operations are one change): the layers indexed once by their key, a patch a lookup, never a scan per patch.

const simularium = () =>
  new File(
    [readFileSync(new URL('../../../../../../../data/examples/particles/small.simularium', import.meta.url))],
    'small.simularium',
  );

const layer = (i: number, color: number) => ({
  entities: [i],
  compartments: [],
  targets: [],
  visible: true,
  color: Color(color),
  transparency: null,
  emissive: null,
});

it('the positive control (a copy per item) is caught', () => {
  checkLinear('quadratic control', scaling(quadraticControl, 2000), false);
});

it('a looks patch of N layers over N layers', async () => {
  const s = await scalingAsync(
    {
      setup: async (n) => {
        const v = await headlessViewer();
        expectOk(await v.api.load.files({ files: [simularium()] }));
        const repr = v.plugin.managers.particles.hierarchy.current.lists[0].representations[0].cell.transform.ref;
        const layers = Array.from({ length: n }, (_, i) => layer(i, 0xff0000));
        await v.plugin
          .build()
          .to(repr)
          .apply(ParticleRepresentation3DLayers, { layers, cuts: [], hidden: [] })
          .commit();
        const patches = Array.from({ length: n }, (_, i) => ({
          selector: { entities: [n - 1 - i] },
          color: Color(0xff),
        }));
        return { v, repr, patches };
      },
      run: async ({ v, repr, patches }: { v: PrismViewer; repr: string; patches: { selector: object }[] }) => {
        if (!patchParticleLook(v.plugin.state.data.build(), repr, { layers: patches })) throw new Error('no change');
      },
      teardown: ({ v }) => v.dispose(),
    },
    2000,
  );
  checkLinear('particles.look patch, N layers', s);
}, 600_000);
