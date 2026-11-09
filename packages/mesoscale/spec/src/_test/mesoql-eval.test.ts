/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { parseMesoQL, printMesoQL } from '../format/mesoql.js';
import { MesoQLComposed } from '../format/mesoql-skill.js';
import { lociSize } from '../ir/loci.js';
import {
  answerMatches,
  evalLoci,
  type MesoQLEvalScene,
  mesoQLEvalScene,
  MesoQLEvalQuestions,
} from './mesoql-eval.questions.js';

// The quick-lane eval of the MesoQL skill: every expected address is canonical, checks clean against the β-cell's ids
// and picks copies; the grader accepts an equivalent spelling and rejects a near miss.

let scene: MesoQLEvalScene;
beforeAll(async () => {
  scene = await mesoQLEvalScene();
});

describe("the skill's compositions", () => {
  it('each picks copies in the β-cell (an example that picks nothing misleads an agent)', () => {
    for (const c of MesoQLComposed) expect([c.text, lociSize(evalLoci(c.text, scene)!) > 0]).toEqual([c.text, true]);
  });
});

describe(':location on a superstructure compartment', () => {
  it('splits the granule compartment into its membrane and interior proteins', () => {
    const size = (q: string) => lociSize(evalLoci(q, scene)!);
    const all = size('(in c.isg)');
    expect(size('(in c.isg :location membrane)')).toBeGreaterThan(0);
    expect(size('(in c.isg :location interior)')).toBeGreaterThan(0);
    expect(size('(in c.isg :location membrane)') + size('(in c.isg :location interior)')).toBe(all);
  });
});

describe('the MesoQL eval questions', () => {
  it('are ten, with distinct addresses', () => {
    expect(MesoQLEvalQuestions).toHaveLength(10);
    expect(new Set(MesoQLEvalQuestions.map((q) => q.expect)).size).toBe(10);
  });

  it('cover population, entity, in, copies with a count, instance, and, or, not :in, within, part', () => {
    const heads = new Set(MesoQLEvalQuestions.flatMap((q) => [...q.expect.matchAll(/\((\w+)/g)].map((m) => m[1])));
    for (const s of ['population', 'entity', 'in', 'copies', 'instance', 'and', 'or', 'not', 'within', 'part'])
      expect([s, heads.has(s)]).toEqual([s, true]);
    expect(MesoQLEvalQuestions.some((q) => /\(copies \S+ \d+ \d+\)/.test(q.expect))).toBe(true);
    expect(MesoQLEvalQuestions.some((q) => /\(not .* :in /.test(q.expect))).toBe(true);
    expect(MesoQLEvalQuestions.some((q) => /\(in .* :(nested|location) /.test(q.expect))).toBe(true);
  });

  for (const q of MesoQLEvalQuestions)
    it(`${q.ask} → ${q.expect}`, () => {
      const r = parseMesoQL(q.expect, { kinds: scene.kinds }, undefined, 'selection');
      expect(r.issues.map((i) => i.code)).toEqual([]);
      expect(printMesoQL(r.expr!)).toBe(q.expect);
      expect(lociSize(evalLoci(q.expect, scene)!)).toBeGreaterThan(0);
    });
});

describe('answerMatches', () => {
  it('accepts equivalent spellings, tagged or not', () => {
    expect(answerMatches('(population p.Chga p.Scg2)', '(or (population p.Chga) (population p.Scg2))', scene)).toBe(
      true,
    );
    expect(answerMatches('Here it is: [MesoQL](entity e.ribosome)[/MesoQL]', '(population p.ribosomes)', scene)).toBe(
      true,
    );
  });

  it('rejects a near miss, an unreadable answer and two addresses', () => {
    const g12 = '(part (copies p.granules 12) p.Vamp2)';
    expect(answerMatches('(population p.Vamp2)', g12, scene)).toBe(false);
    expect(answerMatches('(part (copies p.granules 12) p.Vamp2', g12, scene)).toBe(false);
    expect(answerMatches(`[MesoQL]${g12}[/MesoQL] [MesoQL]${g12}[/MesoQL]`, g12, scene)).toBe(false);
  });
});
