/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type Issue, issue } from './issues.js';
import { readSexpr, type SNode } from './sexpr.js';

// MesoQL (design.md §3.8): declarative addresses into a mesoscale scene, after SeqQL and MolQL
// (packages/sequences/_spec/seqql.md). An address is schematized (written with document ids: "the copies of p.catalase
// in c.exosome", "HU's DNA entry site") and materialized by the runtime into MesoLoci (placement set → runs of copy
// indices), as Mol*'s Loci materialize a MolQL selection. The S-expression is the spelling people and agents write and
// the document stores; this file is the table, the checker and the parsed tree. Evaluation over an IR is in
// ir/loci.ts.

export type QType = 'selection' | 'site' | 'residues';

export interface QSymbol {
  readonly name: string;
  readonly full: string;
  readonly returns: QType;
  readonly description: string;
  /** Positional arguments: ids of a kind, or sub-expressions of a type. `rest` takes the remaining positionals. */
  readonly args: readonly {
    readonly name: string;
    /** `int`: a non-negative integer (an ordinal, a count). */
    readonly kind: 'id' | 'int' | 'word' | QType;
    readonly ref?: 'population' | 'instance' | 'entity' | 'compartment' | 'model' | 'superstructure';
    readonly rest?: boolean;
    readonly optional?: boolean;
  }[];
  readonly keywords?: Readonly<Record<string, 'number' | 'length' | 'bool' | 'word' | 'range' | 'selection'>>;
  readonly example: string;
}

export const MesoQLSymbols: readonly QSymbol[] = [
  {
    name: 'all',
    full: 'meso.all',
    returns: 'selection',
    description: 'every copy in the scene',
    args: [],
    example: '(all)',
  },
  {
    name: 'population',
    full: 'meso.population',
    returns: 'selection',
    description: 'the copies of populations',
    args: [{ name: 'ids', kind: 'id', ref: 'population', rest: true }],
    example: '(population p.catalase)',
  },
  {
    name: 'instance',
    full: 'meso.instance',
    returns: 'selection',
    description: 'copies stated individually, by id: the same copy across re-resolutions (unlike `copies`)',
    args: [{ name: 'ids', kind: 'id', ref: 'instance', rest: true }],
    example: '(instance i.granule-a)',
  },
  {
    name: 'entity',
    full: 'meso.entity',
    returns: 'selection',
    description: 'the copies of every population of these entities',
    args: [{ name: 'ids', kind: 'id', ref: 'entity', rest: true }],
    example: '(entity e.catalase)',
  },
  {
    name: 'in',
    full: 'meso.compartment',
    returns: 'selection',
    description:
      'the copies of the populations of compartments (and of the compartments inside them, unless :nested false)',
    args: [{ name: 'ids', kind: 'id', ref: 'compartment', rest: true }],
    keywords: { nested: 'bool', location: 'word' },
    example: '(in c.exosome :location membrane)',
  },
  {
    name: 'model',
    full: 'meso.model',
    returns: 'selection',
    description: 'the copies a model placed',
    args: [{ name: 'ids', kind: 'id', ref: 'model', rest: true }],
    example: '(model m.picks)',
  },
  {
    name: 'copies',
    full: 'meso.copies',
    returns: 'selection',
    description:
      'copies of one population by ordinal: from `start`, `count` of them (default 1); valid for one resolution',
    args: [
      { name: 'population', kind: 'id', ref: 'population' },
      { name: 'start', kind: 'int' },
      { name: 'count', kind: 'int', optional: true },
    ],
    example: '(copies p.catalase 12)',
  },
  {
    name: 'and',
    full: 'meso.and',
    returns: 'selection',
    description: 'copies in every operand',
    args: [{ name: 'operands', kind: 'selection', rest: true }],
    example: '(and (entity e.catalase) (in c.exosome))',
  },
  {
    name: 'or',
    full: 'meso.or',
    returns: 'selection',
    description: 'copies in any operand',
    args: [{ name: 'operands', kind: 'selection', rest: true }],
    example: '(or (population p.CD9) (population p.CD63))',
  },
  {
    name: 'not',
    full: 'meso.not',
    returns: 'selection',
    description: 'copies not in the operand (within :in, default every copy)',
    args: [{ name: 'operand', kind: 'selection' }],
    keywords: { in: 'selection' },
    example: '(not (entity e.lipid))',
  },
  {
    name: 'within',
    full: 'meso.within',
    returns: 'selection',
    description:
      'copies of the first selection whose centre is within :distance of a copy of :of (centres, the document length unit)',
    args: [{ name: 'operand', kind: 'selection' }],
    keywords: { of: 'selection', distance: 'length' },
    example: '(within (entity e.ALB) :of (population p.catalase.observed) :distance 20)',
  },
  {
    name: 'site',
    full: 'meso.site',
    returns: 'site',
    description: "a named site of an entity (its `sites`): a point and an axis in the entity's frame, one per copy",
    args: [
      { name: 'entity', kind: 'id', ref: 'entity' },
      { name: 'site', kind: 'word' },
    ],
    example: '(site e.hu dna-entry)',
  },
  {
    name: 'residues',
    full: 'meso.residues',
    returns: 'residues',
    description:
      "residues of an entity's structure, by chain and label range (a schematized address: needs the structure loaded)",
    args: [{ name: 'entity', kind: 'id', ref: 'entity' }],
    keywords: { chain: 'word', range: 'range' },
    example: '(residues e.hu :chain A :range 53-63)',
  },
  {
    name: 'part',
    full: 'meso.part',
    returns: 'selection',
    description: 'copies of an inner population of a superstructure, in the instances the first selection picks',
    args: [
      { name: 'instances', kind: 'selection' },
      { name: 'inner', kind: 'id', ref: 'population' },
    ],
    example: '(part (copies p.granules 12) p.Vamp2)',
  },
];

