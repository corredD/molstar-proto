/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { ContextMenuItem } from '@molstar/prism-ui';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import { describe, expect, it, vi } from 'vitest';
import { documentMenuItems } from '../document.js';

// A document row's Color… (prism.md §5.3, §6; ui.md: "Color… (a row), its color dot: a look patch"): the swatches and
// the default color, each one `mesoviewspec.look` on the row's address. A part's row has none (read-only in 3D).

function harness() {
  const run = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
  const api = { run } as unknown as ViewerApi;
  let opened: ContextMenuItem[] | undefined;
  const open = (items: ContextMenuItem[]) => {
    opened = items;
  };
  return { api, run, open, opened: () => opened };
}

const row = (id: string, select: string) => ({ label: id, doc: { id, select } as never });

describe('a document row’s Color…', () => {
  it('opens the swatches; a swatch and the default color are mesoviewspec.look on the row’s address', async () => {
    const h = harness();
    const items = documentMenuItems(h.api, undefined, row('p.catalase', '(population p.catalase)'), h.open);
    const color = items.find((i) => i.id === 'color');
    expect(color?.label).toBe('Color…');
    await color!.run!();
    const swatches = h.opened()!;
    expect(swatches.length).toBeGreaterThan(2);
    await swatches.find((i) => i.id === 'color-tomato')!.run!();
    expect(h.run).toHaveBeenLastCalledWith('mesoviewspec.look', { select: '(population p.catalase)', color: 'tomato' });
    await swatches.find((i) => i.id === 'color-default')!.run!();
    expect(h.run).toHaveBeenLastCalledWith('mesoviewspec.look', {
      select: '(population p.catalase)',
      defaultColor: true,
    });
  });

  it('is not offered on a part’s row, nor without a way to open the swatches', () => {
    const h = harness();
    const part = documentMenuItems(h.api, undefined, row('p.granules/p.Vamp2', '(part ...)'), h.open);
    expect(part.some((i) => i.id === 'color')).toBe(false);
    const none = documentMenuItems(h.api, undefined, row('p.catalase', '(population p.catalase)'));
    expect(none.some((i) => i.id === 'color')).toBe(false);
  });
});
