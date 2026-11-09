/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// The S-expression spelling (design.md §3.7): one tree, three spellings, as SeqQL has them
// (packages/sequences/_spec/seqql.md "Overview"): the S-expression for people, agents and tests; JSON for storage;
// the builder/types for code. This file is the reader, the printer and the codec between the S-expression and JSON.
// Conventions follow SeqQL's printer (packages/sequences/core/src/query/print.ts): positionals, then `:keyword`
// arguments, one line when it fits in 80 columns, else one argument a line, two spaces in. It is written here, not
// imported: meso-spec imports nothing of Mol* (biome.json).
//
// The data codec, JSON → S-expression:
// - an item of a document section (`entities`, `populations`, …) → `(entity e.catalase :label catalase …)`: the
//   section's singular as the head, its id as the first positional;
// - another object with a `kind` that is a word → `(sphere :radius 50)`: the kind as the head; with a `ref` (IR nodes),
//   the ref as the first positional;
// - a quantity `{value, unit}` → `(15 A)`;
// - any other object → a record `(:title "Exosome" :organism (:name "Homo sapiens"))`;
// - an array → `[a b c]`; null → `nil`; strings are words when they read back as the same string, else quoted;
// - camelCase keys → kebab-case keywords (`voxelSize` → `:voxel-size`); a key that would not read back (an id used as
//   a key, `p.ALB`) → a quoted keyword `:"p.ALB"`;
// - MesoQL expressions (the string values of `select`, `selection`, `at`, `target`, `entry`, `exit`) are inlined as
//   forms, not quoted strings: the address is written in its own spelling inside the document's.

export type SNode =
  | { readonly kind: 'list'; readonly items: readonly SNode[]; readonly start: number; readonly end: number }
  | { readonly kind: 'vector'; readonly items: readonly SNode[]; readonly start: number; readonly end: number }
  | {
      readonly kind: 'atom';
      readonly value: string | number | boolean | null;
      readonly raw: string;
      readonly start: number;
      readonly end: number;
    }
  /** `:name`; `quoted` when written `:"name"` (a key read back exactly, never re-cased). */
  | {
      readonly kind: 'keyword';
      readonly name: string;
      readonly quoted?: boolean;
      readonly start: number;
      readonly end: number;
    };

export interface SReadError {
  readonly message: string;
  readonly offset: number;
}

/** JSON's number grammar (as SeqQL's reader): a word that matches all of it is a number. */
export const NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;
const DELIMITER = /[ \t\r\n()";[\]]/;
/** A word that reads back as the same string. */
const WORD = /^[^ \t\r\n()";[\]:$][^ \t\r\n()";[\]]*$/;
const KEYWORD = /^[a-z][a-z0-9-]*$/;

/** Reads every top-level form of a text. Never throws: the first error stops it. */
export function readSexpr(text: string): { nodes: SNode[]; error?: SReadError } {
  let i = 0;
  const n = text.length;
  const stack: { kind: 'list' | 'vector'; items: SNode[]; start: number }[] = [];
  const top: SNode[] = [];
  const push = (node: SNode) => (stack.length ? stack[stack.length - 1].items.push(node) : top.push(node));
  const fail = (message: string, offset: number) => ({ nodes: top, error: { message, offset } });
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }
    if (c === ';') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '(' || c === '[') {
      stack.push({ kind: c === '(' ? 'list' : 'vector', items: [], start: i });
      i++;
      continue;
    }
    if (c === ')' || c === ']') {
      const open = stack.pop();
      if (!open) return fail(`unexpected ${c}`, i);
      if ((open.kind === 'list') !== (c === ')'))
        return fail(`${c} closes a ${open.kind === 'list' ? '(' : '['} opened at ${open.start}`, i);
      push({ kind: open.kind, items: open.items, start: open.start, end: i + 1 });
      i++;
      continue;
    }
    if (c === '"') {
      const start = i;
      i++;
      while (i < n && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      if (i >= n) return fail('unterminated string', start);
      i++;
      const raw = text.slice(start, i);
      try {
        push({ kind: 'atom', value: JSON.parse(raw) as string, raw, start, end: i });
      } catch {
        return fail(`bad string ${raw}`, start);
      }
      continue;
    }
    if (c === ':') {
      const start = i;
      if (text[i + 1] === '"') {
        i++;
        const s = i;
        i++;
        while (i < n && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
        if (i >= n) return fail('unterminated keyword', start);
        i++;
        let name: string;
        try {
          name = JSON.parse(text.slice(s, i)) as string;
        } catch {
          return fail(`bad keyword ${text.slice(start, i)}`, start);
        }
        push({ kind: 'keyword', name, quoted: true, start, end: i });
        continue;
      }
      i++;
      while (i < n && !DELIMITER.test(text[i])) i++;
      const name = text.slice(start + 1, i);
      if (!KEYWORD.test(name)) return fail(`bad keyword :${name}`, start);
      push({ kind: 'keyword', name, start, end: i });
      continue;
    }
    const start = i;
    while (i < n && !DELIMITER.test(text[i])) i++;
    const raw = text.slice(start, i);
    const value = NUMBER.test(raw)
      ? Number(raw)
      : raw === 'true'
        ? true
        : raw === 'false'
          ? false
          : raw === 'nil'
            ? null
            : raw;
    push({ kind: 'atom', value, raw, start, end: i });
  }
  if (stack.length)
    return fail(`unclosed ${stack[stack.length - 1].kind === 'list' ? '(' : '['}`, stack[stack.length - 1].start);
  return { nodes: top };
}

