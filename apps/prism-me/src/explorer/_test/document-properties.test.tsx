/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag medium

import {
  exosomeDoc,
  ExosomeRecipe,
  syntheticPicksStar,
  syntheticVesicleObj,
} from '../../../../../packages/mesoscale/spec/src/examples/index.js';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { ShellModel } from '@molstar/prism-ui/shell/shell';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { documentKey } from '../document.js';
import { explorerUI, sceneModelOf } from '../ui.js';

// The properties of a MesoViewSpec document's rows (prism.md §4.2, §4.3), over a headless viewer in jsdom with the
// exosome example open: the document row's Group by and Issues, a population's Evidence and Built by, and none of the
// sections of a node (Look, Clips) on a document row.

interface Doc {
  evidence: { id: string; statement: string }[];
  populations: { id: string; evidence?: string[] }[];
}

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
  document.body.innerHTML = '';
});

async function until(check: () => boolean, ms = 20000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function mounted() {
  const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
  viewers.push(v);
  const r = await v.api.run('mesoviewspec.open', {
    data: JSON.stringify(exosomeDoc()),
    files: [
      new File([JSON.stringify(ExosomeRecipe)], 'exosome.cellpack-gpu.json'),
      new File([syntheticPicksStar()], 'catalase_picks.star'),
      new File([syntheticVesicleObj()], 'membrane.obj'),
    ],
  });
  if (!r.ok) throw new Error(r.message);
  const api = v.api.as({ kind: 'person' });
  const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
  const host = document.createElement('div');
  document.body.append(host);
  ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
  return { v, host, scene: sceneModelOf(api.explorer!)! };
}

const section = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`[data-section="${id}"]`);
const header = (host: HTMLElement, id: string) => section(host, id)?.querySelector<HTMLButtonElement>('button');
async function open(host: HTMLElement, id: string) {
  await until(() => !!header(host, id));
  if (header(host, id)!.getAttribute('aria-expanded') !== 'true') header(host, id)!.click();
}
const kindShown = (host: HTMLElement) => host.querySelector('[data-properties-kind]')?.textContent;
const choice = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="Group by"] button')).find(
    (b) => b.textContent === label,
  );
const docRowPick = (id: string, kind: string, label: string) => ({
  key: documentKey(id),
  label,
  kind,
  doc: { id, select: `(${kind} ${id})` },
});

