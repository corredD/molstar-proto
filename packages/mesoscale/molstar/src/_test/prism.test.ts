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
import { MesoSession } from '../session.js';

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
          ? { ...x, looks: [...x.looks!, { select: '(population p.miRNA)', color: '#00ff00' }] }
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

  it('a representation hint the adapter cannot draw falls back to spheres, said as a render issue', {
    tags: ['medium'],
  }, async () => {
    const { adapter, result } = await session();
    const lumen = { ...exosomeDoc(), session: { view: 'v.lumen' } };
    const report = await adapter.commit(updateView(lumen, result.ir!));
    expect(report.issues?.map((i) => [i.code, i.phase])).toEqual([['representation.fallback', 'render']]);
    expect(report.issues?.[0].message).toMatch(/^2 types ask to be drawn as structure/);
  });
});

const withAbundance = (
  doc: MesoViewSpecDoc,
  population: string,
  abundance: MesoViewSpecDoc['populations'][number]['abundance'],
): MesoViewSpecDoc => ({
  ...doc,
  populations: doc.populations.map((p) => (p.id === population ? { ...p, abundance } : p)),
});
const conc = (value: number) => ({ concentration: { value, unit: 'M' as const } });
const listCount = (v: PrismViewer) => v.plugin.managers.particles.hierarchy.current.lists.length;

describe('a session over the Prism adapter (headless)', () => {
  async function open() {
    const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
    viewers.push(v);
    const s = new MesoSession(
      exosomeDoc(),
      { resolvers: DefaultResolvers, load: (id) => ExosomeResources[id]?.() },
      new PrismMesoAdapter(v),
    );
    await s.start();
    return { v, s };
  }

  // gate A1: two edits in flight diffed against the same previous IR, so the first one's list was never removed
  it('overlapping edits run one after the other: no orphan list', { tags: ['medium'] }, async () => {
    const { v, s } = await open();
    expect(listCount(v)).toBe(3);
    await Promise.all([
      s.edit(withAbundance(exosomeDoc(), 'p.miRNA', conc(0.0008)), 'a'),
      s.edit(withAbundance(exosomeDoc(), 'p.miRNA', conc(0.0012)), 'b'),
    ]);
    expect(listCount(v)).toBe(3);
    expect(s.history.map((r) => r.label)).toEqual(['open', 'a', 'b']);
  });

  // gate A1: each click built its doc from session.doc at click time, so the last edit to finish dropped the other
  it('edits given as functions of the current doc compose', { tags: ['medium'] }, async () => {
    const { v, s } = await open();
    await Promise.all([
      s.edit((d) => withAbundance(d, 'p.catalase', { count: 150 }), 'catalase 150'),
      s.edit((d) => withAbundance(d, 'p.miRNA', conc(0.0008)), 'miRNA'),
    ]);
    const pops = new Map(s.doc.populations.map((p) => [p.id, p.abundance]));
    expect(pops.get('p.catalase')).toEqual({ count: 150 });
    expect(pops.get('p.miRNA')).toEqual(conc(0.0008));
    expect(listCount(v)).toBe(3);
  });

  // gate AN1: Prism's undo records the adapter's representation calls but not its list create and delete, so undo
  // stripped a kept list's representation; the adapter still counted it kept and the next view edit threw
  it('after an undo strips a representation, the next edit draws the list again', { tags: ['medium'] }, async () => {
    const { v, s } = await open();
    await s.edit((d) => withAbundance(d, 'p.miRNA', conc(0.0008)), 'miRNA');
    for (let i = 0; i < 2; i++) await v.managers.history.undo();
    const reprs = () => v.plugin.managers.particles.hierarchy.current.lists.map((l) => l.representations.length);
    expect(reprs()).toContain(0);
    const record = await s.edit((d) => ({ ...d, session: { view: 'v.lumen' } }), 'view');
    expect(record.kind).toBe('view');
    expect(reprs()).toEqual([1, 1, 1]);
    expect(s.issues.map((i) => i.code)).toContain('adapter.redrawn');
  });

  it('a kept list deleted outside the adapter is made again on the next edit', { tags: ['medium'] }, async () => {
    const { v, s } = await open();
    const ref = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    await v.plugin.runTask(v.plugin.state.data.updateTree(v.plugin.state.data.build().delete(ref)));
    expect(listCount(v)).toBe(2);
    await s.edit((d) => ({ ...d, session: { view: 'v.lumen' } }), 'view');
    expect(v.plugin.managers.particles.hierarchy.current.lists.map((l) => l.representations.length)).toEqual([1, 1, 1]);
  });
});