// ---- printing ----

const WIDTH = 80;

/** A layout document: an atom's text, or a form with its parts. */
export type Doc =
  | string
  | { readonly open: '(' | '['; readonly head?: string; readonly parts: readonly (readonly [string | null, Doc])[] };

export function atomText(v: string | number | boolean | null): string {
  if (v === null) return 'nil';
  if (typeof v !== 'string') return String(v);
  return WORD.test(v) && !NUMBER.test(v) && v !== 'true' && v !== 'false' && v !== 'nil' ? v : JSON.stringify(v);
}

const close = (o: '(' | '[') => (o === '(' ? ')' : ']');
// a part key starting with NUL was written quoted and prints quoted again
const kw = (k: string) =>
  k.startsWith('\u0000') ? `:${JSON.stringify(k.slice(1))}` : KEYWORD.test(k) ? `:${k}` : `:${JSON.stringify(k)}`;

function flat(d: Doc): string {
  if (typeof d === 'string') return d;
  const head = d.head !== undefined ? [d.head] : [];
  const parts = d.parts.map(([k, v]) => (k === null ? flat(v) : `${kw(k)} ${flat(v)}`));
  return `${d.open}${[...head, ...parts].join(' ')}${close(d.open)}`;
}

/**
 * One line when it fits; else the head and the positionals that fit, then one argument a line, two spaces in from the
 * form's own column (a nested form indents from its parent's column, not from the end of its keyword, so deep trees
 * stay readable). A vector of atoms (a matrix, a point list) fills its lines instead of one atom a line.
 */
export function layout(d: Doc, column = 0): string {
  const line = flat(d);
  if (typeof d === 'string' || column + line.length <= WIDTH) return line;
  if (d.open === '[' && d.parts.every(([k, v]) => k === null && typeof v === 'string')) return fill(d, column);
  let out = d.open + (d.head ?? '');
  let k = 0;
  if (d.head !== undefined)
    for (; k < d.parts.length; k++) {
      const [key, v] = d.parts[k];
      const text = flat(v);
      if (key !== null || column + out.length + 1 + text.length > WIDTH) break;
      out += ` ${text}`;
    }
  // a vector's items and a record's keywords line up under their first; a headed form's arguments two spaces in
  const inner = column + (d.open === '[' || d.head === undefined ? 1 : 2);
  const pad = ' '.repeat(inner);
  for (; k < d.parts.length; k++) {
    const [key, v] = d.parts[k];
    const lead = key === null ? '' : `${kw(key)} `;
    const first = out.length === 1;
    const at = first ? column + 1 : inner;
    const text = flat(v);
    let body: string;
    if (typeof v === 'string' || at + lead.length + text.length <= WIDTH) body = `${lead}${text}`;
    else if (key === null) body = layout(v, at);
    // a keyword whose value does not fit: the value on the next line, two spaces in from the keyword
    else body = `${lead.trimEnd()}\n${' '.repeat(inner + 2)}${layout(v, inner + 2)}`;
    out += `${first ? '' : `\n${pad}`}${body}`;
  }
  return `${out}${close(d.open)}`;
}

function fill(d: Exclude<Doc, string>, column: number): string {
  const lines: string[] = [];
  let cur = '[';
  let width = column + 1;
  for (const [, v] of d.parts) {
    const t = v as string;
    const sep = cur === '[' || cur.trim() === '' ? '' : ' ';
    if (sep && width + 1 + t.length > WIDTH) {
      lines.push(cur);
      cur = ' '.repeat(column + 1) + t;
      width = column + 1 + t.length;
    } else {
      cur += sep + t;
      width += sep.length + t.length;
    }
  }
  lines.push(`${cur}]`);
  return lines.join('\n');
}

