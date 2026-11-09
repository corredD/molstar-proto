/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { BetaCellResources, betaCellDoc, exosomeDoc, ExosomeResources } from '@molstar/meso-spec/examples';
import { applyPatch, type MesoViewSpecDoc, type Patch } from '@molstar/meso-spec/format';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers';
import { evaluateMesoQL, placementSets } from '@molstar/meso-spec/ir';
import { compile, flattenInstances, updateView } from '@molstar/meso-spec/runtime';
import { describe, expect, it } from 'vitest';
import { parseMesoQL } from '@molstar/meso-spec/format';
import { documentLooks, documentOutline, OutlineStats } from '../document-tree.js';
import { PrismMesoAdapter } from '../prism-adapter.js';

// The document's rows (prism.md §4.1, §4.2) without a viewer: compartments nested by `parent`, populations and
// instances under them, a superstructure's parts made when opened, the counts with what was asked, the groupings, and
// the rows kept across a view edit.

const exosome = async (doc: MesoViewSpecDoc = exosomeDoc()) => ({
  doc,
  r: await compile(doc, { resolvers: DefaultResolvers, load: (id: string) => ExosomeResources[id]?.() }),
});
const betaCell = async () => {
  const doc = betaCellDoc();
  return { doc, r: await compile(doc, { resolvers: DefaultResolvers, load: (id) => BetaCellResources[id]?.() }) };
};

