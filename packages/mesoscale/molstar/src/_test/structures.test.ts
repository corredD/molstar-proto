/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag medium

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@molstar/meso-spec/runtime';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers';
import { exosomeDoc, ExosomeResources } from '@molstar/meso-spec/examples';
import { type PlacementSet, placementSets } from '@molstar/meso-spec/ir';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { Asset } from '@molstar/core/util/assets';
import { afterEach, describe, expect, it } from 'vitest';
import { type AdapterStructures, PrismMesoAdapter } from '../prism-adapter.js';

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