/** The canonical text of a single form already read (to reformat a MesoQL string). */
export function printNode(node: SNode): string {
  return layout(nodeDoc(node), 0);
}

function nodeDoc(node: SNode): Doc {
  if (node.kind === 'atom') return atomText(node.value);
  if (node.kind === 'keyword') return node.quoted ? `:${JSON.stringify(node.name)}` : kw(node.name);
  const items = node.items;
  if (node.kind === 'vector') return { open: '[', parts: pairs(items) };
  const [head, ...rest] = items;
  if (head && head.kind === 'atom' && typeof head.value === 'string')
    return { open: '(', head: atomText(head.value), parts: pairs(rest) };
  return { open: '(', parts: pairs(items) };
}

function pairs(items: readonly SNode[]): [string | null, Doc][] {
  const out: [string | null, Doc][] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'keyword' && i + 1 < items.length)
      out.push([it.quoted ? `\u0000${it.name}` : it.name, nodeDoc(items[++i])]);
    else out.push([null, nodeDoc(it)]);
  }
  return out;
}

// ---- the data codec ----

export interface DataCodec {
  /** Array keys whose items are id'd nodes, to their singular head (`entities` → `entity`). */
  readonly sections: Readonly<Record<string, string>>;
  /** The key a non-section object's first positional is (`ref` for IR nodes). */
  readonly positional?: string;
  /** The key the root's head is (`format`). */
  readonly root?: string;
  /** String-valued keys that hold an S-expression (MesoQL), written inline. */
  readonly inline?: readonly string[];
}

export const DocumentCodec: DataCodec = {
  sections: {
    frames: 'frame',
    alignments: 'alignment',
    resources: 'resource',
    entities: 'entity',
    compartments: 'compartment',
    populations: 'population',
    instances: 'instance',
    catalogs: 'catalog',
    relations: 'relation',
    models: 'model',
    evidence: 'evidence',
    activities: 'activity',
    views: 'view',
    annotations: 'annotation',
    superstructures: 'superstructure',
    tours: 'tour',
    sites: 'site',
    states: 'state',
  },
  root: 'format',
  inline: ['select', 'selection', 'at', 'target', 'entry', 'exit', 'focus', 'cutaway'],
};

export const IRCodec: DataCodec = { sections: {}, positional: 'ref', inline: [] };

const camelToKebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const kebabToCamel = (k: string) => k.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
/** The keyword a key prints as: kebab-case when it reads back as the same key, else quoted (a NUL marks it). */
const keyName = (k: string) => {
  const kebab = camelToKebab(k);
  return KEYWORD.test(kebab) && kebabToCamel(kebab) === k ? kebab : `\u0000${k}`;
};
const isQuantity = (o: Record<string, unknown>) => {
  const keys = Object.keys(o);
  return keys.length === 2 && typeof o.value === 'number' && typeof o.unit === 'string' && WORD.test(o.unit);
};
const isWord = (v: unknown): v is string =>
  typeof v === 'string' && WORD.test(v) && !NUMBER.test(v) && v !== 'true' && v !== 'false' && v !== 'nil';

function toDoc(v: unknown, codec: DataCodec, parentKey: string | undefined, root: boolean): Doc {
  if (v === null || v === undefined) return 'nil';
  if (typeof v !== 'object') {
    if (typeof v === 'string' && parentKey && codec.inline?.includes(parentKey) && v.trimStart().startsWith('(')) {
      const r = readSexpr(v);
      if (!r.error && r.nodes.length === 1) return nodeDoc(r.nodes[0]);
    }
    return atomText(v as string | number | boolean);
  }
  if (Array.isArray(v)) {
    const singular = parentKey ? codec.sections[parentKey] : undefined;
    return {
      open: '[',
      parts: v.map(
        (x) => [null, singular ? itemDoc(x, codec, singular) : toDoc(x, codec, undefined, false)] as [null, Doc],
      ),
    };
  }
  const o = v as Record<string, unknown>;
  if (isQuantity(o))
    return {
      open: '(',
      parts: [
        [null, atomText(o.value as number)],
        [null, atomText(o.unit as string)],
      ],
    };
  if (root && codec.root && isWord(o[codec.root]))
    return form(atomText(o[codec.root] as string), undefined, o, [codec.root], codec);
  if (isWord(o.kind)) {
    const pk = codec.positional;
    const pos = pk && isWord(o[pk]) ? (o[pk] as string) : undefined;
    return form(o.kind as string, pos, o, pos !== undefined ? ['kind', pk!] : ['kind'], codec);
  }
  return form(undefined, undefined, o, [], codec);
}

