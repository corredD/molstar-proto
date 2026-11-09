/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Compartment, Entity, Id, MesoViewSpecDoc, Superstructure } from '@molstar/meso-spec/format';
import { type IR, type IRLook, type IRNode, type PlacementSet } from '@molstar/meso-spec/ir';
import type { CompileResult } from '@molstar/meso-spec/runtime';

// The open document as the Scene tree shows it (prism.md §4.1, §4.2): its compartments nested by `parent`, its
// populations and instances under them, a population's superstructure parts under it (made when first opened), each
// row standing for a MesoQL address. Made from the document and the IR, not from the lists. Incremental: the rows are
// kept while the document's sections, the counts and the grouping are the same objects (a patch shares what it does
// not touch), so a view edit (a look, the camera) rebuilds no row; only the eyes and dots are read again
// (`documentLooks`, O(types)).

export type DocumentGroupBy = 'compartment' | 'model' | 'kind';

export const DocumentGroupings: readonly (readonly [DocumentGroupBy, string])[] = [
  ['compartment', 'Compartment'],
  ['model', 'Model'],
  ['kind', 'Kind'],
];

export type DocumentRowKind = 'compartment' | 'population' | 'instance' | 'part' | 'model' | 'kind';

/** A row of the document: what it stands for (its address) and how many copies. */
export interface DocumentRow {
  /**
   * Stable across edits and groupings: a document id (a compartment, a population, an instance); a part
   * `<outer>/<inner>` (`/` is in no id); a group `@model:<id>`, `@kind:<kind>` (`@` is in no id).
   */
  readonly id: string;
  readonly kind: DocumentRowKind;
  readonly label: string;
  /** Its MesoQL address: its eye, focus and highlight act on it. */
  readonly select: string;
  readonly achieved: number;
  /** A population's target, when it has one. */
  readonly requested?: number;
  readonly parent?: string;
  readonly children: readonly string[];
  /** A population or instance of a superstructure entity drawn as parts: its parts' rows come when asked (`parts`). */
  readonly parts?: boolean;
  /** The entity a population, instance or part is of. */
  readonly entity?: Id;
  /** The document id it stands for (a population, an instance, a compartment, a model); a part: its inner population. */
  readonly ref?: Id;
  /** The model that placed its copies (a population, an instance). */
  readonly model?: string;
}

/** The rows of the open document under one grouping. */
export interface DocumentOutline {
  readonly title: string;
  /** Copies drawn: the populations' and instances', the parts' through every instance. */
  readonly copies: number;
  readonly groupBy: DocumentGroupBy;
  readonly roots: readonly string[];
  /** A row by id; a part's is made (with its siblings) when first asked for. */
  row(id: string): DocumentRow | undefined;
  /** A row's children: its own, then its parts (made on demand). */
  children(id: string): readonly DocumentRow[];
  /** The rows above a row, nearest first; undefined when it is no row. */
  ancestors(id: string): string[] | undefined;
}

type Counts = CompileResult['counts'];

interface Inputs {
  readonly doc: MesoViewSpecDoc;
  readonly ir: IR | undefined;
  readonly counts: Counts;
  readonly groupBy: DocumentGroupBy;
}

/** The last outline made, by its inputs: what a view edit finds again. */
const Made = new WeakMap<object, { inputs: Inputs; outline: DocumentOutline }[]>();

/** How many outlines were made (the scaling guard counts rebuilds). */
export const OutlineStats = { made: 0 };

/**
 * The document's rows under `groupBy`: the same outline (and the same row objects) while the document's sections, the
 * counts, the IR's tree and the grouping are the same.
 */
export function documentOutline(
  doc: MesoViewSpecDoc,
  ir: IR | undefined,
  counts: Counts,
  groupBy: DocumentGroupBy = 'compartment',
): DocumentOutline {
  const key = doc.populations;
  const kept = Made.get(key) ?? [];
  const found = kept.find((k) => sameInputs(k.inputs, doc, ir, counts, groupBy));
  if (found) return found.outline;
  const outline = makeOutline({ doc, ir, counts, groupBy });
  // one outline a grouping is kept (switching back and forth makes none again)
  Made.set(key, [
    ...kept.filter((k) => k.inputs.groupBy !== groupBy),
    { inputs: { doc, ir, counts, groupBy }, outline },
  ]);
  return outline;
}

