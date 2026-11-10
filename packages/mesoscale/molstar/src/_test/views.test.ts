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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMesoViewSpecExtension, type MesoViewSpecApi, type SavedDocument } from '../extension.js';
import { MesoPlacements } from '../particle-list.js';
import { stubCanvasForLabels } from './canvas.js';

stubCanvasForLabels();

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
  return {
    ...d,
    views: [...d.views!, red],
    tours: [
      ...(d.tours ?? []),
      {
        id: 't.quick',
        label: 'Quick',
        steps: [
          { view: 'v.cell', duration: 1, caption: 'The slice' },
          { view: 'v.red', duration: 1, caption: 'Red' },
        ],
      },
      { id: 't.slow', steps: [{ view: 'v.cell', duration: 60000 }, { view: 'v.red' }] },
    ],
  };
}

/** Resolves when `test` holds, checked at each change of the owner. */
function until(h: Harness, test: () => boolean): Promise<void> {
  if (test()) return Promise.resolve();
  return new Promise((resolve) => {
    const sub = h.model.changed.subscribe(() => {
      if (!test()) return;
      sub.unsubscribe();
      resolve();
    });
  });
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

async function open(d = doc()) {
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
  const errors: string[] = [];
  v.plugin.events.log.subscribe((e) => {
    if (e.type === 'error') errors.push(String(e.message));
  });
  const run = (id: string, values: Record<string, unknown> = {}) => person.run(id, values);
  const r = await run('mesoviewspec.open', { data: JSON.stringify(d), files: files(d) });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const h = { v, api, model: api.model, run, runs, errors, steps: () => v.managers.history.steps.value };
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
      const layers = (tr.params as { layers: { targets: number[]; color: number | null; visible: boolean }[] }).layers;
      return layers.find((l) => l.targets.length === 1 && l.targets[0] === t.index);
    }
  }
  throw new Error('no list draws the ribosomes');
}

const viewOf = (d: MesoViewSpecDoc | undefined, id: string) => d?.views?.find((v) => v.id === id);
const shownId = (h: Harness) => h.model.session?.ir?.view.id;

