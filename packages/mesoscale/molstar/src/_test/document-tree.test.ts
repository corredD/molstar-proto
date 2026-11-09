/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { BetaCellResources, betaCellDoc, exosomeDoc, ExosomeResources } from '@molstar/meso-spec/examples';
import { applyPatch, type MesoViewSpecDoc, type Patch } from '@molstar/meso-spec/format';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers';
import { compile, updateView } from '@molstar/meso-spec/runtime';
import { describe, expect, it } from 'vitest';
import { documentLooks, documentOutline, OutlineStats } from '../document-tree.js';

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
