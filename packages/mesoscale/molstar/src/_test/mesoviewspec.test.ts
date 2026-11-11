/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag medium

import fs from 'node:fs';
import { observableState } from '@molstar/prism-ui/core';
import { exosomeDoc, ExosomeRecipe, syntheticPicksStar, syntheticVesicleObj } from '@molstar/meso-spec/examples';
import { printData, readPatch } from '@molstar/meso-spec/format';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { createAgentPolicy } from '@molstar/prism-viewer/agent/policies';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMesoViewSpecExtension, type MesoViewSpecApi } from '../extension.js';
import { MesoPlacements, placementStore } from '../particle-list.js';
import { MesoViewSpecLazyExtension } from '../prism-viewer.js';

// The `mesoviewspec` extension in the real Prism viewer (prism.md §3, §5.3): open from data, a URL and files, edit,
// save, close. Resources come from a fake, never the network.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

const Base = 'https://example.org/d/';
const Recipe = JSON.stringify(ExosomeRecipe);
const Picks = syntheticPicksStar();
/** Other picks, fewer: what a resource whose `uri` an edit changes reads instead. */
const OtherPicks = syntheticPicksStar(10, 3);
const Membrane = syntheticVesicleObj();
const RecipeName = 'exosome.cellpack-gpu.json';

/** What the fake serves, by address; `asked` is every address it was asked for. */
function fakeResources() {
  const served = new Map([
    [`https://example.org/spec/src/examples/fixtures/${RecipeName}`, Recipe],
    [`${Base}fixtures/catalase_picks.star`, Picks],
    [`${Base}fixtures/other_picks.star`, OtherPicks],
    [`${Base}fixtures/membrane.obj`, Membrane],
    [`${Base}exosome.mesoviewspec.json`, JSON.stringify(exosomeDoc())],
  ]);
  const asked: string[] = [];
  return {
    asked,
    fetchText: async (url: string) => {
      asked.push(url);
      return served.get(url);
    },
  };
}

async function open() {
  const fake = fakeResources();
  const v = await createPrismViewerHeadless({ spec: explorerSpec(false) });
  viewers.push(v);
  await v.extensions.mount(createMesoViewSpecExtension({ fetchText: fake.fetchText }));
  const api = (v.api as unknown as { mesoviewspec: MesoViewSpecApi }).mesoviewspec;
  return { v, fake, api, run: (id: string, values: Record<string, unknown>) => v.api.run(id, values) };
}

/** The explorer's spec, with the stub left out when the test mounts the extension itself. */
function explorerSpec(withStub: boolean) {
  const spec = createMesoscaleExplorerSpec('');
  return withStub ? spec : { ...spec, extensions: (spec.extensions ?? []).filter((e) => e.id !== 'mesoviewspec') };
}

const lists = (v: PrismViewer) => v.plugin.managers.particles.hierarchy.current.lists.length;
const resourceFiles = () => [
  new File([Recipe], RecipeName),
  new File([Picks], 'catalase_picks.star'),
  new File([Membrane], 'membrane.obj'),
];

