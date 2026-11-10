/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { DocumentTree, DocumentViews } from '@molstar/meso-molstar';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import { describe, expect, it, vi } from 'vitest';
import {
  activateViewsRow,
  type DocumentRowDraft,
  documentAncestorKeys,
  documentMenuItems,
  documentRowByKey,
  pushDocumentRows,
} from '../document.js';

// The Views row (prism.md §4.1, §4.4; ui.md §3): last under the document, its views (the one shown and the one the
// saved document opens with said so) and its tours (where one is while it plays, its caption muted). A click on a view
// shows it (`mesoviewspec.view`, no step); a tour's ⋯ plays or stops it.

function treeOf(views: Partial<DocumentViews> = {}): DocumentTree {
  return {
    outline: {
      title: 'β-cell',
      copies: 10,
      roots: [],
      row: () => undefined,
      children: () => [],
      ancestors: () => undefined,
    },
    looks: { visible: () => undefined, color: () => undefined },
    visible: true,
    showsOnly: true,
    issues: [],
    views: {
      views: [
        { id: 'v.granules', label: 'Granules' },
        { id: 'v.cell', label: 'The whole slice', description: 'All of it' },
      ],
      tours: [{ id: 't.granule', label: 'Into one granule', steps: 3 }],
      shown: 'v.granules',
      opensWith: 'v.cell',
      ...views,
    },
  } as unknown as DocumentTree;
}

/** Every row, all open. */
function rows(tree: DocumentTree) {
  const out: DocumentRowDraft[] = [];
  pushDocumentRows(tree, 1, (row, children) => {
    out.push(row);
    children();
  });
  return out;
}

function harness() {
  const run = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
  return { api: { run } as unknown as ViewerApi, run };
}

describe('the Views row', () => {
  it('lists the views, then the tours, under the document; the view shown and the one it opens with said so', () => {
    const all = rows(treeOf());
    expect(all.map((r) => [r.key, r.depth, r.label, r.count ?? '', r.tip ?? ''])).toEqual([
      ['md:', 1, 'β-cell', '10 copies', ''],
      ['md:#views', 2, 'Views', '', ''],
      ['md:#view:v.granules', 3, 'Granules', 'shown', ''],
      ['md:#view:v.cell', 3, 'The whole slice', 'opens with', 'All of it'],
      ['md:#tour:t.granule', 3, 'Into one granule', '3 views', ''],
    ]);
    expect(all[0].hasChildren).toBe(true);
    // no eye, no color: a view is no part of the scene
    expect(all.slice(1).every((r) => r.visible === undefined && r.color === undefined)).toBe(true);
  });

  it('a tour playing says where it is, its caption muted', () => {
    const tree = treeOf({ playing: { tour: 't.granule', step: 2, of: 3, caption: 'One granule' } });
    const tour = rows(tree).find((r) => r.key === 'md:#tour:t.granule')!;
    expect([tour.count, tour.tip]).toEqual(['2 of 3', 'One granule']);
  });

  it('none without views or tours', () => {
    expect(rows(treeOf({ views: [], tours: [] })).map((r) => r.key)).toEqual(['md:']);
  });

  it('its rows are found by key, under the Views row and the document', () => {
    const tree = treeOf();
    expect(documentRowByKey(tree, 'md:#view:v.cell')?.label).toBe('The whole slice');
    expect(documentRowByKey(tree, 'md:#views')?.label).toBe('Views');
    expect(documentRowByKey(tree, 'md:#view:v.gone')).toBeUndefined();
    expect(documentAncestorKeys(tree, 'md:#view:v.cell')).toEqual(['md:#views', 'md:', 'c:particles']);
    expect(documentAncestorKeys(tree, 'md:#views')).toEqual(['md:', 'c:particles']);
  });

  it('a click on a view shows it; a tour is played from its ⋯, stopped while it plays', async () => {
    const h = harness();
    const tree = treeOf();
    const view = documentRowByKey(tree, 'md:#view:v.cell')!;
    await activateViewsRow(h.api, view.doc);
    expect(h.run).toHaveBeenLastCalledWith('mesoviewspec.view', { view: 'v.cell' });

    const viewItems = documentMenuItems(h.api, tree, view);
    expect(viewItems.map((i) => i.id)).toContain('show-view');
    // no Focus, Color, Show only or Show all again: a view has no address
    expect(viewItems.map((i) => i.id)).not.toContain('show-all');
    expect(documentMenuItems(h.api, tree, documentRowByKey(tree, 'md:#view:v.granules')!).map((i) => i.id)).not.toContain(
      'show-view',
    );

    const tour = documentRowByKey(tree, 'md:#tour:t.granule')!;
    const play = documentMenuItems(h.api, tree, tour).find((i) => i.id === 'play-tour')!;
    await play.run!();
    expect(h.run).toHaveBeenLastCalledWith('mesoviewspec.tour.play', { tour: 't.granule' });
    const playing = treeOf({ playing: { tour: 't.granule', step: 1, of: 3 } });
    const stop = documentMenuItems(h.api, playing, tour).find((i) => i.id === 'stop-tour')!;
    await stop.run!();
    expect(h.run).toHaveBeenLastCalledWith('mesoviewspec.tour.stop', {});
  });
});
