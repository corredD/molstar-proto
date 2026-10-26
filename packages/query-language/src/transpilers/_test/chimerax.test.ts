/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { MolScriptBuilder as B } from '../../language/builder.js';
import { parseAtomSpec, transpiler } from '../chimerax/parser.js';
import { selectors } from '../chimerax/selectors.js';

// The grammar and its errors; what the specs select is checked against ChimeraX itself in
// model/src/script/_test/chimerax-oracle.test.ts.

const json = (s: string, modelId?: number[]) => JSON.stringify(transpiler(s, { modelId } as any));

describe('ChimeraX atom specs', () => {
  it('reads every form of the hierarchy', () => {
    for (const s of [
      '#1',
      '#1,3-5',
      '#1.2',
      '#!1',
      '#*',
      '#1/A',
      '/A,B',
      '/A-C',
      '/A:12-20',
      ':12A',
      ':start-20',
      ':-5--1',
      ':ALA,GLY',
      '@CA',
      '@C*',
      '@[NO]',
      "@O3'",
      '/A:12@CA,CB',
      '#1/A:12 :14',
      '/A /B',
    ]) {
      expect(() => transpiler(s), s).not.toThrow();
    }
  });

  it('reads attributes, zones, selectors and operators', () => {
    for (const s of [
      '@@bfactor>40',
      '@@bfactor',
      '@@^bfactor',
      '::name="HOH"',
      "::name='HOH'",
      '::name==hoh',
      '//chain_id=A',
      'ligand :<5',
      'ligand @>20',
      '(ligand) :<5',
      '~protein',
      'protein & /A | ligand',
      'C',
      'Zn',
      'min-backbone',
      'nucleic-acid',
    ]) {
      expect(() => transpiler(s), s).not.toThrow();
    }
  });

  it('groups & and | to the right, with one precedence, as ChimeraX', () => {
    // `a & b | c` is `a & (b | c)`: ChimeraX counts `protein & /A | ligand` as 1091 atoms of 1CBS, the protein alone.
    expect(json('protein & /A | ligand')).toBe(json('protein & (/A | ligand)'));
    expect(json('ligand | protein & /A')).toBe(json('ligand | (protein & /A)'));
  });

  it('matches a model term against the model the text is on (default #1)', () => {
    const empty = JSON.stringify(B.struct.generator.empty());
    expect(json('#2')).toBe(empty);
    expect(json('#2', [2])).not.toBe(empty);
    expect(json('#1-3', [2])).not.toBe(empty);
    expect(json('#1.1')).toBe(empty);
    expect(json('#!1', [1])).not.toBe(empty);
  });

  it('takes names from resolveName: named selections and sel', () => {
    const all = B.struct.generator.all();
    expect(transpiler('frozen & /A', { resolveName: (n) => (n === 'frozen' ? all : undefined) })).toBeTruthy();
    expect(() => transpiler('frozen')).toThrow('"frozen" is not a selector name');
  });

  it('says which selectors and attributes Mol* does not have', () => {
    expect(() => transpiler('aromatic')).toThrow(/aromatic chemical group\) is not supported/);
    expect(() => transpiler('Npl')).toThrow(/IDATM atom type\) is not supported/);
    expect(() => transpiler('@@idatm_type=C3')).toThrow(/'@@idatm_type' is not supported; @@ takes bfactor/);
    expect(() => transpiler('##name=1cbs')).toThrow(/model attributes \('##name'\) are not supported/);
    expect(() => transpiler(':ALA-GLY')).toThrow(/residue name range/);
    for (const [name, s] of Object.entries(selectors)) if (!s.map) expect(() => transpiler(name), name).toThrow();
  });

  it('reads element selectors with their case: C is carbon, c is no selector', () => {
    expect(() => transpiler('C')).not.toThrow();
    expect(() => transpiler('c')).toThrow('"c" is not a selector name');
  });
});

describe('parseAtomSpec: a spec at the start of a command', () => {
  const ends = (text: string) => {
    const p = parseAtomSpec(text);
    return [p.text, text.slice(p.end)];
  };

  it('ends where the spec stops reading, as ChimeraX: the rest is the command’s', () => {
    expect(ends('/A:12 red')).toEqual(['/A:12', ' red']);
    expect(ends('/A :12 red')).toEqual(['/A :12', ' red']);
    expect(ends('protein & /A target ac')).toEqual(['protein & /A', ' target ac']);
    expect(ends('#1 ligand red')).toEqual(['#1', ' ligand red']);
    expect(ends('ligand :<5 cartoons')).toEqual(['ligand :<5', ' cartoons']);
    expect(ends('/A:12;show')).toEqual(['/A:12', ';show']);
  });

  it('takes a quoted spec whole', () => {
    expect(ends('"/A :12" red')).toEqual(['"/A :12"', ' red']);
  });

  it('ends at the blank before a word it stopped inside', () => {
    // `/A:5-` stops after `/A:5`, inside the word: the spec is `#1`, and `/A:5-` is left to the command.
    expect(ends('#1 /A:5-')).toEqual(['#1', ' /A:5-']);
  });

  it('fails when no spec reads at the start', () => {
    expect(() => parseAtomSpec('red')).toThrow('"red" is not a selector name');
    expect(() => parseAtomSpec('')).toThrow('empty atom specifier');
  });
});
