/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Id, MesoViewSpecDoc } from './doc.js';
import { type Issue, issue } from './issues.js';
import { PatchCodec, printData, readData, type SReadError } from './sexpr.js';
import { validate } from './validate.js';

// Patches over a MesoViewSpec document (prism.md §2, design.md §3.1): Seq*'s, over this document. Ops by id (`set`,
// `remove`, `insert`, `move`); a node is a section item, or a view's look or annotation; the top-level fields
// `session`, `metadata` and `units` are set on the reserved id `document`. All or nothing: shapes, then the ops in
// order, then the result validated (static); any error leaves the document as it was. No cascade. Applying returns the
// inverse; `diff(a, b)` the patch from `a` to `b`. Untouched sections and items are shared (`===`).

export const PatchFormat = 'meso_view_spec_patch';
export const DocumentId = 'document';

/** A node: any object with an `id`. */
export type PatchNode = { readonly id: Id; readonly [field: string]: unknown };
export type Anchor = Id | 'first' | 'last';
export type ListKey = 'looks' | 'annotations';

/** Where an op names a list: a section (`parent: 'views'`), or a view's `looks` / `annotations` (`parent: 'v.x', list`). */
export interface At {
  readonly parent: string;
  readonly list?: ListKey;
  readonly after?: Anchor;
}
export type Op =
  | { readonly op: 'set'; readonly id: Id; readonly fields: Readonly<Record<string, unknown>> }
  | { readonly op: 'remove'; readonly id: Id }
  | ({ readonly op: 'insert'; readonly node: PatchNode } & At)
  | ({ readonly op: 'move'; readonly id: Id } & Partial<At>);

export interface Patch {
  readonly format: typeof PatchFormat;
  /** The revision it applies to; another (or none) refuses it. */
  readonly base?: string;
  /** The document's revision after it (the committer's). */
  readonly revision?: string;
  readonly ops: readonly Op[];
}

const Sections = [
  'frames',
  'alignments',
  'resources',
  'entities',
  'compartments',
  'populations',
  'instances',
  'catalogs',
  'relations',
  'models',
  'evidence',
  'activities',
  'views',
  'superstructures',
  'tours',
] as const;
type Section = (typeof Sections)[number];
/** What a document must keep as a list; the others leave when emptied. */
const Required: readonly string[] = ['entities', 'compartments', 'populations'];
/** The top-level fields `set` on `document` takes. */
const TopFields = ['session', 'metadata', 'units'] as const;
/** The order a document keeps its fields in: a field put back goes where it was (`set` on `document`). */
const DocOrder = [
  'format',
  'version',
  'revision',
  'metadata',
  'units',
  'frames',
  'alignments',
  'resources',
  'entities',
  'superstructures',
  'compartments',
  'populations',
  'instances',
  'catalogs',
  'relations',
  'models',
  'evidence',
  'activities',
  'views',
  'session',
  'tours',
  'custom',
];
/** The order a view keeps its fields in (doc.ts). */
const ViewOrder = ['id', 'label', 'frame', 'camera', 'looks', 'selection', 'annotations', 'cutaway', 'description'];
/** The sections a view edit leaves alone (`classifyEdit`'s strip). */
const ViewSections: readonly string[] = ['views', 'tours'];

type Where = { readonly section: Section } | { readonly view: Id; readonly list: ListKey };
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const isSection = (x: string): x is Section => (Sections as readonly string[]).includes(x);
const isList = (x: unknown): x is ListKey => x === 'looks' || x === 'annotations';
/** What a list holds: the same type of list for a move. */
const typeOf = (w: Where) => ('section' in w ? w.section : w.list);

const listOf = (doc: MesoViewSpecDoc, w: Where): readonly PatchNode[] =>
  (('section' in w ? doc[w.section] : doc.views?.find((v) => v.id === w.view)?.[w.list]) as
    | readonly PatchNode[]
    | undefined) ?? [];

