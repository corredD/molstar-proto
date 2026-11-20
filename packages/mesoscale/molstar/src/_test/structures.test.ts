/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag medium

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, updateView } from '@molstar/meso-spec/runtime';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers';
import { exosomeDoc, ExosomeResources } from '@molstar/meso-spec/examples';
import { type PlacementSet, placementSets } from '@molstar/meso-spec/ir';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { Asset } from '@molstar/core/util/assets';
import { StateSelection } from '@molstar/core/state';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { afterEach, describe, expect, it } from 'vitest';
import { type AdapterStructures, PrismMesoAdapter } from '../prism-adapter.js';
import { EntityStructureCache } from '../entity-structures.js';
import { Task } from '@molstar/core/task';

// A document's entities drawn from their structures (lane `mvs-lod-bands`, scope A): an entity with a structure is its
// type's target in the list (`targetMapping`), so Mol*'s sphere levels and silhouettes have atoms to work on; loaded
// once per source; one that cannot load leaves its copies spheres, said.

const fixture = join(
  import.meta.dirname,
  '../../../../prism/viewer/src/sequence/molstar/_test/fixtures/structures/1c26.bcif',
);

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

const options = (cache: Map<string, unknown>) => ({
  resolvers: DefaultResolvers,
  load: (id: string) => ExosomeResources[id]?.(),
  cache: cache as Map<string, never>,
});

/** The catalase drawn from a file; every other entity none */
function catalaseFrom(bytes: Uint8Array, name = '1c26.bcif'): AdapterStructures {
  const file = Asset.File(new File([bytes], name));
  return {
    of: (t) =>
      t.entity === 'e.catalase' ? { key: name, name: 'catalase', source: { kind: 'file', file } } : undefined,
  };
}

async function session(structures: AdapterStructures, doc: MesoViewSpecDoc = exosomeDoc()) {
  const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
  viewers.push(v);
  const adapter = new PrismMesoAdapter(v, { structures });
  const cache = new Map();
  const result = await compile(doc, options(cache));
  const report = await adapter.commit(result.ir!);
  return { v, adapter, cache, result, report };
}

/** The sets holding a type of `entity`, with that type's index */
function typesOf(sets: readonly PlacementSet[], entity: string) {
  return sets.flatMap((s) => s.typeTable.filter((t) => t.entity === entity).map((t) => ({ set: s, type: t.index })));
}

describe('entities drawn from their structures (headless)', () => {
  it('an entity with a structure is its type target in the list; the other types have none', {
    tags: ['medium'],
  }, async () => {
    const { adapter, result } = await session(catalaseFrom(readFileSync(fixture)));
    const sets = placementSets(result.ir!);
    const catalase = typesOf(sets, 'e.catalase');
    expect(catalase.length).toBeGreaterThan(0);
    for (const { set, type } of catalase) {
      const list = adapter.listObject(set.key)!.data as ParticleList;
      const target = list.targetMapping?.get(type);
      expect(target?.kind).toBe('structure');
      expect(target?.kind === 'structure' && target.structure.elementCount).toBeGreaterThan(100);
    }
    for (const s of sets) {
      const list = adapter.listObject(s.key)!.data as ParticleList;
      for (const t of s.typeTable)
        if (t.entity !== 'e.catalase') expect(list.targetMapping?.get(t.index)).toBeUndefined();
    }
  });

  it('loaded once: a re-packed list holds the same structure', { tags: ['medium'] }, async () => {
    const { adapter, cache, result } = await session(catalaseFrom(readFileSync(fixture)));
    const structureIn = (sets: readonly PlacementSet[]) => {
      const [{ set, type }] = typesOf(sets, 'e.catalase').filter((x) => x.set.model === 'm.recipe');
      const t = (adapter.listObject(set.key)!.data as ParticleList).targetMapping?.get(type);
      return t?.kind === 'structure' ? t.structure : undefined;
    };
    const before = structureIn(placementSets(result.ir!));
    expect(before).toBeDefined();
    const doc: MesoViewSpecDoc = {
      ...exosomeDoc(),
      populations: exosomeDoc().populations.map((p) =>
        p.id === 'p.miRNA' ? { ...p, abundance: { concentration: { value: 0.0008, unit: 'M' as const } } } : p,
      ),
    };
    const next = await compile(doc, options(cache));
    const report = await adapter.commit(next.ir!);
    expect(report.added.length).toBe(1);
    expect(structureIn(placementSets(next.ir!))).toBe(before);
  });

  it('a structure that cannot load: its copies stay spheres, said as resource.unavailable', {
    tags: ['medium'],
  }, async () => {
    const { adapter, result, report } = await session(
      catalaseFrom(new TextEncoder().encode('not a structure'), 'broken.bcif'),
    );
    for (const { set, type } of typesOf(placementSets(result.ir!), 'e.catalase')) {
      expect((adapter.listObject(set.key)!.data as ParticleList).targetMapping?.get(type)).toBeUndefined();
    }
    const unavailable = report.issues?.filter((i) => i.code === 'resource.unavailable') ?? [];
    expect(unavailable.length).toBe(1);
    expect(unavailable[0]).toMatchObject({ phase: 'render' });
    expect(unavailable[0].message).toMatch(/catalase/);
  });
});