/** No step made unsafe (a change outside the API), no error logged. */
function noUnsafe(h: Harness) {
  expect(h.steps().filter((s) => s.unsafe !== undefined)).toEqual([]);
  expect(h.errors).toEqual([]);
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
    // the document's unit is nm, the IR's camera Å
    expect(h.model.session?.ir?.view.camera?.position).toEqual([0, 0, 90000]);
    expect(ribosomes(h)?.color).toBe(Red);
    expect(h.model.doc).toBe(before);
    expect((await saved(h)).session?.view).toBeUndefined();

    const gone = await h.run('mesoviewspec.view', { view: 'v.nowhere' });
    expect(gone.ok).toBe(false);
    expect(h.steps().length).toBe(steps);
  });

  it('showing the view shown again moves the camera back to it (Ludo, 2026-11-09), no step', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    await h.run('mesoviewspec.view', { view: 'v.red' });
    const steps = h.steps().length;
    const runs = h.runs.length;
    // a headless viewer has no canvas: the adapter's camera write is what is watched
    const adapter = h.model.adapter as unknown as { applyCamera(): boolean };
    const camera = vi.spyOn(adapter, 'applyCamera');
    const r = await h.run('mesoviewspec.view', { view: 'v.red' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect((r as { unchanged?: boolean }).unchanged).toBeUndefined();
    expect(camera).toHaveBeenCalledTimes(1);
    expect(h.steps().length).toBe(steps);
    expect(h.runs.slice(runs)).toEqual(['mesoviewspec.view']);
    expect(shownId(h)).toBe('v.red');
    noUnsafe(h);
  });

  it('a show that fails mid-draw draws the view shown before again (Ludo, 2026-11-09)', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    const steps = h.steps().length;
    const savedOf = () => (h.model as unknown as { saved: unknown }).saved;
    const savedBefore = savedOf();
    // the looks of v.red written, then the draw fails before it ends
    const adapter = h.model.adapter as unknown as { writeLooks(...a: unknown[]): Promise<number> };
    const write = adapter.writeLooks.bind(adapter);
    vi.spyOn(adapter, 'writeLooks').mockImplementationOnce(async (...a: unknown[]) => {
      await write(...a);
      throw new Error('the draw failed');
    });
    const r = await h.run('mesoviewspec.view', { view: 'v.red' });
    expect(r.ok).toBe(false);
    // the screen, the adapter, the session and the saved value agree: v.granules
    expect(ribosomes(h)?.color).not.toBe(Red);
    expect(h.model.shown).toBeUndefined();
    expect(h.model.shownId).toBe('v.granules');
    expect(shownId(h)).toBe('v.granules');
    expect(savedOf()).toBe(savedBefore);
    expect(h.steps().length).toBe(steps);
    expect(h.steps().filter((s) => s.unsafe !== undefined)).toEqual([]);
    // and the next show works
    expect((await h.run('mesoviewspec.view', { view: 'v.red' })).ok).toBe(true);
    expect(ribosomes(h)?.color).toBe(Red);
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

  it('the Views row: the views and tours, the view shown, the same object while they are the same', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    const tree = h.api.treeState();
    const views = tree.value!.views;
    expect(views.views.map((v) => v.id)).toEqual(['v.granules', 'v.cell', 'v.granule-12', 'v.docked', 'v.red']);
    expect(views.tours.map((t) => [t.id, t.label, t.steps])).toEqual([
      ['t.granule', 'Into one granule', 3],
      ['t.quick', 'Quick', 2],
      ['t.slow', 't.slow', 2],
    ]);
    expect(views.shown).toBe('v.granules');
    expect(views.opensWith).toBeUndefined();
    // a look edit makes new views in the document, not a new Views row
    await h.run('mesoviewspec.eye', { select: '(population p.ribosomes)', visible: false });
    expect(tree.value!.views).toBe(views);
    await h.run('mesoviewspec.view', { view: 'v.red' });
    expect(tree.value!.views.shown).toBe('v.red');
  });

  it('a patch that removes the view shown falls back to the first; Undo shows it again', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    await h.run('mesoviewspec.view', { view: 'v.red' });
    // the tours naming it go with it (no cascade: prism.md §2.1)
    const r = await h.run('mesoviewspec.edit', {
      patch: '(patch :ops [(remove t.quick) (remove t.slow) (remove v.red)])',
    });
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

describe('New view from here, Update camera, Open with this view (prism.md §4.4)', () => {
  // the camera in Å, the world frame (the canvas's: a headless viewer has none, so the tests give it)
  const here = { position: [100, 200, 3000], target: [100, 200, 0], up: [0, 1, 0] };

  it('New view from here is one step: the camera here in the document’s unit, the shown view’s looks with new ids, shown', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    await h.run('mesoviewspec.view', { view: 'v.red' });
    const steps = h.steps().length;
    const r = await h.run('mesoviewspec.newView', { camera: here });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(h.steps().length).toBe(steps + 1);
    const views = h.model.doc!.views!;
    const made = views.at(-1)!;
    expect(made.id).toBe('v.view.1');
    expect(made.label).toBe('View 1');
    // nm: Å / 10
    expect(made.camera).toEqual({ position: [10, 20, 300], target: [10, 20, 0], up: [0, 1, 0] });
    const red = viewOf(h.model.doc, 'v.red')!;
    expect(made.looks?.map(({ id: _, ...l }) => l)).toEqual(red.looks?.map(({ id: _, ...l }) => l));
    const ids = views.flatMap((v) => (v.looks ?? []).flatMap((l) => (l.id ? [l.id] : [])));
    expect(new Set(ids).size).toBe(ids.length);
    expect(made.looks?.every((l) => l.id)).toBe(true);
    expect(shownId(h)).toBe('v.view.1');
    expect(ribosomes(h)?.color).toBe(Red);

    await h.v.managers.history.undo();
    expect(viewOf(h.model.doc, 'v.view.1')).toBeUndefined();
    expect(shownId(h)).toBe('v.red');
    noUnsafe(h);
  });

  it('Update camera sets the shown view’s camera, one step; Undo puts the old one back', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    await h.run('mesoviewspec.view', { view: 'v.cell' });
    const was = viewOf(h.model.doc, 'v.cell')!.camera;
    const steps = h.steps().length;
    // the canvas's field of view (degrees) given with it
    const r = await h.run('mesoviewspec.updateCamera', { camera: { ...here, fov: 30 } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(h.steps().length).toBe(steps + 1);
    // v.cell's camera was semantic (focus, fit, from +z): numeric now, with the fov and the view's transition (Ludo,
    // 2026-11-09), and the result says what was replaced
    expect(viewOf(h.model.doc, 'v.cell')!.camera).toEqual({
      position: [10, 20, 300],
      target: [10, 20, 0],
      up: [0, 1, 0],
      fov: 30,
      transition: 1200,
    });
    expect((r as { did: string }).did).toMatch(/focus.*replaced/);
    expect(h.model.session?.ir?.view.camera?.position).toEqual([100, 200, 3000]);
    expect(viewOf(h.model.doc, 'v.granules')!.camera).toEqual(viewOf(doc(), 'v.granules')!.camera);
    await h.v.managers.history.undo();
    expect(viewOf(h.model.doc, 'v.cell')!.camera).toEqual(was);
  });

  it('Open with this view sets session.view, one step: the saved document opens on it', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    const steps = h.steps().length;
    const r = await h.run('mesoviewspec.openWith', { view: 'v.red' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(h.steps().length).toBe(steps + 1);
    expect(h.model.doc!.session?.view).toBe('v.red');
    expect(h.api.treeState().value!.views.opensWith).toBe('v.red');
    expect((await h.run('mesoviewspec.openWith', { view: 'v.red' })) as { unchanged?: boolean }).toMatchObject({
      unchanged: true,
    });
    const file = await saved(h);
    expect(file.session?.view).toBe('v.red');

    const again = await open();
    await again.run('mesoviewspec.close', {});
    const o = await again.run('mesoviewspec.open', { data: JSON.stringify(file), files: files(file) });
    expect(o.ok, JSON.stringify(o)).toBe(true);
    expect(shownId(again)).toBe('v.red');
    expect(ribosomes(again)?.color).toBe(Red);
  });

  it('Update camera on a view with a frame: the camera written in the frame derives back to the canvas’s', {
    tags: ['medium'],
  }, async () => {
    const d = doc();
    const s = Math.SQRT1_2;
    const framed: MesoViewSpecDoc = {
      ...d,
      // a tomogram's frame: 2 nm voxels, turned a quarter about z and moved
      frames: [
        ...(d.frames ?? []),
        { id: 'f.tomo', kind: 'instrument', units: 'nm', handedness: 'right', voxelSize: 2 },
      ],
      alignments: [
        ...(d.alignments ?? []),
        {
          id: 'a.tomo',
          from: 'f.tomo',
          to: 'f.cell',
          transform: { rotation: [0, 0, s, s], translation: [100, -50, 20] },
        },
      ],
      views: [
        ...d.views!,
        { id: 'v.tomo', frame: 'f.tomo', camera: { position: [0, 0, 500], target: [0, 0, 0], up: [0, 1, 0] } },
      ],
    };
    const h = await open(framed);
    await h.run('mesoviewspec.view', { view: 'v.tomo' });
    const r = await h.run('mesoviewspec.updateCamera', { camera: here });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    // written in voxels of the frame, not in Å of the world
    expect(viewOf(h.model.doc, 'v.tomo')!.camera!.position).not.toEqual(here.position);
    expect(shownId(h)).toBe('v.tomo');
    const cam = h.model.session!.ir!.view.camera!;
    for (const k of ['position', 'target', 'up'] as const)
      cam[k].forEach((x, i) => expect(x, `${k}[${i}]`).toBeCloseTo(here[k][i], 1));
  });

  it('the new ids of a view and an annotation are past every id of the document, not only views and annotations', {
    tags: ['medium'],
  }, async () => {
    const d = doc();
    const taken: MesoViewSpecDoc = {
      ...d,
      // a tour and a look holding the ids New view and Add label would take first
      tours: [...(d.tours ?? []), { id: 'v.view.1', steps: [{ view: 'v.cell' }] }],
      views: d.views!.map((v) =>
        v.id === 'v.cell'
          ? { ...v, looks: [...(v.looks ?? []), { id: 'an.1', select: '(population p.ribosomes)' }] }
          : v,
      ),
    };
    const h = await open(taken);
    await h.run('mesoviewspec.view', { view: 'v.cell' });
    const made = await h.run('mesoviewspec.newView', { camera: here });
    expect(made.ok, JSON.stringify(made)).toBe(true);
    expect(h.model.doc!.views!.at(-1)!.id).toBe('v.view.2');
    const label = await h.run('mesoviewspec.label', { select: '(instance i.granule-docked)', text: 'Here' });
    expect(label.ok, JSON.stringify(label)).toBe(true);
    expect(viewOf(h.model.doc, 'v.view.2')!.annotations?.map((a) => a.id)).toEqual(['an.2']);
  });

  it('Open with no view named opens with the view shown', { tags: ['medium'] }, async () => {
    const h = await open();
    await h.run('mesoviewspec.view', { view: 'v.cell' });
    const steps = h.steps().length;
    const r = await h.run('mesoviewspec.openWith', {});
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(h.steps().length).toBe(steps + 1);
    expect(h.model.doc!.session?.view).toBe('v.cell');
    expect(shownId(h)).toBe('v.cell');
  });
});

/** The labels the adapter drew for the view's annotations: by annotation id, their text. */
function annotationLabels(h: Harness): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of h.v.plugin.state.data.cells.values()) {
    const p = c.transform.params as { node?: string; text?: string } | undefined;
    if (p?.node?.startsWith('md:#an:')) out[p.node.slice('md:#an:'.length)] = p.text ?? '';
  }
  return out;
}

describe('annotations as labels (prism.md §5.2, Add label)', () => {
  it('a view’s annotations are drawn as labels when it is shown, and go when another is', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    expect(annotationLabels(h)).toEqual({});
    const steps = h.steps().length;
    await h.run('mesoviewspec.view', { view: 'v.docked' });
    expect(annotationLabels(h)).toEqual({ 'an.docked': 'Docked granule' });
    await h.run('mesoviewspec.view', { view: 'v.granule-12' });
    expect(annotationLabels(h)).toEqual({ 'an.g12': 'Granule 12: its VAMP2' });
    await h.run('mesoviewspec.view', { view: 'v.cell' });
    expect(annotationLabels(h)).toEqual({});
    expect(h.steps().length).toBe(steps);
    noUnsafe(h);
  });

  it('Undo brings back the labels of the view it shows again; a view removed takes its labels', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    await h.run('mesoviewspec.view', { view: 'v.docked' });
    await h.run('mesoviewspec.eye', { select: '(population p.ribosomes)', visible: false });
    await h.run('mesoviewspec.view', { view: 'v.cell' });
    expect(annotationLabels(h)).toEqual({});
    await h.v.managers.history.undo();
    expect(annotationLabels(h)).toEqual({ 'an.docked': 'Docked granule' });
    // the adapter knows the labels it adopted: showing another view removes them
    await h.run('mesoviewspec.view', { view: 'v.cell' });
    expect(annotationLabels(h)).toEqual({});

    await h.run('mesoviewspec.view', { view: 'v.docked' });
    const r = await h.run('mesoviewspec.edit', { patch: '(patch :ops [(remove t.granule) (remove v.docked)])' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(annotationLabels(h)).toEqual({});
    await h.v.managers.history.undo();
    expect(annotationLabels(h)).toEqual({ 'an.docked': 'Docked granule' });
    noUnsafe(h);
  });

  it('Add label on a row is an annotation of the view shown, one step, drawn and saved', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    await h.run('mesoviewspec.view', { view: 'v.cell' });
    const steps = h.steps().length;
    const r = await h.run('mesoviewspec.label', { select: '(instance i.granule-docked)', text: 'Here' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(h.steps().length).toBe(steps + 1);
    const cell = viewOf(h.model.doc, 'v.cell')!;
    expect(cell.annotations).toEqual([{ id: 'an.1', target: '(instance i.granule-docked)', text: 'Here' }]);
    expect(annotationLabels(h)).toEqual({ 'an.1': 'Here' });
    expect(viewOf(await saved(h), 'v.cell')?.annotations?.[0]?.text).toBe('Here');
    await h.v.managers.history.undo();
    expect(annotationLabels(h)).toEqual({});
    expect(viewOf(h.model.doc, 'v.cell')!.annotations).toBeUndefined();
    noUnsafe(h);
  });
});

describe('a tour (prism.md §4.4)', () => {
  it('plays each step as a view shown, records no step, and leaves the last view shown', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    const steps = h.steps().length;
    const runs = h.runs.length;
    const captions: string[] = [];
    const sub = h.model.changed.subscribe(() => {
      const c = h.model.playing?.caption;
      if (c !== undefined && captions.at(-1) !== c) captions.push(c);
    });
    const r = await h.run('mesoviewspec.tour.play', { tour: 't.quick' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    await h.api.tourEnded();
    sub.unsubscribe();
    expect(captions).toEqual(['The slice', 'Red']);
    // (the looks a view writes are runs of its own run: `particles.look`, no step)
    expect(h.runs.slice(runs).filter((r) => r.startsWith('mesoviewspec.'))).toEqual([
      'mesoviewspec.tour.play',
      'mesoviewspec.view',
      'mesoviewspec.view',
    ]);
    expect(h.steps().length).toBe(steps);
    noUnsafe(h);
    expect(shownId(h)).toBe('v.red');
    expect(ribosomes(h)?.color).toBe(Red);
    expect(h.model.playing).toBeUndefined();
  });

  it('Stop leaves the view shown; Undo stops a tour playing', { tags: ['medium'] }, async () => {
    const h = await open();
    await h.run('mesoviewspec.tour.play', { tour: 't.slow' });
    await until(h, () => shownId(h) === 'v.cell');
    expect(h.model.playing).toMatchObject({ tour: 't.slow', step: 1, of: 2 });
    const stop = await h.run('mesoviewspec.tour.stop', {});
    expect(stop.ok, JSON.stringify(stop)).toBe(true);
    await h.api.tourEnded();
    expect(h.model.playing).toBeUndefined();
    expect(shownId(h)).toBe('v.cell');
    expect((await h.run('mesoviewspec.tour.stop', {})) as { unchanged?: boolean }).toMatchObject({ unchanged: true });

    await h.run('mesoviewspec.eye', { select: '(population p.ribosomes)', visible: false });
    await h.run('mesoviewspec.tour.play', { tour: 't.slow' });
    await until(h, () => h.model.playing?.step === 1);
    // Undo waits for no run in flight (the step's view): it is refused until the view is shown, then the tour holds
    let undo = await h.v.managers.history.undo();
    for (let i = 0; !undo.ok && i < 100; i++) {
      await new Promise((r) => setTimeout(r, 20));
      undo = await h.v.managers.history.undo();
    }
    expect(undo.ok, JSON.stringify(undo)).toBe(true);
    await h.api.tourEnded();
    expect(h.model.playing).toBeUndefined();
  });

  it('a close stops the tour at once, not after its step’s hold', { tags: ['medium'] }, async () => {
    const h = await open();
    await h.run('mesoviewspec.tour.play', { tour: 't.slow' });
    await until(h, () => shownId(h) === 'v.cell' && h.model.playing?.step === 1);
    // t.slow's first step holds 60 s
    const close = await h.run('mesoviewspec.close', {});
    expect(close.ok, JSON.stringify(close)).toBe(true);
    const ended = await Promise.race([
      h.api.tourEnded().then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 1000)),
    ]);
    expect(ended).toBe(true);
    expect(h.model.playing).toBeUndefined();
  });

  it('an unknown tour is refused; none named plays the first', { tags: ['medium'] }, async () => {
    const h = await open();
    expect((await h.run('mesoviewspec.tour.play', { tour: 't.nowhere' })).ok).toBe(false);
    const r = await h.run('mesoviewspec.tour.play', {});
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(h.model.playing?.tour).toBe('t.granule');
    await h.run('mesoviewspec.tour.stop', {});
    await h.api.tourEnded();
  });
});