function sameInputs(a: Inputs, doc: MesoViewSpecDoc, ir: IR | undefined, counts: Counts, groupBy: DocumentGroupBy) {
  const d = a.doc;
  return (
    a.groupBy === groupBy &&
    a.counts === counts &&
    a.ir?.root === ir?.root &&
    d.compartments === doc.compartments &&
    d.populations === doc.populations &&
    d.instances === doc.instances &&
    d.entities === doc.entities &&
    d.superstructures === doc.superstructures &&
    d.models === doc.models &&
    d.metadata === doc.metadata
  );
}

/** What the IR says of the copies: which model placed a population (or instance), and its (set, type) pairs. */
interface Placed {
  readonly model: Map<string, string>;
  /** Population (or instance) id → its sets' keys and type indices, world and template sets alike. */
  readonly pairs: Map<string, { readonly set: string; readonly type: number }[]>;
  /** The models in the order the IR resolved them (world level). */
  readonly models: string[];
}

function placedOf(ir: IR | undefined): Placed {
  const model = new Map<string, string>();
  const pairs = new Map<string, { set: string; type: number }[]>();
  const models: string[] = [];
  if (!ir) return { model, pairs, models };
  const visit = (n: IRNode, inside: boolean) => {
    if (n.kind === 'placements') {
      const s: PlacementSet = n.params.set;
      if (!inside && !models.includes(s.model)) models.push(s.model);
      for (const t of s.typeTable) {
        if (!inside && !model.has(t.population)) model.set(t.population, s.model);
        let p = pairs.get(t.population);
        if (!p) pairs.set(t.population, (p = []));
        p.push({ set: s.key, type: t.index });
      }
    }
    for (const c of n.children ?? []) visit(c, inside || n.kind === 'superstructure');
  };
  visit(ir.root, false);
  return { model, pairs, models };
}

/** Pairs by populations, kept with the IR's tree (a view edit keeps it). */
const PlacedOf = new WeakMap<object, Placed>();
function placed(ir: IR | undefined): Placed {
  if (!ir) return placedOf(undefined);
  let p = PlacedOf.get(ir.root);
  if (!p) PlacedOf.set(ir.root, (p = placedOf(ir)));
  return p;
}

const KindLabels: Readonly<Record<string, string>> = {
  protein: 'Proteins',
  complex: 'Complexes',
  'nucleic-acid': 'Nucleic acids',
  lipid: 'Lipids',
  glycan: 'Glycans',
  'small-molecule': 'Small molecules',
  assembly: 'Assemblies',
};

