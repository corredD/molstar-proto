/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag medium

import { exosomeDoc, ExosomeRecipe, syntheticPicksStar, syntheticVesicleObj } from '@molstar/meso-spec/examples';
import type { Look, MesoViewSpecDoc } from '@molstar/meso-spec/format';
import { ParticleRepresentation3DLayers } from '@molstar/plugin/state/transforms/particles/layers';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { StateSelection } from '@molstar/core/state';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { createMesoViewSpecExtension, type MesoViewSpecApi, type SavedDocument } from '../extension.js';

// The mesoscale operations on a document's lists (prism.md §1.1, §5.1, §5.3): each is a patch of the shown view,
// proposed through the owner port, one step, one Undo; default colors drawn as today unless the person chose a theme
// (option A, Ludo 2026-11-09). Resources come from the dropped files, never the network.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

const exosomeFiles = () => [
  new File([JSON.stringify(ExosomeRecipe)], 'exosome.cellpack-gpu.json'),
  new File([syntheticPicksStar()], 'catalase_picks.star'),
  new File([syntheticVesicleObj()], 'membrane.obj'),
];

async function open(doc: MesoViewSpecDoc = exosomeDoc()) {
  const spec = createMesoscaleExplorerSpec('');
  const v = await createPrismViewerHeadless({
    spec: { ...spec, extensions: (spec.extensions ?? []).filter((e) => e.id !== 'mesoviewspec') },
  });
  viewers.push(v);
  await v.extensions.mount(createMesoViewSpecExtension({ fetchText: async () => undefined }));
  const api = (v.api as unknown as { mesoviewspec: MesoViewSpecApi }).mesoviewspec;
  const person = v.api.as({ kind: 'person' });
  const run = (id: string, values: Record<string, unknown> = {}) => person.run(id, values);
  const r = await run('mesoviewspec.open', { data: JSON.stringify(doc), files: exosomeFiles() });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return { v, api, model: api.model, run, steps: () => v.managers.history.steps.value.length };
}
type Harness = Awaited<ReturnType<typeof open>>;

/** The drawn list holding a population: its state ref and the population's type (its entity id there). */
function listOf(h: Harness, population: string) {
  for (const key of h.model.adapter.keys()) {
    const ref = h.model.adapter.listRef(key);
    const t = h.model.adapter.setOf(key)?.typeTable.find((x) => x.population === population);
    if (ref && t) return { key, ref, type: t.index };
  }
  throw new Error(`no list draws ${population}`);
}

/** The documents' lists drawn, by state ref. */
const listRefs = (h: Harness) => h.model.adapter.keys().flatMap((k) => h.model.adapter.listRef(k) ?? []);

/** The layer a list draws for a type (the adapter writes one a type), as the layers cell holds it. */
function layerOf(h: Harness, ref: string, type: number) {
  const q = StateSelection.Generators.byRef(ref).subtree().ofType(SO.Particle.Representation3D);
  const repr = h.v.plugin.state.data.select(q)[0];
  const tree = h.v.plugin.state.data.tree;
  for (const child of tree.children.get(repr.transform.ref).toArray()) {
    const t = tree.transforms.get(child);
    if (t?.transformer !== ParticleRepresentation3DLayers) continue;
    const layers = (t.params as { layers: { targets: number[]; color: number | null; visible: boolean }[] }).layers;
    return layers.find((l) => l.targets.length === 1 && l.targets[0] === type);
  }
  return undefined;
}

async function saved(h: Harness): Promise<MesoViewSpecDoc> {
  const r = await h.run('mesoviewspec.save', {});
  expect(r.ok).toBe(true);
  return JSON.parse(await (r as { value: SavedDocument }).value.blob.text()) as MesoViewSpecDoc;
}

const shownLooks = (doc: MesoViewSpecDoc): readonly Look[] => {
  const id = doc.session?.view;
  return ((id !== undefined ? doc.views?.find((v) => v.id === id) : undefined) ?? doc.views?.[0])?.looks ?? [];
};
const styleLooks = (doc: MesoViewSpecDoc) => shownLooks(doc).filter((l) => l.id?.startsWith('l.style.'));

