/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { MolScriptBuilder as B } from '@molstar/query-language/language/builder';
import { ChimeraxCommands } from '../chimerax/commands.js';
import { chimeraxColor } from '../chimerax/colors.js';
import { ChimeraxCommandOrder, ChimeraxSubcommandOrder, resolveWord } from '../chimerax/names.js';
import { splitChimerax } from '../chimerax/tokenizer.js';
import { ChimeraxUnsupported } from '../chimerax/unsupported.js';
import { EmptyEnv, type ScriptEnv } from '../env.js';
import type { Command, Sel } from '../ir.js';
import { compileScript, dialectOfFile, dialectPrefix } from '../script.js';
import { selectionOn } from '../selection.js';

// ChimeraX's dialect (_spec §3.4, chimerax.md): the tokenizer, ChimeraX's own abbreviations, every table example, the
// unsupported commands, and what the main commands compile to.

const env: ScriptEnv = {
  ...EmptyEnv,
  objects: [
    { name: '1cbs', molecule: 0, model: 1 },
    { name: '1tqn', molecule: 1, model: 2 },
  ],
  nextMolecule: 2,
  files: ['model.pdb'],
};

const compile = (text: string, e: ScriptEnv = env) => compileScript(text, 'chimerax', e);

function ok(text: string, e: ScriptEnv = env): readonly Command[] {
  const r = compile(text, e);
  const errors = r.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) expect.fail(`${text}: ${errors.map((d) => `${d.code}: ${d.message}`).join('; ')}`);
  return r.commands;
}

function errorOf(text: string, e: ScriptEnv = env) {
  const r = compile(text, e);
  const d = r.diagnostics.find((x) => x.severity === 'error');
  if (!d) expect.fail(`${text}: no error`);
  return d;
}

const empty = JSON.stringify(B.struct.generator.empty());
const on = (s: Sel, object: string) => JSON.stringify(selectionOn(s, object));

describe('the ChimeraX tokenizer', () => {
  it('splits commands on ; and newlines; # where a command starts is a comment, elsewhere a model', () => {
    const { segments } = splitChimerax('open 1cbs; color #1 red\n# a comment; show\n  hide #1 models');
    expect(segments.map((s) => s.source)).toEqual(['open 1cbs', 'color #1 red', 'hide #1 models']);
  });

  it('takes a quote only where a word starts (an atom name keeps its prime)', () => {
    const { segments, diagnostics } = splitChimerax(`show @O3'; label :12 text "a; b"`);
    expect(segments.map((s) => s.source)).toEqual([`show @O3'`, 'label :12 text "a; b"']);
    expect(diagnostics).toEqual([]);
  });
});

describe('command names, as ChimeraX resolves them', () => {
  it('is the first command, in ChimeraX’s order, that starts with the word typed', () => {
    // ChimeraX 1.10: `sel` select, `col` color, `sh` shape (not show), `hi` hide, `tu` turn, `mo` movie, `v` vr.
    expect(resolveWord('sel', ChimeraxCommandOrder)).toBe('select');
    expect(resolveWord('col', ChimeraxCommandOrder)).toBe('color');
    expect(resolveWord('sh', ChimeraxCommandOrder)).toBe('shape');
    expect(resolveWord('sho', ChimeraxCommandOrder)).toBe('show');
    expect(resolveWord('hi', ChimeraxCommandOrder)).toBe('hide');
    expect(resolveWord('tu', ChimeraxCommandOrder)).toBe('turn');
    expect(resolveWord('mo', ChimeraxCommandOrder)).toBe('movie');
    expect(resolveWord('mm', ChimeraxCommandOrder)).toBe('mmaker');
    expect(resolveWord('cl', ChimeraxCommandOrder)).toBe('clip');
    expect(resolveWord('clo', ChimeraxCommandOrder)).toBe('close');
    expect(resolveWord('cart', ChimeraxCommandOrder)).toBe('cartoon');
    expect(resolveWord('cl', ChimeraxSubcommandOrder.select)).toBe('clear');
    expect(resolveWord('b', ChimeraxSubcommandOrder.color)).toBe('byattribute');
    expect(resolveWord('bf', ChimeraxSubcommandOrder.color)).toBe('bfactor');
  });

  it('runs abbreviated commands and subcommands', () => {
    expect(ok('sel /A:12-20')[0].kind).toBe('select');
    expect(ok('col /A red')[0].kind).toBe('color');
    expect(ok('sel cl')[0].kind).toBe('select.clear');
    expect(ok('cartoon h')[0]).toMatchObject({ kind: 'display', mode: 'hide' });
    expect(ok('color bf')[0]).toMatchObject({ kind: 'color', color: { theme: 'uncertainty' } });
  });

  it('says what an abbreviation means when ChimeraX reads it as another command', () => {
    const d = errorOf('sh ligand');
    expect(d.code).toBe('unsupported');
    expect(d.message).toContain('shape');
  });
});