/** The document with a list replaced: only that list's path copied; a list emptied is dropped unless required. */
function withList(doc: MesoViewSpecDoc, w: Where, list: readonly PatchNode[]): MesoViewSpecDoc {
  const keep = list.length > 0 || ('section' in w && Required.includes(w.section));
  // the key keeps its place: a patch and its inverse give the same bytes
  const put = (o: object, k: string): Obj => {
    if (k in o) return keep ? { ...o, [k]: list } : merge(o as Obj, { [k]: null });
    if (!keep) return o as Obj;
    const out = Object.entries(o);
    putField(out, k, list, 'section' in w ? DocOrder : ViewOrder);
    return Object.fromEntries(out);
  };
  if ('section' in w) return put(doc, w.section) as unknown as MesoViewSpecDoc;
  return { ...doc, views: doc.views?.map((v) => (v.id === w.view ? (put(v, w.list) as unknown as typeof v) : v)) };
}

/** The ids of the looks and annotations a node carries (a view's own lists). */
const nestedIds = (node: Obj): unknown[] =>
  [node.looks, node.annotations].flatMap((l) => (Array.isArray(l) ? l.map((x) => (x as PatchNode)?.id) : []));

/** An id the nodes bring that the document has (outside `except`, a view whose lists they replace) or twice; else none. */
function clash(doc: MesoViewSpecDoc, ids: unknown[], except?: Id): string | undefined {
  const seen = new Set<unknown>();
  for (const id of ids) {
    if (id === undefined) continue;
    if (seen.has(id)) return `${String(id)} is twice in the node`;
    seen.add(id);
    const at = typeof id === 'string' ? find(doc, id) : undefined;
    if (at && !(except !== undefined && 'view' in at.w && at.w.view === except))
      return `${String(id)} is already in the document`;
  }
}

/** What a patch reads: sections are lists of objects, a view's looks and annotations too (`validate` says the rest). */
function wellFormed(doc: unknown): boolean {
  const list = (xs: unknown) => xs === undefined || (Array.isArray(xs) && xs.every(isObj));
  if (!isObj(doc) || !Sections.every((s) => list(doc[s]))) return false;
  return ((doc.views ?? []) as Obj[]).every((v) => list(v.looks) && list(v.annotations));
}

/** A node's place: the list, its index. */
function find(doc: MesoViewSpecDoc, id: Id): { w: Where; i: number } | undefined {
  for (const s of Sections) {
    const i = ((doc[s] ?? []) as readonly PatchNode[]).findIndex((x) => x?.id === id);
    if (i >= 0) return { w: { section: s }, i };
  }
  for (const v of doc.views ?? [])
    for (const list of ['looks', 'annotations'] as const) {
      const i = (v[list] ?? ([] as readonly PatchNode[])).findIndex((x) => (x as PatchNode)?.id === id);
      if (i >= 0) return { w: { view: v.id, list }, i };
    }
}

const place = (w: Where): { parent: string; list?: ListKey } =>
  'section' in w ? { parent: w.section } : { parent: w.view, list: w.list };
/** A look put back after one with no id could not be anchored: the inverse then sets the view's whole list. */
const unanchored = (w: Where, list: readonly PatchNode[], i: number) =>
  !('section' in w) && i > 0 && typeof list[i - 1]?.id !== 'string';
const wholeList = (w: Where, list: readonly PatchNode[]): Op => ({
  op: 'set',
  id: (w as { view: Id }).view,
  fields: { [(w as { list: ListKey }).list]: list },
});
const prevOf = (list: readonly PatchNode[], i: number): Anchor => (i === 0 ? 'first' : list[i - 1].id);
/** The index an anchor gives in a list (the node itself, if in it, is not counted); -1: no such sibling. */
function slot(list: readonly PatchNode[], after: Anchor | undefined): number {
  if (after === undefined || after === 'last') return list.length;
  if (after === 'first') return 0;
  const j = list.findIndex((x) => x.id === after);
  return j < 0 ? -1 : j + 1;
}
const splice = (list: readonly PatchNode[], i: number, drop: number, ...add: PatchNode[]) => {
  const out = [...list];
  out.splice(i, drop, ...add);
  return out;
};
/** A list a patch names, or why not. */
function whereOf(doc: MesoViewSpecDoc, parent: unknown, list: unknown): Where | string {
  if (list !== undefined) {
    if (!isList(list)) return `list is looks or annotations, not ${JSON.stringify(list)}`;
    return doc.views?.some((v) => v.id === parent) ? { view: parent as Id, list } : `${String(parent)} is no view`;
  }
  return typeof parent === 'string' && isSection(parent)
    ? { section: parent }
    : `${String(parent)} is no section (a view's looks and annotations take a list)`;
}

