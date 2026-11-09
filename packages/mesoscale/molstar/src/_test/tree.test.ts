/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag medium

import { OrderedSet } from '@molstar/core/data/int';
import {
  betaCellDoc,
  BetaCellResources,
  exosomeDoc,
  ExosomeRecipe,
  syntheticPicksStar,
  syntheticVesicleObj,
} from '@molstar/meso-spec/examples';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format';
import { placementSets } from '@molstar/meso-spec/ir';
import { Particle, type ParticleList } from '@molstar/model/model/particles/particle-list';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { observableState } from '@molstar/prism-ui/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DocumentGroupBy, OutlineStats } from '../document-tree.js';
import { createMesoViewSpecExtension, type MesoViewSpecApi, type SavedDocument } from '../extension.js';

// The open document in the Scene tree (prism.md §4.1, §4.2, §4.5, §4.6, §5.2) on a headless Prism viewer: the rows and
// their counts, a 3D pick's row, a row's highlight, Focus, the eye and Show only as patches, Group by. Resources come
// from the dropped files, never the network.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const v of viewers.splice(0)) await v.dispose();
});

const Recipe = JSON.stringify(ExosomeRecipe);
const Picks = syntheticPicksStar();
const Membrane = syntheticVesicleObj();
const RecipeName = 'exosome.cellpack-gpu.json';
const Repack = (count: number) => `(patch :ops [(set p.catalase :fields (:abundance (:count ${count})))])`;

const exosomeFiles = () => [
  new File([Recipe], RecipeName),
  new File([Picks], 'catalase_picks.star'),
  new File([Membrane], 'membrane.obj'),
];

/** The β-cell's recipe as a file named by the basename of its resource's address (a document's files are by name). */
function betaCellFiles(doc: MesoViewSpecDoc) {
  const files: File[] = [];
  for (const r of doc.resources ?? []) {
    const make = BetaCellResources[r.id];
    if (!make || !r.uri) continue;
    files.push(new File([JSON.stringify(make())], r.uri.slice(r.uri.lastIndexOf('/') + 1)));
  }
  return files;
}

async function setup() {
  const spec = createMesoscaleExplorerSpec('');
  const v = await createPrismViewerHeadless({
    spec: { ...spec, extensions: (spec.extensions ?? []).filter((e) => e.id !== 'mesoviewspec') },
  });
  viewers.push(v);
  await v.extensions.mount(createMesoViewSpecExtension({ fetchText: async () => undefined }));
  const api = (v.api as unknown as { mesoviewspec: MesoViewSpecApi }).mesoviewspec;
  const person = v.api.as({ kind: 'person' });
  return {
    v,
    api,
    model: api.model,
    run: (id: string, values: Record<string, unknown> = {}) => person.run(id, values),
    steps: () => v.managers.history.steps.value.length,
  };
}
type Harness = Awaited<ReturnType<typeof setup>>;

async function openExosome() {
  const h = await setup();
  const r = await h.run('mesoviewspec.open', { data: JSON.stringify(exosomeDoc()), files: exosomeFiles() });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return h;
}

async function openBetaCell() {
  const h = await setup();
  const doc = betaCellDoc();
  const r = await h.run('mesoviewspec.open', { data: JSON.stringify(doc), files: betaCellFiles(doc) });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return h;
}

/** The drawn lists: their set key and their particle list. */
function drawn(h: Harness) {
  return h.model.adapter.keys().flatMap((key) => {
    const list = h.model.adapter.listObject(key)?.data as ParticleList | undefined;
    return list && h.model.adapter.listRef(key) ? [{ key, list }] : [];
  });
}

/** The keys of expanded instance lists (`<set>|<type>*<template>`). */
const expandedKeys = (h: Harness) => drawn(h).filter((d) => d.key.includes('*'));

const keyOf = (h: Harness, loci: Particle.Loci) => drawn(h).find((d) => d.list === loci.particles)?.key;

