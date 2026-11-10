/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag medium

import { StateSelection } from '@molstar/core/state';
import { betaCellDoc, BetaCellResources } from '@molstar/meso-spec/examples';
import type { MesoViewSpecDoc, View } from '@molstar/meso-spec/format';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { ParticleRepresentation3DLayers } from '@molstar/plugin/state/transforms/particles/layers';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { afterEach, describe, expect, it } from 'vitest';
import { createMesoViewSpecExtension, type MesoViewSpecApi, type SavedDocument } from '../extension.js';
import { MesoPlacements } from '../particle-list.js';

// The document's views (prism.md §4.4, §7.4) on a headless Prism viewer: showing one is no step (`undoable: false`, as
// `snapshot.apply`), look edits go to the view shown, a checkpoint notes the view shown with it and Undo shows it again
// with the scene it restores. Resources come from the dropped files, never the network.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

const Red = 0xff0000;
const CellRibosomes = 0x7a9cc6;

/** The β-cell with one more view: the ribosomes red (a layer the tests can read). */
function doc(): MesoViewSpecDoc {
  const d = betaCellDoc();
  const cell = d.views!.find((v) => v.id === 'v.cell')!;
  const red: View = {
    id: 'v.red',
    label: 'Red ribosomes',
    camera: { position: [0, 0, 9000], target: [0, 0, 0], up: [0, 1, 0] },
    looks: [...(cell.looks ?? []), { select: '(population p.ribosomes)', color: '#ff0000' }],
  };
  return { ...d, views: [...d.views!, red] };
}

function files(d: MesoViewSpecDoc) {
  const out: File[] = [];
  for (const r of d.resources ?? []) {
    const make = BetaCellResources[r.id];
    if (!make || !r.uri) continue;
    out.push(new File([JSON.stringify(make())], r.uri.slice(r.uri.lastIndexOf('/') + 1)));
  }
  return out;
}

async function open() {
  const spec = createMesoscaleExplorerSpec('');
  const v = await createPrismViewerHeadless({
    spec: { ...spec, extensions: (spec.extensions ?? []).filter((e) => e.id !== 'mesoviewspec') },
  });
  viewers.push(v);
  await v.extensions.mount(createMesoViewSpecExtension({ fetchText: async () => undefined }));
  const api = (v.api as unknown as { mesoviewspec: MesoViewSpecApi }).mesoviewspec;
  const person = v.api.as({ kind: 'person' });
  const runs: string[] = [];
  v.api.events.started.subscribe((r) => runs.push(r.operation));
  const run = (id: string, values: Record<string, unknown> = {}) => person.run(id, values);
  const d = doc();
  const r = await run('mesoviewspec.open', { data: JSON.stringify(d), files: files(d) });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const h = { v, api, model: api.model, run, runs, steps: () => v.managers.history.steps.value };
  return h;
}
type Harness = Awaited<ReturnType<typeof open>>;

/** The ribosomes' layer as the tree holds it now (the adapter writes one a type). */
function ribosomes(h: Harness) {
  for (const key of h.model.adapter.keys()) {
    const ref = h.model.adapter.listRef(key);
    const t = h.model.adapter.setOf(key)?.typeTable.find((x) => x.population === 'p.ribosomes');
    if (!ref || !t) continue;
    const q = StateSelection.Generators.byRef(ref).subtree().ofType(SO.Particle.Representation3D);
    const repr = h.v.plugin.state.data.select(q)[0];
    const tree = h.v.plugin.state.data.tree;
    for (const child of tree.children.get(repr.transform.ref).toArray()) {
      const tr = tree.transforms.get(child);
      if (tr?.transformer !== ParticleRepresentation3DLayers) continue;
      const layers = (tr.params as { layers: { targets: number[]; color: number | null; visible: boolean }[] })
        .layers;
      return layers.find((l) => l.targets.length === 1 && l.targets[0] === t.index);
    }
  }
  throw new Error('no list draws the ribosomes');
}

const viewOf = (d: MesoViewSpecDoc | undefined, id: string) => d?.views?.find((v) => v.id === id);
const shownId = (h: Harness) => h.model.session?.ir?.view.id;

function noUnsafe(h: Harness) {
  expect(h.steps().filter((s) => s.unsafe !== undefined)).toEqual([]);
}

async function saved(h: Harness): Promise<MesoViewSpecDoc> {
  const r = await h.run('mesoviewspec.save', {});
  expect(r.ok).toBe(true);
  return JSON.parse(await (r as { value: SavedDocument }).value.blob.text()) as MesoViewSpecDoc;
}

