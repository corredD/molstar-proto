/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { it } from 'vitest';
import { checkLinear, quadraticControl, scaling } from '../../../../sequences/core/_test/model/scaling.js';
import { tiledFixture } from '../examples/streaming.js';
import type { MesoViewSpecDoc } from '../format/doc.js';
import type { IR, IRNode } from '../ir/ir.js';
import { DefaultResolvers } from '../resolvers/index.js';
import { compile, updateView } from '../runtime/runtime.js';

// A streamed view over N tiles (`test:scaling`, design.md §6.8.5): the camera reads level 0, one proxy copy per (tile,
// population), and a selection over a population (`(population p.a)`) walks the runs of the types it matches. With the
// proxy copies written tile by tile the two populations alternate and the selection holds N runs, each union copying
// the last (×16 at 4× the tiles); written population by population they are one run. Each run builds level 0 and the
// view afresh (a stream node with new `params` defeats level 0's cache).

const grids = { 512: [8, 8, 8], 2048: [16, 16, 8] } as const;
const compiled = new Map<number, { doc: MesoViewSpecDoc; ir: IR }>();
for (const n of [512, 2048] as const) {
  const { doc, provider } = tiledFixture({ grid: [...grids[n]], perTile: { 'p.a': 5, 'p.b': 5 } });
  const r = await compile(doc, { resolvers: DefaultResolvers, tiles: () => provider });
  compiled.set(n, { doc, ir: r.ir! });
}

/** The tree with every stream node's `params` copied: level 0 is cached on them. */
const fresh = (n: IRNode): IRNode =>
  ({
    ...n,
    ...(n.kind === 'stream' ? { params: { ...n.params } } : {}),
    ...(n.children ? { children: n.children.map(fresh) } : {}),
  }) as IRNode;

it('the positive control (a copy per item) is caught', () => {
  checkLinear('quadratic control', scaling(quadraticControl, 2000), false);
});

it('updateView over a stream: a population look and the camera on level 0, N tiles', () => {
  checkLinear(
    'streamed updateView, N tiles',
    scaling(
      {
        setup: (n: number) => {
          const c = compiled.get(n)!;
          const doc: MesoViewSpecDoc = {
            ...c.doc,
            views: c.doc.views!.map((v) =>
              v.id === 'v.all' ? { ...v, looks: [{ select: '(population p.a)', color: '#ff0000' }] } : v,
            ),
          };
          return { doc, ir: { root: fresh(c.ir.root), view: c.ir.view } as IR };
        },
        run: ({ doc, ir }) => {
          updateView(doc, ir);
        },
      },
      512,
      { reps: 3 },
    ),
  );
});
