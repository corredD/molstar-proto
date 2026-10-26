/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// ChimeraX atom specifiers (https://www.cgl.ucsf.edu/chimerax/docs/user/commands/atomspec.html) as MolQL. The grammar
// is ChimeraX 1.10's own (chimerax/core/commands/_atomspec.py, a Grako PEG), read by hand: blanks may come before any
// token; `&` and `|` have one precedence and group to the right (`a & b | c` is `a & (b | c)`); terms side by side
// are only models (`#1/A #2/B`), and parts side by side within a model are a union (`/A:12 :14` is A:12 or A:14).
// Hand-written, not on the monadic parser: a command takes a spec and then keywords (`color /A :12 red`), so a spec
// reads as far as it can and says where it ended (`parseAtomSpec`), as ChimeraX's own does.
//
// Matching follows chimerax/atomic/structure.py: chain ids, residue and atom names ignore case (ChimeraX: unless the
// structure has lower-case chain ids) and take wildcards (`*`, `?`, `[…]`); a residue part that reads as a number
// (`12`, `12A`, `start-20`) is a residue number, else a name. Zones (`@<5`) include the atoms they start from.

import { MolScriptBuilder as B } from '../../language/builder.js';
import { Expression } from '../../language/expression.js';
import type { TranspileOptions, Transpiler } from '../transpiler.js';
import { type AttrLevel, attributes } from './attributes.js';
import { elementSelector, IdatmTypes, selectors } from './selectors.js';

export interface ChimeraxTranspileOptions extends TranspileOptions {
  /**
   * The id of the model the text is evaluated on (`#1` is `[1]`): a model term (`#1`, `#2-4`) matches it or nothing.
   * Default `[1]`, the one structure of a session that opened one file.
   */
  readonly modelId?: readonly number[];
}

// The parse tree, as ChimeraX's: a specifier is terms joined by `&` and `|`; a term a group, a `~`, a selector or
// models; a model its ids, attribute tests and parts; parts chains, residues and atoms.

type Zone = { readonly target: '@' | ':' | '/' | '#'; readonly op: '<' | '>'; readonly distance: number };
type Part = { readonly start: string; readonly end?: string };
type AttrTest = {
  readonly name: string;
  readonly no?: true;
  readonly op?: string;
  readonly value?: { readonly text: string; readonly quoted: boolean };
};
type AtomNode = { readonly parts?: readonly Part[]; readonly attrs?: readonly AttrTest[] };
type ResidueNode = AtomNode & { readonly atoms: readonly AtomNode[] };
type ChainNode = AtomNode & { readonly residues: readonly ResidueNode[] };
type ModelRange = { readonly start: number | '*' | 'start'; readonly end?: number | '*' | 'end' };
type ModelNode = {
  readonly exact: boolean;
  /** Per level of the id (`#1.2`): the ranges that match there. */
  readonly hierarchy?: readonly (readonly ModelRange[])[];
  readonly attrs?: readonly AttrTest[];
  readonly parts?: readonly ChainNode[];
  readonly zone?: Zone;
};
type Term =
  | { readonly kind: 'group'; readonly spec: Spec; readonly zone?: Zone }
  | { readonly kind: 'not'; readonly term: Term; readonly zone?: Zone }
  | { readonly kind: 'selector'; readonly name: string; readonly expression: Expression; readonly zone?: Zone }
  | { readonly kind: 'models'; readonly models: readonly ModelNode[] };
type Spec = Term | { readonly kind: 'op'; readonly op: '&' | '|'; readonly left: Term; readonly right: Spec };

const Blank = /\s/;

class Reader {
  i = 0;
  /** The furthest place a token was looked for, and why the selector there failed: for messages. */
  furthest = 0;
  unknownWord: { readonly word: string; readonly at: number } | undefined;

  constructor(
    readonly s: string,
    readonly options: ChimeraxTranspileOptions | undefined,
  ) {}

  private skip(i: number) {
    while (i < this.s.length && Blank.test(this.s[i])) i++;
    return i;
  }