/** A new field goes before the first field `order` puts after it, else last. */
function putField(entries: [string, unknown][], f: string, v: unknown, order: readonly string[]) {
  const at = order.indexOf(f);
  const i = at < 0 ? -1 : entries.findIndex(([g]) => order.indexOf(g) > at);
  entries.splice(i < 0 ? entries.length : i, 0, [f, v]);
}

/** A shallow merge: each field replaces, `null` removes; a new field goes where `order` has it (else last). */
function merge(cur: Obj, fields: Obj, order: readonly string[] = []): Obj {
  const out: [string, unknown][] = Object.entries(cur);
  for (const [f, v] of Object.entries(fields)) {
    const k = out.findIndex(([g]) => g === f);
    if (v === null) {
      if (k >= 0) out.splice(k, 1);
    } else if (k >= 0) out[k] = [f, v];
    else putField(out, f, v, order);
  }
  return Object.fromEntries(out);
}

class Refused extends Error {}
const refuse = (k: number, code: 'patch.shape' | 'patch.base' | 'patch.target', message: string): never => {
  throw Object.assign(new Refused(message), { k, code });
};

/** One op applied; the document, its inverse ops (forward order) and the ids it touched. */
function step(doc: MesoViewSpecDoc, raw: unknown, k: number): { doc: MesoViewSpecDoc; inverse: Op[]; touched: Id[] } {
  const bad = (m: string) => refuse(k, 'patch.target', m);
  const shape = (m: string) => refuse(k, 'patch.shape', m);
  if (!isObj(raw)) return shape('an op is an object');
  const op = raw as unknown as Op;
  if (op.op === 'insert') {
    if (!isObj(op.node) || typeof op.node.id !== 'string') return shape('insert takes a node with an id');
    const w = whereOf(doc, op.parent, op.list);
    if (typeof w === 'string') return bad(w);
    if (op.node.id === DocumentId || find(doc, op.node.id)) return bad(`${op.node.id} is already in the document`);
    const dup = clash(doc, nestedIds(op.node));
    if (dup) return bad(dup);
    const list = listOf(doc, w);
    const at = slot(list, op.after);
    if (at < 0) return bad(`after ${String(op.after)} names no sibling in ${op.parent}`);
    return {
      doc: withList(doc, w, splice(list, at, 0, op.node)),
      inverse: [{ op: 'remove', id: op.node.id }],
      touched: [op.node.id],
    };
  }
  if (op.op !== 'set' && op.op !== 'remove' && op.op !== 'move')
    return shape(`op is set, remove, insert or move, not ${JSON.stringify((raw as Obj).op)}`);
  if (typeof op.id !== 'string') return shape(`${op.op} takes the id of a node`);
  if (op.op === 'set') {
    const { fields } = op;
    if (!isObj(fields)) return shape('set takes fields, {name: value}, null removes a field');
    if ('id' in fields || 'kind' in fields) return shape('set never changes an id or a kind (replace the node)');
    const dup = clash(doc, nestedIds(fields), op.id);
    if (dup) return bad(dup);
    if (op.id === DocumentId) {
      const f = Object.keys(fields).find((x) => !(TopFields as readonly string[]).includes(x));
      if (f) return shape(`set on ${DocumentId} takes ${TopFields.join(', ')}, not ${f}`);
      if (fields.metadata === null) return shape('a document has its metadata (a title)');
      const cur = doc as unknown as Obj;
      return {
        doc: merge(cur, fields, DocOrder) as unknown as MesoViewSpecDoc,
        inverse: [
          {
            op: 'set',
            id: DocumentId,
            fields: Object.fromEntries(Object.keys(fields).map((x) => [x, cur[x] ?? null])),
          },
        ],
        touched: [DocumentId],
      };
    }
    const at = find(doc, op.id);
    if (!at) return bad(`${op.id} names no node a patch can address`);
    const list = listOf(doc, at.w);
    const cur = list[at.i] as Obj;
    // a field removed and put back would land last: the inverse of that is the node itself, where it was
    const dropped = Object.entries(fields).some(([f, v]) => v === null && f in cur);
    const inverse: Op[] =
      unanchored(at.w, list, at.i) && dropped
        ? [wholeList(at.w, list)]
        : dropped
          ? [
              { op: 'remove', id: op.id },
              { op: 'insert', node: cur as PatchNode, ...place(at.w), after: prevOf(list, at.i) },
            ]
          : [{ op: 'set', id: op.id, fields: Object.fromEntries(Object.keys(fields).map((f) => [f, cur[f] ?? null])) }];
    return {
      doc: withList(doc, at.w, splice(list, at.i, 1, merge(cur, fields) as PatchNode)),
      inverse,
      touched: [op.id],
    };
  }
  const at = find(doc, op.id);
  if (!at) return bad(`${op.id} names no node a patch can address`);
  const list = listOf(doc, at.w);
  const node = list[at.i];
  const out = withList(doc, at.w, splice(list, at.i, 1));
  const back = { ...place(at.w), after: prevOf(list, at.i) };
  const wide = unanchored(at.w, list, at.i);
  if (op.op === 'remove')
    return { doc: out, inverse: [wide ? wholeList(at.w, list) : { op: 'insert', node, ...back }], touched: [op.id] };
  const to = op.parent === undefined ? at.w : whereOf(doc, op.parent, op.list);
  if (typeof to === 'string') return bad(to);
  if (typeOf(to) !== typeOf(at.w)) return bad(`${op.id} is in ${typeOf(at.w)}, not ${typeOf(to)}`);
  // within its own list the move is one change of that list (an emptied list is never in between)
  const sameList = JSON.stringify(to) === JSON.stringify(at.w);
  const dest = sameList ? splice(list, at.i, 1) : listOf(out, to);
  const i = slot(dest, op.after);
  if (i < 0) return bad(`after ${String(op.after)} names no sibling`);
  return {
    doc: withList(sameList ? doc : out, to, splice(dest, i, 0, node)),
    inverse: wide
      ? [...(sameList ? [] : [{ op: 'remove', id: op.id } as Op]), wholeList(at.w, list)]
      : [{ op: 'move', id: op.id, ...back }],
    touched: [op.id],
  };
}