describe('the table', () => {
  it('compiles every example (with 1cbs and 1tqn open as #1 and #2)', () => {
    for (const c of ChimeraxCommands) for (const e of c.examples) ok(e);
  });

  it('fails every listed unsupported command, saying so', () => {
    for (const u of ChimeraxUnsupported) {
      const d = errorOf(`${u.name} #1`);
      expect(d.code, u.name).toBe('unsupported');
      expect(ChimeraxCommandOrder.includes(u.name), `${u.name} is ChimeraX's`).toBe(true);
    }
  });

  it('fails any other ChimeraX command as unsupported, and a word ChimeraX lacks as unknown', () => {
    expect(errorOf('kvfinder').code).toBe('unsupported');
    const d = errorOf('shw ligand');
    expect(d.code).toBe('unknown-command');
    expect(d.hint).toBe('Did you mean show?');
  });

  it('names the other dialect a command is from, and what an abbreviation is in ChimeraX', () => {
    expect(errorOf('fetch 1cbs').hint).toContain('pymol fetch');
    expect(errorOf('mol addrep top').message).toContain("'mol' is ChimeraX’s molmap");
  });
});

describe('atom specs in commands', () => {
  it('reads a spec as far as it goes; the rest is the command’s (color /A :12 red)', () => {
    const [c] = ok('color /A :12 red');
    expect(c).toMatchObject({ kind: 'color', color: { rgb: 0xff0000 } });
    expect((c as { sel: Sel }).sel.text).toBe('/A :12');
  });

  it('matches model terms by the models’ ids', () => {
    const [c] = ok('show #2 cartoons');
    const s = (c as { sel: Sel }).sel;
    expect(on(s, '1tqn')).not.toBe(empty);
    expect(on(s, '1cbs')).toBe(empty);
  });

  it('gives an opened structure the lowest free model id', () => {
    const e = { ...env, objects: [{ name: '1tqn', molecule: 1, model: 2 }] };
    const cmds = ok('open 1cbs; color #1 red', e);
    expect(cmds[0]).toMatchObject({ kind: 'load', name: '1cbs', model: 1 });
    expect(on((cmds[1] as { sel: Sel }).sel, '1cbs')).not.toBe(empty);
  });

  it('says a word that is no spec, selector or name', () => {
    const d = errorOf('show frobnicate');
    expect(d.code).toBe('no-name');
  });

  it('reads sel as the selection, as the commands before leave it', () => {
    ok('show sel');
    const cmds = ok('select /A:12; show sel');
    const shown = cmds.find((c) => c.kind === 'display' && c.mode === 'show') as { sel: Sel };
    expect(on(shown.sel, '1cbs')).not.toBe(empty);
  });

  it('defines names that later specs use, and refuses a built-in selector as a name', () => {
    const cmds = ok('name site /A:45,60; color site red');
    expect(cmds[0]).toMatchObject({ kind: 'name.set', name: 'site' });
    expect(errorOf('name protein /A').message).toContain('selector');
  });
});

