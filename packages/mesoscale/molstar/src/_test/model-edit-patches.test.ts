/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { exosomeDoc } from '@molstar/meso-spec/examples';
import { applyPatch, type MesoViewSpecDoc } from '@molstar/meso-spec/format';
import { describe, expect, it } from 'vitest';
import { countPatch, relaxPatch, seedPatch } from '../model-edits.js';

// The model edits of Built by (prism.md §4.3, §12.2 lane 6) as patches over the document: what each one writes, and
// what it refuses before any patch exists. The patch applied is the validation's judgement (static issues).

const doc = exosomeDoc() as MesoViewSpecDoc;

describe('countPatch', () => {
  it('sets the abundance of the population, keeping its kind', () => {
    const r = countPatch(doc, 'p.catalase', 300);
    expect(r.refused).toBeUndefined();
    expect(r.patch?.ops).toEqual([{ op: 'set', id: 'p.catalase', fields: { abundance: { count: 300 } } }]);
    const applied = applyPatch(doc, r.patch!);
    expect(applied.issues).toEqual([]);
    expect(applied.doc.populations.find((p) => p.id === 'p.catalase')?.abundance).toEqual({ count: 300 });
  });

  it('is nothing when the count is already so', () => {
    const now = (doc.populations.find((p) => p.id === 'p.catalase')?.abundance as { count: number }).count;
    expect(countPatch(doc, 'p.catalase', now)).toEqual({});
  });

  it('refuses a count below 0, a fraction, and a population that has no count', () => {
    expect(countPatch(doc, 'p.catalase', -1).refused).toMatch(/0 or more/);
    expect(countPatch(doc, 'p.catalase', 2.5).refused).toMatch(/whole number/);
    expect(countPatch(doc, 'p.catalase', Number.NaN).refused).toMatch(/whole number/);
    // the lipids are a density: their count is the area's, not a number to type
    expect(countPatch(doc, 'p.lipids', 10).refused).toMatch(/density/);
    expect(countPatch(doc, 'p.nothing', 10).refused).toMatch(/no population/);
  });
});

describe('seedPatch', () => {
  it('sets the seed of the model', () => {
    const r = seedPatch(doc, 'm.recipe', 7);
    expect(r.patch?.ops).toEqual([{ op: 'set', id: 'm.recipe', fields: { seed: 7 } }]);
    expect(applyPatch(doc, r.patch!).issues).toEqual([]);
  });

  it('refuses a seed that is not a whole number, a model that is not there', () => {
    expect(seedPatch(doc, 'm.recipe', 1.5).refused).toMatch(/whole number/);
    expect(seedPatch(doc, 'm.recipe', -3).refused).toMatch(/whole number/);
    expect(seedPatch(doc, 'm.nothing', 3).refused).toMatch(/no model/);
  });

  it('is nothing for the seed it has (1 when it states none)', () => {
    const m = doc.models?.find((x) => x.id === 'm.recipe');
    expect(seedPatch(doc, 'm.recipe', m?.seed ?? 1)).toEqual({});
  });
});

describe('relaxPatch', () => {
  it('inserts meso.relax as the refiner of the model, last in models, with an id the document does not use', () => {
    const r = relaxPatch(doc, 'm.recipe');
    expect(r.refused).toBeUndefined();
    const [op] = r.patch!.ops;
    expect(op).toMatchObject({
      op: 'insert',
      parent: 'models',
      after: 'last',
      node: { id: 'm.relax', kind: 'procedural', method: 'meso.relax', refines: 'm.recipe', populations: [] },
    });
    const applied = applyPatch(doc, r.patch!);
    expect(applied.issues).toEqual([]);
    expect(applied.doc.models?.at(-1)?.id).toBe('m.relax');
  });

  it('takes the next id when m.relax is there, and refuses a model that has a refiner already', () => {
    const had = applyPatch(doc, relaxPatch(doc, 'm.recipe').patch!).doc;
    expect(relaxPatch(had, 'm.recipe').refused).toMatch(/already.*m\.relax/);
    // the stage itself can be refined further: its id is the next free
    const second = relaxPatch(had, 'm.relax');
    expect(second.patch?.ops[0]).toMatchObject({ node: { id: 'm.relax.2', refines: 'm.relax' } });
    expect(applyPatch(had, second.patch!).issues).toEqual([]);
  });

  it('refuses a model that is not there, and one a relax cannot refine (precomputed)', () => {
    expect(relaxPatch(doc, 'm.nothing').refused).toMatch(/no model/);
    expect(relaxPatch(doc, 'm.picks').refused).toMatch(/precomputed/);
  });
});