export interface PatchResult {
  /** The new document, or the one given when refused. */
  readonly doc: MesoViewSpecDoc;
  /** The patch that undoes it (for the record: Prism's Undo is its checkpoints, prism.md §2.4); null when refused. */
  readonly inverse: Patch | null;
  readonly issues: readonly Issue[];
}

/** The node id a path into a document names: the deepest item on its way (`/views/0/looks/2/color`). */
function nodeAt(doc: MesoViewSpecDoc, path: string | undefined): Id | undefined {
  const [, s, i, l, j] = (path ?? '').split('/');
  const item = ((doc as unknown as Record<string, readonly PatchNode[] | undefined>)[s] ?? [])[Number(i)];
  const sub = l ? ((item as unknown as Obj)?.[l] as readonly PatchNode[] | undefined)?.[Number(j)] : undefined;
  return sub?.id ?? item?.id;
}

/** A patch: all or nothing. The result's issues are pathed at the last op that touched their node (else `/ops`). */
export function applyPatch(doc: MesoViewSpecDoc, patch: Patch): PatchResult {
  const fail = (issues: Issue[]) => ({ doc, inverse: null, issues });
  const one = (code: 'patch.shape' | 'patch.base', message: string, path: string) =>
    fail([issue(code, 'error', 'static', message, { path })]);
  if (!isObj(patch) || !Array.isArray(patch.ops))
    return one('patch.shape', `a patch is {format, base, revision, ops: [...]}`, '');
  if (patch.format !== undefined && patch.format !== PatchFormat)
    return one('patch.shape', `a patch's format is "${PatchFormat}", not ${JSON.stringify(patch.format)}`, '/format');
  if (patch.base !== undefined && patch.base !== doc.revision)
    return one(
      'patch.base',
      `for revision "${patch.base}"; the document is at ${doc.revision === undefined ? 'none' : `"${doc.revision}"`}`,
      '/base',
    );
  if (!wellFormed(doc)) return one('patch.shape', 'the document is not well formed (validate says where)', '');
  let next = doc;
  const inverse: Op[][] = [];
  const touched = new Map<Id, number>();
  try {
    patch.ops.forEach((op, k) => {
      const r = step(next, op, k);
      next = r.doc;
      inverse.unshift(r.inverse);
      for (const id of r.touched) touched.set(id, k);
    });
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    const k = (e as unknown as { k: number }).k;
    return fail([
      issue((e as unknown as { code: 'patch.shape' }).code, 'error', 'static', e.message, { path: `/ops/${k}` }),
    ]);
  }
  next = merge(next as unknown as Obj, { revision: patch.revision ?? null }, DocOrder) as unknown as MesoViewSpecDoc;
  const errors = validate(next).filter((i) => i.severity === 'error');
  if (errors.length)
    return fail(
      errors.map((i) => {
        const id = nodeAt(next, i.path) ?? i.ids?.[0];
        const k = id === undefined ? undefined : touched.get(id);
        return {
          ...i,
          path: k === undefined ? '/ops' : `/ops/${k}`,
          message: `${i.message}${i.path ? ` (at ${i.path})` : ''}`,
        };
      }),
    );
  const back: Patch = {
    format: PatchFormat,
    ...(patch.revision !== undefined ? { base: patch.revision } : {}),
    ...(doc.revision !== undefined ? { revision: doc.revision } : {}),
    ops: inverse.flat(),
  };
  return { doc: next, inverse: back, issues: [] };
}