describe('what commands compile to', () => {
  it('show with a spec shows atoms; hide with none hides every atom', () => {
    expect(ok('show ligand')).toEqual([
      expect.objectContaining({ kind: 'display', mode: 'hide', reps: ['ball-and-stick', 'spheres', 'lines'] }),
      expect.objectContaining({ kind: 'display', mode: 'show', reps: ['sticks'] }),
    ]);
    expect(ok('hide')[0]).toMatchObject({
      kind: 'display',
      mode: 'hide',
      reps: ['sticks', 'ball-and-stick', 'spheres', 'lines'],
    });
  });

  it('show takes comma-separated targets and the target letters', () => {
    const kinds = ok('show /A atoms,cartoons').map((c) => (c.kind === 'display' ? `${c.mode} ${c.reps}` : c.kind));
    expect(kinds).toContain('show cartoon');
    expect(kinds).toContain('show sticks');
    expect(ok('hide /A target c')[0]).toMatchObject({ reps: ['cartoon', 'putty', 'tube', 'backbone'] });
    expect(ok('hide #1 models')[0]).toMatchObject({ kind: 'object.visibility', objects: ['1cbs'], visible: false });
  });

  it('shows atoms in the style set for them before', () => {
    const cmds = ok('style ligand ball; show ligand atoms');
    expect(cmds[0]).toMatchObject({ kind: 'atom-style', style: 'ball-and-stick' });
    const shows = cmds.filter((c) => c.kind === 'display' && c.mode === 'show') as {
      reps: string[];
      optional?: true;
    }[];
    expect(shows.map((s) => s.reps[0]).sort()).toEqual(['ball-and-stick', 'sticks']);
    expect(shows.every((s) => s.optional)).toBe(true);
  });

  it('transparency changes surfaces unless a target says', () => {
    expect(ok('transparency 50')[0]).toMatchObject({
      kind: 'transparency',
      alpha: 0.5,
      reps: ['surface', 'mesh', 'gaussian-surface'],
    });
    expect(ok('transparency /A 30 cartoons')[0]).toMatchObject({ reps: ['cartoon', 'putty', 'tube', 'backbone'] });
  });

  it('measures the atoms of a spec in the order written, or one spec of all of them', () => {
    const [d] = ok('angle :12@CA :13@CA :14@CA');
    expect(d).toMatchObject({ kind: 'measure', measure: 'angle' });
    expect((d as { atoms: Sel[] }).atoms).toHaveLength(3);
    expect((ok('distance sel')[0] as { atoms: Sel[] }).atoms).toHaveLength(1);
  });

  it('labels residues by default (name and number), atoms when asked', () => {
    expect(ok('label /A:45')[0]).toMatchObject({ kind: 'label', per: 'residue' });
    expect(ok('label /A:45 atoms')[0]).not.toHaveProperty('per');
    expect(ok('label :12 text "{0.name} {0.number}"')[0]).toMatchObject({
      text: [{ property: 'resn' }, { text: ' ' }, { property: 'resi' }],
    });
  });

  it('colors by ChimeraX’s names and forms, and by element with its colors', () => {
    expect(chimeraxColor('cornflower blue')).toBe(0x6495ed);
    expect(chimeraxColor('#f80')).toBe(0xff8800);
    expect(chimeraxColor('100,50,0')).toBe(0xff8000);
    expect(chimeraxColor('rgb(255, 0, 0)')).toBe(0xff0000);
    expect(ok('color /A cornflower blue')[0]).toMatchObject({ color: { rgb: 0x6495ed } });
    const het = ok('color ligand byhetero');
    expect(het[0].kind).toBe('require');
    expect(het.some((c) => c.kind === 'color' && c.sel.text.endsWith('& C'))).toBe(false);
  });

  it('matches keywords by prefix, any case when typed in lower case, as ChimeraX', () => {
    ok('set bgcolor white');
    ok('color /A red tar c');
    expect(errorOf('set BGCOLOR white').code).toBe('argument');
  });

  it('warns for keywords ChimeraX takes that change nothing here', () => {
    const r = compile('surface /A probeRadius 1.6');
    expect(r.diagnostics.map((d) => d.severity)).toEqual(['warning']);
  });

  it('runs .cxc scripts: open file.cxc includes one given with the submission', () => {
    const e = { ...env, scripts: new Map([['setup.cxc', 'color /A red']]) };
    expect(ok('open setup.cxc', e)[0]).toMatchObject({ kind: 'color', source: 'setup.cxc: color /A red' });
  });
});

describe('the dialect by its word and its files', () => {
  it('reads chimerax … as ChimeraX, and .cxc files', () => {
    expect(dialectPrefix('chimerax show ligand')).toMatchObject({ dialect: 'chimerax', rest: 'show ligand' });
    expect(dialectOfFile('setup.cxc')).toBe('chimerax');
  });
});

describe('fixes from the first review', () => {
  it('gives each word of one open its own model id and name (M2)', () => {
    const e = {
      ...env,
      objects: [
        { name: 'a', molecule: 0, model: 1 },
        { name: 'c', molecule: 1, model: 3 },
      ],
    };
    const loads = ok('open 1cbs 1tqn name x', e) as { model?: number; name: string }[];
    expect(loads.map((l) => l.model)).toEqual([2, 4]);
    expect(new Set(loads.map((l) => l.name)).size).toBe(2);
  });

  it('keeps a style without a spec to the models open now (M3)', () => {
    const cmds = ok('style sphere; open 1abc; show #3 atoms');
    const shows = cmds.filter((c) => c.kind === 'display' && c.mode === 'show') as { reps: string[]; sel: Sel }[];
    const spheres = shows.find((s) => s.reps[0] === 'spheres');
    if (spheres) expect(on(spheres.sel, '1abc')).toBe(empty);
  });

  it('forgets the styles of a model closed (M3)', () => {
    const cmds = ok('style #1 & ligand ball; close #1; open 1cbs; show ligand atoms');
    const shows = cmds.filter((c) => c.kind === 'display' && c.mode === 'show') as { reps: string[] }[];
    expect(shows.map((s) => s.reps[0])).toEqual(['sticks']);
  });

  it('reads only as a flag: it takes no value (M4)', () => {
    ok('show ligand only target a');
    expect(errorOf('show ligand only true').code).toBe('argument');
  });

  it('turns and moves by the amount each frame, as ChimeraX (S8)', () => {
    expect(ok('turn y 10 3')[0]).toMatchObject({ kind: 'camera.turn', angle: 30 });
    expect(ok('move x 2 5')[0]).toMatchObject({ kind: 'camera.move', distance: 10 });
  });

  it('reads enum words in any case, as ChimeraX (camera Ortho)', () => {
    expect(ok('camera Ortho')[0]).toMatchObject({ kind: 'canvas', projection: 'orthographic' });
  });
});
