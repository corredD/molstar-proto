/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag medium

import { StateSelection } from '@molstar/core/state';
import { exosomeDoc, ExosomeRecipe, syntheticPicksStar, syntheticVesicleObj } from '@molstar/meso-spec/examples';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMesoViewSpecExtension, type MesoViewSpecApi } from '../extension.js';
import { isMissingList, MesoPlacements, placementStore } from '../particle-list.js';
import { stubCanvasForLabels } from './canvas.js';

// Undo, Redo and the rollback of a failed step over a MesoViewSpec document in the real Prism viewer (prism.md §7.3):
// the document's lists stay in the data tree and in checkpoints, a restore writes nothing through the API and resolves
// nothing, a session opened on a fresh page fills its lists. Resources come from a fake, never the network.

// the exosome's first view has an annotation, drawn as a label
stubCanvasForLabels();

const viewers: PrismViewer[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const v of viewers.splice(0)) await v.dispose();
});

const Base = 'https://example.org/d/';
const Recipe = JSON.stringify(ExosomeRecipe);
const Picks = syntheticPicksStar();
const Membrane = syntheticVesicleObj();
const RecipeName = 'exosome.cellpack-gpu.json';
const Catalase = 'p.catalase';
const Original = exosomeDoc();
const OriginalAbundance = Original.populations.find((p) => p.id === Catalase)?.abundance;
const Repack = (count: number) => `(patch :ops [(set ${Catalase} :fields (:abundance (:count ${count})))])`;
const LookPatch = '(patch :ops [(set l.catalase :fields (:color "#00ff00"))])';

const resourceFiles = () => [
  new File([Recipe], RecipeName),
  new File([Picks], 'catalase_picks.star'),
  new File([Membrane], 'membrane.obj'),
];
const documentFile = () => new File([JSON.stringify(Original)], 'exosome.mesoviewspec.json');

function explorerSpec(withStub: boolean) {
  const spec = createMesoscaleExplorerSpec('');
  return withStub ? spec : { ...spec, extensions: (spec.extensions ?? []).filter((e) => e.id !== 'mesoviewspec') };
}

/** The served resources by address, for the one test that opens by URL. */
function fakeResources() {
  const served = new Map([
    [`https://example.org/spec/src/examples/fixtures/${RecipeName}`, Recipe],
    [`${Base}fixtures/catalase_picks.star`, Picks],
    [`${Base}fixtures/membrane.obj`, Membrane],
    [`${Base}exosome.mesoviewspec.json`, JSON.stringify(Original)],
  ]);
  return async (url: string) => served.get(url);
}

/** A headless prism-me viewer with the extension mounted, and everything the tests watch: errors, API runs, steps. */
async function setup() {
  const v = await createPrismViewerHeadless({ spec: explorerSpec(false) });
  viewers.push(v);
  await v.extensions.mount(createMesoViewSpecExtension({ fetchText: fakeResources() }));
  const api = (v.api as unknown as { mesoviewspec: MesoViewSpecApi }).mesoviewspec;
  // the person's calls: steps are recorded for them (the default script origin records too, checked by the first test)
  const person = v.api.as({ kind: 'person' });
  const runs: string[] = [];
  v.api.events.started.subscribe((r) => runs.push(r.operation));
  const errors: string[] = [];
  v.plugin.events.log.subscribe((e) => {
    if (e.type === 'error') errors.push(String(e.message));
  });
  return {
    v,
    api,
    model: api.model,
    person,
    runs,
    errors,
    run: (id: string, values: Record<string, unknown> = {}) => person.run(id, values),
  };
}
type Harness = Awaited<ReturnType<typeof setup>>;

const openOriginal = (h: Harness) => h.run('mesoviewspec.open', { file: documentFile(), files: resourceFiles() });
const repack = (h: Harness, count: number) => h.run('mesoviewspec.edit', { patch: Repack(count) });

const lists = (v: PrismViewer) => v.plugin.managers.particles.hierarchy.current.lists;
const stateOf = (v: PrismViewer) => v.plugin.state.data;
const representationsOf = (v: PrismViewer, ref: string) =>
  stateOf(v).select(StateSelection.Generators.byRef(ref).subtree().ofType(SO.Particle.Representation3D));