const size = (loci: readonly Particle.Loci[]) => loci.reduce((n, l) => n + Particle.lociSize(l), 0);

/** The saved document: what `mesoviewspec.save` gives, read back. */
async function saved(h: Harness): Promise<{ text: string; doc: MesoViewSpecDoc }> {
  const r = await h.run('mesoviewspec.save', {});
  expect(r.ok).toBe(true);
  const text = await (r.ok ? (r.value as SavedDocument).blob.text() : Promise.resolve(''));
  return { text, doc: JSON.parse(text) as MesoViewSpecDoc };
}

const shownLooks = (doc: MesoViewSpecDoc) => {
  const id = doc.session?.view;
  return ((id !== undefined ? doc.views?.find((v) => v.id === id) : undefined) ?? doc.views?.[0])?.looks ?? [];
};
const looksWith = (doc: MesoViewSpecDoc, prefix: string) => shownLooks(doc).filter((l) => l.id?.startsWith(prefix));

describe('the rows of the document (prism.md §4.1)', () => {
  it('shows the compartments tree with the session counts; a re-pack changes the row and Undo brings it back', {
    tags: ['medium'],
  }, async () => {
    const h = await openExosome();
    const tree = h.api.treeState();
    const seen: unknown[] = [];
    const sub = tree.subscribe((t) => seen.push(t));
    try {
      const before = tree.value!;
      expect(before.outline.roots).toEqual(['medium']);
      expect(before.outline.title).toBe('Exosome in plasma');
      const counts = h.model.session!.counts;
      const row = before.outline.row('p.catalase')!;
      expect(row.kind).toBe('population');
      expect(row.achieved).toBe(counts['p.catalase'].achieved);
      expect(row.requested).toBe(counts['p.catalase'].requested);
      expect(row.achieved).toBeGreaterThan(0);
      expect(before.outline.row('p.lipids')?.achieved).toBe(counts['p.lipids'].achieved);
      const achieved0 = row.achieved;
      const requested0 = row.requested;
      const steps0 = h.steps();

      expect((await h.run('mesoviewspec.edit', { patch: Repack(300) })).ok).toBe(true);
      expect(h.steps()).toBe(steps0 + 1);
      const after = tree.value!;
      const edited = after.outline.row('p.catalase')!;
      expect(edited.requested).toBe(300);
      expect(edited.achieved).toBe(h.model.session!.counts['p.catalase'].achieved);
      expect(edited.achieved).not.toBe(achieved0);
      // the rows of the populations that did not change read the same
      expect(after.outline.row('p.lipids')).toEqual(before.outline.row('p.lipids'));

      expect((await h.v.managers.history.undo()).ok).toBe(true);
      const undone = tree.value!;
      const back = undone.outline.row('p.catalase')!;
      expect(back.requested).toBe(requested0);
      expect(back.achieved).toBe(achieved0);
      expect(back.achieved).toBe(h.model.session!.counts['p.catalase'].achieved);
      // the watched state emitted along the way
      await new Promise((r) => setTimeout(r, 50));
      expect(seen.length).toBeGreaterThan(0);
    } finally {
      sub.unsubscribe();
    }
  });
});