/**
 * A keyword's value against its type: a number, a length (not negative), a bool, a word; a label range is a word or a
 * number (`53-63`, `15`).
 */
function keywordFits(
  kt: Exclude<NonNullable<QSymbol['keywords']>[string], 'selection'>,
  v: string | number | boolean | null,
): v is string | number | boolean {
  if (kt === 'number') return typeof v === 'number';
  if (kt === 'length') return typeof v === 'number' && v >= 0;
  if (kt === 'bool') return typeof v === 'boolean';
  if (kt === 'word') return typeof v === 'string';
  return typeof v === 'string' || typeof v === 'number';
}

/** `a population`, `an instance`. */
const an = (w: string) => `${/^[aeiou]/.test(w) ? 'an' : 'a'} ${w}`;

const bySymbol = new Map(MesoQLSymbols.flatMap((s) => [[s.name, s] as const, [s.full, s] as const]));

/** A checked MesoQL expression: the symbol, its positional values (ids, numbers, sub-expressions) and keywords. */
export interface QExpr {
  readonly symbol: QSymbol;
  readonly args: readonly (string | number | QExpr)[];
  readonly keywords: Readonly<Record<string, string | number | boolean | QExpr>>;
}

export interface QContext {
  /** id → kind, for reference checks (`validate`'s DocIndex). */
  readonly kinds?: ReadonlyMap<string, string>;
  /** entity id → the names of its sites, to check `(site e name)`; an entity not in it is not checked. */
  readonly sites?: ReadonlyMap<string, readonly string[]>;
}

/**
 * Parses and checks an address; issues carry `path` (the document pointer it was found at). `want` is the type the
 * slot asks for (a look's `select` a selection, a relation's `entry` a site, a site's `at` residues); without it, the
 * type the address's own head returns.
 */