/** Deep equality as JSON has it: a field that is `undefined` is not there. */
const equal = (x: unknown, y: unknown): boolean => {
  if (x === y) return true;
  if (!x || !y || typeof x !== 'object' || typeof y !== 'object' || Array.isArray(x) !== Array.isArray(y)) return false;
  const keys = (o: object) => Object.keys(o).filter((k) => (o as Obj)[k] !== undefined);
  const [kx, ky] = [keys(x), keys(y)];
  return kx.length === ky.length && kx.every((k) => k in y && equal((x as Obj)[k], (y as Obj)[k]));
};
/** A list a patch can address item by item: every item has an id, no two the same. */
const addressable = (xs: readonly PatchNode[] | undefined) =>
  (xs ?? []).every((x) => typeof x?.id === 'string') && new Set((xs ?? []).map((x) => x.id)).size === (xs ?? []).length;

/** The ops that turn one list into another, nodes matched by id: removes, then inserts and moves, then sets. */
function diffList(w: Where, a: readonly PatchNode[], b: readonly PatchNode[], ops: Op[], rm: Op[]) {
  // a node whose kind changed is a replacement: removed, and inserted again
  const next = new Map(b.map((y) => [y.id, y]));
  const kept = a.filter((x) => next.has(x.id) && equal(x.kind, next.get(x.id)?.kind));
  const ids = new Set(kept.map((x) => x.id));
  for (const x of a) if (!ids.has(x.id)) rm.push({ op: 'remove', id: x.id });
  const work = kept.map((x) => x.id);
  b.forEach((y, i) => {
    if (work[i] === y.id) return;
    const after = i === 0 ? 'first' : b[i - 1].id;
    if (work.includes(y.id)) {
      ops.push({ op: 'move', id: y.id, ...place(w), after });
      work.splice(work.indexOf(y.id), 1);
    } else ops.push({ op: 'insert', node: y, ...place(w), after });
    work.splice(i, 0, y.id);
  });
  const before = new Map(kept.map((x) => [x.id, x]));
  for (const y of b) {
    const x = before.get(y.id) as Obj | undefined;
    if (!x || x === y) continue;
    const fields: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const nested = (k === 'looks' || k === 'annotations') && 'section' in w && w.section === 'views';
      const [p, q] = [x[k] as PatchNode[] | undefined, (y as Obj)[k] as PatchNode[] | undefined];
      // a list emptied but kept is the view's field; else its items by id
      if (nested && Array.isArray(p) && Array.isArray(q) && q.length > 0 && addressable(p) && addressable(q))
        diffList({ view: y.id, list: k }, p, q, ops, rm);
      else if (!equal(x[k], (y as Obj)[k])) fields[k] = (y as Obj)[k] ?? null;
    }
    if (Object.keys(fields).length) ops.push({ op: 'set', id: y.id, fields });
  }
}

/**
 * The patch from `a` to `b`, nodes matched by id: applying it to `a` gives `b`. Null when it cannot say so: a field a
 * patch cannot name differs (`version`, `custom`), or a section has an item with no id or two with one.
 */