const catalaseAbundance = (doc: MesoViewSpecDoc | undefined) =>
  doc?.populations.find((p) => p.id === Catalase)?.abundance;
/** The list the catalase copies are in (the recipe model's), as it is in the tree now. */
const recipeList = (v: PrismViewer) =>
  lists(v).find((l) => (l.cell.obj?.data as ParticleList | undefined)?.sourceData?.name?.startsWith('m.recipe@'));
const recipeKey = (h: Harness) => h.model.adapter.keys().find((k) => k.startsWith('m.recipe@'));
const placementCells = (v: PrismViewer) => stateOf(v).select(StateSelection.Generators.ofTransformer(MesoPlacements));

/** What every stage asserts (the same for the document at that stage): no error, steps, lists, representations. */
interface Stage {
  readonly steps: number;
  readonly lists: number;
  readonly abundance: unknown;
  readonly recipeCount?: number;
}

function check(h: Harness, at: string, want: Stage) {
  const { v, model } = h;
  const where = `at ${at}`;
  expect(h.errors, `errors ${where}`).toEqual([]);
  const steps = v.managers.history.steps.value;
  expect(steps.length, `History length ${where}`).toBe(want.steps);
  expect(
    steps.filter((s) => s.unsafe !== undefined).map((s) => `${s.label}: ${s.unsafe}`),
    `unsafe steps ${where}`,
  ).toEqual([]);
  expect(lists(v).length, `lists ${where}`).toBe(want.lists);
  for (const l of lists(v)) {
    expect(l.cell.obj, `list object ${where}`).toBeDefined();
    expect(l.representations.length, `representation of ${l.cell.obj?.label} ${where}`).toBeGreaterThan(0);
    expect(isMissingList(l.cell.obj!.data as ParticleList), `a missing list ${where}`).toBe(false);
  }
  expect(catalaseAbundance(model.doc), `abundance ${where}`).toEqual(want.abundance);
  if (want.recipeCount !== undefined) {
    expect((recipeList(v)?.cell.obj?.data as ParticleList | undefined)?.count, `recipe copies ${where}`).toBe(
      want.recipeCount,
    );
  }
}

/** A restore ran: nothing through the API, nothing resolved, no placements filled by the owner. */
function expectPureRestore(h: Harness, runsBefore: number, at: string) {
  const record = h.model.session?.history.at(-1);
  expect(record?.kind, `record ${at}`).toBe('restore');
  expect(record?.resolverRuns, `resolver runs ${at}`).toBe(0);
  expect(h.runs.slice(runsBefore), `API runs during the restore ${at}`).toEqual([]);
  for (const c of placementCells(h.v)) {
    expect((c.transform.params as { fill?: number }).fill ?? 0, `fill ${at}`).toBe(0);
  }
}

/** Undo or Redo through the history manager, noting what the restore did. */
async function restoreBy(h: Harness, what: 'undo' | 'redo', at: string) {
  const before = h.runs.length;
  const r = await h.v.managers.history[what]();
  expect(r.ok, `${at}: ${JSON.stringify(r)}`).toBe(true);
  return { before, record: h.model.session?.history.at(-1) };
}