function makeOutline({ doc, ir, counts, groupBy }: Inputs): DocumentOutline {
  OutlineStats.made++;
  const rows = new Map<string, DocumentRow>();
  const roots: string[] = [];
  const entities = new Map<Id, Entity>(doc.entities.map((e) => [e.id, e]));
  for (const ss of doc.superstructures ?? []) for (const e of ss.entities ?? []) entities.set(e.id, e);
  const superstructures = new Map<Id, Superstructure>((doc.superstructures ?? []).map((s) => [s.id, s]));
  const at = placed(ir);
  const achieved = (id: Id) => counts[id]?.achieved ?? 0;

  const seen = new Set<Id>();
  const shared = new Set<Id>();
  for (const p of doc.populations) (seen.has(p.entity) ? shared : seen).add(p.entity);
  /** A population's or instance's row (no parent yet). */
  const leaf = (
    kind: 'population' | 'instance',
    id: Id,
    entity: Id,
    detail: 'parts' | 'entity' | undefined,
    label?: string,
  ): Mutable => {
    const e = entities.get(entity);
    const c = counts[id];
    const parts = !!e?.superstructure && superstructures.has(e.superstructure) && detail !== 'entity';
    return {
      id,
      kind,
      // two populations of one entity (packed and picked catalase) told apart by their ids
      label: label ?? (shared.has(entity) ? `${e?.label ?? entity} · ${id}` : (e?.label ?? entity)),
      select: `(${kind} ${id})`,
      achieved: c?.achieved ?? (kind === 'instance' ? 1 : 0),
      ...(c?.requested !== undefined ? { requested: c.requested } : {}),
      children: [],
      ...(parts ? { parts: true } : {}),
      entity,
      ref: id,
      ...(at.model.has(id) ? { model: at.model.get(id) } : {}),
    };
  };
  const leaves: Mutable[] = [
    ...doc.populations.map((p) => leaf('population', p.id, p.entity, p.detail)),
    ...(doc.instances ?? []).map((i) => leaf('instance', i.id, i.entity, i.detail, i.label)),
  ];
  const byId = new Map(leaves.map((l) => [l.id, l]));
  const compartmentOf = new Map<Id, Id>([
    ...doc.populations.map((p) => [p.id, p.compartment] as const),
    ...(doc.instances ?? []).map((i) => [i.id, i.compartment] as const),
  ]);
  // the copies a part row counts, and the document: a superstructure's parts once per instance
  const partCopies = (row: Mutable): number => {
    const ss = superstructures.get(entities.get(row.entity ?? '')?.superstructure ?? '');
    if (!ss || !row.parts) return 0;
    let n = 0;
    for (const p of ss.populations) n += achieved(p.id);
    return n * row.achieved;
  };

  const add = (row: Mutable, parent: Mutable | undefined) => {
    if (parent) {
      row.parent = parent.id;
      parent.children.push(row.id);
    } else roots.push(row.id);
    rows.set(row.id, row);
  };

  if (groupBy === 'compartment') {
    const byParent = new Map<Id | undefined, Compartment[]>();
    const known = new Set(doc.compartments.map((c) => c.id));
    for (const c of doc.compartments) {
      const p = c.parent && known.has(c.parent) ? c.parent : undefined;
      const list = byParent.get(p);
      if (list) list.push(c);
      else byParent.set(p, [c]);
    }
    const leavesIn = new Map<Id, Mutable[]>();
    for (const l of leaves) {
      const c = compartmentOf.get(l.id)!;
      const list = leavesIn.get(c);
      if (list) list.push(l);
      else leavesIn.set(c, [l]);
    }
    // a compartment's rows: its compartments, then its populations and instances; its count all of them, nested
    const walk = (c: Compartment, parent: Mutable | undefined, seen: Set<Id>): number => {
      if (seen.has(c.id)) return 0;
      seen.add(c.id);
      const row: Mutable = {
        id: c.id,
        kind: 'compartment',
        label: c.label,
        select: `(in ${c.id})`,
        achieved: 0,
        children: [],
        ref: c.id,
      };
      add(row, parent);
      let n = 0;
      for (const child of byParent.get(c.id) ?? []) n += walk(child, row, seen);
      for (const l of leavesIn.get(c.id) ?? []) {
        add(l, row);
        n += l.achieved + partCopies(l);
      }
      row.achieved = n;
      return n;
    };
    const seen = new Set<Id>();
    for (const c of byParent.get(undefined) ?? []) walk(c, undefined, seen);
    // a compartment in a loop of parents has no root: listed at the top all the same
    for (const c of doc.compartments) if (!seen.has(c.id)) walk(c, undefined, seen);
    // a population whose compartment is unknown (the validation says so): at the top
    for (const l of leaves) if (!rows.has(l.id)) add(l, undefined);
  } else if (groupBy === 'model') {
    const models = new Map<string, Mutable>();
    const docModels = new Map((doc.models ?? []).map((m) => [m.id, m]));
    const realizedBy = new Map<Id, string>();
    for (const m of doc.models ?? []) for (const p of m.populations) realizedBy.set(p, m.id);
    // the IR's models first (what built the copies), then the document's that placed nothing
    const order = [...at.models, ...(doc.models ?? []).map((m) => m.id).filter((m) => !at.models.includes(m))];
    const groupOf = (model: string): Mutable => {
      let g = models.get(model);
      if (g) return g;
      const m = docModels.get(model);
      g = {
        id: `@model:${model}`,
        kind: 'model',
        label: m?.label ?? (model.startsWith('default:') ? `${model.slice('default:'.length)} (default)` : model),
        select: m ? `(model ${model})` : '',
        achieved: 0,
        children: [],
        ref: model,
      };
      models.set(model, g);
      return g;
    };
    for (const m of order) groupOf(m);
    const unplaced: Mutable = {
      id: '@model:',
      kind: 'model',
      label: 'Not placed',
      select: '',
      achieved: 0,
      children: [],
    };
    for (const l of leaves) {
      const m = l.model ?? realizedBy.get(l.id);
      const g = m !== undefined ? groupOf(m) : unplaced;
      g.children.push(l.id);
      g.achieved += l.achieved + partCopies(l);
    }
    for (const g of [...models.values(), unplaced]) {
      if (!g.children.length) continue;
      const kids = g.children.splice(0);
      if (!g.select) g.select = anyOf(kids.map((id) => byId.get(id)!.select));
      add(g, undefined);
      for (const id of kids) add(byId.get(id)!, g);
    }
  } else {
    const kinds = new Map<string, Mutable>();
    for (const l of leaves) {
      const kind = entities.get(l.entity ?? '')?.kind ?? 'unknown';
      let g = kinds.get(kind);
      if (!g) {
        g = {
          id: `@kind:${kind}`,
          kind: 'kind',
          label: KindLabels[kind] ?? kind,
          select: '',
          achieved: 0,
          children: [],
        };
        kinds.set(kind, g);
      }
      g.children.push(l.id);
      g.achieved += l.achieved + partCopies(l);
    }
    for (const g of kinds.values()) {
      const kids = g.children.splice(0);
      g.select = anyOf(kids.map((id) => byId.get(id)!.select));
      add(g, undefined);
      for (const id of kids) add(byId.get(id)!, g);
    }
  }

  let copies = 0;
  for (const l of leaves) copies += l.achieved + partCopies(l);

  // parts, made when first asked for: a superstructure's rows under each population (or instance) drawn as parts
  const partsMade = new Set<string>();
  const makeParts = (outer: DocumentRow) => {
    if (partsMade.has(outer.id)) return;
    partsMade.add(outer.id);
    const ss = superstructures.get(entities.get(outer.entity ?? '')?.superstructure ?? '');
    if (!ss) return;
    const self = rows.get(outer.id) as Mutable;
    const instances = outer.achieved;
    // the address of the instances the parts are in: the outer row's; a part of a part has no address of its own
    const of = outer.kind === 'part' ? undefined : outer.select;
    const known = new Set(ss.compartments.map((c) => c.id));
    const byParent = new Map<Id | undefined, Compartment[]>();
    for (const c of ss.compartments) {
      const p = c.parent && known.has(c.parent) ? c.parent : undefined;
      const list = byParent.get(p);
      if (list) list.push(c);
      else byParent.set(p, [c]);
    }
    const popsIn = new Map<Id, Superstructure['populations'][number][]>();
    for (const p of ss.populations) {
      const list = popsIn.get(p.compartment);
      if (list) list.push(p);
      else popsIn.set(p.compartment, [p]);
    }
    const part = (p: Superstructure['populations'][number], parent: Mutable): number => {
      const e = entities.get(p.entity);
      const c = counts[p.id];
      const nested = !!e?.superstructure && superstructures.has(e.superstructure) && p.detail !== 'entity';
      const row: Mutable = {
        id: `${outer.id}/${p.id}`,
        kind: 'part',
        label: e?.label ?? p.entity,
        select: of ? `(part ${of} ${p.id})` : '',
        achieved: (c?.achieved ?? 0) * instances,
        ...(c?.requested !== undefined ? { requested: c.requested * instances } : {}),
        children: [],
        ...(nested ? { parts: true } : {}),
        entity: p.entity,
        ref: p.id,
      };
      add(row, parent);
      return row.achieved;
    };
    // the envelope (a compartment with no parent) is the outer row itself: its populations right under it; the
    // compartments inside it are rows
    const inner = (c: Compartment, parent: Mutable, seen: Set<Id>) => {
      if (seen.has(c.id)) return;
      seen.add(c.id);
      const row: Mutable = {
        id: `${outer.id}/${c.id}`,
        kind: 'compartment',
        label: c.label,
        select: '',
        achieved: 0,
        children: [],
        ref: c.id,
      };
      add(row, parent);
      for (const child of byParent.get(c.id) ?? []) inner(child, row, seen);
      for (const p of popsIn.get(c.id) ?? []) row.achieved += part(p, row);
      row.select = anyOf(row.children.map((id) => rows.get(id)!.select));
    };
    const seen = new Set<Id>();
    for (const env of byParent.get(undefined) ?? []) {
      seen.add(env.id);
      for (const child of byParent.get(env.id) ?? []) inner(child, self, seen);
      for (const p of popsIn.get(env.id) ?? []) part(p, self);
    }
    for (const c of ss.compartments) if (!seen.has(c.id)) inner(c, self, seen);
  };

  const ensure = (id: string): DocumentRow | undefined => {
    const r = rows.get(id);
    if (r) return r;
    // a part: its outer rows' parts made first, outermost first
    const slash = id.lastIndexOf('/');
    if (slash < 0) return undefined;
    const outer = ensure(id.slice(0, slash));
    if (outer?.parts) makeParts(outer);
    else if (outer?.kind === 'compartment') return undefined;
    return rows.get(id);
  };

  return {
    title: doc.metadata?.title || 'Untitled document',
    copies,
    groupBy,
    roots,
    row: ensure,
    children(id) {
      const r = ensure(id);
      if (!r) return [];
      if (r.parts) makeParts(r);
      return r.children.map((c) => rows.get(c)!);
    },
    ancestors(id) {
      let r = ensure(id);
      if (!r) return undefined;
      const out: string[] = [];
      while (r?.parent !== undefined) {
        out.push(r.parent);
        r = rows.get(r.parent);
      }
      return out;
    },
  };
}