describe('a pick maps to its row (prism.md §4.6)', () => {
  it('exosome: the first copy of every drawn list is a population row, and its label names the population', {
    tags: ['medium'],
  }, async () => {
    const h = await openExosome();
    const outline = h.model.outline()!;
    const lists = drawn(h);
    expect(lists.length).toBeGreaterThan(0);
    for (const { key, list } of lists) {
      const id = h.api.rowOfCopy(key, 0);
      expect(id, `row of ${key}`).toBeDefined();
      const row = outline.row(id!);
      expect(row, `row ${id} of ${key}`).toBeDefined();
      expect(row!.kind, `kind of ${id}`).toBe('population');
      expect(list.getParticleLabel(0)).toMatch(new RegExp(`^${id!.replaceAll('.', '\\.')}#\\d+$`));
    }
    // a row of another set is no row
    expect(h.api.rowOfCopy('no-such-set', 0)).toBeUndefined();
    expect(h.api.rowOfCopy(lists[0].key, -1)).toBeUndefined();
  });

  it("exosome: a world list's entity description is its entity's label and its compartment's", {
    tags: ['medium'],
  }, async () => {
    const h = await openExosome();
    const doc = h.model.doc!;
    const lists = drawn(h);
    for (const { key, list } of lists) {
      for (const [type, info] of list.entityInfo ?? []) {
        expect(info.description, `description of type ${type} in ${key}`).toMatch(/^.+ · .+$/);
      }
    }
    const catalase = doc.populations.find((p) => p.id === 'p.catalase')!;
    const entity = doc.entities.find((e) => e.id === catalase.entity)!;
    const compartment = doc.compartments.find((c) => c.id === catalase.compartment)!;
    const descriptions = lists.flatMap((d) => [...(d.list.entityInfo?.values() ?? [])].map((i) => i.description));
    expect(descriptions).toContain(`${entity.label} · ${compartment.label}`);
  });

  it('β-cell: an expanded list maps to a part row; labels name the instance then the copy in the template', {
    tags: ['medium'],
  }, async () => {
    const h = await openBetaCell();
    const outline = h.model.outline()!;
    const expanded = expandedKeys(h);
    expect(expanded.length).toBeGreaterThan(0);
    let fromPopulation = 0;
    let fromInstance = 0;
    for (const { key, list } of drawn(h)) {
      const id = h.api.rowOfCopy(key, 0)!;
      expect(id, `row of ${key}`).toBeDefined();
      expect(outline.row(id), `row ${id} of ${key}`).toBeDefined();
      const label = list.getParticleLabel(0);
      if (!key.includes('*')) {
        expect(outline.row(id)!.kind).not.toBe('part');
        continue;
      }
      expect(id, key).toMatch(/^(p\.granules|i\.granule-[a-z]+)\/p\.[A-Za-z0-9]+$/);
      expect(outline.row(id)!.kind).toBe('part');
      const [outer, inner] = id.split('/');
      if (outer === 'p.granules') {
        fromPopulation++;
        expect(label).toMatch(new RegExp(`^p\\.granules#\\d+/${inner.replaceAll('.', '\\.')}#\\d+$`));
      } else {
        fromInstance++;
        expect(label).toMatch(new RegExp(`^${outer.replaceAll('.', '\\.')}/${inner.replaceAll('.', '\\.')}#\\d+$`));
      }
    }
    expect(fromPopulation).toBeGreaterThan(0);
    expect(fromInstance).toBeGreaterThan(0);
    // every copy of an expanded list is a part row of the document
    for (const { key, list } of expanded) {
      for (const i of [0, Math.floor(list.count / 2), list.count - 1]) {
        const id = h.api.rowOfCopy(key, i)!;
        expect(outline.row(id), `row ${id} of ${key}#${i}`).toBeDefined();
      }
    }
  });
});