describe('undo of a document', () => {
  it('Undo, Redo and Undo of a re-pack: the old copies back, the new ones again, nothing resolved or run', {
    tags: ['medium'],
  }, async () => {
    const h = await setup();
    expect((await openOriginal(h)).ok).toBe(true);
    // the default origin of a script records a step as the person does
    expect(h.v.managers.history.steps.value[0].origin.kind).toBe('person');
    const key0 = recipeKey(h)!;
    const data0 = h.model.adapter.listObject(key0)?.data as ParticleList;
    const n0 = data0.count;
    const achieved0 = h.model.session!.counts[Catalase].achieved;
    const stage0 = { steps: 1, lists: 3, abundance: OriginalAbundance, recipeCount: n0 };
    check(h, 'open', stage0);

    const r = await repack(h, 300);
    expect(r.ok).toBe(true);
    const key1 = recipeKey(h)!;
    const data1 = h.model.adapter.listObject(key1)?.data as ParticleList;
    expect(key1).not.toBe(key0);
    expect(data1.count).not.toBe(n0);
    expect(h.model.session!.counts[Catalase].achieved).not.toBe(achieved0);
    const stage1 = { steps: 2, lists: 3, abundance: { count: 300 }, recipeCount: data1.count };
    check(h, 're-pack', stage1);

    for (const round of [1, 2]) {
      const undone = await restoreBy(h, 'undo', `undo ${round}`);
      // an Undo takes the step off the History's list (Redo has it); its length is the steps before it
      check(h, `undo ${round}`, { ...stage0, steps: 1 });
      expectPureRestore(h, undone.before, `undo ${round}`);
      expect(h.model.session!.counts[Catalase].achieved, `catalase count, undo ${round}`).toBe(achieved0);
      expect(h.model.adapter.listObject(key0)?.data, `the old list by identity, undo ${round}`).toBe(data0);
      expect(placementStore(h.v.plugin).get(key0)).toBe(data0);

      const redone = await restoreBy(h, 'redo', `redo ${round}`);
      check(h, `redo ${round}`, stage1);
      expectPureRestore(h, redone.before, `redo ${round}`);
      expect(h.model.session!.counts[Catalase].achieved).not.toBe(achieved0);
      expect(h.model.adapter.listObject(key1)?.data, `the new list by identity, redo ${round}`).toBe(data1);
    }
    expect(h.runs.filter((o) => o === 'mesoviewspec.open')).toHaveLength(1);
  });

  it('a new edit after Undo of a re-pack works and draws', { tags: ['medium'] }, async () => {
    const h = await setup();
    await openOriginal(h);
    const stage0 = { steps: 1, lists: 3, abundance: OriginalAbundance };
    await repack(h, 300);
    await restoreBy(h, 'undo', 'undo');
    check(h, 'undo', stage0);
    expect(h.v.managers.history.redoable.value.length).toBe(1);
    const looks = h.runs.length;

    const r = await h.run('mesoviewspec.edit', { patch: LookPatch });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(h.model.session!.history.at(-1)!.kind).toBe('view');
    expect(h.model.session!.history.at(-1)!.resolverRuns).toBe(0);
    // the look went through the API, as a step of its own, and emptied Redo
    expect(h.runs.slice(looks)).toContain('particles.look');
    check(h, 'look edit', { ...stage0, steps: 2 });
    expect(h.v.managers.history.redoable.value.length).toBe(0);
    for (const l of lists(h.v)) expect(representationsOf(h.v, l.cell.transform.ref).length).toBeGreaterThan(0);
    // and it undoes
    await restoreBy(h, 'undo', 'undo of the look');
    check(h, 'undo of the look', { ...stage0, steps: 1 });
  });

  it('a model edit that fails mid-commit rolls back: the lists, the document, the History, and the next edit works', {
    tags: ['medium'],
  }, async () => {
    const h = await setup();
    await openOriginal(h);
    const doc = h.model.doc;
    const key0 = recipeKey(h)!;
    const data0 = h.model.adapter.listObject(key0)?.data as ParticleList;
    const stage0 = { steps: 1, lists: 3, abundance: OriginalAbundance, recipeCount: data0.count };
    check(h, 'open', stage0);

    // the commit does its work (the tree changed: the old list deleted, a new one made) and then throws
    const commit = h.model.adapter.commit.bind(h.model.adapter);
    vi.spyOn(h.model.adapter, 'commit').mockImplementationOnce(async (ir) => {
      await commit(ir);
      throw new Error('boom after the tree changed');
    });
    const r = await repack(h, 300);
    expect(r.ok).toBe(false);
    // the rollback logs nothing as an error of ours; the thrown one is the operation's failure
    h.errors.length = 0;
    check(h, 'failed re-pack', stage0);
    expect(h.model.doc).toBe(doc);
    expect(h.model.session!.doc).toBe(doc);
    expect(h.model.adapter.listObject(key0)?.data).toBe(data0);
    expect(recipeKey(h)).toBe(key0);
    expect(h.v.managers.history.redoable.value.length).toBe(0);

    const again = await repack(h, 300);
    expect(again.ok, JSON.stringify(again)).toBe(true);
    check(h, 'the edit after', { steps: 2, lists: 3, abundance: { count: 300 } });
    expect(recipeKey(h)).not.toBe(key0);
  });

  it('Undo of Close brings the lists and the document back; Redo closes again', { tags: ['medium'] }, async () => {
    const h = await setup();
    await openOriginal(h);
    const doc = h.model.doc;
    const key0 = recipeKey(h)!;
    const data0 = h.model.adapter.listObject(key0)?.data as ParticleList;
    const open = { steps: 1, lists: 3, abundance: OriginalAbundance, recipeCount: data0.count };

    expect((await h.run('mesoviewspec.close')).ok).toBe(true);
    expect(lists(h.v)).toHaveLength(0);
    expect(h.model.doc).toBeUndefined();
    expect(h.v.managers.history.steps.value.map((s) => s.unsafe)).toEqual([undefined, undefined]);

    const undone = await restoreBy(h, 'undo', 'undo of close');
    check(h, 'undo of close', open);
    expectPureRestore(h, undone.before, 'undo of close');
    expect(h.model.doc).toBe(doc);
    expect(h.model.adapter.listObject(key0)?.data).toBe(data0);

    await restoreBy(h, 'redo', 'redo of close');
    expect(h.errors).toEqual([]);
    expect(lists(h.v)).toHaveLength(0);
    expect(h.model.doc).toBeUndefined();
    expect(h.v.managers.history.steps.value).toHaveLength(2);

    const back = await restoreBy(h, 'undo', 'undo of close again');
    check(h, 'undo of close again', open);
    expectPureRestore(h, back.before, 'undo of close again');

    const r = await repack(h, 300);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    check(h, 'the edit after', { steps: 2, lists: 3, abundance: { count: 300 } });
  });

  it('Undo of the open leaves no lists and no document; Redo draws it again', { tags: ['medium'] }, async () => {
    const h = await setup();
    await openOriginal(h);
    const doc = h.model.doc;
    const key0 = recipeKey(h)!;
    const data0 = h.model.adapter.listObject(key0)?.data as ParticleList;
    const open = { steps: 1, lists: 3, abundance: OriginalAbundance, recipeCount: data0.count };

    await restoreBy(h, 'undo', 'undo of the open');
    expect(h.errors).toEqual([]);
    expect(lists(h.v)).toHaveLength(0);
    expect(h.model.doc).toBeUndefined();
    expect(h.model.session).toBeUndefined();
    expect(h.v.managers.history.steps.value).toHaveLength(0);
    expect(h.v.managers.history.redoable.value).toHaveLength(1);

    const redone = await restoreBy(h, 'redo', 'redo of the open');
    check(h, 'redo of the open', open);
    expectPureRestore(h, redone.before, 'redo of the open');
    expect(h.model.doc).toBe(doc);
    expect(h.model.adapter.listObject(key0)?.data).toBe(data0);
    // the document is alive: an edit works
    expect((await repack(h, 300)).ok).toBe(true);
    check(h, 'the edit after', { steps: 2, lists: 3, abundance: { count: 300 } });
  });
});

