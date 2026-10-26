/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { MolScriptBuilder as B } from '@molstar/query-language/language/builder';
import { transpiler as chimeraxTranspiler } from '@molstar/query-language/transpilers/chimerax/parser';
import { fail, note, type Span, warning } from '../diagnostics.js';
import { PdbIdHint, pdbId } from '../entries.js';
import type { AtomStyleEntry } from '../env.js';
import {
  type AtomStyle,
  AtomStyles,
  type ColorSpec,
  type CommandBody,
  type LabelPart,
  type LoadSource,
  type RepType,
  type Sel,
} from '../ir.js';
import { fixedTo, isEmptyPart, selAnd, selectionOn, selMinus, selOr } from '../selection.js';
import type { CommandHelp, Compiled, Compiler, ParamSpec } from '../table.js';
import { ChimeraxArgs, type Keywords, readBool } from './args.js';
import { ChimeraxElementColors } from './colors.js';

// ChimeraX's commands (chimerax.md §1, _spec §2): each its help, its positional arguments and keywords by ChimeraX's
// names, the keywords it takes that change nothing here, and how it compiles to the IR. `ChimeraxUnsupported` lists
// its commands Mol* does not do; any other ChimeraX command fails saying it is ChimeraX's (never a silent no-op).

export interface ChimeraxCommand extends CommandHelp {
  /** The positional arguments, in order (for help and completion; `compile` reads them). */
  readonly params: readonly ParamSpec[];
  readonly keywords?: Keywords;
  /** Keywords ChimeraX takes that change nothing here, with what to say (a warning when given). */
  readonly ignored?: Readonly<Record<string, string>>;
  compile(a: ChimeraxArgs, c: Compiler): Compiled;
}

const p = (name: string, kind: ParamSpec['kind'], optional = true, values?: readonly string[]): ParamSpec =>
  values ? { name, kind, optional, values } : { name, kind, optional };

const objects = (name = 'objects', optional = true) => p(name, 'selection', optional);

/** Every atom, as a selection. */
const All: Sel = { text: 'all', dialect: 'chimerax', parts: [{ scope: 'others', molql: B.struct.generator.all() }] };

/** The representations a ChimeraX target (`atoms`, `cartoons`, `surfaces`) is drawn with. */
const AtomTypes: readonly RepType[] = ['sticks', 'ball-and-stick', 'spheres', 'lines'];
const CartoonTypes: readonly RepType[] = ['cartoon', 'putty', 'tube', 'backbone'];
const SurfaceTypes: readonly RepType[] = ['surface', 'mesh', 'gaussian-surface'];

type Target = 'atoms' | 'cartoons' | 'surfaces' | 'models' | 'other';

const TargetWords = ['atoms', 'bonds', 'cartoons', 'ribbons', 'surfaces', 'models', 'pbonds', 'pseudobonds'];

/** What a `what` word or a `target` letter names. */
function targetOf(word: string): Target {
  switch (word) {
    case 'atoms':
    case 'bonds':
    case 'a':
    case 'b':
      return 'atoms';
    case 'cartoons':
    case 'ribbons':
    case 'c':
    case 'r':
      return 'cartoons';
    case 'surfaces':
    case 's':
      return 'surfaces';
    case 'models':
    case 'm':
      return 'models';
    default:
      return 'other';
  }
}

/** The targets of a command: its `what` words, else its `target` letters, else the default. */
function targetsOf(a: ChimeraxArgs, what: readonly string[] | undefined, def: readonly Target[]): Target[] {
  const out = new Set<Target>();
  if (what) for (const w of what) out.add(targetOf(w));
  if (a.has('target')) for (const ch of a.text('target')) out.add(targetOf(ch));
  if (!out.size) for (const t of def) out.add(t);
  if (out.has('other')) {
    a.c.report(
      warning('unsupported-argument', 'Pseudobonds are not drawn: they are left as they are.', a.at('target')),
    );
    out.delete('other');
  }
  return [...out];
}

const TypesOf: Readonly<Record<Exclude<Target, 'models' | 'other'>, readonly RepType[]>> = {
  atoms: AtomTypes,
  cartoons: CartoonTypes,
  surfaces: SurfaceTypes,
};

/** The objects a spec covers (`#1`, `#2-3`, `close #1`): those its part on them selects something. */
function objectsOf(sel: Sel, c: Compiler): string[] {
  return c.state.objects.filter((o) => !isEmptyPart(selectionOn(sel, o.name))).map((o) => o.name);
}

/**
 * The atoms of a selection by the style they are drawn in (_spec §5.4): an atom's style is the last `style` command's
 * that covers it, else stick. Each part may select nothing, so each display is optional.
 */
function byStyle(sel: Sel, styles: readonly AtomStyleEntry[]): { style: AtomStyle; sel: Sel }[] {
  if (!styles.length) return [{ style: 'sticks', sel }];
  // An entry's own atoms: the ones no later entry takes.
  const owned = styles.map((e, i) => {
    let own = selAnd(sel, e.sel);
    for (const later of styles.slice(i + 1)) own = selMinus(own, later.sel);
    return { style: e.style, sel: own };
  });
  let unstyled = sel;
  for (const e of styles) unstyled = selMinus(unstyled, e.sel);
  const out: { style: AtomStyle; sel: Sel }[] = [];
  for (const style of AtomStyles) {
    const mine = owned.filter((o) => o.style === style).map((o) => o.sel);
    if (style === 'sticks') mine.unshift(unstyled);
    if (!mine.length) continue;
    out.push({ style, sel: { ...mine.reduce((x, y) => selOr(x, y)), text: `${sel.text} (${styleWord(style)})` } });
  }
  return out;
}

const styleWord = (s: AtomStyle) => (s === 'sticks' ? 'stick' : s === 'ball-and-stick' ? 'ball' : 'sphere');

/** `show … atoms`: each style's atoms shown in it, and in no other atom style (an atom has one style). */
function showAtoms(sel: Sel, c: Compiler): CommandBody[] {
  const parts = byStyle(sel, c.state.atomStyles);
  const optional = parts.length > 1;
  const out: CommandBody[] = optional ? [{ kind: 'require', sel }] : [];
  for (const part of parts) {
    const others = AtomTypes.filter((t) => t !== part.style);
    out.push({ kind: 'display', mode: 'hide', reps: others, sel: part.sel, ...(optional ? { optional: true } : {}) });
    out.push({
      kind: 'display',
      mode: 'show',
      reps: [part.style],
      sel: part.sel,
      ...(optional ? { optional: true } : {}),
    });
  }
  return out;
}

/** `show` and `hide` for their targets. */
function showOrHide(verb: 'show' | 'hide', a: ChimeraxArgs, c: Compiler): Compiled {
  const spec = a.spec();
  const what = a.choices(TargetWords);
  const sel = spec?.sel ?? All;
  const targets = targetsOf(a, what?.values, ['atoms']);
  const only = verb === 'show' && a.bool('only', false);
  const out: CommandBody[] = [];
  for (const t of targets) {
    if (t === 'models') {
      const names = spec ? objectsOf(sel, c) : 'all';
      if (names !== 'all' && !names.length) fail('no-name', `'${sel.text}' names no model.`, a.here);
      out.push({ kind: 'object.visibility', objects: names, visible: verb === 'show' });
      continue;
    }
    if (t === 'other') continue;
    const types = TypesOf[t];
    if (only) out.push({ kind: 'display', mode: 'hide', reps: types, sel: selMinus(All, sel, `~(${sel.text})`) });
    if (verb === 'hide') out.push({ kind: 'display', mode: 'hide', reps: types, sel });
    else if (t === 'atoms') out.push(...showAtoms(sel, c));
    else out.push({ kind: 'display', mode: 'show', reps: [t === 'cartoons' ? 'cartoon' : 'surface'], sel });
  }
  return out;
}