export function diff(a: MesoViewSpecDoc, b: MesoViewSpecDoc): Patch | null {
  if (!wellFormed(a) || !wellFormed(b)) return null;
  const [x, y] = [a as unknown as Obj, b as unknown as Obj];
  const ops: Op[] = [];
  // every removal first: a node that moves between lists leaves one before it enters the other
  const rm: Op[] = [];
  const fields: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if ((Sections as readonly string[]).includes(k) || k === 'revision') continue;
    if (!equal(x[k], y[k])) {
      if (!(TopFields as readonly string[]).includes(k)) return null;
      fields[k] = y[k] ?? null;
    }
  }
  if (Object.keys(fields).length) ops.push({ op: 'set', id: DocumentId, fields });
  for (const s of Sections) {
    const [p, q] = [(a[s] ?? []) as readonly PatchNode[], (b[s] ?? []) as readonly PatchNode[]];
    if (!addressable(p) || !addressable(q)) return null;
    diffList({ section: s }, p, q, ops, rm);
  }
  const all = [...rm, ...ops];
  const patch: Patch = {
    format: PatchFormat,
    ...(a.revision !== undefined ? { base: a.revision } : {}),
    ...(b.revision !== undefined ? { revision: b.revision } : {}),
    ops: all,
  };
  // what the ops reach, checked by replaying them (no validation: `b` is the caller's)
  const bare = (d: MesoViewSpecDoc) => ({ ...d, revision: undefined });
  try {
    return equal(bare(all.reduce((d, op, k) => step(d, op, k).doc, a)), bare(b)) ? patch : null;
  } catch {
    return null;
  }
}

/**
 * What a patch costs (prism.md §2.3), read from its ops: `view` when it touches only views, tours, `session` and
 * `metadata` (a view's looks and annotations are views'), else `model`. A patch that does not apply is `model`.
 */
export function classifyPatch(doc: MesoViewSpecDoc, patch: Patch): 'view' | 'model' {
  try {
    return classify(doc, patch);
  } catch {
    return 'model';
  }
}

function classify(doc: MesoViewSpecDoc, patch: Patch): 'view' | 'model' {
  const added = new Map<Id, Where>();
  const view = (w: Where | string | undefined) =>
    typeof w === 'object' && (!('section' in w) || ViewSections.includes(w.section));
  const where = (parent: string, list?: ListKey) =>
    list !== undefined && added.has(parent) ? { view: parent, list } : whereOf(doc, parent, list);
  const of = (id: Id) => added.get(id) ?? find(doc, id)?.w;
  for (const op of patch.ops) {
    if (op.op === 'set' && op.id === DocumentId) {
      if (Object.keys(op.fields).some((f) => f !== 'session' && f !== 'metadata')) return 'model';
    } else if (op.op === 'insert') {
      const w = where(op.parent, op.list);
      if (!view(w)) return 'model';
      added.set(op.node.id, w as Where);
    } else if (!view(of(op.id)) || (op.op === 'move' && op.parent !== undefined && !view(where(op.parent, op.list))))
      return 'model';
  }
  return 'view';
}

/** A patch as S-expression text. */
export function printPatch(patch: Patch): string {
  const { format: _, ops, ...rest } = patch;
  return printData({ kind: 'patch', ...rest, ops: ops.map(({ op, ...r }) => ({ kind: op, ...r })) }, PatchCodec);
}

/** S-expression text back to a patch; the inverse of `printPatch`. */
export function readPatch(text: string): { patch?: Patch; error?: SReadError } {
  const r = readData(text, PatchCodec);
  const v = r.value as { kind?: string; ops?: { kind: string }[] } | undefined;
  if (!v) return { error: r.error };
  if (v.kind !== 'patch' || !Array.isArray(v.ops))
    return { error: { message: 'expected (patch :ops [...])', offset: 0 } };
  const { kind: _, ops, ...rest } = v;
  if (!ops.every((o) => isObj(o) && typeof o.kind === 'string'))
    return { error: { message: 'every op is a form, (set id ...)', offset: 0 } };
  return { patch: { format: PatchFormat, ...rest, ops: ops.map(({ kind, ...o }) => ({ op: kind, ...o }) as Op) } };
}