describe('mesoviewspec.open', () => {
  it('opens JSON text with the files beside it, draws the lists, and gets a summary', {
    tags: ['medium'],
  }, async () => {
    const { v, run } = await open();
    const r = await run('mesoviewspec.open', {
      data: JSON.stringify(exosomeDoc()),
      files: resourceFiles(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.did).toMatch(/^Opened Exosome in plasma: \d+ copies in \d+ lists\.$/);
    expect(lists(v)).toBeGreaterThan(0);
    const got = await run('mesoviewspec.get', {});
    expect(got.ok).toBe(true);
    if (got.ok) {
      const counts = (got.value as { counts: Record<string, { achieved: number; requested?: number }> }).counts;
      expect(counts['p.catalase']?.achieved).toBeGreaterThan(0);
      expect(got.did).toMatch(/p\.catalase \(e\.catalase\): \d+/);
      expect(got.did).toMatch(/Models: 2/);
    }
    const outline = await run('mesoviewspec.get', { detail: 'outline' });
    expect(outline.ok && outline.did).toMatch(/Compartments:/);
  });

  it('opens by URL: the resources are asked for beside the document', { tags: ['medium'] }, async () => {
    const { v, fake, run } = await open();
    const r = await run('mesoviewspec.open', { url: `${Base}exosome.mesoviewspec.json` });
    expect(r.ok).toBe(true);
    expect(fake.asked).toContain(`https://example.org/spec/src/examples/fixtures/${RecipeName}`);
    expect(fake.asked).toContain(`${Base}fixtures/catalase_picks.star`);
    expect(lists(v)).toBeGreaterThan(0);
  });

  it('opens a file: its resources are read from the files dropped with it, by name, with no fetch', {
    tags: ['medium'],
  }, async () => {
    const { v, fake, run } = await open();
    const file = new File([JSON.stringify(exosomeDoc())], 'exosome.mesoviewspec.json');
    const r = await run('mesoviewspec.open', { file, files: resourceFiles() });
    expect(r.ok).toBe(true);
    expect(fake.asked).toEqual([]);
    expect(lists(v)).toBeGreaterThan(0);
  });

  // the app's check (prism.md §3): a document alone, its resources missing, some sets come out empty; an empty set has no
  // representation Prism can draw, and it failed the whole open
  it('opens with a resource missing: the empty sets are not drawn, the rest is', { tags: ['medium'] }, async () => {
    const { v, run } = await open();
    const r = await run('mesoviewspec.open', { data: JSON.stringify(exosomeDoc()), files: [resourceFiles()[1]] });
    expect(r.ok).toBe(true);
    expect(lists(v)).toBeGreaterThan(0);
    const reprs = v.plugin.managers.particles.hierarchy.current.lists.map((l) => l.representations.length);
    expect(reprs.every((n) => n === 1)).toBe(true);
  });

  // `?mesoviewspec=/path/doc.json` in the app: an address relative to the page is resolved against it
  it('opens by an address relative to the page: its resources too', { tags: ['medium'] }, async () => {
    vi.stubGlobal('location', { href: 'https://example.org/app/index.html' });
    try {
      const { v, fake, run } = await open();
      const r = await run('mesoviewspec.open', { url: '/d/exosome.mesoviewspec.json' });
      expect(r.ok).toBe(true);
      expect(fake.asked).toContain(`https://example.org/spec/src/examples/fixtures/${RecipeName}`);
      expect(lists(v)).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('opens the S-expression', { tags: ['medium'] }, async () => {
    const { v, run } = await open();
    const r = await run('mesoviewspec.open', { data: printData(exosomeDoc()), files: resourceFiles() });
    expect(r.ok).toBe(true);
    expect(lists(v)).toBeGreaterThan(0);
  });

  it('refuses what is not a document, and a second one from the agent', { tags: ['medium'] }, async () => {
    const { v, run } = await open();
    expect(await run('mesoviewspec.open', { data: '{"format": "other"}' })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(await run('mesoviewspec.open', { data: '{not json' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await run('mesoviewspec.open', {})).toMatchObject({ ok: false, code: 'invalid' });
    expect(lists(v)).toBe(0);
    const data = JSON.stringify(exosomeDoc());
    expect((await run('mesoviewspec.open', { data, files: resourceFiles() })).ok).toBe(true);
    const asAgent = await v.api.as({ kind: 'agent', turn: 't1' }).run('mesoviewspec.open', { data });
    expect(asAgent).toMatchObject({ ok: false, code: 'blocked' });
  });
});

describe('mesoviewspec.edit, save, close', () => {
  it('edits with an S-expression patch: one model rerun, and the count changes', { tags: ['medium'] }, async () => {
    const { api, run } = await open();
    await run('mesoviewspec.open', { data: JSON.stringify(exosomeDoc()), files: resourceFiles() });
    const before = api.model.session!.counts['p.catalase'].achieved;
    const text = '(patch :ops [(set p.catalase :fields (:abundance (:count 300)))])';
    expect(readPatch(text).patch?.ops).toEqual([
      { op: 'set', id: 'p.catalase', fields: { abundance: { count: 300 } } },
    ]);
    const r = await run('mesoviewspec.edit', { patch: text });
    expect(r.ok).toBe(true);
    const record = api.model.session!.history.at(-1)!;
    expect(record.kind).toBe('model');
    expect(record.resolverRuns).toBe(1);
    expect(api.model.session!.counts['p.catalase'].achieved).not.toBe(before);
    expect(api.model.doc!.populations.find((p) => p.id === 'p.catalase')?.abundance).toEqual({ count: 300 });
    // the same patch again: nothing to do
    expect(await run('mesoviewspec.edit', { patch: text })).toMatchObject({ ok: true, unchanged: true });
  });

  it('refuses a patch whole: invalid, and the document is as it was', { tags: ['medium'] }, async () => {
    const { api, run, v } = await open();
    await run('mesoviewspec.open', { data: JSON.stringify(exosomeDoc()), files: resourceFiles() });
    const doc = api.model.doc;
    const steps = v.managers.history.steps.value.length;
    const bad = await run('mesoviewspec.edit', {
      patch: '(patch :ops [(set p.catalase :fields (:abundance (:count -1)))])',
    });
    expect(bad).toMatchObject({ ok: false, code: 'invalid' });
    const gone = await run('mesoviewspec.edit', { patch: '(patch :ops [(remove e.catalase)])' });
    expect(gone).toMatchObject({ ok: false, code: 'invalid' });
    expect(api.model.doc).toBe(doc);
    expect(v.managers.history.steps.value.length).toBe(steps);
  });

  it('saves JSON that reads back to the document, and the S-expression', { tags: ['medium'] }, async () => {
    const { api, run } = await open();
    expect(await run('mesoviewspec.save', {})).toMatchObject({ ok: false, code: 'not-found' });
    await run('mesoviewspec.open', { data: JSON.stringify(exosomeDoc()), files: resourceFiles() });
    const r = await run('mesoviewspec.save', {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { blob, filename } = r.value as { blob: Blob; filename: string };
    expect(filename).toBe('Exosome-in-plasma.mesoviewspec.json');
    expect(JSON.parse(await blob.text())).toEqual(JSON.parse(JSON.stringify(api.model.doc)));
    const s = await run('mesoviewspec.save', { format: 'sexpr' });
    expect(s.ok && (s.value as { filename: string }).filename).toBe('Exosome-in-plasma.mesoviewspec');
  });

  it('closes: the lists go, and closing again is already so', { tags: ['medium'] }, async () => {
    const { v, run } = await open();
    expect(await run('mesoviewspec.close', {})).toMatchObject({ ok: true, unchanged: true });
    await run('mesoviewspec.open', { data: JSON.stringify(exosomeDoc()), files: resourceFiles() });
    expect(lists(v)).toBeGreaterThan(0);
    expect((await run('mesoviewspec.close', {})).ok).toBe(true);
    expect(lists(v)).toBe(0);
  });

  // lane 7's find (Ludo, 2026-11-10): the loader read the session's document, still the one before the edit while the
  // edit compiles, so an edit of a resource's address drew the old resource
  it('an edit of a resource’s uri reads and draws the new resource in that edit; Undo and Redo', {
    tags: ['medium'],
  }, async () => {
    const { api, fake, run, v } = await open();
    expect((await run('mesoviewspec.open', { url: `${Base}exosome.mesoviewspec.json` })).ok).toBe(true);
    const observed = () => api.model.session!.counts['p.catalase.observed']?.achieved;
    const drawn = () => {
      const key = api.model.adapter.keys().find((k) => k.startsWith('m.picks@'));
      return key ? api.model.adapter.setOf(key)?.count : undefined;
    };
    expect(observed()).toBe(24);
    expect(drawn()).toBe(24);
    fake.asked.length = 0;
    const r = await run('mesoviewspec.edit', {
      patch: JSON.stringify({
        format: 'meso_view_spec_patch',
        ops: [{ op: 'set', id: 'r.picks', fields: { uri: 'fixture://other_picks.star' } }],
      }),
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(fake.asked).toContain(`${Base}fixtures/other_picks.star`);
    expect(fake.asked).not.toContain(`${Base}fixtures/catalase_picks.star`);
    expect(observed()).toBe(10);
    expect(drawn()).toBe(10);

    // a restore compiles too (every compile loads its resources: a model's key hashes their content), and before the
    // session takes the restored document: it reads the restored one's, not those of the document drawn before it
    fake.asked.length = 0;
    await v.managers.history.undo();
    expect(api.model.doc!.resources!.find((x) => x.id === 'r.picks')?.uri).toBe('fixture://catalase_picks.star');
    expect(fake.asked).toContain(`${Base}fixtures/catalase_picks.star`);
    expect(fake.asked).not.toContain(`${Base}fixtures/other_picks.star`);
    expect(observed()).toBe(24);
    expect(drawn()).toBe(24);
    fake.asked.length = 0;
    await v.managers.history.redo();
    expect(fake.asked).toContain(`${Base}fixtures/other_picks.star`);
    expect(fake.asked).not.toContain(`${Base}fixtures/catalase_picks.star`);
    expect(observed()).toBe(10);
    expect(drawn()).toBe(10);
  });

  // the same cause: a list drawn by an edit was described (its entity, its compartment) by the document before it
  it('a list an edit draws is described by the edited document: a new entity’s label', {
    tags: ['medium'],
  }, async () => {
    const { api, v, run } = await open();
    expect((await run('mesoviewspec.open', { url: `${Base}exosome.mesoviewspec.json` })).ok).toBe(true);
    const r = await run('mesoviewspec.edit', {
      patch: JSON.stringify({
        format: 'meso_view_spec_patch',
        ops: [
          {
            op: 'insert',
            node: { id: 'e.other', label: 'other thing', kind: 'protein', radius: { value: 40, unit: 'A' } },
            parent: 'entities',
            after: 'last',
          },
          { op: 'set', id: 'p.catalase.observed', fields: { entity: 'e.other' } },
        ],
      }),
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const key = api.model.adapter.keys().find((k) => k.startsWith('m.picks@'))!;
    const list = placementStore(v.plugin).get(key)!;
    const descriptions = [...list.entityInfo!.values()].map((e) => (e as { description?: string }).description);
    expect(descriptions.some((d) => d?.includes('other thing'))).toBe(true);
  });
});

describe('the files dropped with a document (gate M1, N1, S1)', () => {
  const repack = '(patch :ops [(set p.catalase :fields (:abundance (:count 300)))])';
  const catalase = (api: MesoViewSpecApi) => api.model.session?.counts['p.catalase']?.achieved;

  it('an Undo back to a dropped document brings its files back: a re-pack still reads them', {
    tags: ['medium'],
  }, async () => {
    const { v, api, run } = await open();
    const file = new File([JSON.stringify(exosomeDoc())], 'exosome.mesoviewspec.json');
    expect((await run('mesoviewspec.open', { file, files: resourceFiles() })).ok).toBe(true);
    expect(
      (await run('mesoviewspec.open', { data: JSON.stringify({ ...exosomeDoc(), metadata: { title: 'B' } }) })).ok,
    ).toBe(true);
    await v.managers.history.undo();
    expect(api.model.doc?.metadata?.title).toBe('Exosome in plasma');
    expect((await run('mesoviewspec.edit', { patch: repack })).ok).toBe(true);
    expect(catalase(api)).toBe(300);
  });

  it('an edit that loses copies to a missing resource says so', { tags: ['medium'] }, async () => {
    const { run } = await open();
    expect((await run('mesoviewspec.open', { data: JSON.stringify(exosomeDoc()) })).ok).toBe(true);
    const r = await run('mesoviewspec.edit', { patch: repack });
    expect(r.ok && r.warnings?.join('\n')).toMatch(/resource|could not/i);
  });

  it('a file dropped with a document that names no such resource is said, not silently taken', {
    tags: ['medium'],
  }, async () => {
    const { run } = await open();
    const r = await run('mesoviewspec.open', {
      data: JSON.stringify(exosomeDoc()),
      files: [...resourceFiles(), new File(['x'], '1crn.pdb')],
    });
    expect(r.ok && r.warnings?.join('\n')).toMatch(/1crn\.pdb/);
  });
});

describe('the stub', () => {
  it('asks the agent before an open from a host it does not know, and is loaded only when used', {
    tags: ['medium'],
  }, async () => {
    const stub = MesoViewSpecLazyExtension.stub.operations!.find((o) => o.id === 'mesoviewspec.open')!;
    const def = { ...stub, params: {}, run: async () => ({}) as never } as never;
    const policy = createAgentPolicy({ checkpointing: observableState(true).asReadonly });
    expect(policy.approves(def, { url: 'https://example.org/d/x.mesoviewspec.json' })).toBe(false);
    expect(policy.blockedHosts(def, { url: 'https://example.org/d/x.mesoviewspec.json' })).toEqual(['example.org']);
    expect(policy.approves(def, { url: 'https://files.rcsb.org/x.mesoviewspec.json' })).toBe(true);
    expect(policy.approves(def, { url: 'http://files.rcsb.org/x.mesoviewspec.json' })).toBe(false);
    expect(policy.approves(def, { data: '{}' })).toBe(true);
    // gate M2: a document given as data names its resources' hosts itself, and those are judged before any fetch
    const remote = JSON.stringify({
      ...exosomeDoc(),
      resources: [{ id: 'r.x', kind: 'recipe', format: 'obj', uri: 'https://unknown.example/x.obj' }],
    });
    expect(policy.approves(def, { data: remote })).toBe(false);
    expect(policy.blockedHosts(def, { data: remote })).toEqual(['unknown.example']);
    expect(MesoViewSpecLazyExtension.stub.owns?.transformers).toEqual([MesoPlacements.id]);
  });

  it('loads at the first call, replays it as one step, and its flags are the definitions', {
    tags: ['medium'],
  }, async () => {
    const v = await createPrismViewerHeadless({ spec: explorerSpec(true) });
    viewers.push(v);
    const r = await v.api.run('mesoviewspec.open', { data: JSON.stringify(exosomeDoc()), files: resourceFiles() });
    expect(r.ok).toBe(true);
    expect(v.extensions.status('mesoviewspec')?.value).toBe('loaded');
    expect(lists(v)).toBeGreaterThan(0);
    expect(v.managers.history.steps.value).toHaveLength(1);
  });

  it("is in prism-me's spec: a dropped document opens through the stub, its files as resources", {
    tags: ['medium'],
  }, async () => {
    const v = await createPrismViewerHeadless({ spec: explorerSpec(true) });
    viewers.push(v);
    expect(v.extensions.status('mesoviewspec')?.value).toBe('stub');
    const doc = new File([JSON.stringify(exosomeDoc())], 'exosome.mesoviewspec.json');
    const r = await v.api.load.files({ files: [doc, ...resourceFiles()] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.did).toMatch(/^Opened Exosome in plasma: \d+ copies in \d+ lists\.$/);
    expect(v.extensions.status('mesoviewspec')?.value).toBe('loaded');
    expect(lists(v)).toBeGreaterThan(0);
    // the other files were its resources, not data of their own
    expect(v.plugin.managers.structure.hierarchy.current.structures).toHaveLength(0);
    expect(v.managers.history.steps.value).toHaveLength(1);
  });

  it('is a stub at start in the viewer, and its source imports no code', { tags: ['medium'] }, async () => {
    const v = await createPrismViewerHeadless({ spec: explorerSpec(true) });
    viewers.push(v);
    expect(v.extensions.status('mesoviewspec')?.value).toBe('stub');
    expect(v.api.describe('mesoviewspec.open')).toBeDefined();
    const source = fs.readFileSync(new URL('../prism-viewer.ts', import.meta.url), 'utf8');
    const imports = source.split('\n').filter((l) => /^\s*(import|export)\b.*\bfrom\b/.test(l) || /\bimport\(/.test(l));
    const code = imports.filter((l) => !/^import type\b/.test(l.trim()) && !/\bimport\('\.\/extension\.js'\)/.test(l));
    expect(code).toEqual([]);
    expect(source).not.toMatch(/from '@molstar\/meso-spec|from '\.\/document-model|from '\.\/extension/);
  });
});