describe("a row's highlight is one loci a list (prism.md §4.6)", () => {
  it('exosome: a population is one loci of its achieved count; a compartment covers several lists', {
    tags: ['medium'],
  }, async () => {
    const h = await openExosome();
    const counts = h.model.session!.counts;
    const lipids = h.api.lociOf('(population p.lipids)');
    expect(lipids).toHaveLength(1);
    expect(Particle.lociSize(lipids[0] as Particle.Loci)).toBe(counts['p.lipids'].achieved);
    expect(counts['p.lipids'].achieved).toBeGreaterThan(0);
    // the same objects while what is drawn is the same
    expect(h.api.lociOf('(population p.lipids)')).toBe(lipids);

    const inside = h.api.lociOf('(in c.exosome)') as readonly Particle.Loci[];
    expect(inside.length).toBeGreaterThan(1);
    expect(new Set(inside.map((l) => l.particles)).size).toBe(inside.length);
    const doc = h.model.doc!;
    const expected = doc.populations
      .filter((p) => p.compartment === 'c.exosome')
      .reduce((n, p) => n + (counts[p.id]?.achieved ?? 0), 0);
    expect(size(inside)).toBe(expected);
  });

  it('β-cell: the granules light whole instances; one instance’s Vamp2 lights exactly its copies', {
    tags: ['medium'],
  }, async () => {
    const h = await openBetaCell();
    const counts = h.model.session!.counts;
    const ir = h.model.session!.ir!;
    const sets = placementSets(ir);

    const all = h.api.lociOf('(population p.granules)') as readonly Particle.Loci[];
    const expandedOfPopulation = expandedKeys(h).filter((d) => h.api.rowOfCopy(d.key, 0)?.startsWith('p.granules/'));
    expect(expandedOfPopulation.length).toBeGreaterThan(0);
    // the expanded lists, and the pack's own list where the 120 granules stand (drawn too)
    const granules = all.filter((l) => keyOf(h, l)?.includes('*'));
    const bodies = all.filter((l) => !keyOf(h, l)?.includes('*'));
    expect(granules.length).toBe(expandedOfPopulation.length);
    expect(bodies.map((l) => Particle.lociSize(l))).toEqual([120]);
    let perGranule = 0;
    for (const { key } of expandedOfPopulation) {
      const template = key.slice(key.indexOf('*') + 1);
      perGranule += sets.find((s) => s.key === template)!.count;
    }
    expect(size(granules)).toBe(120 * perGranule);
    for (const l of granules) expect(keyOf(h, l)).toBeDefined();

    const vamp = h.api.lociOf('(part (instance i.granule-docked) p.Vamp2)') as readonly Particle.Loci[];
    expect(vamp.length).toBeGreaterThan(0);
    expect(size(vamp)).toBe(counts['p.Vamp2'].achieved);
    expect(counts['p.Vamp2'].achieved).toBeGreaterThan(0);
    // and each lit copy is the docked granule's Vamp2: no other instance's
    for (const l of vamp) {
      const key = keyOf(h, l)!;
      for (let k = 0; k < Particle.lociSize(l); k++) {
        expect(h.api.rowOfCopy(key, OrderedSet.getAt(l.indices, k))).toBe('i.granule-docked/p.Vamp2');
      }
    }
  });
});