describe('showing a view (prism.md §4.4)', () => {
  it('is no step: its looks and camera drawn, the History as it was, the document unchanged', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    expect(shownId(h)).toBe('v.granules');
    const steps = h.steps().length;
    const before = h.model.doc;
    const r = await h.run('mesoviewspec.view', { view: 'v.red' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(h.steps().length).toBe(steps);
    noUnsafe(h);
    expect(shownId(h)).toBe('v.red');
    expect(h.model.shown).toBe('v.red');
    expect(h.model.session?.ir?.view.camera?.position).toEqual([0, 0, 9000]);
    expect(ribosomes(h)?.color).toBe(Red);
    expect(h.model.doc).toBe(before);
    expect((await saved(h)).session?.view).toBeUndefined();

    expect((await h.run('mesoviewspec.view', { view: 'v.red' })) as { unchanged?: boolean }).toMatchObject({
      ok: true,
      unchanged: true,
    });
    const gone = await h.run('mesoviewspec.view', { view: 'v.nowhere' });
    expect(gone.ok).toBe(false);
    expect(h.steps().length).toBe(steps);
  });

  it('look edits go to the view shown; switching back shows them', { tags: ['medium'] }, async () => {
    const h = await open();
    await h.run('mesoviewspec.view', { view: 'v.red' });
    const eye = await h.run('mesoviewspec.eye', { select: '(population p.ribosomes)', visible: false });
    expect(eye.ok, JSON.stringify(eye)).toBe(true);
    const ids = (id: string) => (viewOf(h.model.doc, id)?.looks ?? []).map((l) => l.id ?? '');
    expect(ids('v.red').some((id) => id.startsWith('l.eye.'))).toBe(true);
    expect(ids('v.granules').some((id) => id.startsWith('l.eye.'))).toBe(false);
    expect(ribosomes(h)?.visible).toBe(false);

    await h.run('mesoviewspec.view', { view: 'v.cell' });
    expect(ribosomes(h)).toMatchObject({ visible: true, color: CellRibosomes });
    await h.run('mesoviewspec.view', { view: 'v.red' });
    expect(ribosomes(h)).toMatchObject({ visible: false, color: Red });
    noUnsafe(h);
  });

  it('Undo shows again the view noted with the scene it restores, writing nothing; Redo the one it left', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    await h.run('mesoviewspec.view', { view: 'v.red' });
    const steps = h.steps().length;
    await h.run('mesoviewspec.eye', { select: '(population p.ribosomes)', visible: false });
    expect(h.steps().length).toBe(steps + 1);
    await h.run('mesoviewspec.view', { view: 'v.cell' });
    expect(h.steps().length).toBe(steps + 1);

    const runs = h.runs.length;
    const undo = await h.v.managers.history.undo();
    expect(undo.ok, JSON.stringify(undo)).toBe(true);
    expect(h.runs.slice(runs)).toEqual([]);
    expect(h.model.session?.history.at(-1)?.resolverRuns ?? 0).toBe(0);
    for (const c of h.v.plugin.state.data.select(StateSelection.Generators.ofTransformer(MesoPlacements)))
      expect((c.transform.params as { fill?: number }).fill ?? 0).toBe(0);
    expect(h.model.shown).toBe('v.red');
    expect(shownId(h)).toBe('v.red');
    expect(ribosomes(h)).toMatchObject({ visible: true, color: Red });
    expect(viewOf(h.model.doc, 'v.red')?.looks?.some((l) => l.id?.startsWith('l.eye.'))).toBe(false);
    noUnsafe(h);

    const redo = await h.v.managers.history.redo();
    expect(redo.ok, JSON.stringify(redo)).toBe(true);
    expect(h.model.shown).toBe('v.cell');
    expect(shownId(h)).toBe('v.cell');
    expect(ribosomes(h)).toMatchObject({ visible: true, color: CellRibosomes });
    expect(viewOf(h.model.doc, 'v.red')?.looks?.some((l) => l.id?.startsWith('l.eye.'))).toBe(true);

    // the next look edit goes to the view Redo left shown
    await h.run('mesoviewspec.eye', { select: '(population p.ribosomes)', visible: false });
    expect(viewOf(h.model.doc, 'v.cell')?.looks?.some((l) => l.id?.startsWith('l.eye.'))).toBe(true);
    expect(ribosomes(h)?.visible).toBe(false);
  });

  it('a model edit keeps the view shown', { tags: ['medium'] }, async () => {
    const h = await open();
    await h.run('mesoviewspec.view', { view: 'v.red' });
    const r = await h.run('mesoviewspec.edit', {
      patch: '(patch :ops [(set p.ribosomes :fields (:abundance (:count 1500)))])',
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(h.model.session?.history.at(-1)?.kind).toBe('model');
    expect(shownId(h)).toBe('v.red');
    expect(ribosomes(h)?.color).toBe(Red);
  });

  it('a patch that removes the view shown falls back to the first; Undo shows it again', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    await h.run('mesoviewspec.view', { view: 'v.red' });
    const r = await h.run('mesoviewspec.edit', { patch: '(patch :ops [(remove v.red)])' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(shownId(h)).toBe('v.granules');
    expect(ribosomes(h)?.color).not.toBe(Red);
    // a look edit now goes to the view shown, not to a view that is gone
    await h.run('mesoviewspec.eye', { select: '(population p.ribosomes)', visible: false });
    expect(viewOf(h.model.doc, 'v.granules')?.looks?.some((l) => l.id?.startsWith('l.eye.'))).toBe(true);
    await h.v.managers.history.undo();
    await h.v.managers.history.undo();
    expect(shownId(h)).toBe('v.red');
    expect(ribosomes(h)?.color).toBe(Red);
    noUnsafe(h);
  });
});