  /** A token, after blanks (Grako's rule): consumed when it is there. */
  tok(t: string): boolean {
    const j = this.skip(this.i);
    if (j > this.furthest) this.furthest = j;
    if (!this.s.startsWith(t, j)) return false;
    this.i = j + t.length;
    return true;
  }

  /** A pattern, after blanks; `sticky` regexes only. */
  re(r: RegExp): string | undefined {
    const j = this.skip(this.i);
    if (j > this.furthest) this.furthest = j;
    r.lastIndex = j;
    const m = r.exec(this.s);
    if (!m) return undefined;
    this.i = j + m[0].length;
    return m[0];
  }

  /** Whether the text at the place (without blanks first) is a `.` with no blank before it: a submodel level. */
  submodelDot(): boolean {
    if (this.s[this.i] !== '.') return false;
    this.i++;
    return true;
  }

  /** Runs a rule; on failure (undefined) puts the place back. */
  attempt<T>(rule: () => T | undefined): T | undefined {
    const at = this.i;
    const r = rule();
    if (r === undefined) this.i = at;
    return r;
  }
}

const SelectorName = /[a-zA-Z_][-+a-zA-Z0-9_]*/y;
const ModelNumber = /[0-9]{1,5}(?![0-9A-Fa-f])/y;
const PartStart = /-?[a-zA-Z0-9_'"*?[\]\\]+/y;
const PartEnd = /[-a-zA-Z0-9_'"\\]+/y;
const AttrName = /[a-zA-Z_][a-zA-Z0-9_]*/y;
const AttrBare = /[^,#/:@ \t]+/y;
const AttrDouble = /"[^"]+"/y;
const AttrSingle = /'[^']+'/y;
const RealNumber = /[0-9]*\.?[0-9]+/y;
const Dash = /-/y;
const AttrOps = ['>=', '>', '<=', '<', '==', '=', '!==', '!=', '<>'];
const ZoneOps = ['@>', '@<', ':>', ':<', '/>', '/<', '#>', '#<'];

function atomSpecifier(r: Reader): Spec | undefined {
  const left = r.attempt(() => term(r));
  if (!left) return undefined;
  for (const op of ['&', '|'] as const) {
    const right = r.attempt(() => (r.tok(op) ? atomSpecifier(r) : undefined));
    if (right) return { kind: 'op', op, left, right };
  }
  return left;
}

function zone(r: Reader): Zone | undefined {
  return r.attempt(() => {
    const op = ZoneOps.find((o) => r.tok(o));
    if (!op) return undefined;
    const d = r.re(RealNumber);
    if (d === undefined) return undefined;
    return { target: op[0] as Zone['target'], op: op[1] as Zone['op'], distance: Number(d) };
  });
}

function term(r: Reader): Term | undefined {
  const group = r.attempt((): Term | undefined => {
    if (!r.tok('(')) return undefined;
    const spec = atomSpecifier(r);
    if (!spec || !r.tok(')')) return undefined;
    return { kind: 'group', spec, zone: zone(r) };
  });
  if (group) return group;
  const not = r.attempt((): Term | undefined => {
    if (!r.tok('~')) return undefined;
    const t = term(r);
    return t && { kind: 'not', term: t, zone: zone(r) };
  });
  if (not) return not;
  const selector = r.attempt((): Term | undefined => {
    const at = r.i;
    const name = r.re(SelectorName);
    if (name === undefined) return undefined;
    const expression = selectorExpression(r, name);
    if (!expression) {
      r.unknownWord = { word: name, at };
      return undefined;
    }
    return { kind: 'selector', name, expression, zone: zone(r) };
  });
  if (selector) return selector;
  const models: ModelNode[] = [];
  for (let m = r.attempt(() => model(r)); m; m = r.attempt(() => model(r))) models.push(m);
  return models.length ? { kind: 'models', models } : undefined;
}

/** A selector's MolQL: ChimeraX's built-ins, then the caller's names (`name` and `sel`). */
function selectorExpression(r: Reader, name: string): Expression | undefined {
  const element = elementSelector(name);
  if (element) return element;
  const builtin = Object.hasOwn(selectors, name) ? selectors[name] : undefined;
  if (builtin) {
    if (!builtin.map) throw new Error(`selector '${name}' (${builtin['@desc']}) is not supported`);
    return builtin.map();
  }
  if (IdatmTypes.has(name)) throw new Error(`selector '${name}' (an IDATM atom type) is not supported`);
  return r.options?.resolveName?.(name);
}

function model(r: Reader): ModelNode | undefined {
  const withIds = r.attempt((): ModelNode | undefined => {
    const exact = r.tok('#!');
    if (!exact && !r.tok('#')) return undefined;
    const hierarchy = modelHierarchy(r);
    if (!hierarchy) return undefined;
    const attrs = r.attempt(() => (r.tok('##') ? attributeList(r) : undefined));
    return { exact, hierarchy, attrs, parts: modelParts(r), zone: zone(r) };
  });
  if (withIds) return withIds;
  const withAttrs = r.attempt((): ModelNode | undefined => {
    if (!r.tok('##')) return undefined;
    const attrs = attributeList(r);
    return attrs && { exact: false, attrs, parts: modelParts(r), zone: zone(r) };
  });
  if (withAttrs) return withAttrs;
  const parts = modelParts(r);
  return parts && { exact: false, parts, zone: zone(r) };
}

function modelHierarchy(r: Reader): ModelRange[][] | undefined {
  const first = modelRangeList(r);
  if (!first) return undefined;
  const levels = [first];
  for (;;) {
    const next = r.attempt(() => (r.submodelDot() ? modelRangeList(r) : undefined));
    if (!next) return levels;
    levels.push(next);
  }
}

function modelRangeList(r: Reader): ModelRange[] | undefined {
  const first = modelRange(r);
  if (!first) return undefined;
  const ranges = [first];
  for (;;) {
    const next = r.attempt(() => (r.tok(',') ? modelRange(r) : undefined));
    if (!next) return ranges;
    ranges.push(next);
  }
}

function modelRange(r: Reader): ModelRange | undefined {
  const range = r.attempt((): ModelRange | undefined => {
    const start = modelSpec(r, 'start');
    if (start === undefined || r.re(Dash) === undefined) return undefined;
    const end = modelSpec(r, 'end');
    return end === undefined ? undefined : { start: start as ModelRange['start'], end: end as ModelRange['end'] };
  });
  if (range) return range;
  const one = modelSpec(r);
  return one === undefined ? undefined : { start: one as ModelRange['start'] };
}

function modelSpec(r: Reader, word?: 'start' | 'end'): number | string | undefined {
  const n = r.re(ModelNumber);
  if (n !== undefined) return Number(n);
  if (word && r.tok(word)) return word;
  if (r.tok('*')) return '*';
  return undefined;
}

function modelParts(r: Reader): ChainNode[] | undefined {
  const chains: ChainNode[] = [];
  for (let c = r.attempt(() => chain(r)); c; c = r.attempt(() => chain(r))) chains.push(c);
  return chains.length ? chains : undefined;
}

/** `/parts//attrs` and the residues under it, or the residues alone. */
function chain(r: Reader): ChainNode | undefined {
  const own = r.attempt((): ChainNode | undefined => {
    if (!r.tok('/')) return undefined;
    const parts = partList(r);
    if (!parts) return undefined;
    const attrs = r.attempt(() => (r.tok('//') ? attributeList(r) : undefined));
    return { parts, attrs, residues: many(r, residue) };
  });
  if (own) return own;
  const attrsOnly = r.attempt((): ChainNode | undefined => {
    if (!r.tok('//')) return undefined;
    const attrs = attributeList(r);
    return attrs && { attrs, residues: many(r, residue) };
  });
  if (attrsOnly) return attrsOnly;
  const residues = many(r, residue);
  return residues.length ? { residues } : undefined;
}

function residue(r: Reader): ResidueNode | undefined {
  const own = r.attempt((): ResidueNode | undefined => {
    if (!r.tok(':')) return undefined;
    const parts = partList(r);
    if (!parts) return undefined;
    const attrs = r.attempt(() => (r.tok('::') ? attributeList(r) : undefined));
    return { parts, attrs, atoms: many(r, atom) };
  });
  if (own) return own;
  const attrsOnly = r.attempt((): ResidueNode | undefined => {
    if (!r.tok('::')) return undefined;
    const attrs = attributeList(r);
    return attrs && { attrs, atoms: many(r, atom) };
  });
  if (attrsOnly) return attrsOnly;
  const atoms = many(r, atom);
  return atoms.length ? { atoms } : undefined;
}

function atom(r: Reader): AtomNode | undefined {
  const own = r.attempt((): AtomNode | undefined => {
    if (!r.tok('@')) return undefined;
    const parts = partList(r, true);
    if (!parts) return undefined;
    const attrs = r.attempt(() => (r.tok('@@') ? attributeList(r) : undefined));
    return { parts, attrs };
  });
  if (own) return own;
  return r.attempt((): AtomNode | undefined => {
    if (!r.tok('@@')) return undefined;
    const attrs = attributeList(r);
    return attrs && { attrs };
  });
}

function many<T>(r: Reader, rule: (r: Reader) => T | undefined): T[] {
  const xs: T[] = [];
  for (let x = r.attempt(() => rule(r)); x; x = r.attempt(() => rule(r))) xs.push(x);
  return xs;
}

/** `12-20,40`, `ALA,GLY`, `CA,CB`: atom names take no ranges. */
function partList(r: Reader, names = false): Part[] | undefined {
  const first = part(r, names);
  if (!first) return undefined;
  const parts = [first];
  for (;;) {
    const next = r.attempt(() => (r.tok(',') ? part(r, names) : undefined));
    if (!next) return parts;
    parts.push(next);
  }
}

function part(r: Reader, names: boolean): Part | undefined {
  const start = r.re(PartStart);
  if (start === undefined) return undefined;
  if (names) return { start };
  const end = r.attempt(() => (r.re(Dash) !== undefined ? r.re(PartEnd) : undefined));
  return end === undefined ? { start } : { start, end };
}

function attributeList(r: Reader): AttrTest[] | undefined {
  const first = attrTest(r);
  if (!first) return undefined;
  const tests = [first];
  for (;;) {
    const next = r.attempt(() => (r.tok(',') ? attrTest(r) : undefined));
    if (!next) return tests;
    tests.push(next);
  }
}

function attrTest(r: Reader): AttrTest | undefined {
  const compared = r.attempt((): AttrTest | undefined => {
    const name = r.re(AttrName);
    if (name === undefined) return undefined;
    const op = AttrOps.find((o) => r.tok(o));
    if (!op) return undefined;
    const quoted = r.re(AttrDouble) ?? r.re(AttrSingle);
    if (quoted !== undefined) return { name, op, value: { text: quoted.slice(1, -1), quoted: true } };
    const bare = r.re(AttrBare);
    return bare === undefined ? undefined : { name, op, value: { text: bare, quoted: false } };
  });
  if (compared) return compared;
  const name = r.attempt(() => r.re(AttrName));
  if (name !== undefined) return { name };
  return r.attempt((): AttrTest | undefined => {
    if (!r.tok('^')) return undefined;
    const n = r.re(AttrName);
    return n === undefined ? undefined : { name: n, no: true };
  });
}

// From the tree to MolQL.

const All = () => B.struct.generator.all();
const Empty = () => B.struct.generator.empty();

const hasWildcard = (s: string) => /[*?[]/.test(s);
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A shell pattern (`C*`, `?G`, `[CN]A`) as an anchored regex, as Python's `fnmatch`. */
function globToRegExp(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') out += '.*';
    else if (c === '?') out += '.';
    else if (c === '[') {
      const close = pattern.indexOf(']', i + 2);
      if (close < 0) {
        out += '\\[';
        continue;
      }
      let body = pattern.slice(i + 1, close);
      if (body.startsWith('!')) body = `^${body.slice(1)}`;
      out += `[${body.replace(/\\/g, '\\\\')}]`;
      i = close;
    } else out += escapeRegExp(c);
  }
  return `^${out}$`;
}

/** A string property against a name or a pattern, ignoring case unless asked. */
function stringTest(property: Expression, text: string, caseSensitive = false): Expression {
  if (caseSensitive && !hasWildcard(text)) return B.core.rel.eq([property, text]);
  const pattern = hasWildcard(text) ? globToRegExp(text) : `^${escapeRegExp(text)}$`;
  return B.core.str.match([B.re(pattern, caseSensitive ? '' : 'i'), property]);
}

const or = (xs: Expression[]) => (xs.length === 1 ? xs[0] : B.core.logic.or(xs));
const and = (xs: Expression[]) => (xs.length === 1 ? xs[0] : B.core.logic.and(xs));

function chainPartTest(p: Part): Expression {
  const id = B.ammp('auth_asym_id');
  if (p.end === undefined) return stringTest(id, p.start);
  // ChimeraX compares the ids as strings; one character a side reads as a class.
  if (p.start.length === 1 && p.end.length === 1 && !hasWildcard(p.start)) {
    return B.core.str.match([B.re(`^[${escapeRegExp(p.start)}-${escapeRegExp(p.end)}]$`, 'i'), id]);
  }
  throw new Error(`chain range '${p.start}-${p.end}' is not supported: give the chains (/A,B,C) or one-letter ends`);
}

/** A residue id as ChimeraX reads one (`12`, `12A`, `-3`), or undefined when it is a name. */
function residueId(text: string, edge?: 'start' | 'end'): { seq: number; ic: string } | null | undefined {
  if (edge && text.toLowerCase() === edge) return null;
  if (/^-?\d+$/.test(text)) return { seq: Number(text), ic: '' };
  if (/^-?\d+.$/.test(text)) return { seq: Number(text.slice(0, -1)), ic: text.slice(-1) };
  return undefined;
}

/** `seq/ic` against a bound, as ChimeraX orders them: a blank insertion code before any other. */
function residueBound(bound: { seq: number; ic: string }, side: 'from' | 'to'): Expression {
  const seq = B.ammp('auth_seq_id');
  const ic = B.ammp('pdbx_PDB_ins_code');
  const beyond = side === 'from' ? B.core.rel.gr([seq, bound.seq]) : B.core.rel.lt([seq, bound.seq]);
  const at = B.core.rel.eq([seq, bound.seq]);
  if (!bound.ic) {
    // From `12`: 12 and every 12x. To `20`: 20 only, not 20A (ChimeraX's order).
    return side === 'from'
      ? B.core.rel.gre([seq, bound.seq])
      : B.core.logic.or([beyond, B.core.logic.and([at, B.core.rel.eq([ic, ''])])]);
  }
  const icTest =
    side === 'from'
      ? B.core.logic.and([B.core.rel.neq([ic, '']), B.core.rel.gre([ic, bound.ic])])
      : B.core.logic.or([B.core.rel.eq([ic, '']), B.core.rel.lte([ic, bound.ic])]);
  return B.core.logic.or([beyond, B.core.logic.and([at, icTest])]);
}

function residuePartTest(p: Part): Expression {
  const start = residueId(p.start, p.end === undefined ? undefined : 'start');
  if (p.end === undefined) {
    if (start) {
      return B.core.logic.and([
        B.core.rel.eq([B.ammp('auth_seq_id'), start.seq]),
        B.core.rel.eq([B.ammp('pdbx_PDB_ins_code'), start.ic]),
      ]);
    }
    return stringTest(B.ammp('auth_comp_id'), p.start);
  }
  const end = residueId(p.end, 'end');
  if (start !== undefined && end !== undefined) {
    const tests: Expression[] = [];
    if (start) tests.push(residueBound(start, 'from'));
    if (end) tests.push(residueBound(end, 'to'));
    return tests.length ? and(tests) : B.core.type.bool([true]);
  }
  throw new Error(`residue name range ':${p.start}-${p.end}' is not supported: give the names (:ALA,GLY)`);
}

const atomPartTest = (p: Part) => stringTest(B.ammp('auth_atom_id'), p.start);

/** A value as ChimeraX converts an unquoted one: an int, else a float, else the text. */
function attrValue(v: { text: string; quoted: boolean }, op: string): number | string {
  if (v.quoted || op === '==' || op === '!==') return v.text;
  const n = Number(v.text);
  return v.text.trim() !== '' && Number.isFinite(n) ? n : v.text;
}

function attrTestExpr(level: AttrLevel, t: AttrTest): Expression {
  const symbol = level === 'atom' ? '@@' : level === 'residue' ? '::' : level === 'chain' ? '//' : '##';
  const attr = Object.hasOwn(attributes[level], t.name) ? attributes[level][t.name] : undefined;
  if (!attr) {
    const known = Object.keys(attributes[level]);
    throw new Error(
      `attribute '${symbol}${t.name}' is not supported${known.length ? `; ${symbol} takes ${known.join(', ')}` : ''}`,
    );
  }
  const p = attr.property();
  if (t.no) return B.core.type.bool([false]);
  if (!t.op || !t.value) {
    if (attr.kind === 'bool') return p;
    return attr.kind === 'number' ? B.core.rel.neq([p, 0]) : B.core.rel.neq([p, '']);
  }
  const value = attrValue(t.value, t.op);
  if (attr.kind === 'bool') {
    const truthy = value === 1 || value === 'true' || value === 'True';
    const eq = t.op === '=' || t.op === '==';
    return truthy === eq ? p : B.core.logic.not([p]);
  }
  if (typeof value === 'string' || attr.kind === 'string') {
    const text = String(value);
    switch (t.op) {
      case '=':
      case '==':
        return stringTest(p, text, t.op === '==');
      case '!=':
      case '!==':
      case '<>':
        return B.core.logic.not([stringTest(p, text, t.op === '!==')]);
      default:
        throw new Error(`'${symbol}${t.name}${t.op}${t.value.text}' compares text by order, which is not supported`);
    }
  }
  switch (t.op) {
    case '=':
    case '==':
      return B.core.rel.eq([p, value]);
    case '!=':
    case '!==':
    case '<>':
      return B.core.rel.neq([p, value]);
    case '>':
      return B.core.rel.gr([p, value]);
    case '>=':
      return B.core.rel.gre([p, value]);
    case '<':
      return B.core.rel.lt([p, value]);
    default:
      return B.core.rel.lte([p, value]);
  }
}

/** A level's own test: any of its parts, and all of its attribute tests. */
function levelTest(level: AttrLevel, node: AtomNode, partTest: (p: Part) => Expression): Expression | undefined {
  const tests: Expression[] = [];
  if (node.parts) tests.push(or(node.parts.map(partTest)));
  if (node.attrs) {
    // ChimeraX's chains are polymer chains: an atom in none (a water, a ligand) fails every chain attribute test.
    if (level === 'chain') tests.push(B.core.rel.eq([B.ammp('entityType'), 'polymer']));
    for (const t of node.attrs) tests.push(attrTestExpr(level, t));
  }
  return tests.length ? and(tests) : undefined;
}

type Path = { chain?: Expression; residue?: Expression; atom?: Expression };

function atomGroups(path: Path): Expression {
  if (!path.chain && !path.residue && !path.atom) return All();
  return B.struct.generator.atomGroups({
    ...(path.chain && { 'chain-test': path.chain }),
    ...(path.residue && { 'residue-test': path.residue }),
    ...(path.atom && { 'atom-test': path.atom }),
  });
}

/** A model's parts: each path through chains, residues and atoms is one generator, and the paths a union. */
function partsExpr(chains: readonly ChainNode[]): Expression {
  return union(partPaths(chains).map(atomGroups));
}

/** A model's parts as paths through chains, residues and atoms, in the order written. */
function partPaths(chains: readonly ChainNode[]): Path[] {
  const paths: Path[] = [];
  for (const c of chains) {
    const chain = levelTest('chain', c, chainPartTest);
    if (!c.residues.length) {
      paths.push({ chain });
      continue;
    }
    for (const res of c.residues) {
      const residue = levelTest('residue', res, residuePartTest);
      if (!res.atoms.length) {
        paths.push({ chain, residue });
        continue;
      }
      for (const a of res.atoms) paths.push({ chain, residue, atom: levelTest('atom', a, atomPartTest) });
    }
  }
  return paths;
}

/**
 * The pieces of a spec that is only models side by side (`:12@CA :14@CA`, `#1/A:45@CA #2/A:45@CA`): each model's
 * paths, in the order written, so a command that takes atoms in order (`angle`) reads them as ChimeraX does. Undefined
 * for any other spec (an operator, a selector, a zone).
 */
function piecesOf(s: Spec, id: readonly number[]): Expression[] | undefined {
  if (s.kind !== 'models') return undefined;
  const pieces: Expression[] = [];
  for (const m of s.models) {
    if (m.attrs || m.zone) return undefined;
    // A model that is not this one still counts its pieces (as nothing), so every model reads as many.
    const own = modelMatches(m, id);
    const paths: Path[] = m.parts ? partPaths(m.parts) : [{}];
    for (const path of paths) pieces.push(own ? atomGroups(path) : Empty());
  }
  return pieces;
}

function union(xs: Expression[]): Expression {
  return xs.length === 1 ? xs[0] : B.struct.combinator.merge(xs);
}

function modelMatches(node: ModelNode, id: readonly number[]): boolean {
  if (!node.hierarchy) return true;
  if (node.exact && id.length !== node.hierarchy.length) return false;
  return node.hierarchy.every((ranges, level) => {
    const n = id[level];
    if (n === undefined) return false;
    return ranges.some((m) => {
      if (m.end === undefined) return m.start === '*' || m.start === n;
      if (typeof m.start === 'number' && n < m.start) return false;
      return typeof m.end !== 'number' || n <= m.end;
    });
  });
}

function zoneExpr(z: Zone, reference: Expression): Expression {
  // `min-radius` given: centre to centre, as ChimeraX (without it Mol* reads the target's lookup, which pads it).
  const near = B.struct.filter.within({
    0: All(),
    target: reference,
    'min-radius': 0,
    'max-radius': z.distance,
    'atom-radius': 0,
  });
  const expand = (sel: Expression, property: Expression) =>
    B.struct.generator.queryInSelection({
      0: B.struct.modifier.expandProperty({ 0: B.struct.modifier.union({ 0: sel }), property }),
      query: All(),
    });
  const unit =
    z.target === ':'
      ? B.ammp('residueKey')
      : z.target === '/'
        ? B.ammp('auth_asym_id')
        : z.target === '#'
          ? B.acp('modelIndex')
          : undefined;
  if (z.op === '<') {
    // The atoms (residues, chains, models) with an atom within the distance; the reference is within it.
    return unit ? expand(near, unit) : B.struct.combinator.merge([near, reference]);
  }
  // Atoms beyond it; residues (chains, models) with every atom beyond it.
  if (!unit) {
    return B.struct.filter.within({
      0: All(),
      target: reference,
      'min-radius': 0,
      'max-radius': z.distance,
      'atom-radius': 0,
      invert: true,
    });
  }
  return B.struct.modifier.exceptBy({ 0: All(), by: expand(near, unit) });
}

function withZone(e: Expression, z: Zone | undefined) {
  return z ? zoneExpr(z, e) : e;
}

function termExpr(t: Term, id: readonly number[]): Expression {
  switch (t.kind) {
    case 'group':
      return withZone(specExpr(t.spec, id), t.zone);
    case 'not':
      return withZone(B.struct.modifier.exceptBy({ 0: All(), by: termExpr(t.term, id) }), t.zone);
    case 'selector':
      return withZone(t.expression, t.zone);
    case 'models':
      return union(
        t.models.map((m) => {
          if (m.attrs) throw new Error(`model attributes ('##${m.attrs[0].name}') are not supported`);
          const own = modelMatches(m, id) ? (m.parts ? partsExpr(m.parts) : All()) : Empty();
          return withZone(own, m.zone);
        }),
      );
  }
}

function specExpr(s: Spec, id: readonly number[]): Expression {
  if (s.kind !== 'op') return termExpr(s, id);
  const left = termExpr(s.left, id);
  const right = specExpr(s.right, id);
  // Nothing folds away (`#1 & ligand` on model 2 is nothing): a part that selects nothing reads as such.
  if (s.op === '&')
    return isNothing(left) || isNothing(right) ? Empty() : B.struct.modifier.intersectBy({ 0: left, by: right });
  if (isNothing(left)) return right;
  if (isNothing(right)) return left;
  return B.struct.combinator.merge([left, right]);
}

const isNothing = (e: Expression) =>
  Expression.isApply(e) && Expression.isSymbol(e.head) && e.head.name === 'structure-query.generator.empty';

/** Why nothing read at the start: the word that is no selector, else the place. */
function noSpec(r: Reader): Error {
  if (r.unknownWord) return new Error(`"${r.unknownWord.word}" is not a selector name`);
  return new Error(r.s.trim() ? `not an atom specifier at ${r.furthest}` : 'empty atom specifier');
}

/** A spec read from the start of `text`: its MolQL and where it ended (the rest is the command's). */
export interface AtomSpecPrefix {
  readonly expression: Expression;
  /** The spec as written (quotes and `=` included). */
  readonly text: string;
  /** Where the spec ends in `text`: the rest starts there (blanks first). */
  readonly end: number;
  /** A spec of models side by side: its pieces in the order written (`piecesOf`). */
  readonly pieces?: readonly Expression[];
}

/**
 * Reads an atom spec at the start of `text` as ChimeraX does (`AtomSpecArg.parse`): as far as it reads; when that ends
 * inside a word, it ends at the blank before the word instead (`/A:12 red` → `/A:12`, the rest ` red`). A spec in
 * double quotes is the quotes' contents, whole. Throws when no spec reads there.
 */
export function parseAtomSpec(text: string, options?: ChimeraxTranspileOptions): AtomSpecPrefix {
  const id = options?.modelId ?? [1];
  if (text.startsWith('"')) {
    const close = /"(\s|$)/g;
    close.lastIndex = 1;
    const m = close.exec(text);
    if (!m) throw new Error('incomplete quoted text');
    const inner = text.slice(1, m.index);
    return {
      expression: transpile(inner.startsWith('=') ? inner.slice(1) : inner, options),
      text: text.slice(0, m.index + 1),
      end: m.index + 1,
    };
  }
  const offset = text.startsWith('=') ? 1 : 0;
  const read = (upTo: number) => {
    const r = new Reader(text.slice(offset, upTo), options);
    const spec = atomSpecifier(r);
    return { r, spec, end: r.i };
  };
  let { r, spec, end } = read(text.length);
  if (!spec || end === 0) throw noSpec(r);
  const after = offset + end;
  if (after < text.length && !/[;\s]/.test(text[after])) {
    // Ended inside a word: back to the blank before it, as ChimeraX.
    let blank = after;
    while (blank > offset && !Blank.test(text[blank])) blank--;
    if (blank === offset) throw new Error(`only the start "${text.slice(0, after)}" of the atom specifier reads`);
    ({ r, spec, end } = read(blank));
    if (!spec || end === 0) throw noSpec(r);
  }
  const pieces = piecesOf(spec, id);
  return {
    expression: specExpr(spec, id),
    text: text.slice(0, offset + end),
    end: offset + end,
    ...(pieces ? { pieces } : {}),
  };
}

function transpile(source: string, options: ChimeraxTranspileOptions | undefined): Expression {
  const r = new Reader(source, options);
  const spec = atomSpecifier(r);
  if (!spec) throw noSpec(r);
  if (source.slice(r.i).trim()) {
    const at = r.i + (source.slice(r.i).length - source.slice(r.i).trimStart().length);
    if (r.unknownWord && r.unknownWord.at >= r.i) throw noSpec(r);
    throw new Error(`the atom specifier ends at ${at}: '${source.slice(at)}' does not read`);
  }
  return specExpr(spec, options?.modelId ?? [1]);
}

/** A whole text as one atom spec (a target field, a test): every character must read. */
export const transpiler: Transpiler = (source, options) => transpile(source, options as ChimeraxTranspileOptions);
