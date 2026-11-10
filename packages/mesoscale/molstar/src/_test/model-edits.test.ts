/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag medium

import { exosomeDoc, ExosomeRecipe, syntheticPicksStar, syntheticVesicleObj } from '@molstar/meso-spec/examples';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { createMesoViewSpecExtension, type MesoViewSpecApi } from '../extension.js';
import { countPatch, relaxPatch, seedPatch } from '../model-edits.js';

// The model edits of Built by on the exosome (prism.md §4.3, §7.2): each is one `mesoviewspec.edit` of the owner, one
// step, one Undo, and the session's record says which models resolved again. Resources come from files, no network.

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
  const r = await person.run('mesoviewspec.open', { data: JSON.stringify(doc), files: exosomeFiles() });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const model = api.model;
  const steps = () => v.managers.history.steps.value.length;
  const edit = (patch: unknown) => person.run('mesoviewspec.edit', { patch: JSON.stringify(patch) });
  const last = () => model.session!.history.at(-1)!;
  /** The models the last edit resolved, and those it took from the cache */
  const ran = () =>
    last()
      .models?.filter((m) => !m.cached)
      .map((m) => m.model);
  const hit = () =>
    last()
      .models?.filter((m) => m.cached)
      .map((m) => m.model);
  return { v, api, model, person, steps, edit, last, ran, hit, undo: () => v.managers.history.undo() };
}
type Harness = Awaited<ReturnType<typeof open>>;

const copies = (h: Harness, population: string) => h.model.session!.counts[population];

describe('a count edit (prism.md §4.3, §7.2)', () => {
  it('is one model edit that runs only its model again; Undo brings the copies back', async () => {
    const h = await open();
    const before = copies(h, 'p.catalase');
    expect(before.requested).toBe(506);
    const s0 = h.steps();
    const { patch } = countPatch(h.model.doc!, 'p.catalase', 300);
    const r = await h.edit(patch);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(h.steps()).toBe(s0 + 1);
    expect(h.last().kind).toBe('model');
    // the recipe model holds the catalase: it runs again, the picks and the rest are the session's
    expect(h.ran()).toEqual(['m.recipe']);
    expect(h.hit()).toContain('m.picks');
    expect(copies(h, 'p.catalase')).toEqual({ requested: 300, achieved: 300 });
    expect((h.model.doc!.populations.find((p) => p.id === 'p.catalase')?.abundance as { count: number }).count).toBe(
      300,
    );

    await h.undo();
    expect((h.model.doc!.populations.find((p) => p.id === 'p.catalase')?.abundance as { count: number }).count).toBe(
      506,
    );
    expect(h.steps()).toBe(s0);
  });

  it('a count below 0 is refused: nothing changes, no step', async () => {
    const h = await open();
    const doc = h.model.doc;
    const s0 = h.steps();
    const bad = {
      format: 'meso_view_spec_patch',
      ops: [{ op: 'set', id: 'p.catalase', fields: { abundance: { count: -4 } } }],
    };
    const r = await h.edit(bad);
    expect(r.ok).toBe(false);
    expect(h.steps()).toBe(s0);
    expect(h.model.doc).toBe(doc);
    expect(copies(h, 'p.catalase').requested).toBe(506);
  });

  it('the owner’s entities carry the new count (the info is not the last set’s)', async () => {
    const h = await open();
    const list = h.model.adapter
      .keys()
      .find((k) => h.model.adapter.setOf(k)?.typeTable.some((t) => t.population === 'p.catalase'))!;
    const ref = h.model.adapter.listRef(list)!;
    const countOf = () => {
      const info = h.api.owner?.info(ref);
      return info?.entities.find((e) => e.name.toLowerCase().includes('catalase'))?.count;
    };
    // the copies placed (the packer fits fewer than the 506 asked for), as the session counts them
    expect(countOf()).toBe(copies(h, 'p.catalase').achieved);
    const r = await h.edit(countPatch(h.model.doc!, 'p.catalase', 300).patch);
    expect(r.ok).toBe(true);
    const list2 = h.model.adapter
      .keys()
      .find((k) => h.model.adapter.setOf(k)?.typeTable.some((t) => t.population === 'p.catalase'))!;
    const ref2 = h.model.adapter.listRef(list2)!;
    const info = h.api.owner?.info(ref2);
    expect(info?.entities.find((e) => e.name.toLowerCase().includes('catalase'))?.count).toBe(300);
  });
});

describe('a seed edit', () => {
  it('runs only its model again, with other copies: one step; Undo', async () => {
    const h = await open();
    const s0 = h.steps();
    const key0 = h.model.adapter.keys().find((k) => k.startsWith('m.recipe@'));
    const r = await h.edit(seedPatch(h.model.doc!, 'm.recipe', 7).patch);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(h.steps()).toBe(s0 + 1);
    expect(h.ran()).toEqual(['m.recipe']);
    expect(h.model.adapter.keys().find((k) => k.startsWith('m.recipe@'))).not.toBe(key0);
    expect(h.model.doc!.models?.find((m) => m.id === 'm.recipe')?.seed).toBe(7);
    await h.undo();
    expect(h.model.doc!.models?.find((m) => m.id === 'm.recipe')?.seed).toBe(1);
    expect(h.steps()).toBe(s0);
  });
});

describe('Add relax stage', () => {
  it('adds meso.relax as a refining model: the recipe is the session’s, the stage runs; 506 of 506; Undo', async () => {
    const h = await open();
    const s0 = h.steps();
    expect(copies(h, 'p.catalase').achieved).toBeLessThan(506);
    const r = await h.edit(relaxPatch(h.model.doc!, 'm.recipe').patch);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(h.steps()).toBe(s0 + 1);
    expect(h.ran()).toEqual(['m.relax']);
    expect(h.hit()).toContain('m.recipe');
    expect(copies(h, 'p.catalase')).toEqual({ requested: 506, achieved: 506 });
    await h.undo();
    expect(h.model.doc!.models?.some((m) => m.id === 'm.relax')).toBe(false);
    expect(copies(h, 'p.catalase').achieved).toBeLessThan(506);
    expect(h.steps()).toBe(s0);
  });
});