const ShowKeywords: Keywords = { target: { kind: 'text' }, only: { kind: 'bool' } };

/** ChimeraX's element colors on the atoms of a selection: the ones other than carbon (`byhetero`), or all. */
const ElementList = ['C', 'N', 'O', 'S', 'P', 'H', 'F', 'CL', 'BR', 'I', 'SE', 'FE', 'ZN', 'MG', 'CA', 'NA', 'K'];
const ElementListMore = ['MN', 'CU', 'CO', 'NI', 'CD', 'HG', 'B', 'SI', 'LI', 'AL', 'AS', 'PT', 'AU', 'AG', 'W'];

function ofElement(s: Sel, element: string): Sel {
  const test = B.struct.generator.atomGroups({
    'atom-test': B.core.rel.eq([B.acp('elementSymbol'), B.es(element)]),
  });
  return {
    ...s,
    text: `${s.text} & ${element[0]}${element.slice(1).toLowerCase()}`,
    parts: s.parts.map((x) => ({ ...x, molql: B.struct.modifier.intersectBy({ 0: x.molql, by: test }) })),
  };
}

function byElement(s: Sel, carbons: boolean): CommandBody[] {
  const elements = [...ElementList, ...ElementListMore].filter((e) => carbons || e !== 'C');
  return [
    { kind: 'require', sel: s },
    ...elements.map(
      (e): CommandBody => ({
        kind: 'color',
        sel: ofElement(s, e),
        color: { rgb: ChimeraxElementColors.get(e)! },
        optional: true,
      }),
    ),
  ];
}

/** ChimeraX's palettes, as the PyMOL palettes the host knows (`color bfactor`, `rainbow`). */
const Palettes: Readonly<Record<string, string>> = {
  rainbow: 'rainbow',
  bluered: 'blue_white_red',
  'blue-white-red': 'blue_white_red',
  redblue: 'red_white_blue',
  'red-white-blue': 'red_white_blue',
  'blue-red': 'blue_red',
  'red-blue': 'red_blue',
};

function palette(a: ChimeraxArgs, def: string): string {
  if (!a.has('palette')) return def;
  const name = a.text('palette').toLowerCase();
  const known = Palettes[name];
  if (!known) {
    a.c.report(
      warning(
        'unsupported-argument',
        `The palette '${name}' is not one Mol* has: ${def.replace(/_/g, '-')} is used.`,
        a.at('palette'),
        `Palettes: ${Object.keys(Palettes).join(', ')}.`,
      ),
    );
    return def;
  }
  return known;
}

/** `color … bychain` and the other `by…` words: a theme, or per-element colors. */
const ColorWords = [
  'byatom',
  'bychain',
  'byelement',
  'byhetero',
  'byidentity',
  'bymodel',
  'bynucleotide',
  'bypolymer',
  'fromatoms',
  'fromcartoons',
  'fromribbons',
  'random',
];

function colorWord(word: string, sel: Sel, at: Span, c: Compiler): Compiled {
  switch (word) {
    case 'byatom':
    case 'byelement':
      return byElement(sel, true);
    case 'byhetero':
      return byElement(sel, false);
    case 'bychain':
      c.report(note('Mol* colors the chains with its own palette, not ChimeraX’s.', at));
      return [{ kind: 'color', sel, color: { theme: 'chain-id' } }];
    case 'bypolymer':
      return [{ kind: 'color', sel, color: { theme: 'polymer-id' } }];
    case 'byidentity':
      return [{ kind: 'color', sel, color: { theme: 'entity-id' } }];
    case 'bymodel':
      return [{ kind: 'color', sel, color: { theme: 'model-index' } }];
    default:
      return fail(
        'unsupported',
        `color ${word} is not supported.`,
        at,
        'Use a color, byhetero, byelement, bychain, bypolymer, byidentity or bymodel.',
      );
  }
}