export function parseMesoQL(
  text: string,
  ctx: QContext = {},
  path?: string,
  want?: QType,
): { expr?: QExpr; issues: Issue[] } {
  const issues: Issue[] = [];
  const err = (code: string, message: string) =>
    issues.push(issue(`mesoql.${code}`, 'error', 'static', message, { path }));
  const r = readSexpr(text);
  if (r.error) {
    err('syntax', `${r.error.message} at ${r.error.offset} in ${text}`);
    return { issues };
  }
  if (r.nodes.length !== 1) {
    err('syntax', `an address is one form, read ${r.nodes.length}`);
    return { issues };
  }
  const check = (n: SNode, want: QType): QExpr | undefined => {
    if (n.kind !== 'list' || n.items[0]?.kind !== 'atom' || typeof n.items[0].value !== 'string') {
      err(
        'form',
        `expected a form like ${want === 'selection' ? '(entity e.x)' : '(site e.x name)'}, found ${text.slice(n.start, n.end)}`,
      );
      return undefined;
    }
    const head = n.items[0].value;
    const s = bySymbol.get(head);
    if (!s) {
      const near = MesoQLSymbols.filter((x) => x.name.startsWith(head.slice(0, 2))).map((x) => x.name);
      err('symbol.unknown', `no MesoQL symbol ${head}${near.length ? `; did you mean ${near.join(', ')}?` : ''}`);
      return undefined;
    }
    if (s.returns !== want) {
      err('type', `(${s.name} …) is a ${s.returns}; a ${want} is expected here`);
      return undefined;
    }
    const args: (string | number | QExpr)[] = [];
    const keywords: Record<string, string | number | boolean | QExpr> = {};
    const positional = n.items.slice(1);
    let a = 0;
    for (let i = 0; i < positional.length; i++) {
      const it = positional[i];
      if (it.kind === 'keyword') {
        const kt = s.keywords?.[it.name];
        const v = positional[++i];
        if (!kt) {
          err('keyword', `(${s.name}) takes no :${it.name}`);
          continue;
        }
        if (!v) {
          err('keyword', `:${it.name} has no value`);
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(keywords, it.name)) {
          err('keyword', `:${it.name} is given twice`);
          continue;
        }
        if (kt === 'selection') {
          const e = check(v, 'selection');
          if (e) keywords[it.name] = e;
        } else if (v.kind === 'atom' && keywordFits(kt, v.value)) {
          if (kt === 'range' && !/^-?\d+-?-?\d+$/.test(String(v.value)))
            err('range', `:${it.name} ${v.raw} is a label range like 53-63`);
          keywords[it.name] = v.value;
        } else err('keyword', `:${it.name} takes a ${kt}`);
        continue;
      }
      const def = s.args[Math.min(a, s.args.length - 1)];
      if (!def || (a >= s.args.length && !def.rest)) {
        err('arity', `(${s.name}) takes ${s.args.length} argument${s.args.length === 1 ? '' : 's'}`);
        break;
      }
      a++;
      if (def.kind === 'selection' || def.kind === 'site' || def.kind === 'residues') {
        const e = check(it, def.kind);
        if (e) args.push(e);
      } else if (it.kind === 'atom' && def.kind === 'int' && Number.isInteger(it.value) && (it.value as number) >= 0)
        args.push(it.value as number);
      else if (it.kind === 'atom' && typeof it.value === 'string' && (def.kind === 'id' || def.kind === 'word')) {
        if (def.kind === 'id' && def.ref && ctx.kinds) {
          const k = ctx.kinds.get(it.value);
          if (!k) err('ref.missing', `${it.value} names nothing (${s.name} takes a ${def.ref})`);
          else if (k !== def.ref) err('ref.kind', `${it.value} is ${an(k)}; (${s.name}) takes ${an(def.ref)}`);
        }
        args.push(it.value);
      } else err('argument', `${def.name} of (${s.name}) is a ${def.kind}, found ${text.slice(it.start, it.end)}`);
    }
    if (s.name === 'site' && typeof args[0] === 'string' && typeof args[1] === 'string') {
      const names = ctx.sites?.get(args[0]);
      if (names && !names.includes(args[1]))
        err('site', `${args[0]} has no site ${args[1]}${names.length ? `; its sites: ${names.join(', ')}` : ''}`);
    }
    const required = s.args.filter((x) => !x.optional && !x.rest).length;
    if (a < required || (s.args[0]?.rest && a === 0 && s.name !== 'all'))
      err('arity', `(${s.name}) needs ${s.args.map((x) => x.name).join(', ')}`);
    return { symbol: s, args, keywords };
  };
  const first = r.nodes[0];
  const head = first.kind === 'list' && first.items[0]?.kind === 'atom' ? String(first.items[0].value) : '';
  const expr = check(first, want ?? bySymbol.get(head)?.returns ?? 'selection');
  return { expr: issues.length ? undefined : expr, issues };
}

/** The canonical text of a checked expression (short names, positionals, then keywords). */
export function printMesoQL(e: QExpr): string {
  const atom = (v: string | number | boolean) =>
    typeof v === 'string' && /[\s()"[\]]/.test(v) ? JSON.stringify(v) : String(v);
  const parts = [e.symbol.name, ...e.args.map((a) => (typeof a === 'object' ? printMesoQL(a) : atom(a)))];
  for (const [k, v] of Object.entries(e.keywords))
    parts.push(`:${k}`, typeof v === 'object' ? printMesoQL(v) : atom(v));
  return `(${parts.join(' ')})`;
}

/** The markdown reference of the language, generated from the table (as SeqQL's reference is). */
export function mesoQLReference(): string {
  const rows = MesoQLSymbols.map(
    (s) =>
      `| \`${s.name}\` | ${s.returns} | ${s.args.map((a) => `${a.name}${a.rest ? '…' : ''}${a.optional ? '?' : ''}`).join(' ')}${
        s.keywords
          ? ` ${Object.keys(s.keywords)
              .map((k) => `:${k}`)
              .join(' ')}`
          : ''
      } | ${s.description} | \`${s.example}\` |`,
  );
  return ['| Symbol | Returns | Arguments | Meaning | Example |', '| --- | --- | --- | --- | --- |', ...rows].join(
    '\n',
  );
}