/** The `structure` params of the representation drawing a list's structures (its silhouettes) */
function silhouettesOf(v: PrismViewer, ref: string) {
  const q = StateSelection.Generators.byRef(ref).subtree().ofType(SO.Particle.Representation3D);
  // the representation drawing the structures (`target`), else the list's first
  const cells = v.plugin.state.data.select(q);
  const cell =
    cells.find((c) => (c.transform.params as { type?: { name?: string } }).type?.name === 'target') ?? cells[0];
  const p = cell?.transform.params as { type: { params: { structure?: Record<string, unknown> } } } | undefined;
  const s = p?.type.params.structure ?? {};
  return { on: s.lodImpostor, by: s.lodImpostorBy, pixels: s.lodImpostorPixels, distance: s.lodImpostorDistance };
}

/** Exosome with bands: catalase atoms near, silhouettes below 12 px; in the lumen view, atoms at every size */
function bandedExosome(): MesoViewSpecDoc {
  const d = exosomeDoc();
  return {
    ...d,
    bands: [
      { id: 'b.near', size: [12, null] },
      { id: 'b.far', size: [0, 12], blend: { width: 0.5 } },
      { id: 'b.lumen', evaluator: 'meso.view', params: { view: 'v.lumen' } },
    ],
    scales: [
      { id: 's.atoms', select: '(entity e.catalase)', at: 'b.near', show: { representation: 'structure' } },
      {
        id: 's.shape',
        select: '(entity e.catalase)',
        at: 'b.far',
        show: { representation: ['silhouette', 'spheres'] },
      },
      { id: 's.lumen', select: '(entity e.catalase)', at: 'b.lumen', show: { representation: 'structure' } },
    ],
  };
}

describe('bands drive the silhouettes (headless)', () => {
  it("a list of a type drawn from its structure takes the bands' silhouettes; a scene band switches them", {
    tags: ['medium'],
  }, async () => {
    const doc = bandedExosome();
    const { v, adapter, result, report } = await session(catalaseFrom(readFileSync(fixture)), doc);
    expect(report.issues?.filter((i) => /^bands\.|representation\.fallback/.test(i.code))).toEqual([]);
    const sets = placementSets(result.ir!);
    const catalase = new Set(typesOf(sets, 'e.catalase').map((x) => x.set.key));
    expect(catalase.size).toBeGreaterThan(0);
    const before = new Map(sets.map((s) => [s.key, silhouettesOf(v, adapter.listRef(s.key)!)]));
    for (const s of sets) {
      const now = silhouettesOf(v, adapter.listRef(s.key)!);
      if (catalase.has(s.key)) expect(now).toMatchObject({ on: true, by: 'size', pixels: 12 });
      else expect(now).toEqual(before.get(s.key));
    }
    // the lumen view: its band holds, atoms at every size (silhouettes off)
    const lumen = updateView({ ...doc, session: { view: 'v.lumen' } }, result.ir!);
    await adapter.commit(lumen);
    for (const key of catalase) expect(silhouettesOf(v, adapter.listRef(key)!).on).toBe(false);
    // back: silhouettes again
    await adapter.commit(updateView(doc, lumen));
    for (const key of catalase) expect(silhouettesOf(v, adapter.listRef(key)!)).toMatchObject({ on: true, pixels: 12 });
  });

  it('without structures the bands decide nothing: the lists are left as they are', { tags: ['medium'] }, async () => {
    const doc = bandedExosome();
    const none: AdapterStructures = { of: () => undefined };
    const { v, adapter, result } = await session(none, doc);
    const plain = await session(none, exosomeDoc());
    for (const s of placementSets(result.ir!))
      expect(silhouettesOf(v, adapter.listRef(s.key)!)).toEqual(silhouettesOf(plain.v, plain.adapter.listRef(s.key)!));
  });
});

