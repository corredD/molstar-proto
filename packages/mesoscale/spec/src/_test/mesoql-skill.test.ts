/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { betaCellDoc } from '../examples/betacell.js';
import { MesoQLSymbols, parseMesoQL } from '../format/mesoql.js';
import {
  MesoQLComposed,
  MesoQLIssueCodes,
  mesoQLSignature,
  mesoQLSkill,
  mesoQLSkillFile,
} from '../format/mesoql-skill.js';
import { indexDoc } from '../format/validate.js';

// The MesoQL skill (design.md §3.8, §12.1): generated from MesoQLSymbols, kept equal to the committed reference.

describe('the skill', () => {
  it('is packages/mesoscale/_spec/reference/mesoql-skill.md (update with -u)', async () => {
    await expect(mesoQLSkillFile()).toMatchFileSnapshot('../../../_spec/reference/mesoql-skill.md');
  });

  it('lists every symbol by its signature, and the host line', () => {
    const skill = mesoQLSkill({ ids: 'Ids: p.granules (a population).' });
    expect(MesoQLSymbols.filter((s) => !skill.includes(mesoQLSignature(s))).map((s) => s.name)).toEqual([]);
    expect(skill).toContain('Ids: p.granules (a population).');
    expect(mesoQLSkill()).not.toContain('Ids:');
  });

  it("says a superstructure's copies are counted once, as the CLI counts them", () => {
    expect(mesoQLSkill()).toMatch(/counted once, as the template's, not once per instance/);
  });

  it('derives signatures from the table', () => {
    const sig = (n: string) => mesoQLSignature(MesoQLSymbols.find((s) => s.name === n)!);
    expect(sig('in')).toBe('(in c c... :nested b :location L)');
    expect(sig('copies')).toBe('(copies p start count?)');
    expect(sig('within')).toBe('(within Q :of Q :distance d)');
    expect(sig('all')).toBe('(all)');
  });

  it('every example and composition parses clean against the β-cell, as the type its head returns', () => {
    const ctx = { kinds: indexDoc(betaCellDoc()).kinds };
    const texts = [...MesoQLSymbols.map((s) => s.example), ...MesoQLComposed.map((c) => c.text)];
    for (const text of texts) {
      const r = parseMesoQL(text, {});
      expect([text, r.issues.map((i) => i.code)]).toEqual([text, []]);
    }
    for (const c of MesoQLComposed) {
      const r = parseMesoQL(c.text, ctx);
      expect([c.text, r.issues.map((i) => i.code)]).toEqual([c.text, []]);
    }
  });

  it('lists the codes the checker emits, one bad address each', () => {
    const ctx = { kinds: indexDoc(betaCellDoc()).kinds, sites: new Map([['e.Vamp2', ['s1']]]) };
    const bad: Record<string, string> = {
      'mesoql.syntax': '(entity e.Vamp2',
      'mesoql.form': 'e.Vamp2',
      'mesoql.symbol.unknown': '(frob e.Vamp2)',
      'mesoql.type': '(and (site e.Vamp2 s1))',
      'mesoql.keyword': '(all :frob 1)',
      'mesoql.range': '(residues e.Vamp2 :range x)',
      'mesoql.arity': '(copies p.granules)',
      'mesoql.argument': '(entity 5)',
      'mesoql.ref.missing': '(entity e.nope)',
      'mesoql.ref.kind': '(entity p.granules)',
      'mesoql.site': '(site e.Vamp2 nope)',
    };
    for (const { code } of MesoQLIssueCodes) {
      if (code === 'mesoql.empty') continue; // the runtime's, in ir/loci.ts
      const r = parseMesoQL(bad[code], ctx, undefined, code === 'mesoql.site' ? 'site' : undefined);
      expect([code, r.issues.map((i) => i.code)]).toEqual([code, expect.arrayContaining([code])]);
    }
    expect(Object.keys(bad).filter((c) => !MesoQLIssueCodes.some((x) => x.code === c))).toEqual([]);
  });
});