describe('a session with a document', () => {
  /** The `.molj` of a viewer's scene. */
  async function saveState(h: Harness): Promise<string> {
    const r = await h.run('session.save', { kind: 'state' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    return r.ok ? await (r.value as { blob: Blob }).blob.text() : '';
  }

  it('a .molj opens on a new viewer: the document is back and its lists are filled when the resources are there', {
    tags: ['medium'],
  }, async () => {
    // The original is opened by URL (the fake serves it) so the .molj stores the address; the new viewer's default
    // fetch is the page's network, which a test must not use: it is the global `fetch` the asset manager calls, here
    // served from the same fake.
    const a = await setup();
    const url = `${Base}exosome.mesoviewspec.json`;
    expect((await a.run('mesoviewspec.open', { url })).ok).toBe(true);
    await repack(a, 300);
    const doc = a.model.doc!;
    const key = recipeKey(a)!;
    const count = (a.model.adapter.listObject(key)?.data as ParticleList).count;
    const original = a.v.plugin.state.getSnapshot({ camera: false }).custom?.['prism-viewer.mesoviewspec'] as {
      url?: string;
    };
    expect(original.url).toBe(url);
    const text = await saveState(a);
    expect(text).toContain('ms-plugin.meso-view-spec-placements');

    const served = fakeResources();
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown) => {
      const address = String((input as { url?: string }).url ?? input);
      fetched.push(address);
      const body = await served(address);
      return body === undefined
        ? new Response('not found', { status: 404 })
        : new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
    });

    const v = await createPrismViewerHeadless({ spec: explorerSpec(true) });
    viewers.push(v);
    expect(v.extensions.status('mesoviewspec')?.value).toBe('stub');
    const errors: string[] = [];
    v.plugin.events.log.subscribe((e) => {
      if (e.type === 'error') errors.push(String(e.message));
    });
    const opened = await v.api.run('session.open', { data: text, type: 'molj' });
    expect(opened.ok, JSON.stringify(opened)).toBe(true);
    // the transformer loaded the chunk, which registered the custom state before the state was set
    expect(v.extensions.status('mesoviewspec')?.value).toBe('loaded');
    const b = (v.api as unknown as { mesoviewspec: MesoViewSpecApi }).mesoviewspec;
    expect(b.model.doc).toEqual(doc);
    expect(errors).toEqual([]);
    expect(lists(v)).toHaveLength(3);
    for (const l of lists(v)) {
      expect(isMissingList(l.cell.obj!.data as ParticleList)).toBe(false);
      expect(l.representations.length).toBeGreaterThan(0);
    }
    const mine = lists(v).find((l) => (l.cell.obj!.data as ParticleList).sourceData?.name?.startsWith('m.recipe@'))!;
    expect((mine.cell.obj!.data as ParticleList).count).toBe(count);
    expect(b.model.issues.map((i) => i.code)).toContain('placements.missing');
    expect(b.model.issues.find((i) => i.code === 'placements.missing')?.severity).toBe('info');
    // a cold resolution: the models were asked for again (the original's placements are on another page)
    expect(fetched.some((u) => u.endsWith(RecipeName))).toBe(true);
    expect(placementCells(v).every((c) => ((c.transform.params as { fill?: number }).fill ?? 0) === 1)).toBe(true);
    // and the document is alive there: an edit re-packs
    expect((await v.api.run('mesoviewspec.edit', { patch: Repack(310) })).ok).toBe(true);
    expect(lists(v)).toHaveLength(3);
  });

  it('a .molj of a document opened from files: the document is back, and its models are unavailable', {
    tags: ['medium'],
  }, async () => {
    // Files are not in a .molj (a .molx holds them), and the document has no address to fetch from: the new viewer
    // restores the document and its lists exist, but the models cannot resolve (prism.md §7.1, "a .molj cannot").
    const a = await setup();
    await openOriginal(a);
    const doc = a.model.doc!;
    const text = await saveState(a);

    const v = await createPrismViewerHeadless({ spec: explorerSpec(true) });
    viewers.push(v);
    const opened = await v.api.run('session.open', { data: text, type: 'molj' });
    expect(opened.ok, JSON.stringify(opened)).toBe(true);
    const b = (v.api as unknown as { mesoviewspec: MesoViewSpecApi }).mesoviewspec;
    expect(b.model.doc).toEqual(doc);
    expect(b.model.session?.history.at(-1)?.kind).toBe('restore');
    for (const l of lists(v)) expect(l.cell.obj).toBeDefined();
    // no resource could be read: no copies are drawn, said as an issue
    const copies = Object.values(b.model.session!.counts).reduce((n, c) => n + c.achieved, 0);
    expect(copies).toBe(0);
    expect(b.model.issues.some((i) => i.severity === 'error' || i.severity === 'warning')).toBe(true);
  });

  it('the same .molj on the same viewer after a close: the document and the lists are back', {
    tags: ['medium'],
  }, async () => {
    const h = await setup();
    await openOriginal(h);
    await repack(h, 300);
    const doc = h.model.doc!;
    const key = recipeKey(h)!;
    const data = h.model.adapter.listObject(key)?.data as ParticleList;
    const text = await saveState(h);
    expect((await h.run('mesoviewspec.close')).ok).toBe(true);
    expect(lists(h.v)).toHaveLength(0);

    const opened = await h.run('session.open', { data: text, type: 'molj' });
    expect(opened.ok, JSON.stringify(opened)).toBe(true);
    expect(h.model.doc).toEqual(doc);
    expect(h.errors).toEqual([]);
    expect(lists(h.v)).toHaveLength(3);
    for (const l of lists(h.v)) {
      expect(isMissingList(l.cell.obj!.data as ParticleList)).toBe(false);
      expect(l.representations.length).toBeGreaterThan(0);
    }
    expect((recipeList(h.v)?.cell.obj?.data as ParticleList).count).toBe(data.count);
    expect(catalaseAbundance(h.model.doc)).toEqual({ count: 300 });
    // and it undoes: the session open is a step
    expect((await h.v.managers.history.undo()).ok).toBe(true);
    expect(h.v.managers.history.steps.value.every((s) => s.unsafe === undefined)).toBe(true);
  });
});