describe('Focus frames the sphere of the row (prism.md §4.5)', () => {
  it('mesoviewspec.focus on a population: no history step, the camera on lociSphere', {
    tags: ['medium'],
  }, async () => {
    const h = await openExosome();
    const sphere = h.model.sphereOf('(population p.catalase)')!;
    expect(sphere).toBeDefined();
    expect(sphere.radius).toBeGreaterThan(0);
    const steps = h.steps();
    // a headless viewer has no canvas: the camera manager is asked to frame the sphere, which is what moves the target
    const focus = vi.spyOn(h.v.plugin.managers.camera, 'focusSphere').mockImplementation(() => {});
    const r = await h.run('mesoviewspec.focus', { select: '(population p.catalase)' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(h.steps()).toBe(steps);
    expect(focus).toHaveBeenCalledTimes(1);
    const framed = focus.mock.calls[0][0];
    for (let i = 0; i < 3; i++) expect(Math.abs(framed.center[i] - sphere.center[i])).toBeLessThan(1e-3);
    expect(Math.abs(framed.radius - sphere.radius)).toBeLessThan(1e-3);
    const canvas = h.v.plugin.canvas3d;
    if (canvas) {
      const target = canvas.camera.state.target;
      for (let i = 0; i < 3; i++) expect(Math.abs(target[i] - sphere.center[i])).toBeLessThan(1e-3);
    }
    expect(await h.run('mesoviewspec.focus', { select: '(population p.nothing)' })).toMatchObject({ ok: false });
  });
});

describe('the eye and Show only are patches of the shown view (prism.md §5.2)', () => {
  it('an eye is one step and one look; a second one sets the same look; Show only inserts two and removes only them; Undo', {
    tags: ['medium'],
  }, async () => {
    const h = await openExosome();
    const tree = h.api.treeState();
    expect(tree.value!.looks.visible('p.lipids')).toBe(true);
    expect(tree.value!.looks.visible('c.exosome')).toBe(true);
    const steps0 = h.steps();

    const hide = await h.run('mesoviewspec.eye', { select: '(population p.lipids)', visible: false });
    expect(hide.ok, JSON.stringify(hide)).toBe(true);
    expect(h.steps()).toBe(steps0 + 1);
    const a = await saved(h);
    const eyes = looksWith(a.doc, 'l.eye.');
    expect(eyes).toHaveLength(1);
    expect(eyes[0]).toMatchObject({ id: 'l.eye.1', select: '(population p.lipids)', visible: false });
    expect(shownLooks(a.doc).at(-1)?.id).toBe('l.eye.1');
    expect(tree.value!.looks.visible('p.lipids')).toBe(false);
    expect(tree.value!.looks.visible('c.exosome')).toBe(false);
    expect(tree.value!.visible).toBe(false);
    expect(tree.value!.looks.visible('p.catalase')).toBe(true);

    // a second eye on the address sets the same look: no l.eye.2
    const show = await h.run('mesoviewspec.eye', { select: '(population p.lipids)', visible: true });
    expect(show.ok, JSON.stringify(show)).toBe(true);
    expect(h.steps()).toBe(steps0 + 2);
    const b = await saved(h);
    expect(looksWith(b.doc, 'l.eye.')).toEqual([expect.objectContaining({ id: 'l.eye.1', visible: true })]);
    expect(tree.value!.looks.visible('p.lipids')).toBe(true);
    expect(tree.value!.looks.visible('c.exosome')).toBe(true);

    // Show only
    expect(h.model.showsOnly).toBe(false);
    expect((await h.run('mesoviewspec.showOnly', { select: '(in c.exosome)' })).ok).toBe(true);
    expect(h.steps()).toBe(steps0 + 3);
    expect(h.model.showsOnly).toBe(true);
    expect(tree.value!.showsOnly).toBe(true);
    const c = await saved(h);
    expect(looksWith(c.doc, 'l.only.').map((l) => [l.id, l.select, l.visible])).toEqual([
      ['l.only.1', '(all)', false],
      ['l.only.2', '(in c.exosome)', true],
    ]);
    // the eye's look stays
    expect(looksWith(c.doc, 'l.eye.')).toHaveLength(1);
    expect(tree.value!.looks.visible('p.ALB')).toBe(false);
    expect(tree.value!.looks.visible('p.catalase')).toBe(true);
    // the Show-only looks come after the eye's: the lipids are shown again
    expect(tree.value!.looks.visible('p.lipids')).toBe(true);

    // Show all again removes only the Show-only looks
    expect((await h.run('mesoviewspec.showOnly', {})).ok).toBe(true);
    expect(h.steps()).toBe(steps0 + 4);
    expect(h.model.showsOnly).toBe(false);
    const d = await saved(h);
    expect(looksWith(d.doc, 'l.only.')).toEqual([]);
    expect(shownLooks(d.doc)).toEqual(shownLooks(b.doc));

    // Undo brings back the previous looks
    expect((await h.v.managers.history.undo()).ok).toBe(true);
    expect(shownLooks((await saved(h)).doc)).toEqual(shownLooks(c.doc));
    expect(h.model.showsOnly).toBe(true);
    expect(tree.value!.showsOnly).toBe(true);
    expect((await h.v.managers.history.undo()).ok).toBe(true);
    expect(shownLooks((await saved(h)).doc)).toEqual(shownLooks(b.doc));
    expect(h.model.showsOnly).toBe(false);
    expect((await h.v.managers.history.undo()).ok).toBe(true);
    expect(shownLooks((await saved(h)).doc)).toEqual(shownLooks(a.doc));
    expect(tree.value!.looks.visible('p.lipids')).toBe(false);
  });

  it('a saved document opens again with its looks: the eye is still closed', { tags: ['medium'] }, async () => {
    const h = await openExosome();
    expect((await h.run('mesoviewspec.eye', { select: '(population p.lipids)', visible: false })).ok).toBe(true);
    const a = await saved(h);
    expect((await h.run('mesoviewspec.close', {})).ok).toBe(true);
    expect(h.model.doc).toBeUndefined();
    expect(h.api.treeState().value).toBeUndefined();

    const r = await h.run('mesoviewspec.open', { data: a.text, files: exosomeFiles() });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const b = await saved(h);
    expect(shownLooks(b.doc)).toEqual(shownLooks(a.doc));
    expect(looksWith(b.doc, 'l.eye.')).toHaveLength(1);
    const tree = h.api.treeState().value!;
    expect(tree.looks.visible('p.lipids')).toBe(false);
    expect(tree.looks.visible('c.exosome')).toBe(false);
    expect(tree.looks.visible('p.catalase')).toBe(true);

    // and Show only, on top of the eye
    expect((await h.run('mesoviewspec.showOnly', { select: '(population p.catalase)' })).ok).toBe(true);
    const c = await saved(h);
    expect((await h.run('mesoviewspec.close', {})).ok).toBe(true);
    expect((await h.run('mesoviewspec.open', { data: c.text, files: exosomeFiles() })).ok).toBe(true);
    expect(shownLooks((await saved(h)).doc)).toEqual(shownLooks(c.doc));
    expect(h.model.showsOnly).toBe(true);
    const again = h.api.treeState().value!;
    expect(again.showsOnly).toBe(true);
    expect(again.looks.visible('p.ALB')).toBe(false);
    expect(again.looks.visible('p.lipids')).toBe(false);
    expect(again.looks.visible('p.catalase')).toBe(true);
  });
});

describe('Group by (prism.md §4.2)', () => {
  it('switches to Model, Kind and back; the Compartment outline is not rebuilt', { tags: ['medium'] }, async () => {
    const h = await openExosome();
    const groupBy = observableState<DocumentGroupBy>('compartment');
    const tree = h.api.treeState(groupBy.asReadonly);
    const sub = tree.subscribe(() => {});
    try {
      const compartment = tree.value!.outline;
      expect(compartment.groupBy).toBe('compartment');
      expect(compartment.roots).toEqual(['medium']);
      const made = OutlineStats.made;

      groupBy.set('model');
      const model = tree.value!.outline;
      expect(model.groupBy).toBe('model');
      expect(model.roots.length).toBeGreaterThan(0);
      expect(model.roots.every((id) => id.startsWith('@model:'))).toBe(true);
      expect(model.row('p.catalase')?.parent?.startsWith('@model:')).toBe(true);
      expect(model.copies).toBe(compartment.copies);
      expect(OutlineStats.made).toBe(made + 1);

      groupBy.set('kind');
      const kind = tree.value!.outline;
      expect(kind.groupBy).toBe('kind');
      expect(kind.roots.every((id) => id.startsWith('@kind:'))).toBe(true);
      expect(kind.roots).toContain('@kind:lipid');
      expect(kind.row('p.lipids')?.parent).toBe('@kind:lipid');
      expect(OutlineStats.made).toBe(made + 2);

      groupBy.set('compartment');
      expect(tree.value!.outline).toBe(compartment);
      expect(OutlineStats.made).toBe(made + 2);
      // and back to a grouping seen before: the same again
      groupBy.set('model');
      expect(tree.value!.outline).toBe(model);
      expect(OutlineStats.made).toBe(made + 2);
    } finally {
      sub.unsubscribe();
    }
  });
});
