/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { exosomeDoc } from '../examples/exosome.js';
import { nucleoidDoc } from '../examples/nucleoid.js';
import { mesoQLReference, parseMesoQL, printMesoQL } from '../format/mesoql.js';
import { indexDoc, validate } from '../format/validate.js';
import { placementSets } from '../ir/ir.js';
import { evaluateMesoQL, intersectRuns, lociSize, lociToIds, subtractRuns, typeRuns, unionRuns } from '../ir/loci.js';
import { updateView } from '../runtime/runtime.js';
import { compileExosome } from './helpers.js';

// MesoQL (design.md §3.8): addresses are checked against the document, materialized into MesoLoci (runs per set),
// and a view's looks, selection and annotations come from them.

const kinds = indexDoc(exosomeDoc()).kinds as ReadonlyMap<string, string>;
const q = (text: string) => {
  const p = parseMesoQL(text, { kinds });
  expect(p.issues).toEqual([]);
  return p.expr!;
};

describe('MesoQL', () => {
  it('parses, checks and prints canonically', () => {
    expect(printMesoQL(q('(and (entity e.catalase)   (in c.exosome :nested false))'))).toBe(
      '(and (entity e.catalase) (in c.exosome :nested false))',
    );
    expect(printMesoQL(q('(meso.population p.CD9 p.CD63)'))).toBe('(population p.CD9 p.CD63)');
  });

  it('says what is wrong, where', () => {
    const codes = (t: string) => parseMesoQL(t, { kinds }, '/views/0/looks/0/select').issues.map((i) => i.code);
    expect(codes('(entty e.catalase)')).toEqual(['mesoql.symbol.unknown']);
    expect(codes('(entity c.exosome)')).toEqual(['mesoql.ref.kind']);
    expect(codes('(population p.nope)')).toEqual(['mesoql.ref.missing']);
    expect(codes('(and (site e.catalase x))')).toEqual(['mesoql.type']);
    expect(codes('(within (all) :of (all) :distance far)')).toEqual(['mesoql.keyword']);
    expect(codes('(entity e.catalase')).toEqual(['mesoql.syntax']);
    // validation reports them with the document pointer
    const d = exosomeDoc();
    const bad = { ...d, views: [{ id: 'v', looks: [{ select: '(entity c.exosome)' }] }] };
    expect(validate(bad).find((i) => i.code === 'mesoql.ref.kind')?.path).toBe('/views/0/looks/0/select');
  });

  it('run algebra', () => {
    expect(unionRuns([0, 5, 10, 12], [4, 11])).toEqual([0, 12]);
    expect(intersectRuns([0, 5, 10, 20], [3, 12])).toEqual([3, 5, 10, 12]);
    expect(subtractRuns([0, 20], [3, 5, 10, 12])).toEqual([0, 3, 5, 10, 12, 20]);
  });

  it('a population is one run however many copies it has', async () => {
    const r = await compileExosome(exosomeDoc());
    const ctx = { doc: exosomeDoc(), ir: r.ir! };
    const lip = evaluateMesoQL(q('(population p.lipids)'), ctx).loci;
    expect([...lip.values()]).toEqual([[0, 88666]]);
    expect(lociSize(evaluateMesoQL(q('(in c.exosome :location membrane)'), ctx).loci)).toBe(
      88666 +
        r.counts['p.CD63'].achieved +
        r.counts['p.CD9'].achieved +
        r.counts['p.ITG'].achieved +
        r.counts['p.RAB5A'].achieved,
    );
    for (const s of placementSets(r.ir!)) for (const runs of typeRuns(s)) expect(runs.length).toBe(2);
  });

  it('and, or, not, copies, within', async () => {
    const r = await compileExosome(exosomeDoc());
    const ctx = { doc: exosomeDoc(), ir: r.ir! };
    const n = (t: string) => lociSize(evaluateMesoQL(q(t), ctx).loci);
    const cat = r.counts['p.catalase'].achieved + 24;
    expect(n('(entity e.catalase)')).toBe(cat);
    expect(n('(and (entity e.catalase) (model m.picks))')).toBe(24);
    expect(n('(or (population p.CD9) (population p.CD63))')).toBe(
      r.counts['p.CD9'].achieved + r.counts['p.CD63'].achieved,
    );
    expect(n('(not (population p.lipids) :in (in c.exosome :location membrane))')).toBe(
      n('(in c.exosome :location membrane)') - 88666,
    );
    expect(lociToIds(evaluateMesoQL(q('(copies p.catalase 12 3)'), ctx).loci, r.ir!)).toEqual([
      'p.catalase#12',
      'p.catalase#13',
      'p.catalase#14',
    ]);
    const near = n('(within (population p.catalase) :of (population p.catalase.observed) :distance 15)');
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(r.counts['p.catalase'].achieved);
  });

  it('a view from addresses: whole-type looks, partial looks with runs, an annotation at its copies', async () => {
    const r = await compileExosome(exosomeDoc());
    const ir = updateView({ ...exosomeDoc(), session: { view: 'v.near-picks' } }, r.ir!);
    const partial = ir.view.looks.filter((l) => l.runs);
    expect(partial.length).toBeGreaterThan(0);
    const hidden = ir.view.looks.filter((l) => !l.runs && l.visible === false).length;
    expect(hidden).toBeGreaterThan(0);
    const over = updateView(exosomeDoc(), r.ir!);
    expect(over.view.annotations?.[0].position?.length).toBe(3);
    expect(over.view.issues).toBeUndefined();
  });

  it('the reference is generated from the table', () => {
    expect(mesoQLReference()).toContain('| `within` | selection |');
  });

  it('an address has the type its slot asks for, and a site name its entity declares (F5)', () => {
    const d = exosomeDoc();
    const at = (doc: typeof d) =>
      validate(doc)
        .filter((i) => i.severity === 'error')
        .map((i) => [i.code, i.path]);
    const k = d.views!.length;
    const view = (v: object) => ({ ...d, views: [...d.views!, { id: 'v.x', ...v }] });
    expect(at(view({ camera: { focus: '(site e.catalase x)' } }))).toEqual([
      ['mesoql.type', `/views/${k}/camera/focus`],
    ]);
    expect(at(view({ looks: [{ select: '(residues e.catalase)' }] }))).toEqual([
      ['mesoql.type', `/views/${k}/looks/0/select`],
    ]);
    expect(at(view({ cutaway: '(site e.catalase x)' }))).toEqual([['mesoql.type', `/views/${k}/cutaway`]]);
    // the slot, not the head, says the type: parseMesoQL takes it
    expect(parseMesoQL('(site e.catalase x)', { kinds }, undefined, 'selection').issues.map((i) => i.code)).toEqual([
      'mesoql.type',
    ]);
    const n = nucleoidDoc();
    const withEntry = (entry: string) => ({
      ...n,
      relations: n.relations!.map((r, i) => (i ? r : { ...r, entry })),
    });
    expect(at(withEntry('(site e.hu nope)'))).toEqual([['mesoql.site', '/relations/0/entry']]);
    expect(at(withEntry('(population p.hu)'))).toEqual([['mesoql.type', '/relations/0/entry']]);
    expect(at(withEntry('(site e.hu dna-exit)'))).toEqual([]);
  });

  it('a keyword value has its type: :nested a bool, :location and :chain words (F6)', () => {
    const codes = (t: string) => parseMesoQL(t, { kinds }).issues.map((i) => i.code);
    expect(codes('(in c.exosome :nested maybe)')).toEqual(['mesoql.keyword']);
    expect(codes('(in c.exosome :nested 3)')).toEqual(['mesoql.keyword']);
    expect(codes('(in c.exosome :location 3)')).toEqual(['mesoql.keyword']);
    expect(codes('(residues e.catalase :chain true)')).toEqual(['mesoql.keyword']);
    expect(codes('(in c.exosome :nested false :location membrane)')).toEqual([]);
  });

  it('a keyword is given once (F11)', () => {
    const codes = (t: string) => parseMesoQL(t, { kinds }).issues.map((i) => i.code);
    expect(codes('(in c.exosome :nested true :nested false)')).toEqual(['mesoql.keyword']);
  });

  it('ordinals, counts and distances are not negative (F11)', () => {
    const codes = (t: string) => parseMesoQL(t, { kinds }).issues.map((i) => i.code);
    expect(codes('(copies p.catalase -1)')).toEqual(['mesoql.argument']);
    expect(codes('(copies p.catalase 0 -3)')).toEqual(['mesoql.argument']);
    expect(codes('(within (all) :of (all) :distance -5)')).toEqual(['mesoql.keyword']);
    expect(codes('(copies p.catalase 0 3)')).toEqual([]);
  });
});