describe('mesoscale.style on a document list (prism.md §5.1)', () => {
  it('is a style look of the shown view: one step; the same address set and moved last; reset removes it; Undo', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    const { ref, type } = listOf(h, 'p.catalase');
    const s0 = h.steps();
    const red = await h.run('mesoscale.style', { particles: ref, entities: String(type), color: '#ff0000' });
    expect(red.ok, JSON.stringify(red)).toBe(true);
    expect(h.steps()).toBe(s0 + 1);
    const a = await saved(h);
    expect(styleLooks(a)).toEqual([{ id: 'l.style.1', select: '(population p.catalase)', color: '#ff0000' }]);
    expect(shownLooks(a).at(-1)?.id).toBe('l.style.1');
    expect(layerOf(h, ref, type)?.color).toBe(0xff0000);

    // the same address again: the same look, set (no l.style.2)
    expect((await h.run('mesoscale.style', { particles: ref, entities: String(type), visible: false })).ok).toBe(true);
    expect(h.steps()).toBe(s0 + 2);
    const b = await saved(h);
    expect(styleLooks(b)).toEqual([
      { id: 'l.style.1', select: '(population p.catalase)', color: '#ff0000', visible: false },
    ]);
    expect(layerOf(h, ref, type)?.visible).toBe(false);

    // reset removes the style look only
    expect((await h.run('mesoscale.style', { particles: ref, entities: String(type), reset: true })).ok).toBe(true);
    const c = await saved(h);
    expect(styleLooks(c)).toEqual([]);
    expect(shownLooks(c)).toEqual(shownLooks(exosomeDoc() as MesoViewSpecDoc));

    // Undo each
    expect((await h.v.managers.history.undo()).ok).toBe(true);
    expect(styleLooks(await saved(h))).toEqual(styleLooks(b));
    expect((await h.v.managers.history.undo()).ok).toBe(true);
    expect(styleLooks(await saved(h))).toEqual(styleLooks(a));
    expect((await h.v.managers.history.undo()).ok).toBe(true);
    expect(styleLooks(await saved(h))).toEqual([]);
  });

  it('a group picked whole is its compartment, (in c.x); the eye’s and the author’s looks stay', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    expect((await h.run('mesoviewspec.eye', { select: '(population p.lipids)', visible: false })).ok).toBe(true);
    const { ref } = listOf(h, 'p.catalase');
    const info = await h.run('mesoscale.entities', { particles: ref });
    expect(info.ok).toBe(true);
    const groups = (info as { value: { groups: { groups: { path: string }[] } } }).value.groups;
    const path = groups.groups[0].path;
    const compartment = path.split('.').slice(-2).join('.');
    expect((await h.run('mesoscale.style', { particles: ref, group: path, transparency: 0.5 })).ok).toBe(true);
    const d = await saved(h);
    expect(styleLooks(d).map((l) => l.select)).toEqual([`(in ${compartment})`]);
    expect(shownLooks(d).filter((l) => l.id?.startsWith('l.eye.'))).toHaveLength(1);
  });

  it('the first style of a document without a view inserts v.prism', { tags: ['medium'] }, async () => {
    const doc = { ...exosomeDoc(), views: [], session: undefined } as MesoViewSpecDoc;
    const h = await open(doc);
    const { ref, type } = listOf(h, 'p.catalase');
    expect((await h.run('mesoscale.style', { particles: ref, entities: String(type), color: '#00ff00' })).ok).toBe(
      true,
    );
    const d = await saved(h);
    expect(d.views?.map((v) => v.id)).toEqual(['v.prism']);
    expect(styleLooks(d)).toEqual([{ id: 'l.style.1', select: '(population p.catalase)', color: '#00ff00' }]);
  });
});

