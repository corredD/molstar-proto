/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { story } from '@molstar/prism-ui/testing/index';
import { RealViewerStory } from '@molstar/prism-viewer/testing/real-viewer';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { scaleDoc, type ScaleKind } from '@molstar/meso-spec/examples/scale';
import { placementSets } from '@molstar/meso-spec/ir/ir';
import { placementBytes } from '@molstar/meso-spec/ir/placements';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers/index';
import { compile, updateView } from '@molstar/meso-spec/runtime/runtime';
import { PrismMesoAdapter } from '../prism-adapter.js';
import { h, panel, Styles } from './ui.js';

// Performance probes in the browser (design.md §8): resolution, the adapter's commit, the first frame, a color edit,
// measured apart, on scenes of a chosen size. Every number is measured here, in this browser, on this machine; the
// targets they are held to are in design.md §8.1. Memory: the placement buffers (exact), the adapter's additions
// (exact), and the JS heap where the browser reports it (Chrome's `performance.memory`).

const meta: Meta = { title: 'Performance', parameters: { layout: 'fullscreen' } };
export default meta;

const frame = () =>
  new Promise<number>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now()))));
// collected first when the browser exposes `gc` (Chromium with `--js-flags=--expose-gc`), so the delta is what is held
const heap = () => {
  (globalThis as { gc?: () => void }).gc?.();
  return (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
};
const mb = (b?: number) => (b === undefined ? 'n/a' : `${(b / 2 ** 20).toFixed(1)} MB`);

function probe() {
  return story(() => {
    const rows = h('tbody');
    const status = h('span', { style: 'color:#666' }, 'pick a size');
    let viewer: PrismViewer | undefined;
    let adapter: PrismMesoAdapter | undefined;
    const run = async (kind: ScaleKind, n: number) => {
      if (!viewer) return;
      status.textContent = `${kind} ${n.toLocaleString('en-US')}: resolving…`;
      await adapter?.clear();
      adapter = new PrismMesoAdapter(viewer);
      const h0 = heap();
      const doc = scaleDoc(kind, n);
      const t0 = performance.now();
      const r = await compile(doc, { resolvers: DefaultResolvers });
      const t1 = performance.now();
      const commit = await adapter.commit(r.ir!);
      const t2 = await frame();
      const recolored = {
        ...doc,
        views: [{ ...doc.views![0], looks: [{ select: '(in c.cell)', color: '#d0453a' }] }],
      };
      const t3 = performance.now();
      const look = await adapter.commit(updateView(recolored, r.ir!));
      const t4 = await frame();
      const sets = placementSets(r.ir!);
      const copies = sets.reduce((s, x) => s + x.count, 0);
      const bytes = sets.reduce((s, x) => s + placementBytes(x), 0);
      const cells = [
        `${kind}`,
        copies.toLocaleString('en-US'),
        (t1 - t0).toFixed(0),
        commit.ms.sets!.toFixed(0),
        (t2 - t1 - commit.ms.total).toFixed(0),
        (t4 - t3).toFixed(0),
        look.added.length === 0 ? 'none' : `${look.added.length}!`,
        mb(bytes),
        mb(copies * 8),
        mb(h0 === undefined ? undefined : (heap() ?? 0) - h0),
      ];
      rows.append(
        h(
          'tr',
          {},
          ...cells.map((c) => h('td', { style: 'padding:2px 8px;border-bottom:1px solid #eee;text-align:right' }, c)),
        ),
      );
      status.textContent = `${kind} ${n.toLocaleString('en-US')}: done`;
    };
    const buttons = (
      [
        ['pack', 10_000],
        ['pack', 50_000],
        ['bilayer', 100_000],
        ['bilayer', 1_000_000],
      ] as const
    ).map(([k, n]) => h('button', { onclick: () => run(k, n) }, `${k} ${n.toLocaleString('en-US')}`));
    const head = [
      'scene',
      'copies',
      'resolve ms',
      'commit ms',
      'first frame ms',
      'color edit ms (to frame)',
      'lists rebuilt by color',
      'placements',
      'adapter adds',
      'JS heap Δ',
    ];
    const table = h(
      'table',
      { style: 'border-collapse:collapse;width:100%' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ...head.map((x) => h('th', { style: 'padding:2px 8px;text-align:right;border-bottom:1px solid #ccc' }, x)),
        ),
      ),
      rows,
    );
    const host = RealViewerStory({
      spec: (base) => base,
      style: 'height:100%',
      setup: async (v) => {
        viewer = v;
        status.textContent = 'ready';
      },
    });
    return h(
      'div',
      { style: `${Styles.grid};grid-template-rows:auto 1fr 1.3fr` },
      panel(
        'Measured in this browser; one scene at a time (each run replaces the last)',
        h('div', { style: Styles.bar }, ...buttons, status),
      ),
      panel('Runs', table),
      panel('Mol* / Prism', h('div', { style: 'flex:1;min-height:0;position:relative' }, host)),
    );
  });
}

/** Resolve, commit, first frame and a color edit on scenes from 10k to 1M copies. */
export const Probe: StoryObj = { render: () => probe() };