describe('documentOutline', () => {
  it('the exosome: compartments nested by parent, each population under its own, counts with what was asked', async () => {
    const { doc, r } = await exosome();
    const o = documentOutline(doc, r.ir, r.counts);
    expect(o.title).toBe('Exosome in plasma');
    expect(o.roots).toEqual(['medium']);
    expect(o.children('medium').map((x) => x.id)).toEqual(['c.exosome', 'p.ALB', 'p.TF']);
    const lumen = o.children('c.exosome').map((x) => x.id);
    expect(lumen).toContain('p.lipids');
    expect(lumen).toContain('p.catalase.observed');
    const catalase = o.row('p.catalase')!;
    expect(catalase).toMatchObject({ kind: 'population', select: '(population p.catalase)', entity: 'e.catalase' });
    // two populations of one entity: told apart by their ids
    expect(catalase.label).toBe('catalase (catalse) · p.catalase');
    expect(o.row('p.catalase.observed')!.label).toBe('catalase (catalse) · p.catalase.observed');
    expect(o.row('p.lipids')!.label).toBe('phospholipid');
    expect(catalase.achieved).toBe(r.counts['p.catalase'].achieved);
    expect(catalase.requested).toBe(r.counts['p.catalase'].requested);
    // a compartment counts the copies in it and nested
    const inExosome = o.children('c.exosome').reduce((n, x) => n + x.achieved, 0);
    expect(o.row('c.exosome')!.achieved).toBe(inExosome);
    expect(o.row('medium')!.achieved).toBe(inExosome + o.row('p.ALB')!.achieved + o.row('p.TF')!.achieved);
    expect(o.row('c.exosome')!.select).toBe('(in c.exosome)');
    expect(o.ancestors('p.lipids')).toEqual(['c.exosome', 'medium']);
    expect(o.copies).toBe(o.row('medium')!.achieved);
  });

  it('groups by the model that placed each population, and by its entity kind', async () => {
    const { doc, r } = await exosome();
    const byModel = documentOutline(doc, r.ir, r.counts, 'model');
    expect(byModel.roots).toEqual(['@model:m.picks', '@model:m.recipe', '@model:default:meso.bilayer']);
    expect(byModel.row('@model:m.recipe')!.select).toBe('(model m.recipe)');
    expect(byModel.row('@model:default:meso.bilayer')).toMatchObject({
      label: 'meso.bilayer (default)',
      select: '(population p.lipids)',
    });
    expect(byModel.ancestors('p.lipids')).toEqual(['@model:default:meso.bilayer']);
    const byKind = documentOutline(doc, r.ir, r.counts, 'kind');
    expect(byKind.roots).toEqual(['@kind:protein', '@kind:lipid']);
    expect(byKind.row('@kind:lipid')!.select).toBe('(population p.lipids)');
    expect(byKind.children('@kind:protein')).toHaveLength(doc.populations.length - 1);
  });

  it("the β-cell: instances beside populations; a granule's parts made when first opened, through every instance", async () => {
    const { doc, r } = await betaCell();
    const made = OutlineStats.made;
    const o = documentOutline(doc, r.ir, r.counts);
    expect(OutlineStats.made).toBe(made + 1);
    expect(o.children('c.cell').map((x) => x.id)).toEqual([
      'p.granules',
      'p.ribosomes',
      'i.granule-docked',
      'i.granule-deep',
    ]);
    const granules = o.row('p.granules')!;
    expect(granules.parts).toBe(true);
    expect(o.row('i.granule-docked')).toMatchObject({ kind: 'instance', select: '(instance i.granule-docked)' });
    // parts: none made until asked
    expect(granules.children).toEqual([]);
    const parts = o.children('p.granules');
    expect(parts.map((x) => x.id)).toEqual([
      'p.granules/p.Vamp2',
      'p.granules/p.Rab3a',
      'p.granules/p.Chga',
      'p.granules/p.Scg2',
    ]);
    const vamp = parts[0];
    expect(vamp).toMatchObject({ kind: 'part', select: '(part (population p.granules) p.Vamp2)', ref: 'p.Vamp2' });
    expect(vamp.achieved).toBe(r.counts['p.Vamp2'].achieved * granules.achieved);
    // a part of an instance, asked by id: its way made
    expect(o.ancestors('i.granule-deep/p.Chga')).toEqual(['i.granule-deep', 'c.cell']);
    expect(o.row('i.granule-deep/p.Chga')!.select).toBe('(part (instance i.granule-deep) p.Chga)');
    expect(o.row('nothing/p.Chga')).toBeUndefined();
    // a compartment counts its parts too: the cell holds every copy of the document
    expect(o.row('c.cell')!.achieved).toBe(o.copies);
    const byModel = documentOutline(doc, r.ir, r.counts, 'model');
    expect(byModel.roots.reduce((n, id) => n + byModel.row(id)!.achieved, 0)).toBe(o.copies);
  });

  it('keeps every row across a view edit; a grouping switched back is the same outline', async () => {
    const { doc, r } = await exosome();
    const o = documentOutline(doc, r.ir, r.counts);
    const patch: Patch = {
      format: 'meso_view_spec_patch',
      ops: [{ op: 'set', id: 'document', fields: { session: { view: 'v.lumen' } } }],
    };
    const edited = applyPatch(doc, patch).doc;
    const ir = updateView(edited, r.ir!);
    const made = OutlineStats.made;
    const again = documentOutline(edited, ir, r.counts);
    expect(again).toBe(o);
    expect(again.row('p.lipids')).toBe(o.row('p.lipids'));
    expect(documentOutline(edited, ir, r.counts, 'kind')).not.toBe(o);
    expect(documentOutline(edited, ir, r.counts)).toBe(o);
    expect(OutlineStats.made).toBe(made + 1);
  });
});

describe('documentLooks', () => {
  it('an eye is closed when a look hides its copies; a group when one row under it is hidden', async () => {
    const { doc, r } = await exosome();
    const o = documentOutline(doc, r.ir, r.counts);
    expect(documentLooks(o, r.ir).visible('medium')).toBe(true);
    const view = doc.session?.view ?? doc.views![0].id;
    const hidden = applyPatch(doc, {
      format: 'meso_view_spec_patch',
      ops: [
        {
          op: 'insert',
          node: { id: 'l.eye.1', select: '(population p.lipids)', visible: false },
          parent: view,
          list: 'looks',
          after: 'last',
        },
      ],
    }).doc;
    const ir = updateView(hidden, r.ir!);
    const looks = documentLooks(documentOutline(hidden, ir, r.counts), ir);
    expect(looks.visible('p.lipids')).toBe(false);
    expect(looks.visible('p.CD63')).toBe(true);
    expect(looks.visible('c.exosome')).toBe(false);
    expect(looks.visible('medium')).toBe(false);
  });
});