describe('what Undo keeps, and what it costs', () => {
  it(
    'after 12 re-packs the store and the cache hold the last 11 states only, and Undo 10 times resolves nothing',
    {
      tags: ['medium'],
    },
    async () => {
      const h = await setup();
      await openOriginal(h);
      const states = [{ sets: h.model.adapter.keys(), cache: h.model.session!.cacheKeys }];
      const counts: number[] = [];
      for (let i = 0; i < 12; i++) {
        const count = 300 + i;
        const r = await repack(h, count);
        expect(r.ok, `re-pack ${count}: ${JSON.stringify(r)}`).toBe(true);
        expect(h.model.session!.history.at(-1)!.resolverRuns).toBe(1);
        states.push({ sets: h.model.adapter.keys(), cache: h.model.session!.cacheKeys });
        counts.push((recipeList(h.v)?.cell.obj?.data as ParticleList).count);
      }
      expect(h.errors).toEqual([]);
      const steps = h.v.managers.history.steps.value;
      expect(steps).toHaveLength(13);
      // the checkpoints of the last 10 only: older steps are listed and "too old"
      expect(steps.filter((s) => s.unsafe === undefined).length).toBeGreaterThanOrEqual(10);

      // the owner keeps the current state and the last 10: the last 11 of the 13
      const kept = states.slice(-11);
      const keptSets = new Set(kept.flatMap((s) => s.sets));
      const keptCache = new Set(kept.flatMap((s) => s.cache));
      const store = placementStore(h.v.plugin);
      expect([...store.keys()].filter((k) => !keptSets.has(k))).toEqual([]);
      expect(store.size).toBe(keptSets.size);
      expect([...h.model.cache.keys()].filter((k) => !keptCache.has(k))).toEqual([]);
      expect(h.model.cache.size).toBe(keptCache.size);
      const recipes = [...store.keys()].filter((k) => k.startsWith('m.recipe@'));
      expect(recipes.length).toBeLessThanOrEqual(11);
      // the states that let go are gone
      for (const s of states.slice(0, 2)) {
        for (const k of s.sets.filter((k) => k.startsWith('m.recipe@'))) expect(store.has(k)).toBe(false);
      }

      for (let k = 1; k <= 10; k++) {
        const undone = await restoreBy(h, 'undo', `undo ${k}`);
        expect(h.errors, `errors, undo ${k}`).toEqual([]);
        expect(undone.record?.kind, `undo ${k}`).toBe('restore');
        expect(undone.record?.resolverRuns, `resolver runs, undo ${k}`).toBe(0);
        expect(h.runs.slice(undone.before), `API runs, undo ${k}`).toEqual([]);
        expect(catalaseAbundance(h.model.doc), `abundance, undo ${k}`).toEqual({ count: 311 - k });
        expect((recipeList(h.v)?.cell.obj?.data as ParticleList).count, `copies, undo ${k}`).toBe(counts[11 - k]);
        expect(lists(h.v)).toHaveLength(3);
        for (const l of lists(h.v)) expect(l.representations.length).toBeGreaterThan(0);
      }
      // the three steps older than the last 10 are listed and "too old": the only unsafe ones, and for no other reason
      const unsafe = h.v.managers.history.steps.value.filter((s) => s.unsafe !== undefined);
      expect(unsafe.map((s) => s.unsafe)).toEqual(unsafe.map(() => expect.stringMatching(/too old/i)));
      expect(h.v.managers.history.steps.value.length - unsafe.length).toBe(0);
    },
    120_000,
  );

  it('a viewer-only setting on a document list undoes, redoes and survives a re-pack', {
    tags: ['medium'],
  }, async () => {
    const h = await setup();
    await openOriginal(h);
    const typeParams = (ref: string) =>
      (
        representationsOf(h.v, ref)[0].transform.params as {
          type: { name: string; params: Record<string, unknown> };
        }
      ).type;
    const ref0 = h.model.adapter.listRef(recipeKey(h)!)!;
    const before = typeParams(ref0);
    expect(before.name).toBe('spacefill');
    const initialSize = before.params.sizeFactor;
    expect(initialSize).not.toBe(0.5);

    const r = await h.run('particles.representation', {
      type: 'spacefill',
      particles: ref0,
      params: { sizeFactor: 0.5 },
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const set = { steps: 2, lists: 3, abundance: OriginalAbundance };
    check(h, 'size set', set);
    expect(typeParams(ref0).params.sizeFactor).toBe(0.5);

    await restoreBy(h, 'undo', 'undo of the size');
    check(h, 'undo of the size', { ...set, steps: 1 });
    const ref1 = h.model.adapter.listRef(recipeKey(h)!)!;
    expect(typeParams(ref1).params.sizeFactor).toBe(initialSize);

    await restoreBy(h, 'redo', 'redo of the size');
    check(h, 'redo of the size', set);
    const ref2 = h.model.adapter.listRef(recipeKey(h)!)!;
    expect(typeParams(ref2).params.sizeFactor).toBe(0.5);

    const oldKey = recipeKey(h)!;
    const oldType = typeParams(ref2);
    expect((await repack(h, 300)).ok).toBe(true);
    check(h, 're-pack', { steps: 3, lists: 3, abundance: { count: 300 } });
    expect(recipeKey(h)).not.toBe(oldKey);
    const fresh = h.model.adapter.listRef(recipeKey(h)!)!;
    expect(fresh).not.toBe(ref2);
    expect(typeParams(fresh)).toEqual(oldType);
    expect(typeParams(fresh).params.sizeFactor).toBe(0.5);

    // Undo of the re-pack brings the old list back with its setting
    await restoreBy(h, 'undo', 'undo of the re-pack');
    check(h, 'undo of the re-pack', set);
    expect(typeParams(h.model.adapter.listRef(recipeKey(h)!)!).params.sizeFactor).toBe(0.5);
  });

  it('the custom state is one object while the document is unchanged, a new one after an edit, never mutated', {
    tags: ['medium'],
  }, async () => {
    const h = await setup();
    const key = 'prism-viewer.mesoviewspec';
    const custom = () =>
      h.v.plugin.state.getSnapshot({ camera: false }).custom?.[key] as { doc: MesoViewSpecDoc; revision?: string };
    expect(custom()).toBeUndefined();
    await openOriginal(h);
    const first = custom();
    expect(first.doc).toBe(h.model.doc);
    expect(custom()).toBe(first);
    expect(h.v.plugin.state.getSnapshot({ camera: false }).custom?.[key]).toBe(first);
    const frozen = JSON.stringify(first);

    await repack(h, 300);
    const second = custom();
    expect(second).not.toBe(first);
    expect(second.doc).not.toBe(first.doc);
    expect(custom()).toBe(second);
    // an edit shares what it did not touch (prism.md §2.1), and changes nothing of the earlier document
    expect(JSON.stringify(first)).toBe(frozen);
    expect(catalaseAbundance(first.doc)).toEqual(OriginalAbundance);
    expect(catalaseAbundance(second.doc)).toEqual({ count: 300 });

    // a view edit: another object, the earlier ones intact
    await h.run('mesoviewspec.edit', { patch: LookPatch });
    const third = custom();
    expect(third).not.toBe(second);
    expect(JSON.stringify(first)).toBe(frozen);
    expect(catalaseAbundance(second.doc)).toEqual({ count: 300 });

    // Undo hands the earlier object back: the same one, so a checkpoint measures it once
    await restoreBy(h, 'undo', 'undo of the look');
    expect(custom()).toBe(second);
    await restoreBy(h, 'undo', 'undo of the re-pack');
    expect(custom()).toBe(first);
    expect(JSON.stringify(first)).toBe(frozen);
  });
});
