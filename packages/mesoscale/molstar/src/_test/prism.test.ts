/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag medium

import { compile, type CompileResult, updateView } from '@molstar/meso-spec/runtime/runtime';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers/index';
import { exosomeDoc, ExosomeResources } from '@molstar/meso-spec/examples/exosome';
import { placementSets } from '@molstar/meso-spec/ir/ir';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format/doc';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { afterEach, describe, expect, it } from 'vitest';
import { PrismMesoAdapter } from '../prism-adapter.js';

// The integration lane (design.md §12): the IR into the real Prism viewer (prism-me's spec, headless, no canvas) through
// the adapter. What it proves: the lists hold the IR's own buffers; a color edit writes looks and touches no list or
// representation object; a density edit replaces only the list of the model it reran.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

const options = (cache: Map<string, unknown>) => ({
  resolvers: DefaultResolvers,
  load: (id: string) => ExosomeResources[id]?.(),
  cache: cache as Map<string, never>,
});

async function session() {
  const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
  viewers.push(v);
  const adapter = new PrismMesoAdapter(v);
  const cache = new Map();
  const result = await compile(exosomeDoc(), options(cache));
  const report = await adapter.commit(result.ir!);
  return { v, adapter, cache, result, report };
}

const reprObjects = (v: PrismViewer) =>
  v.plugin.managers.particles.hierarchy.current.lists.flatMap((l) => l.representations.map((r) => r.cell.obj));

describe('the Prism adapter (headless)', () => {
  it('one list and one representation per placement set, holding the IR buffers', { tags: ['medium'] }, async () => {
    const { v, adapter, result, report } = await session();
    const sets = placementSets(result.ir!);
    expect(report.added.length).toBe(3);
    const lists = v.plugin.managers.particles.hierarchy.current.lists;
    expect(lists.length).toBe(3);
    expect(lists.every((l) => l.representations.length === 1)).toBe(true);
    for (const s of sets) {
      const list = adapter.listObject(s.key)!.data as ParticleList;
      expect(list.coordinates).toBe(s.positions);
      expect(list.rotations).toBe(s.rotations);
      expect(list.targets).toBe(s.types);
      expect(list.count).toBe(s.count);
    }
    expect(report.looksWritten).toBe(result.ir!.view.looks.length);
  });

  it('a color edit: looks written, no list or representation object replaced', { tags: ['medium'] }, async () => {
    const { v, adapter, result } = await session();
    const lists = placementSets(result.ir!).map((s) => adapter.listObject(s.key));
    const reprs = reprObjects(v);
    const doc: MesoViewSpecDoc = {
      ...exosomeDoc(),
      views: exosomeDoc().views!.map((x) =>
        x.id === 'v.overview'
          ? { ...x, looks: [...x.looks!, { select: { populations: ['p.miRNA'] }, color: '#00ff00' }] }
          : x,
      ),
    };
    const report = await adapter.commit(updateView(doc, result.ir!));
    expect(report).toMatchObject({ added: [], removed: [] });
    expect(report.kept.length).toBe(3);
    expect(report.looksWritten).toBeGreaterThan(0);
    placementSets(result.ir!).forEach((s, i) => expect(adapter.listObject(s.key)).toBe(lists[i]));
    reprObjects(v).forEach((r, i) => expect(r).toBe(reprs[i]));
  });

  it("a density edit: the rerun model's list replaced, the others kept", { tags: ['medium'] }, async () => {
    const { adapter, cache, result } = await session();
    const before = new Map(placementSets(result.ir!).map((s) => [s.model, adapter.listObject(s.key)]));
    const doc: MesoViewSpecDoc = {
      ...exosomeDoc(),
      populations: exosomeDoc().populations.map((p) =>
        p.id === 'p.miRNA' ? { ...p, abundance: { concentration: { value: 0.0008, unit: 'M' as const } } } : p,
      ),
    };
    const next: CompileResult = await compile(doc, options(cache));
    expect(next.stats.resolverRuns).toBe(1);
    const report = await adapter.commit(next.ir!);
    expect(report.added.length).toBe(1);
    expect(report.removed.length).toBe(1);
    for (const s of placementSets(next.ir!)) {
      const obj = adapter.listObject(s.key);
      if (s.model === 'm.recipe') expect(obj).not.toBe(before.get(s.model));
      else expect(obj).toBe(before.get(s.model));
    }
  });
});