type Mutable = { -readonly [K in keyof DocumentRow]: DocumentRow[K] } & { children: string[] };

/** One address for several (a group's): `(or …)`, or the one. */
function anyOf(selects: readonly string[]): string {
  const s = selects.filter(Boolean);
  return s.length === 1 ? s[0] : s.length ? `(or ${s.join(' ')})` : '';
}

// --- eyes and dots ------------------------------------------------------------------------------------------------------

/** What the shown view makes of each row: open eye (all of it shown), its one color. */
export interface DocumentLooks {
  /** All of the row's copies shown; a part: undefined (read-only in 3D: prism.md §4.1). */
  visible(id: string): boolean | undefined;
  /** Its one color, when all of its copies have the same stated one. */
  color(id: string): number | undefined;
}

/**
 * The eyes and dots of `outline`'s rows under `ir.view`: a population's (or instance's) from its (set, type) looks
 * (every type has one, `IRView.looks`), a group's from its rows. Read on demand, each row once: O(types + rows).
 */
export function documentLooks(outline: DocumentOutline, ir: IR | undefined): DocumentLooks {
  const looks = new Map<string, IRLook>();
  if (ir) for (const l of ir.view.looks) if (!l.runs) for (const t of l.types) looks.set(`${l.set}|${t}`, l);
  const pairs = placed(ir).pairs;
  const visible = new Map<string, boolean | undefined>();
  const color = new Map<string, number | undefined>();
  const leafLooks = (ref: string) => (pairs.get(ref) ?? []).map((p) => looks.get(`${p.set}|${p.type}`));
  const isVisible = (id: string): boolean | undefined => {
    if (visible.has(id)) return visible.get(id);
    const row = outline.row(id);
    let v: boolean | undefined;
    if (!row || row.kind === 'part' || (row.kind === 'compartment' && id.includes('/'))) v = undefined;
    else if (row.kind === 'population' || row.kind === 'instance') {
      v = leafLooks(row.ref!).every((l) => l?.visible !== false);
    } else {
      v = true;
      for (const c of row.children) if (isVisible(c) === false) v = false;
    }
    visible.set(id, v);
    return v;
  };
  const colorOf = (id: string): number | undefined => {
    if (color.has(id)) return color.get(id);
    const row = outline.row(id);
    let c: number | undefined;
    if (row && (row.kind === 'population' || row.kind === 'instance')) {
      const all = leafLooks(row.ref!);
      c = all[0]?.color;
      if (c === undefined || all.some((l) => l?.color !== c)) c = undefined;
    }
    color.set(id, c);
    return c;
  };
  return { visible: isVisible, color: colorOf };
}

/** Whether every row of the document is shown (its own eye, the Particles category's). */
export function documentVisible(outline: DocumentOutline, looks: DocumentLooks): boolean {
  return outline.roots.every((id) => looks.visible(id) !== false);
}