// review gate (M3, S1): a superstructure of superstructures, two levels deep (3 outer bodies, 4 inner each, 5 x each)
const nested = {
  format: 'meso_view_spec',
  version: '0.2.0',
  metadata: { title: 'nested' },
  units: { length: 'nm' },
  entities: [
    { id: 'e.x', label: 'x', kind: 'protein', radius: 2 },
    { id: 'e.inner', label: 'inner body', kind: 'assembly', superstructure: 's.inner' },
    { id: 'e.outer', label: 'outer body', kind: 'assembly', superstructure: 's.outer' },
  ],
  superstructures: [
    {
      id: 's.inner',
      label: 'inner',
      compartments: [{ id: 'c.in', label: 'in', kind: 'vesicle', geometry: { kind: 'sphere', radius: 12 } }],
      populations: [{ id: 'p.x', entity: 'e.x', compartment: 'c.in', location: 'interior', abundance: { count: 5 } }],
    },
    {
      id: 's.outer',
      label: 'outer',
      compartments: [{ id: 'c.out', label: 'out', kind: 'vesicle', geometry: { kind: 'sphere', radius: 80 } }],
      populations: [
        { id: 'p.inner', entity: 'e.inner', compartment: 'c.out', location: 'interior', abundance: { count: 4 } },
      ],
    },
  ],
  compartments: [{ id: 'c.top', label: 'top', kind: 'cell', geometry: { kind: 'sphere', radius: 400 } }],
  populations: [
    { id: 'p.outer', entity: 'e.outer', compartment: 'c.top', location: 'interior', abundance: { count: 3 } },
  ],
} as unknown as MesoViewSpecDoc;

describe('two levels of superstructures', () => {
  it('counts every copy through both levels', async () => {
    const r = await compile(nested, { resolvers: DefaultResolvers });
    const o = documentOutline(nested, r.ir, r.counts);
    expect(o.row('p.outer/p.inner/p.x')!.achieved).toBe(60);
    expect(o.copies).toBe(3 + 12 + 60);
    expect(o.row('c.top')!.achieved).toBe(o.copies);
  });

  it('names and lights the innermost copies of the drawn lists', async () => {
    const r = await compile(nested, { resolvers: DefaultResolvers });
    const adapter = new PrismMesoAdapter({} as never) as unknown as {
      expansions: Map<string, unknown>;
      placed: Map<string, { ref: string; label: string }>;
      index(ir: unknown): void;
      evict(keys: ReadonlySet<string>): void;
      locate: PrismMesoAdapter['locate'];
      drawnRuns: PrismMesoAdapter['drawnRuns'];
    };
    const flat = flattenInstances(r.ir!, adapter.expansions as never);
    const keys = new Set(placementSets(flat.ir).map((s) => s.key));
    // as a commit keeps them
    adapter.evict(keys);
    for (const k of keys) adapter.placed.set(k, { ref: `ref:${k}`, label: '' });
    adapter.index(r.ir);
    const deep = placementSets(flat.ir).find((s) => s.typeTable.some((t) => t.population === 'p.x'))!;
    expect(adapter.locate(deep.key, 0)!.map((c) => c.population)).toEqual(['p.outer', 'p.inner', 'p.x']);
    const loci = evaluateMesoQL(parseMesoQL('(population p.x)', {}, undefined, 'selection').expr!, {
      doc: nested,
      ir: r.ir!,
    }).loci;
    const runs = adapter.drawnRuns(loci).get(`ref:${deep.key}`);
    expect(runs).toEqual([0, 60]);
  });
});
