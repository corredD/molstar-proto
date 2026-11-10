/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { ViewerApi } from '@molstar/prism-viewer/api';
import { describe, expect, it, vi } from 'vitest';
import type { ExplorerApi } from '../operations.js';
import { type EyeRow, setEyes } from '../rows.js';

// A document's eyes (prism.md §5.2): a drag of eyes over its rows is one patch, `mesoviewspec.eye` once with every
// row's address; the Particles category's eye is the document's `(all)` in that patch. A document's lists are not
// rows, so nothing calls `particles.visibility` or `state.visibility` on them (the cells' hidden flags would disagree
// with the document's eyes).

function harness() {
  const run = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
  const group = vi.fn(async (_label: string, fn: (g: ViewerApi) => Promise<unknown>) => fn({ run } as never));
  return { api: { run, group } as unknown as ViewerApi, run, group, area: {} as ExplorerApi };
}

const docRow = (id: string, select: string): EyeRow => ({ kind: 'population', doc: { id, select } as never });

describe('a drag of eyes over a document’s rows', () => {
  it('is one group and one mesoviewspec.eye with every row’s address', async () => {
    const h = harness();
    const rows = [
      docRow('p.lipids', '(population p.lipids)'),
      docRow('p.catalase', '(population p.catalase)'),
      docRow('c.exosome', '(in c.exosome)'),
    ];
    await setEyes(h.api, h.area, rows, false);
    expect(h.group).toHaveBeenCalledTimes(1);
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.run).toHaveBeenCalledWith('mesoviewspec.eye', {
      select: '(population p.lipids)\n(population p.catalase)\n(in c.exosome)',
      visible: false,
    });
  });

  it('the Particles category’s eye with a document is its (all), in the same patch; no list’s cell is hidden', async () => {
    const h = harness();
    const category: EyeRow = { kind: 'category', objects: [], document: true };
    await setEyes(h.api, h.area, [category, docRow('p.lipids', '(population p.lipids)')], true);
    const calls = h.run.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(['mesoviewspec.eye']);
    expect(h.run).toHaveBeenCalledWith('mesoviewspec.eye', { select: '(all)\n(population p.lipids)', visible: true });
  });
});