describe('the other operations on a document list (prism.md §5.1)', () => {
  it('entities: read through the owner: the document’s compartments, the populations by label', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    const { ref, key } = listOf(h, 'p.catalase');
    const r = await h.run('mesoscale.entities', { particles: ref });
    expect(r.ok).toBe(true);
    const info = (r as { value: { entities: { id: number; name: string }[]; groups: unknown } }).value;
    const set = h.model.adapter.setOf(key)!;
    expect(info.entities.map((e) => e.name)).toEqual(set.typeTable.map((t) => t.label));
    // grouped by the document's compartments (ids), not the list's own (a document list has none)
    expect(JSON.stringify(info.groups)).toContain('c.exosome');
    const kinds = await h.run('mesoscale.entities', { particles: ref, groupBy: 'function' });
    const kindGroups = (kinds as { value: { groups: { groups: { path: string }[] } } }).value.groups.groups;
    expect(kindGroups.map((g) => g.path)).toContain('protein');
  });

  it('colors: generate is one look a population, one step; theme removes their colors', { tags: ['medium'] }, async () => {
    const h = await open();
    const { ref, key } = listOf(h, 'p.catalase');
    const n = h.model.adapter.setOf(key)!.typeTable.length;
    const s0 = h.steps();
    expect((await h.run('mesoscale.colors', { particles: ref, scheme: 'generate' })).ok).toBe(true);
    expect(h.steps()).toBe(s0 + 1);
    const a = await saved(h);
    expect(styleLooks(a)).toHaveLength(n);
    for (const l of styleLooks(a)) expect(l.color).toMatch(/^#[0-9a-f]{6}$/);
    expect((await h.run('mesoscale.colors', { particles: ref, scheme: 'theme' })).ok).toBe(true);
    // every color back to the default: the style looks that held only a color go
    const b = await saved(h);
    expect(styleLooks(b)).toEqual([]);
    expect((await h.v.managers.history.undo()).ok).toBe(true);
    expect(styleLooks(await saved(h))).toEqual(styleLooks(a));
  });

  it('importColors: one patch, by the populations’ labels', { tags: ['medium'] }, async () => {
    const h = await open();
    const { ref, key, type } = listOf(h, 'p.catalase');
    const label = h.model.adapter.setOf(key)!.typeTable[type].label;
    const s0 = h.steps();
    const r = await h.run('mesoscale.importColors', {
      particles: ref,
      json: JSON.stringify({ [label]: '#123456', nowhere: '#ffffff' }),
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(h.steps()).toBe(s0 + 1);
    expect(styleLooks(await saved(h))).toEqual([
      { id: 'l.style.1', select: '(population p.catalase)', color: '#123456' },
    ]);
  });

  it('theme over the document’s lists: one step, one Undo', { tags: ['medium'] }, async () => {
    const h = await open();
    const refs = listRefs(h);
    expect(refs.length).toBeGreaterThan(1);
    const s0 = h.steps();
    const r = await h.run('mesoscale.theme', { objects: refs, theme: 'uniform', color: '#808080' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(h.steps()).toBe(s0 + 1);
    const a = await saved(h);
    expect(styleLooks(a)).toHaveLength(refs.length);
    for (const l of styleLooks(a)) expect(l.color).toBe('#808080');
    const { ref, type } = listOf(h, 'p.catalase');
    expect(layerOf(h, ref, type)?.color).toBe(0x808080);
    expect((await h.v.managers.history.undo()).ok).toBe(true);
    expect(styleLooks(await saved(h))).toEqual([]);
  });
});

describe('default colors (prism.md §5.3, option A)', () => {
  it('are drawn as today; a theme the person chose leaves them out and keeps the stated ones', {
    tags: ['medium'],
  }, async () => {
    const h = await open();
    const { ref, type } = listOf(h, 'p.catalase');
    // a stated color on catalase; every other type of its list keeps its default
    expect((await h.run('mesoscale.style', { particles: ref, entities: String(type), color: '#ff0000' })).ok).toBe(
      true,
    );
    const ir = h.model.session!.ir!;
    const defaults = ir.view.looks.filter((l) => l.colorDefault && !l.runs && h.model.adapter.listRef(l.set) === ref);
    expect(defaults.length).toBeGreaterThan(0);
    const other = defaults[0];
    expect(layerOf(h, ref, other.types[0])?.color).toBe(other.color);

    // the person chooses a theme for the list (a viewer-only setting), then the owner draws again
    const q = StateSelection.Generators.byRef(ref).subtree().ofType(SO.Particle.Representation3D);
    const repr = h.v.plugin.state.data.select(q)[0];
    await h.v.plugin
      .build()
      .to(repr.transform.ref)
      .update({ ...(repr.transform.params as object), colorTheme: { name: 'particle-entity', params: {} } })
      .commit();
    await h.api.owner.themeChanged([ref], h.v.api);
    // no color layer: none at all, or one with no color
    expect(layerOf(h, ref, other.types[0])?.color ?? null).toBeNull();
    expect(layerOf(h, ref, type)?.color).toBe(0xff0000);
  });
});