describe("a MesoViewSpec document's properties", () => {
  it("shows the population's Evidence: its statements, the entity's, and the identifiers; no Look or Clips", async () => {
    const { host, scene, v } = await mounted();
    const tree = scene.documentTree()!;
    const row = tree.outline.row('p.catalase')!;
    scene.picked.set(docRowPick(row.id, 'population', row.label));
    await until(() => kindShown(host) === 'Population');
    await open(host, 'evidence');
    const text = () => section(host, 'evidence')!.textContent ?? '';
    const doc = (v.api as never as { mesoviewspec: { model: { doc: Doc } } }).mesoviewspec.model.doc;
    const statements = (ids: string[] | undefined) =>
      (ids ?? []).map((id) => doc.evidence.find((e) => e.id === id)!.statement);
    const mine = statements(doc.populations.find((p) => p.id === 'p.catalase')!.evidence);
    expect(mine.length).toBeGreaterThan(0);
    await until(() => mine.every((m) => text().includes(m)));
    expect(text()).toContain('Population: assumption');
    // the entity's identifiers: links in a new tab
    const link = section(host, 'evidence')!.querySelector<HTMLAnchorElement>(
      'a[href="https://www.rcsb.org/structure/8CAT"]',
    );
    expect(link?.textContent).toBe('8CAT');
    expect(link?.target).toBe('_blank');

    // the observed copies: the picks' evidence, its confidence
    const observed = scene.documentTree()!.outline.row('p.catalase.observed')!;
    scene.picked.set(docRowPick(observed.id, 'population', observed.label));
    const picked = statements(doc.populations.find((p) => p.id === 'p.catalase.observed')!.evidence);
    await until(() => picked.length > 0 && picked.every((m) => text().includes(m)));
    expect(text()).toContain('observation');
    expect(text()).toContain('medium');
    // no section of a node's
    for (const id of ['look', 'clips', 'representation', 'labels', 'position', 'graphics']) {
      expect(section(host, id)).toBeNull();
    }
    expect(section(host, 'built-by')).not.toBeNull();
    expect(section(host, 'issues')).toBeNull();
    expect(host.querySelector('[aria-label="Group by"]')).toBeNull();
  });

  it('shows Built by: the model, its resolver, its key and its copies', async () => {
    const { host, scene } = await mounted();
    const row = scene.documentTree()!.outline.row('p.catalase')!;
    scene.picked.set(docRowPick(row.id, 'population', row.label));
    await open(host, 'built-by');
    await until(() => !!section(host, 'built-by')!.textContent?.includes('Resolver'));
    const text = section(host, 'built-by')!.textContent!;
    expect(text).toContain(row.model!);
    expect(text).toContain('Key');
    expect(text).toContain('Cached');
    expect(text).toContain('Copies');
  });

  it('the document row has Group by (Compartment, Model, Kind) and Issues, and the grouping is view state', async () => {
    const { host, scene, v } = await mounted();
    const tree = scene.documentTree()!;
    scene.picked.set(docRowPick('', 'mesoviewspec document', tree.outline.title));
    await until(() => kindShown(host) === 'MesoViewSpec document');
    await until(() => !!choice(host, 'Model'));
    expect(['Compartment', 'Model', 'Kind'].every((l) => !!choice(host, l))).toBe(true);
    expect(choice(host, 'Compartment')!.getAttribute('aria-pressed')).toBe('true');
    expect(section(host, 'issues')).not.toBeNull();
    expect(section(host, 'evidence')).toBeNull();
    expect(section(host, 'built-by')).toBeNull();
    await open(host, 'issues');

    const steps = v.api.history.steps.value.length;
    choice(host, 'Kind')!.click();
    await until(() => scene.documentGrouping.value === 'kind');
    await until(() => choice(host, 'Kind')!.getAttribute('aria-pressed') === 'true');
    expect(v.api.history.steps.value.length).toBe(steps);
    expect(scene.documentTree()!.outline.groupBy).toBe('kind');
  });
});

// in the app: the panel shown first, the document dropped after; its lists are no objects of the tree, so the tree
// followed nothing and showed its empty line
describe('a MesoViewSpec document opened with the panel shown', () => {
  it('shows the document under Particles, alone in the scene', async () => {
    const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
    viewers.push(v);
    const api = v.api.as({ kind: 'person' });
    const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
    const host = document.createElement('div');
    document.body.append(host);
    ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
    const r = await v.api.run('mesoviewspec.open', {
      data: JSON.stringify(exosomeDoc()),
      files: [
        new File([JSON.stringify(ExosomeRecipe)], 'exosome.cellpack-gpu.json'),
        new File([syntheticPicksStar()], 'catalase_picks.star'),
        new File([syntheticVesicleObj()], 'membrane.obj'),
      ],
    });
    expect(r.ok).toBe(true);
    await until(() => !!host.querySelector(`[data-tree-key="${documentKey('')}"]`), 5000);
    expect(host.querySelector(`[data-tree-key="${documentKey('')}"]`)?.textContent).toContain('Exosome in plasma');
  });

  it('shows the document opened by data with none of its files, the panel mounted before', async () => {
    const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
    viewers.push(v);
    const api = v.api.as({ kind: 'person' });
    const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
    const host = document.createElement('div');
    document.body.append(host);
    ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
    // no files: the models' resources are missing, so no list is drawn and the lists' count never changes
    const r = await v.api.run('mesoviewspec.open', { data: JSON.stringify(exosomeDoc()) });
    expect(r.ok).toBe(true);
    expect(v.plugin.managers.particles.hierarchy.current.lists.length).toBe(0);
    await until(() => !!host.querySelector(`[data-tree-key="${documentKey('')}"]`), 5000);
    expect(host.querySelector(`[data-tree-key="${documentKey('')}"]`)?.textContent).toContain('Exosome in plasma');
  });
});