/** The transparency of a `color … transparency n` or `surface … transparency n`, in percent. */
function transparencyOf(a: ChimeraxArgs, sel: Sel, reps?: readonly RepType[]): CommandBody[] {
  if (!a.has('transparency')) return [];
  const percent = a.num('transparency');
  return [{ kind: 'transparency', sel, alpha: clamp01(percent / 100), ...(reps ? { reps } : {}) }];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** ChimeraX's default sizes, against which a size is a factor (stick radius 0.2 Å, ball scale 0.25). */
const DefaultStickRadius = 0.2;
const DefaultBallScale = 0.25;
const DefaultAtomRadius = 1.7;

/** A size: a number, `default`, or a change (`+0.1`) of the default, said. */
function sizeOf(a: ChimeraxArgs, keyword: string, def: number): number {
  const t = a.text(keyword).toLowerCase();
  if (t === 'default') return def;
  const v = Number(t);
  if (!Number.isFinite(v))
    fail('argument', `${keyword} is a number, 'default' or +/- a change, not '${t}'.`, a.at(keyword));
  if (/^[+-]/.test(t)) {
    a.c.report(note(`${keyword} ${t} changes the default size: Mol* does not read the size it is now.`, a.at(keyword)));
    return Math.max(0, def + v);
  }
  return v;
}

/** `{0.name} {0.number}`, `ALA` …: a label's text as literals and properties. */
const LabelAttributes: Readonly<Record<string, LabelPart>> = {
  name: { property: 'name' },
  number: { property: 'resi' },
  chain_id: { property: 'chain' },
  element: { property: 'elem' },
  bfactor: { property: 'b' },
  serial_number: { property: 'index' },
};

function labelText(text: string, per: 'atom' | 'residue', at: Span): LabelPart[] {
  const out: LabelPart[] = [];
  const re = /\{0\.([a-z_]+)\}/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push(labelAttribute(m[1], per, at));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

function labelAttribute(name: string, per: 'atom' | 'residue', at: Span): LabelPart {
  if (name === 'name') return { property: per === 'residue' ? 'resn' : 'name' };
  const part = LabelAttributes[name];
  if (!part) {
    fail(
      'unsupported',
      `The label attribute '${name}' is not one Mol* writes.`,
      at,
      `Labels take ${Object.keys(LabelAttributes).join(', ')}.`,
    );
  }
  return part;
}

/** A camera axis: x, y or z (a vector of one is read as its axis). */
function axisOf(text: string, at: Span): 'x' | 'y' | 'z' {
  const t = text.trim().toLowerCase();
  if (t === 'x' || t === 'y' || t === 'z') return t;
  const v = t.split(',').map(Number);
  if (v.length === 3 && v.every(Number.isFinite)) {
    const nonzero = v.map((x, i) => (x !== 0 ? i : -1)).filter((i) => i >= 0);
    if (nonzero.length === 1) return (['x', 'y', 'z'] as const)[nonzero[0]];
  }
  return fail('unsupported-argument', `The axis '${text}' is not supported.`, at, 'Give x, y or z.');
}

/** A load from a word of `open`: an entry (`1cbs`, `pdb:1cbs`, `alphafold:P69905`), a URL, or a file given. */
function loadOf(word: string, at: Span, a: ChimeraxArgs, c: Compiler, i: number): CommandBody {
  const db = a.has('fromDatabase') ? a.text('fromDatabase').toLowerCase() : undefined;
  const [prefix, rest] = word.includes(':') && !/^[a-z]+:\/\//i.test(word) ? word.split(/:(.*)/s) : [db, word];
  const model = c.state.nextModel() + i;
  const name = (wish: string) => c.state.freeName(a.has('name') ? a.text('name') : wish);
  const load = (from: LoadSource, wish: string): CommandBody => ({
    kind: 'load',
    from,
    name: name(wish),
    molecule: c.state.nextMolecule + i,
    model,
    look: 'default',
    copy: true,
    ...(a.has('format') ? { format: formatOf(a.text('format')) } : {}),
  });
  const source = prefix?.toLowerCase();
  if (source === 'alphafold' || source === 'afdb') {
    const id = rest
      .toUpperCase()
      .replace(/^AF-/, '')
      .replace(/-F1(-MODEL_V\d+)?$/, '');
    return load({ entry: { db: 'afdb', id: `AF-${id}-F1` } }, id.toLowerCase());
  }
  if (source === 'pdb' || (!source && pdbId(word))) {
    const id = pdbId(source ? rest : word);
    if (!id) fail('argument', `'${rest}' is not a PDB id.`, at, PdbIdHint);
    return load({ entry: { db: 'pdb', id: id! } }, id!);
  }
  if (source && source !== 'http' && source !== 'https' && source !== 'ftp') {
    return fail(
      'unsupported',
      `Opening from ${source} is not supported.`,
      at,
      'Mol* opens PDB entries (1cbs, pdb:1cbs), AlphaFold DB models (alphafold:P69905), URLs and files given.',
    );
  }
  if (/^(https?|ftp):\/\//i.test(word)) return load({ url: word }, stem(word));
  if (!c.state.files.some((f) => f === word || f.split('/').pop() === word.split('/').pop())) {
    fail(
      'no-name',
      `There is no file '${word}' with this script.`,
      at,
      c.state.files.length
        ? `Files given: ${c.state.files.join(', ')}.`
        : 'Open the file with the script (drop both), give a URL or a PDB id.',
    );
  }
  return load({ file: word }, stem(word));
}

const stem = (file: string) => (file.split(/[\\/]/).pop() ?? file).replace(/\.(gz|zip)$/i, '').replace(/\.[^.]+$/, '');

/** ChimeraX's format names, as Mol*'s. */
function formatOf(f: string): string {
  const t = f.toLowerCase();
  return t === 'mmcif' || t === 'cif' ? 'mmcif' : t === 'pdb' ? 'pdb' : t;
}

const Frames = 'Mol* moves at once: frames are ignored.';

export const ChimeraxCommands: readonly ChimeraxCommand[] = [
  {
    name: 'open',
    summary: 'Open a PDB entry (1cbs, pdb:1cbs), an AlphaFold DB model (alphafold:P69905), a URL or a file given.',
    usage: 'open names [format f] [fromDatabase db] [name n]',
    params: [p('names', 'file', false)],
    keywords: { format: { kind: 'text' }, fromDatabase: { kind: 'text' }, name: { kind: 'name' } },
    ignored: {
      maxModels: 'Every model loads, as a trajectory.',
      coordsets: 'Models load as a trajectory.',
      ignoreCache: 'Mol* reads the entry as the server gives it.',
      structureFactors: 'Maps are not opened (volumes come later).',
      alignment: 'Sequence alignments are not opened.',
    },
    examples: ['open 1cbs', 'open pdb:1tqn', 'open alphafold:P69905', 'open 1cbs format mmcif'],
    compile(a, c) {
      const words = [];
      for (let w = a.word(); w; w = a.word()) words.push(w);
      if (!words.length) fail('argument', 'open needs what to open.', a.here, 'Give a PDB id: open 1cbs.');
      a.done();
      return words.map((w, i) => loadOf(w.text, w.at, a, c, i));
    },
  },
  {
    name: 'close',
    summary: 'Close models (structures); no models: everything. `close session` also forgets the names.',
    usage: 'close [models]',
    params: [objects('models')],
    examples: ['close', 'close #1', 'close #2-3'],
    compile(a, c) {
      const spec = a.spec();
      a.done();
      if (!spec) return [{ kind: 'object.remove', objects: 'all' }];
      const names = objectsOf(spec.sel, c);
      if (!names.length) fail('no-name', `'${spec.sel.text}' names no model.`, a.here, modelsHint(c));
      return [{ kind: 'object.remove', objects: names }];
    },
  },
  {
    name: 'close session',
    summary: 'Close everything, and forget the names and styles.',
    usage: 'close session',
    params: [],
    examples: ['close session'],
    compile(a) {
      a.done();
      return [
        { kind: 'object.remove', objects: 'all' },
        { kind: 'name.remove', names: 'all' },
        { kind: 'atom-style', sel: All, style: 'sticks' },
      ];
    },
  },
  ...(['show', 'display'] as const).map(
    (name): ChimeraxCommand => ({
      name,
      summary: 'Show atoms (in their style), cartoons, surfaces or models; no objects: everything.',
      usage: `${name} [objects] [atoms|cartoons|surfaces|models,…] [target acsm] [only]`,
      params: [objects(), p('what', 'enum', true, TargetWords)],
      keywords: ShowKeywords,
      examples: [`${name} ligand`, `${name} /A:12-20 atoms`, `${name} protein cartoons`, `${name} ligand atoms only`],
      compile: (a, c) => showOrHide('show', a, c),
    }),
  ),
  ...(['hide', '~show', '~display'] as const).map(
    (name): ChimeraxCommand => ({
      name,
      summary: 'Hide atoms, cartoons, surfaces or models; no objects: every atom.',
      usage: `${name} [objects] [atoms|cartoons|surfaces|models,…] [target acsm]`,
      params: [objects(), p('what', 'enum', true, TargetWords)],
      keywords: { target: { kind: 'text' } },
      examples: [`${name}`, `${name} solvent`, `${name} /B cartoons`, `${name} #1 models`],
      compile: (a, c) => showOrHide('hide', a, c),
    }),
  ),
  {
    name: 'style',
    summary: 'Draw atoms as sticks, balls or spheres (now and when they are shown later).',
    usage: 'style [objects] [stick|ball|sphere]',
    params: [objects(), p('atomStyle', 'enum', true, ['stick', 'ball', 'sphere'])],
    ignored: { dashes: 'Bonds are drawn whole.', ringFill: 'Rings are not filled.' },
    examples: ['style stick', 'style ligand ball', 'style ions sphere'],
    compile(a, c) {
      const spec = a.spec();
      const word = a.choice(['stick', 'ball', 'sphere']);
      a.done();
      if (!word) {
        c.report(note('style without a style changes nothing: give stick, ball or sphere.', a.here));
        return [];
      }
      const style: AtomStyle = word.value === 'stick' ? 'sticks' : word.value === 'ball' ? 'ball-and-stick' : 'spheres';
      const sel = spec
        ? fixedTo(
            spec.sel,
            c.state.objects.map((o) => o.name),
          )
        : All;
      return [{ kind: 'atom-style', sel, style }];
    },
  },
  ...(['cartoon', 'ribbon'] as const).map(
    (name): ChimeraxCommand => ({
      name,
      summary: 'Show cartoons (polymers only).',
      usage: `${name} [atoms]`,
      params: [objects('atoms')],
      ignored: {
        smooth: 'Mol* smooths cartoons its own way.',
        suppressBackboneDisplay: 'Atoms shown stay shown.',
        spine: 'Mol* draws no spine.',
      },
      examples: [name, `${name} /A`],
      compile(a) {
        const spec = a.spec();
        a.done();
        return [{ kind: 'display', mode: 'show', reps: ['cartoon'], sel: spec?.sel ?? All }];
      },
    }),
  ),
  ...(['cartoon hide', '~cartoon', '~ribbon'] as const).map(
    (name): ChimeraxCommand => ({
      name,
      summary: 'Hide cartoons.',
      usage: `${name} [atoms]`,
      params: [objects('atoms')],
      examples: [name, `${name} /B`],
      compile(a) {
        const spec = a.spec();
        a.done();
        return [{ kind: 'display', mode: 'hide', reps: CartoonTypes, sel: spec?.sel ?? All }];
      },
    }),
  ),
  {
    name: 'cartoon style',
    summary: 'Draw cartoons as worms (Mol*’s putty) or not.',
    usage: 'cartoon style [atoms] [worm true|false]',
    params: [objects('atoms')],
    keywords: { worm: { kind: 'bool' } },
    ignored: Object.fromEntries(
      [
        'width',
        'thickness',
        'arrows',
        'arrowsHelix',
        'arrowScale',
        'xsection',
        'sides',
        'divisions',
        'barScale',
        'barSides',
        'ssEnds',
        'modeHelix',
        'modeStrand',
        'radius',
        'splineNormals',
      ].map((k) => [k, 'Mol* draws cartoons its own way.']),
    ),
    examples: ['cartoon style worm true', 'cartoon style /A worm false'],
    compile(a) {
      const spec = a.spec();
      a.done();
      if (!a.has('worm')) {
        a.c.report(note('cartoon style changes nothing here but worm: Mol* draws cartoons its own way.', a.here));
        return [];
      }
      return [{ kind: 'cartoon', style: a.bool('worm', false) ? 'putty' : 'automatic', sel: spec?.sel ?? All }];
    },
  },
  {
    name: 'surface',
    summary: 'Show molecular surfaces (Mol*’s: of the atoms given).',
    usage: 'surface [atoms] [color c] [transparency percent]',
    params: [objects('atoms')],
    keywords: { color: { kind: 'color' }, transparency: { kind: 'number' } },
    ignored: {
      enclose: 'Mol* makes the surface of the atoms given.',
      include: 'Mol* makes the surface of the atoms given.',
      probeRadius: 'Mol*’s probe radius applies.',
      gridSpacing: 'Mol*’s resolution applies.',
      resolution: 'Mol*’s molecular surface is drawn.',
      level: 'Mol*’s molecular surface is drawn.',
      visiblePatches: 'The whole surface shows.',
      sharpBoundaries: 'Mol*’s surface applies.',
      nthread: 'Mol* computes in its own way.',
      replace: 'A surface is added to what shows.',
      update: 'Surfaces follow their atoms.',
    },
    examples: ['surface', 'surface /A', 'surface ligand :<5 transparency 50'],
    compile(a) {
      const spec = a.spec();
      a.done();
      const sel = spec?.sel ?? All;
      const out: CommandBody[] = [{ kind: 'display', mode: 'show', reps: ['surface'], sel }];
      const color = a.colorOf('color');
      if (color !== undefined) {
        a.c.report(
          warning('unsupported-argument', 'Mol* colors the atoms, so their other representations too.', a.at('color')),
        );
        out.push({ kind: 'color', sel, color: { rgb: color } });
      }
      out.push(...transparencyOf(a, sel, SurfaceTypes));
      return out;
    },
  },
  ...(['surface hidePatches', 'surface close', '~surface'] as const).map(
    (name): ChimeraxCommand => ({
      name,
      summary: 'Hide molecular surfaces.',
      usage: `${name} [atoms]`,
      params: [objects('atoms')],
      examples: [name, `${name} /A`],
      compile(a) {
        const spec = a.spec();
        a.done();
        return [{ kind: 'display', mode: 'hide', reps: SurfaceTypes, sel: spec?.sel ?? All }];
      },
    }),
  ),
  {
    name: 'surface style',
    summary: 'Draw surfaces solid, as a mesh, or as dots.',
    usage: 'surface style [atoms] solid|mesh|dot',
    params: [objects('atoms'), p('style', 'enum', false, ['solid', 'mesh', 'dot'])],
    examples: ['surface style mesh', 'surface style /A solid'],
    compile(a) {
      const spec = a.spec();
      const style = a.choice(['solid', 'mesh', 'dot']);
      a.done();
      if (!style) return fail('argument', 'surface style needs solid, mesh or dot.', a.here);
      const sel = spec?.sel ?? All;
      const to: RepType = style.value === 'mesh' ? 'mesh' : style.value === 'dot' ? 'points' : 'surface';
      return [
        { kind: 'display', mode: 'hide', reps: SurfaceTypes.filter((t) => t !== to), sel },
        { kind: 'display', mode: 'show', reps: [to], sel },
      ];
    },
  },
  {
    name: 'color',
    summary:
      'Color objects: a ChimeraX color name, #rrggbb or r,g,b; byhetero, byelement, bychain, bypolymer, byidentity, bymodel.',
    usage: 'color [objects] [color [what]] [target acsr] [transparency percent]',
    params: [objects(), p('color', 'color', true, ColorWords), p('what', 'enum', true, TargetWords)],
    keywords: { target: { kind: 'text' }, transparency: { kind: 'number' } },
    ignored: { halfbond: 'Bonds take their atoms’ colors.' },
    examples: ['color red', 'color /A cornflower blue', 'color ligand byhetero', 'color bychain', 'color #1 #ff8800'],
    compile(a, c) {
      const spec = a.spec();
      const sel = spec?.sel ?? All;
      const word = a.choice(ColorWords);
      const color = word ? undefined : a.color();
      const what = a.choices([...TargetWords, 'labels', 'rings', 'All']);
      a.done();
      if (!word && !color) {
        return fail(
          'argument',
          'color needs a color.',
          a.here,
          'A name (red, cornflower blue), #rrggbb, r,g,b, or byhetero, bychain.',
        );
      }
      if (what || a.has('target')) {
        const all = what?.values.includes('All') || a.text('target') === 'All';
        if (!all) {
          c.report(
            warning(
              'unsupported-argument',
              'Mol* colors the atoms, so every representation of them: the target is ignored.',
              what?.at ?? a.at('target'),
            ),
          );
        }
      }
      const out: CommandBody[] = word
        ? [...colorWord(word.value, sel, word.at, c)]
        : [{ kind: 'color', sel, color: { rgb: color!.value } }];
      out.push(...transparencyOf(a, sel));
      return out;
    },
  },
  ...(['color bfactor', 'color byattribute'] as const).map(
    (name): ChimeraxCommand => ({
      name,
      summary: 'Color by B-factor along a palette (bluered by default).',
      usage:
        name === 'color bfactor'
          ? 'color bfactor [atoms] [palette p]'
          : 'color byattribute bfactor [atoms] [palette p]',
      params:
        name === 'color bfactor' ? [objects('atoms')] : [p('attrName', 'enum', false, ['bfactor']), objects('atoms')],
      keywords: { palette: { kind: 'enum', values: Object.keys(Palettes) }, target: { kind: 'text' } },
      ignored: {
        range: 'The range is the data’s.',
        average: 'Atoms are colored one by one.',
        noValueColor: 'Every atom has a B-factor.',
        key: 'No color key is drawn.',
        logInfo: 'Mol* says what it did.',
        transparency: 'Use transparency.',
      },
      examples:
        name === 'color bfactor'
          ? ['color bfactor', 'color bfactor /A palette rainbow']
          : ['color byattribute bfactor'],
      compile(a) {
        if (name === 'color byattribute') {
          const attr = a.word();
          if (!attr || attr.text.toLowerCase() !== 'bfactor') {
            fail(
              'unsupported',
              `Coloring by '${attr?.text ?? ''}' is not supported.`,
              attr?.at ?? a.here,
              'Color by bfactor.',
            );
          }
        }
        const spec = a.spec();
        a.done();
        const color: ColorSpec = { theme: 'uncertainty', params: { palette: palette(a, 'blue_white_red') } };
        return [{ kind: 'color', sel: spec?.sel ?? All, color }];
      },
    }),
  ),
  {
    name: 'rainbow',
    summary: 'Color residues along a rainbow per chain (or chains, polymers).',
    usage: 'rainbow [objects] [residues|chains|polymers] [palette p]',
    params: [objects(), p('level', 'enum', true, ['residues', 'chains', 'polymers', 'structures'])],
    keywords: { palette: { kind: 'enum', values: Object.keys(Palettes) }, target: { kind: 'text' } },
    ignored: { transparency: 'Use transparency.' },
    examples: ['rainbow', 'rainbow /A', 'rainbow chains'],
    compile(a) {
      const spec = a.spec();
      const level = a.choice(['residues', 'chains', 'polymers', 'structures']);
      a.done();
      const theme =
        level?.value === 'chains'
          ? 'chain-id'
          : level?.value === 'polymers'
            ? 'polymer-id'
            : level?.value === 'structures'
              ? 'model-index'
              : 'sequence-id';
      const pal = palette(a, 'rainbow');
      const color: ColorSpec = pal === 'rainbow' ? { theme } : { theme, params: { palette: pal } };
      return [{ kind: 'color', sel: spec?.sel ?? All, color }];
    },
  },
  {
    name: 'transparency',
    summary: 'Make objects transparent, in percent (surfaces unless a target says).',
    usage: 'transparency [objects] percent [what] [target acsr]',
    params: [objects(), p('percent', 'number', false), p('what', 'enum', true, [...TargetWords, 'All'])],
    keywords: { target: { kind: 'text' } },
    examples: ['transparency 50', 'transparency /A 30 cartoons', 'transparency ligand 70 target a'],
    compile(a) {
      const spec = a.spec();
      const percent = a.number();
      if (!percent) return fail('argument', 'transparency needs a percent.', a.here, 'transparency 50');
      const what = a.choices([...TargetWords, 'All']);
      a.done();
      const all = what?.values.includes('All') || a.text('target') === 'All';
      const targets = all ? [] : targetsOf(a, what?.values, ['surfaces']).filter((t) => t !== 'models');
      const reps = all ? undefined : targets.flatMap((t) => (t === 'other' ? [] : TypesOf[t]));
      return [
        { kind: 'transparency', sel: spec?.sel ?? All, alpha: clamp01(percent.value / 100), ...(reps ? { reps } : {}) },
      ];
    },
  },
  {
    name: 'size',
    summary: 'Size sticks (stickRadius), balls (ballScale) or atoms (atomRadius), as factors of ChimeraX’s defaults.',
    usage: 'size [objects] [atomRadius r] [stickRadius r] [ballScale s]',
    params: [objects()],
    keywords: { atomRadius: { kind: 'text' }, stickRadius: { kind: 'text' }, ballScale: { kind: 'text' } },
    ignored: { pseudobondRadius: 'Pseudobonds are not drawn.' },
    examples: ['size stickRadius 0.4', 'size ligand ballScale 0.4', 'size ions atomRadius 2'],
    compile(a) {
      const spec = a.spec();
      a.done();
      const sel = spec?.sel ?? All;
      const out: CommandBody[] = [];
      if (a.has('stickRadius')) {
        out.push({
          kind: 'size',
          sel,
          factor: sizeOf(a, 'stickRadius', DefaultStickRadius) / DefaultStickRadius,
          reps: ['sticks'],
        });
      }
      if (a.has('ballScale')) {
        out.push({
          kind: 'size',
          sel,
          factor: sizeOf(a, 'ballScale', DefaultBallScale) / DefaultBallScale,
          reps: ['ball-and-stick'],
        });
      }
      if (a.has('atomRadius')) {
        out.push({
          kind: 'size',
          sel,
          factor: sizeOf(a, 'atomRadius', DefaultAtomRadius) / DefaultAtomRadius,
          reps: ['spheres'],
        });
      }
      if (!out.length)
        fail('argument', 'size needs stickRadius, ballScale or atomRadius.', a.here, 'size stickRadius 0.4');
      return out;
    },
  },
  {
    name: 'select',
    summary: 'Select objects (`sel` names the selection afterwards).',
    usage: 'select [objects]',
    params: [objects()],
    ignored: {
      residues: 'The atoms given are selected.',
      minimumLength: 'Secondary structure lengths are not filtered.',
      maximumLength: 'Secondary structure lengths are not filtered.',
      sequence: 'Sequences are not searched.',
    },
    examples: ['select /A:12-20', 'select ligand', 'select ligand :<5'],
    compile(a) {
      const spec = a.spec();
      a.done();
      return [{ kind: 'select', mode: 'set', sel: spec?.sel ?? All }];
    },
  },
  ...(
    [
      ['select add', 'add', 'Add objects to the selection.'],
      ['select subtract', 'remove', 'Take objects out of the selection.'],
      ['~select', 'remove', 'Take objects out of the selection (no objects: clear it).'],
    ] as const
  ).map(
    ([name, mode, summary]): ChimeraxCommand => ({
      name,
      summary,
      usage: `${name} [objects]`,
      params: [objects()],
      ignored: { residues: 'The atoms given are selected.' },
      examples: [`${name} :30-40`],
      compile(a) {
        const spec = a.spec();
        a.done();
        if (!spec)
          return name === '~select' ? [{ kind: 'select.clear' }] : fail('argument', `${name} needs objects.`, a.here);
        return [{ kind: 'select', mode, sel: spec.sel }];
      },
    }),
  ),
  {
    name: 'select clear',
    summary: 'Clear the selection.',
    usage: 'select clear',
    params: [],
    examples: ['select clear'],
    compile(a) {
      a.done();
      return [{ kind: 'select.clear' }];
    },
  },
  {
    name: 'name',
    summary: 'Name an atom spec, used as a selector after (re-read with the models there are then).',
    usage: 'name name spec',
    params: [p('name', 'name', false), objects('spec', false)],
    examples: ['name site /A:45,60,88', 'name lig ligand'],
    compile(a, c) {
      const w = a.word();
      if (!w) return fail('argument', 'name needs a name and an atom spec.', a.here, 'name site /A:45,60');
      checkName(w.text, w.at);
      const spec = a.requiredSpec();
      a.done();
      return [{ kind: 'name.set', name: w.text, sel: { ...spec.sel, text: spec.sel.text } }];
    },
  },
  {
    name: 'name frozen',
    summary: 'Name the atoms an atom spec selects now (later models are not in it).',
    usage: 'name frozen name spec',
    params: [p('name', 'name', false), objects('spec', false)],
    examples: ['name frozen pocket ligand :<5'],
    compile(a, c) {
      const w = a.word();
      if (!w) return fail('argument', 'name frozen needs a name and an atom spec.', a.here);
      checkName(w.text, w.at);
      const spec = a.requiredSpec();
      a.done();
      return [
        {
          kind: 'name.set',
          name: w.text,
          sel: fixedTo(
            spec.sel,
            c.state.objects.map((o) => o.name),
          ),
        },
      ];
    },
  },
  {
    name: 'name delete',
    summary: 'Forget a name (`all`: every one).',
    usage: 'name delete name',
    params: [p('name', 'name', false)],
    examples: ['name delete all'],
    compile(a, c) {
      const w = a.word();
      a.done();
      if (!w) return fail('argument', 'name delete needs a name.', a.here);
      if (w.text === 'all') return [{ kind: 'name.remove', names: 'all' }];
      const named = c.state.name(w.text);
      if (!named) return fail('no-name', `No name '${w.text}'.`, w.at, namesHint(c));
      return [{ kind: 'name.remove', names: [named.name] }];
    },
  },
  {
    name: 'name list',
    summary: 'List the names.',
    usage: 'name list',
    params: [],
    ignored: { builtins: 'The built-in selectors are in `help` (chimerax.md §3).' },
    examples: ['name list'],
    compile(a) {
      a.done();
      return [{ kind: 'read', read: { kind: 'names' } }];
    },
  },
  {
    name: 'view',
    summary: 'Frame objects (no objects: everything); `view orient` orients along the principal axes.',
    usage: 'view [objects] [orient] [pad fraction]',
    params: [objects(), p('orient', 'enum', true, ['orient'])],
    keywords: { pad: { kind: 'number' } },
    ignored: {
      clip: 'Mol* keeps its clipping.',
      cofr: 'Mol* turns about the view’s center.',
      zalign: 'The view is not aligned.',
      inFrontOf: 'The view is not aligned.',
      frames: Frames,
    },
    examples: ['view', 'view ligand', 'view orient', 'view /A:45-60 pad 0.2'],
    compile(a, c) {
      const spec = a.spec();
      const orient = a.choice(['orient']);
      if (!spec && !orient) {
        const w = a.peek();
        if (w && !a.atKeyword()) {
          fail('unsupported', `Named views ('${w.text}') are not supported.`, w.at, 'Mol*’s snapshots keep views.');
        }
      }
      a.done();
      if (a.has('pad')) c.report(note('pad is ignored: Mol* frames with its own margin.', a.at('pad')));
      if (orient) return [{ kind: 'camera', action: 'orient', ...(spec ? { sel: spec.sel } : {}), animate: true }];
      if (!spec) return [{ kind: 'camera', action: 'frame', animate: true }];
      return [{ kind: 'camera', action: 'frame', sel: spec.sel, animate: true }];
    },
  },
  {
    name: 'turn',
    summary: 'Turn the scene about a screen axis, in degrees (no arguments: 90° about y).',
    usage: 'turn [axis [angle [frames]]]',
    params: [p('axis', 'enum', true, ['x', 'y', 'z']), p('angle', 'number'), p('frames', 'int')],
    ignored: { coordinateSystem: 'The screen’s axes apply.', center: 'Mol* turns about the view’s center.' },
    examples: ['turn', 'turn y 90', 'turn x -45'],
    compile(a, c) {
      const axisWord = a.word();
      const angle = a.number();
      const frames = a.number();
      a.done();
      for (const k of ['models', 'atoms', 'rock', 'wobble']) {
        if (a.has(k)) fail('unsupported-argument', `turn ${k} is not supported: Mol* turns the view.`, a.at(k));
      }
      if (frames && frames.value > 1) c.report(note(Frames, frames.at));
      const axis = axisWord ? axisOf(axisWord.text, axisWord.at) : 'y';
      return [{ kind: 'camera.turn', axis, angle: angle?.value ?? 90 }];
    },
    keywords: { models: { kind: 'text' }, atoms: { kind: 'text' }, rock: { kind: 'int' }, wobble: { kind: 'int' } },
  },
  {
    name: 'move',
    summary: 'Move the scene along a screen axis, in Ångströms.',
    usage: 'move axis [distance [frames]]',
    params: [p('axis', 'enum', false, ['x', 'y', 'z']), p('distance', 'number'), p('frames', 'int')],
    keywords: { models: { kind: 'text' }, atoms: { kind: 'text' } },
    ignored: { coordinateSystem: 'The screen’s axes apply.' },
    examples: ['move x 5', 'move z -10'],
    compile(a, c) {
      const axisWord = a.word();
      if (!axisWord) return fail('argument', 'move needs an axis.', a.here, 'move x 5');
      const distance = a.number();
      const frames = a.number();
      a.done();
      for (const k of ['models', 'atoms']) {
        if (a.has(k)) fail('unsupported-argument', `move ${k} is not supported: Mol* moves the view.`, a.at(k));
      }
      if (frames && frames.value > 1) c.report(note(Frames, frames.at));
      return [{ kind: 'camera.move', axis: axisOf(axisWord.text, axisWord.at), distance: distance?.value ?? 1 }];
    },
  },
  {
    name: 'zoom',
    summary: 'Zoom by a factor (2: twice as large).',
    usage: 'zoom [factor [frames]]',
    params: [p('factor', 'number'), p('frames', 'int')],
    ignored: { pixelSize: 'Mol* zooms by a factor.' },
    examples: ['zoom 2', 'zoom 0.5'],
    compile(a, c) {
      const factor = a.number();
      const frames = a.number();
      a.done();
      if (frames && frames.value > 1) c.report(note(Frames, frames.at));
      if (!factor) return [{ kind: 'read', read: { kind: 'view' } }];
      if (factor.value <= 0) fail('argument', 'The factor is above 0.', factor.at);
      return [{ kind: 'camera.zoom', factor: factor.value }];
    },
  },
  ...(
    [
      ['distance', 'distance', 2, 'Measure the distance between two atoms.', 'distance :12@CA :14@CA'],
      ['angle', 'angle', 3, 'Measure the angle of three atoms.', 'angle :12@CA :13@CA :14@CA'],
      ['torsion', 'dihedral', 4, 'Measure the torsion angle of four atoms.', 'torsion :12@N :12@CA :12@C :13@N'],
    ] as const
  ).map(
    ([name, measure, n, summary, example]): ChimeraxCommand => ({
      name,
      summary,
      usage: `${name} objects`,
      params: [objects('objects', false)],
      ignored:
        name === 'distance'
          ? {
              color: 'Mol* draws measurements its own way.',
              dashes: 'Mol* draws measurements its own way.',
              radius: 'Mol* draws measurements its own way.',
              decimalPlaces: 'Mol* writes its own decimals.',
              symbol: 'Mol* writes Å.',
              signed: 'Distances are positive.',
              monitor: 'Measurements follow their atoms.',
            }
          : { move: 'Nothing is moved.' },
      examples: [example, `${name} sel`],
      compile(a) {
        const spec = a.requiredSpec(`${n} atoms`);
        const value = a.number();
        a.done();
        if (value) {
          return fail(
            'unsupported',
            `Setting ${name === 'torsion' ? 'a torsion' : 'an angle'} is not supported.`,
            value.at,
            editing,
          );
        }
        const atoms = spec.pieces?.length === n ? spec.pieces : [spec.sel];
        return [{ kind: 'measure', measure, atoms }];
      },
    }),
  ),
  ...(['distance delete', '~distance'] as const).map(
    (name): ChimeraxCommand => ({
      name,
      summary: 'Remove the distance measurements.',
      usage: name,
      params: [],
      examples: [name],
      compile(a) {
        a.spec();
        a.done();
        return [{ kind: 'measure.clear', measure: 'distance' }];
      },
    }),
  ),
  {
    name: 'label',
    summary: 'Label residues (by default: name and number) or atoms; text gives the text ({0.name}, {0.number}).',
    usage: 'label [objects] [residues|atoms] [text t] [attribute a]',
    params: [objects(), p('objectType', 'enum', true, ['residues', 'atoms'])],
    keywords: { text: { kind: 'text' }, attribute: { kind: 'text' } },
    ignored: Object.fromEntries(
      [
        'offset',
        'color',
        'bgColor',
        'size',
        'height',
        'defaultHeight',
        'defaultModelHeight',
        'font',
        'onTop',
        'position',
      ].map((k) => [k, 'Mol* draws labels its own way.']),
    ),
    examples: [
      'label /A:45',
      'label ligand atoms',
      'label :12 text "the site"',
      'label :12@CA atoms attribute bfactor',
    ],
    compile(a) {
      const spec = a.spec();
      const type = a.choice(['residues', 'atoms', 'models', 'bonds', 'pseudobonds']);
      a.done();
      if (type && (type.value === 'models' || type.value === 'bonds' || type.value === 'pseudobonds')) {
        fail('unsupported', `Labels of ${type.value} are not supported.`, type.at, 'Label residues or atoms.');
      }
      const per = type?.value === 'atoms' ? 'atom' : 'residue';
      const sel = spec?.sel ?? All;
      let text: LabelPart[];
      if (a.has('text')) text = labelText(a.text('text'), per, a.at('text'));
      else if (a.has('attribute')) text = [labelAttribute(a.text('attribute'), per, a.at('attribute'))];
      else
        text = per === 'residue' ? [{ property: 'resn' }, { text: ' ' }, { property: 'resi' }] : [{ property: 'name' }];
      return [{ kind: 'label', sel, text, ...(per === 'residue' ? { per: 'residue' as const } : {}) }];
    },
  },
  ...(['label delete', '~label'] as const).map(
    (name): ChimeraxCommand => ({
      name,
      summary: 'Remove labels (no objects: every one).',
      usage: `${name} [objects] [residues|atoms]`,
      params: [objects(), p('objectType', 'enum', true, ['residues', 'atoms'])],
      examples: [name, `${name} /A:45`],
      compile(a) {
        const spec = a.spec();
        a.choice(['residues', 'atoms']);
        a.done();
        return [spec ? { kind: 'label.clear', sel: spec.sel } : { kind: 'label.clear' }];
      },
    }),
  ),
  ...(['matchmaker', 'mmaker'] as const).map(
    (name): ChimeraxCommand => ({
      name,
      summary: 'Superpose by sequence alignment (Mol*’s chain superposition); says the RMSD.',
      usage: `${name} matchAtoms to atoms`,
      params: [objects('matchAtoms', false)],
      keywords: { to: { kind: 'selection' } },
      ignored: Object.fromEntries(
        [
          'pairing',
          'alg',
          'verbose',
          'ssFraction',
          'matrix',
          'gapOpen',
          'hgap',
          'sgap',
          'ogap',
          'cutoffDistance',
          'gapExtend',
          'bring',
          'showAlignment',
          'computeSS',
          'matHH',
          'matSS',
          'matOO',
          'matHS',
          'matHO',
          'matSO',
          'keepComputedSS',
          'reportMatrix',
          'logParameters',
        ].map((k) => [k, 'Mol*’s alignment applies.']),
      ),
      examples: [`${name} #2 to #1`, `${name} #2/A to #1/A`],
      compile(a) {
        const mobile = a.requiredSpec('the atoms to move');
        a.done();
        const target = a.sel('to');
        if (!target) return fail('argument', `${name} needs to: ${name} #2 to #1.`, a.here);
        return [{ kind: 'superpose', method: 'sequence', mobile: mobile.sel, target }];
      },
    }),
  ),
  {
    name: 'align',
    summary: 'Superpose atoms on atoms, paired in order; says the RMSD.',
    usage: 'align atoms toAtoms atoms',
    params: [objects('atoms', false)],
    keywords: { toAtoms: { kind: 'selection' } },
    ignored: {
      move: 'The structure of the atoms moves.',
      each: 'One superposition is made.',
      matchChainIds: 'The atoms pair in order.',
      matchNumbering: 'The atoms pair in order.',
      matchAtomNames: 'The atoms pair in order.',
      cutoffDistance: 'Mol* does not reject outliers.',
      reportMatrix: 'Mol* says the RMSD.',
    },
    examples: ['align #2@CA toAtoms #1@CA'],
    compile(a) {
      const mobile = a.requiredSpec('the atoms to move');
      a.done();
      const target = a.sel('toAtoms');
      if (!target) return fail('argument', 'align needs toAtoms: align #2@CA toAtoms #1@CA.', a.here);
      return [
        { kind: 'superpose', method: 'atoms', mobile: mobile.sel, target, pairs: [{ mobile: mobile.sel, target }] },
      ];
    },
  },
  {
    name: 'set',
    summary: 'Set the background color (bgColor) or silhouettes.',
    usage: 'set [bgColor c] [silhouettes true|false]',
    params: [],
    keywords: { bgColor: { kind: 'color' }, silhouettes: { kind: 'bool' } },
    ignored: {
      silhouetteWidth: 'Mol* draws outlines its own way.',
      silhouetteColor: 'Mol* draws outlines its own way.',
      silhouetteDepthJump: 'Mol* draws outlines its own way.',
      selectionColor: 'Mol* shows the selection its own way.',
      selectionWidth: 'Mol* shows the selection its own way.',
      subdivision: 'Mol* chooses its detail.',
      maxFrameRate: 'Mol* draws when the scene changes.',
    },
    examples: ['set bgColor white', 'set silhouettes true'],
    compile(a) {
      a.done();
      const bg = a.colorOf('bgColor');
      if (bg === undefined && !a.has('silhouettes'))
        return fail('argument', 'set needs bgColor or silhouettes.', a.here);
      return [
        {
          kind: 'canvas',
          ...(bg !== undefined ? { background: bg } : {}),
          ...(a.has('silhouettes') ? { outline: a.bool('silhouettes', true) } : {}),
        },
      ];
    },
  },
  {
    name: '~set',
    summary: 'Put the background back to black (bgColor).',
    usage: '~set bgColor',
    params: [p('setting', 'enum', false, ['bgColor'])],
    examples: ['~set bgColor'],
    compile(a) {
      const w = a.word();
      a.done();
      if (!w || w.text.toLowerCase() !== 'bgcolor') return fail('argument', '~set takes bgColor.', w?.at ?? a.here);
      return [{ kind: 'canvas', background: 0x000000 }];
    },
  },
  {
    name: 'lighting',
    summary: 'Lighting presets (simple, soft, full, flat, gentle, default), shadows, depth cue.',
    usage: 'lighting [preset] [shadows true|false] [depthCue true|false] [multiShadow n]',
    params: [p('preset', 'enum', true, ['default', 'simple', 'soft', 'full', 'flat', 'gentle'])],
    keywords: { shadows: { kind: 'bool' }, depthCue: { kind: 'bool' }, multiShadow: { kind: 'int' } },
    ignored: Object.fromEntries(
      [
        'direction',
        'intensity',
        'color',
        'fillDirection',
        'fillIntensity',
        'fillColor',
        'ambientIntensity',
        'ambientColor',
        'depthCueStart',
        'depthCueEnd',
        'depthCueColor',
        'moveWithCamera',
        'qualityOfShadows',
        'depthBias',
        'msMapSize',
        'msDepthBias',
      ].map((k) => [k, 'Mol*’s lights stay as they are.']),
    ),
    examples: ['lighting soft', 'lighting full', 'lighting simple', 'lighting shadows true', 'lighting depthCue false'],
    compile(a) {
      const preset = a.choice(['default', 'simple', 'soft', 'full', 'flat', 'gentle']);
      a.done();
      const canvas: { occlusion?: boolean; shadow?: boolean; outline?: boolean; fog?: boolean } = {};
      switch (preset?.value) {
        case 'default':
        case 'simple':
          Object.assign(canvas, { occlusion: false, shadow: false });
          break;
        case 'soft':
        case 'gentle':
          Object.assign(canvas, { occlusion: true, shadow: false });
          break;
        case 'full':
          Object.assign(canvas, { occlusion: true, shadow: true });
          break;
        case 'flat':
          Object.assign(canvas, { occlusion: false, shadow: false, outline: true });
          break;
      }
      if (a.has('shadows')) canvas.shadow = a.bool('shadows', false);
      if (a.has('depthCue')) canvas.fog = a.bool('depthCue', true);
      if (a.has('multiShadow')) canvas.occlusion = a.num('multiShadow') > 0;
      if (!Object.keys(canvas).length) return [{ kind: 'read', read: { kind: 'view' } }];
      return [{ kind: 'canvas', ...canvas }];
    },
  },
  {
    name: 'graphics silhouettes',
    summary: 'Outlines on or off.',
    usage: 'graphics silhouettes [true|false]',
    params: [p('enable', 'bool')],
    ignored: {
      width: 'Mol* draws outlines its own way.',
      color: 'Mol* draws outlines its own way.',
      depthJump: 'Mol* draws outlines its own way.',
    },
    examples: ['graphics silhouettes true', 'graphics silhouettes false'],
    compile(a) {
      const w = a.word();
      a.done();
      return [{ kind: 'canvas', outline: w ? readBool(w.text, w.at) : true }];
    },
  },
  {
    name: 'camera',
    summary: 'Orthographic (ortho) or perspective (mono) projection; the field of view.',
    usage: 'camera [ortho|mono] [fieldOfView degrees]',
    params: [p('type', 'enum', true, ['mono', 'ortho'])],
    keywords: { fieldOfView: { kind: 'number' } },
    ignored: {
      eyeSeparation: 'Stereo is not drawn.',
      pixelEyeSeparation: 'Stereo is not drawn.',
      convergence: 'Stereo is not drawn.',
      cubePixels: '360° views are not drawn.',
    },
    examples: ['camera ortho', 'camera mono', 'camera fieldOfView 30'],
    compile(a) {
      const w = a.word();
      a.done();
      if (w && w.text !== 'ortho' && w.text !== 'mono') {
        fail(
          'unsupported',
          `The camera '${w.text}' is not supported.`,
          w.at,
          'Mol* draws mono (perspective) or ortho.',
        );
      }
      const projection = w ? (w.text === 'ortho' ? 'orthographic' : 'perspective') : undefined;
      const fov = a.has('fieldOfView') ? a.num('fieldOfView') : undefined;
      if (!projection && fov === undefined) return [{ kind: 'read', read: { kind: 'view' } }];
      return [{ kind: 'canvas', ...(projection ? { projection } : {}), ...(fov !== undefined ? { fov } : {}) }];
    },
  },
  {
    name: 'save',
    summary: 'Save an image (PNG): name.png [width w] [height h] [transparentBackground true].',
    usage: 'save name.png [width w] [height h] [transparentBackground true|false]',
    params: [p('fileName', 'file', false)],
    keywords: { width: { kind: 'int' }, height: { kind: 'int' }, transparentBackground: { kind: 'bool' } },
    ignored: {
      supersample: 'Mol* draws the image at its size.',
      quality: 'Images are PNG.',
      pixelSize: 'Give width and height.',
      format: 'Images are PNG.',
    },
    examples: ['save image.png', 'save figure.png width 1200 height 900 transparentBackground true'],
    compile(a, c) {
      const w = a.word();
      a.done();
      if (!w) return fail('argument', 'save needs a file name.', a.here, 'save image.png');
      const ext = w.text.toLowerCase().split('.').pop() ?? '';
      if (!['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'gif', 'ppm'].includes(ext)) {
        fail(
          'unsupported',
          `Saving .${ext} files is not supported.`,
          w.at,
          'Save an image (name.png); Mol* sessions and exports are in the Export menu.',
        );
      }
      if (ext !== 'png') c.report(note('The image is saved as PNG.', w.at));
      const size = (k: 'width' | 'height') => {
        if (!a.has(k)) return undefined;
        const v = Math.round(a.num(k));
        if (v <= 0) fail('argument', `${k} is a size in pixels.`, a.at(k));
        return v;
      };
      const width = size('width');
      const height = size('height');
      return [
        {
          kind: 'export.image',
          name: w.text.replace(/\.[^.]+$/, ''),
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
          ...(a.bool('transparentBackground', false) ? { transparent: true } : {}),
        },
      ];
    },
  },
  ...(['undo', 'redo'] as const).map(
    (action): ChimeraxCommand => ({
      name: action,
      summary: action === 'undo' ? 'Undo the last step (alone on its line).' : 'Redo what Undo took back.',
      usage: action,
      params: [],
      examples: [action],
      compile(a) {
        a.done();
        return [{ kind: 'history', action }];
      },
    }),
  ),
  ...(['info', 'info models'] as const).map(
    (name): ChimeraxCommand => ({
      name,
      summary: 'List the models: their ids and names.',
      usage: name,
      params: [],
      examples: [name],
      compile(a) {
        a.spec();
        a.done();
        return [{ kind: 'read', read: { kind: 'objects', ids: 'model' } }];
      },
    }),
  ),
  {
    name: 'info selection',
    summary: 'Count the atoms selected.',
    usage: 'info selection',
    params: [],
    examples: ['info selection'],
    compile(a, c) {
      a.done();
      const nothing: Sel = {
        text: 'sel',
        dialect: 'chimerax',
        parts: [{ scope: 'others', molql: B.struct.generator.empty() }],
      };
      return [{ kind: 'read', read: { kind: 'count', sel: c.state.selection ?? nothing } }];
    },
  },
  {
    name: 'measure center',
    summary: 'The center of atoms.',
    usage: 'measure center objects',
    params: [objects('objects', false)],
    ignored: {
      level: 'Atoms are measured.',
      mark: 'No marker is placed.',
      color: 'No marker is placed.',
      radius: 'No marker is placed.',
      name: 'No marker is placed.',
      modelId: 'No marker is placed.',
    },
    examples: ['measure center ligand'],
    compile(a) {
      const spec = a.requiredSpec();
      a.done();
      return [{ kind: 'read', read: { kind: 'geometry', measure: 'center', atoms: [spec.sel] } }];
    },
  },
  {
    name: 'coordset',
    summary: 'Show a frame of a trajectory (1-based), or play it.',
    usage: 'coordset models [frame]',
    params: [objects('models', false), p('frame', 'int')],
    ignored: {
      holdSteady: 'The view stays.',
      pauseFrames: 'Frames play at Mol*’s pace.',
      loop: 'Frames play at Mol*’s pace.',
      bounce: 'Frames play at Mol*’s pace.',
      computeSs: 'The secondary structure stays.',
    },
    examples: ['coordset #1 10', 'coordset #1'],
    compile(a) {
      a.requiredSpec('the models');
      const frame = a.number();
      a.done();
      if (!frame) return [{ kind: 'trajectory', play: 'forward' }];
      if (frame.value < 1 && frame.value !== -1) fail('argument', 'Frames are counted from 1.', frame.at);
      return [{ kind: 'trajectory', frame: frame.value === -1 ? -1 : frame.value - 1 }];
    },
  },
  ...(['wait', 'stop'] as const).map(
    (name): ChimeraxCommand => ({
      name,
      summary:
        name === 'wait' ? 'Nothing to wait for: Mol* renders as commands run.' : 'Nothing to stop: Mol* moves at once.',
      usage: name === 'wait' ? 'wait [frames]' : 'stop',
      params: name === 'wait' ? [p('frames', 'int')] : [],
      examples: [name],
      compile(a, c) {
        a.word();
        a.done();
        c.report(note(`${name} is not needed: Mol* moves at once.`, a.here));
        return [];
      },
    }),
  ),
];

const editing = 'Mol* shows structures as they are loaded; it does not edit them.';

/** Whether a name may name a spec: not a built-in selector (`protein`, `C`), as ChimeraX refuses those. */
function checkName(name: string, at: Span): void {
  if (!/^[a-zA-Z_][-+a-zA-Z0-9_]*$/.test(name)) {
    fail('argument', `'${name}' is not a name.`, at, 'Names are letters, digits, _, - and + (site_1, pocket).');
  }
  try {
    chimeraxTranspiler(name);
  } catch {
    return;
  }
  fail('argument', `'${name}' is a ChimeraX selector: pick another name.`, at, 'site, pocket, lig1.');
}

function namesHint(c: Compiler): string {
  const names = [...c.state.names.keys()];
  return names.length ? `Names: ${names.join(', ')}.` : 'Nothing is named yet.';
}

function modelsHint(c: Compiler): string {
  const models = c.state.objects.filter((o) => o.model !== undefined).map((o) => `#${o.model} ${o.name}`);
  return models.length ? `Models: ${models.join(', ')}.` : 'Nothing is open.';
}

/** Every ChimeraX command of the table by name. */
export const ChimeraxCommandsByName: ReadonlyMap<string, ChimeraxCommand> = new Map(
  ChimeraxCommands.map((c) => [c.name, c] as const),
);

/** Compiles one command: its arguments from `from` to `end` in the submission. */
export function compileChimeraxCommand(
  command: ChimeraxCommand,
  text: string,
  from: number,
  end: number,
  c: Compiler,
): Compiled {
  const args = new ChimeraxArgs(text, from, end, command.name, command.keywords ?? {}, c, command.ignored);
  return command.compile(args, c);
}