function itemDoc(x: unknown, codec: DataCodec, singular: string): Doc {
  const o = x as Record<string, unknown>;
  if (o && typeof o === 'object' && !Array.isArray(o) && isWord(o.id))
    return form(singular, o.id as string, o, ['id'], codec);
  return toDoc(x, codec, undefined, false);
}

function form(
  head: string | undefined,
  pos: string | undefined,
  o: Record<string, unknown>,
  skip: string[],
  codec: DataCodec,
): Doc {
  const parts: [string | null, Doc][] = [];
  if (pos !== undefined) parts.push([null, atomText(pos)]);
  for (const [k, val] of Object.entries(o)) {
    if (skip.includes(k) || val === undefined) continue;
    parts.push([keyName(k), toDoc(val, codec, k, false)]);
  }
  return { open: '(', head, parts };
}

/** JSON (a document, an IR summary, an issue list) as S-expression text. */
export function printData(value: unknown, codec: DataCodec = DocumentCodec): string {
  return layout(toDoc(value, codec, undefined, true), 0);
}

/** S-expression text back to JSON; the inverse of `printData` for the same codec. */
export function readData(text: string, codec: DataCodec = DocumentCodec): { value?: unknown; error?: SReadError } {
  const r = readSexpr(text);
  if (r.error) return { error: r.error };
  if (r.nodes.length !== 1) return { error: { message: `expected one form, read ${r.nodes.length}`, offset: 0 } };
  try {
    return { value: fromNode(r.nodes[0], codec, undefined, true, text) };
  } catch (e) {
    return { error: { message: (e as Error).message, offset: 0 } };
  }
}

function fromNode(node: SNode, codec: DataCodec, parentKey: string | undefined, root: boolean, text: string): unknown {
  if (node.kind === 'atom') return node.value;
  if (node.kind === 'keyword') throw new Error(`a keyword :${node.name} with no value`);
  // a MesoQL form (a list headed by a word) inside an inline key is kept as its canonical text; a record is data
  if (
    parentKey &&
    codec.inline?.includes(parentKey) &&
    node.kind === 'list' &&
    node.items[0]?.kind === 'atom' &&
    typeof node.items[0].value === 'string'
  )
    return printNode(node);
  if (node.kind === 'vector') {
    const singular = parentKey ? codec.sections[parentKey] : undefined;
    return node.items.map((it) =>
      singular && it.kind === 'list'
        ? fromItem(it, codec, singular, text)
        : fromNode(it, codec, undefined, false, text),
    );
  }
  const items = node.items;
  // a quantity: (15 A)
  if (
    items.length === 2 &&
    items[0].kind === 'atom' &&
    typeof items[0].value === 'number' &&
    items[1].kind === 'atom' &&
    typeof items[1].value === 'string'
  )
    return { value: items[0].value, unit: items[1].value };
  const o: Record<string, unknown> = {};
  let i = 0;
  if (items[0]?.kind === 'atom' && typeof items[0].value === 'string') {
    const head = items[0].value;
    if (root && codec.root) o[codec.root] = head;
    else o.kind = head;
    i = 1;
    if (!(root && codec.root) && items[1]?.kind === 'atom' && codec.positional) {
      o[codec.positional] = items[1].value;
      i = 2;
    }
  }
  readKeywords(items, i, o, codec, text);
  return o;
}

function fromItem(node: SNode & { kind: 'list' }, codec: DataCodec, singular: string, text: string): unknown {
  const items = node.items;
  if (items[0]?.kind === 'atom' && items[0].value === singular && items[1]?.kind === 'atom') {
    const o: Record<string, unknown> = { id: items[1].value };
    readKeywords(items, 2, o, codec, text);
    return o;
  }
  return fromNode(node, codec, undefined, false, text);
}

function readKeywords(
  items: readonly SNode[],
  from: number,
  o: Record<string, unknown>,
  codec: DataCodec,
  text: string,
) {
  for (let i = from; i < items.length; i++) {
    const k = items[i];
    if (k.kind !== 'keyword') throw new Error(`expected a :keyword at ${k.start}, found ${text.slice(k.start, k.end)}`);
    const v = items[++i];
    if (!v) throw new Error(`:${k.name} has no value`);
    const key = !k.quoted && KEYWORD.test(k.name) ? kebabToCamel(k.name) : k.name;
    o[key] = fromNode(v, codec, key, false, text);
  }
}
