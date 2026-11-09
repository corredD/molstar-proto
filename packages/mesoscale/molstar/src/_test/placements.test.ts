/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag medium

import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { afterEach, describe, expect, it } from 'vitest';
import { isMissingList, MesoPlacements, placementStore } from '../particle-list.js';

// prism.md §7.3, point 4: a restore applies the lists before the owner's custom state, so a key the store lacks (a
// session on a fresh page, placements let go) gives an empty list and a warning, never a failed cell.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

describe('MesoPlacements', () => {
  it('a key the store lacks applies as an empty list, said, not a failure', { tags: ['medium'] }, async () => {
    const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
    viewers.push(v);
    await v.extensions.load('particles');
    const warnings: string[] = [];
    const sub = v.plugin.events.log.subscribe((e) => {
      if (e.type === 'warning') warnings.push(String(e.message));
    });
    const b = v.plugin.state.data.build().toRoot().apply(MesoPlacements, { key: 'm.x@nope#0', label: 'x' });
    await v.plugin.runTask(v.plugin.state.data.updateTree(b));
    sub.unsubscribe();
    const cell = v.plugin.state.data.cells.get(b.ref)!;
    expect(cell.status).toBe('ok');
    const list = cell.obj!.data as ParticleList;
    expect(list.count).toBe(0);
    expect(isMissingList(list)).toBe(true);
    expect(warnings.join('\n')).toMatch(/placements\.missing/);
  });

  it('each viewer has its own placements', { tags: ['medium'] }, async () => {
    const a = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
    const c = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
    viewers.push(a, c);
    placementStore(a.plugin).set('k', {} as ParticleList);
    expect(placementStore(c.plugin).has('k')).toBe(false);
  });
});