describe('the representations of a list with structures (headless)', () => {
  it('a target representation draws the structures; the spheres leave them out; a list without has spheres only', {
    tags: ['medium'],
  }, async () => {
    const { v, adapter, result } = await session(catalaseFrom(readFileSync(fixture)));
    const sets = placementSets(result.ir!);
    const catalase = new Set(typesOf(sets, 'e.catalase').map((x) => x.set.key));
    for (const s of sets) {
      const q = StateSelection.Generators.byRef(adapter.listRef(s.key)!).subtree().ofType(SO.Particle.Representation3D);
      const reps = v.plugin.state.data
        .select(q)
        .map((c) => c.transform.params as { type: { name: string; params: { excludeTargets?: boolean } } });
      if (catalase.has(s.key)) {
        expect(reps.map((r) => r.type.name)).toEqual(['spacefill', 'target']);
        expect(reps[0].type.params.excludeTargets).toBe(true);
      } else {
        expect(reps.map((r) => r.type.name)).toEqual(['spacefill']);
        expect(reps[0].type.params.excludeTargets).not.toBe(true);
      }
    }
  });

  it("a host that fetches for the viewer: a structure's address read through its fetch", {
    tags: ['medium'],
  }, async () => {
    const asked: string[] = [];
    const bytes = readFileSync(fixture);
    const structures: AdapterStructures = {
      of: (t) =>
        t.entity === 'e.catalase'
          ? {
              key: 'u',
              name: 'catalase',
              source: { kind: 'url', url: 'https://example.org/x/1c26.bcif', isBinary: true },
            }
          : undefined,
      fetch: async (url) => {
        asked.push(url);
        return new Uint8Array(bytes);
      },
    };
    const { adapter, result } = await session(structures);
    expect(asked).toEqual(['https://example.org/x/1c26.bcif']);
    const [{ set, type }] = typesOf(placementSets(result.ir!), 'e.catalase');
    expect((adapter.listObject(set.key)!.data as ParticleList).targetMapping?.get(type)?.kind).toBe('structure');
  });
});

// the gate's findings on loading (reviewer 5, 6, 7; skeptic 8)
describe('loading the structures (headless)', () => {
  const url = 'https://example.org/x/1c26.bcif?v=2';
  const source = { kind: 'url' as const, url, isBinary: true, format: 'mmcif' };

  it('two loads at once share one fetch; a fetched file is named without its query', { tags: ['medium'] }, async () => {
    const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
    viewers.push(v);
    const cache = new EntityStructureCache();
    const asked: string[] = [];
    const fetch = async (u: string) => {
      asked.push(u);
      await new Promise((r) => setTimeout(r, 20));
      return new Uint8Array(readFileSync(fixture));
    };
    const wanted = [{ key: 'k', name: 'catalase', source }];
    const [a, b] = await Promise.all([
      v.plugin.runTask(Task.create('a', (ctx) => cache.load(v.plugin, ctx, wanted, fetch))),
      v.plugin.runTask(Task.create('b', (ctx) => cache.load(v.plugin, ctx, wanted, fetch))),
    ]);
    expect(asked).toEqual([url]);
    expect(a.get('k')).toBe(b.get('k'));
    expect((a.get('k') as { kind?: string }).kind).toBe('structure');
    cache.dispose();
  });

  it('a failed fetch is not kept: the next load tries again', { tags: ['medium'] }, async () => {
    const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
    viewers.push(v);
    const cache = new EntityStructureCache();
    let up = false;
    const fetch = async () => (up ? new Uint8Array(readFileSync(fixture)) : undefined);
    const wanted = [{ key: 'k', name: 'catalase', source }];
    const first = await v.plugin.runTask(Task.create('a', (ctx) => cache.load(v.plugin, ctx, wanted, fetch)));
    expect(first.get('k')).toMatchObject({ error: expect.stringMatching(/could not be fetched/) });
    up = true;
    const second = await v.plugin.runTask(Task.create('b', (ctx) => cache.load(v.plugin, ctx, wanted, fetch)));
    expect((second.get('k') as { kind?: string }).kind).toBe('structure');
    cache.dispose();
  });
});
