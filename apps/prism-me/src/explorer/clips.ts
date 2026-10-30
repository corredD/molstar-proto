/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type State, StateSelection, type StateObjectCell } from '@molstar/core/state';
import { Clip } from '@molstar/core/util/clip';
import { Structure, StructureElement } from '@molstar/model/model/structure';
import { RepresentationClip } from '@molstar/plugin/state/helpers/representation-clip';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import {
  MaxParticleCutIndex,
  type ParticleCutProps,
  ParticleRepresentation3DLayers,
} from '@molstar/plugin/state/transforms/particles/layers';
import { ClipVolumesTag } from '@molstar/plugin/state/transforms/shape/clip-volumes';
import { type ApiContext, ApiResult } from '@molstar/prism-viewer/api/area';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type {} from '@molstar/prism-viewer/features/clipping';
import type { NodeRef } from './operations.js';

// A clip and what it cuts (_spec/ui.md §3, §4; Ludo 2026-10-28): a clip is one Prism cut (its tag) over the
// representations it is given. Per object it cuts all of it, some of its particles (the representations' layers record
// them by the tag, Prism's clipping.md §5), or some of its atoms (the rest kept whole by the cut's group bit). Given one
// more object or part, or one less, through Prism's operations in one step (`explorer.clipUse`).

export type Cut = ViewerApi['clipping']['cuts']['value'][number];

/** The particle ids a cut is of, by kind (Prism's selector) */
export type Ids = {
  readonly entities: readonly number[];
  readonly compartments: readonly number[];
  readonly targets: readonly number[];
};

/** What a clip cuts of one object: all of it, some of its particles, or some of its atoms */
export interface CutOfObject {
  /** The object's ref */
  readonly ref: string;
  /** Its representations the cut is on */
  readonly on: readonly string[];
  /** Of some of its particles only: which (a model's entities, a list's targets) */
  readonly particles?: Ids;
  /** Of some of its atoms only: those it cuts, on the structure's root */
  readonly atoms?: StructureElement.Loci;
  /** Its records on the object's particles (Prism's, a part each), when it has any */
  readonly records?: readonly ParticleCutProps[];
  /** On particles (a model's, a list's): it can cut them in graded ways */
  readonly particled?: boolean;
}

/** The representations under an object that can be cut (not the cuts' drawings), in tree order */
export function clippableUnder(state: State, ref: string): StateObjectCell[] {
  const out: StateObjectCell[] = [];
  const walk = (r: string) => {
    const cell = state.cells.get(r);
    if (!cell || cell.transform.tags?.includes(ClipVolumesTag)) return;
    if (RepresentationClip.isClippable(cell)) out.push(cell);
    for (const child of state.tree.children.get(r).values()) walk(child);
  };
  walk(ref);
  return out;
}

const isParticles = (cell: StateObjectCell) => !!cell.obj && SO.Particle.Representation3D.is(cell.obj);
const structureOf = (cell: StateObjectCell): Structure | undefined =>
  cell.obj && SO.Molecule.Structure.Representation3D.is(cell.obj) ? cell.obj.data.sourceData : undefined;

/** The records of the cut tagged `tag` on a particle representation (its layers' cuts: a record a part, Prism's) */
function particleRecords(state: State, rep: string, tag: string): ParticleCutProps[] {
  const layers = state.select(StateSelection.Generators.ofTransformer(ParticleRepresentation3DLayers, rep))[0];
  const cuts = (layers?.transform.params as { cuts?: readonly ParticleCutProps[] } | undefined)?.cuts;
  return cuts?.filter((c) => c.tag === tag) ?? [];
}

/** A record's part, as Prism keys it (its ids are sorted) */
const partKey = (r: Ids) => `${r.entities}|${r.compartments}|${r.targets}`;

/** A record of every particle: no ids of any kind */
export const isCover = (r: Ids) => !r.entities.length && !r.compartments.length && !r.targets.length;

/** The ids of a cut's records, each kind's union: what it cuts of some particles; undefined when one is of all */
function unionOf(records: readonly ParticleCutProps[]): Ids | undefined {
  if (!records.length || records.some(isCover)) return undefined;
  if (records.length === 1) return records[0];
  const union = (kind: keyof Ids) => [...new Set(records.flatMap((r) => r[kind]))];
  return { entities: union('entities'), compartments: union('compartments'), targets: union('targets') };
}

/** A cut's representations' refs, as a Set once a cut (asked once an object) */
const Targets = new WeakMap<Cut, ReadonlySet<string>>();
function targetsOf(cut: Cut): ReadonlySet<string> {
  let t = Targets.get(cut);
  if (!t) Targets.set(cut, (t = new Set(cut.targets.map((x) => x.ref))));
  return t;
}

/** What `cut` cuts of the object `ref`; undefined when it is on none of its representations */
export function cutOfObject(
  state: State,
  cut: Cut,
  ref: string,
  reps = clippableUnder(state, ref),
): CutOfObject | undefined {
  const targets = targetsOf(cut);
  const on = reps.filter((c) => targets.has(c.transform.ref));
  if (!on.length) return undefined;
  const refs = on.map((c) => c.transform.ref);
  const tag = cut.object.tag;
  const first = tag ? on.find(isParticles) : undefined;
  const records = first && tag ? particleRecords(state, first.transform.ref, tag) : [];
  const some = unionOf(records);
  if (some) return { ref, on: refs, particles: some, records, particled: true };
  if (records.length) return { ref, on: refs, records, particled: true };
  if (first) return { ref, on: refs, particled: true };
  // a cut keeping some atoms whole: the atoms it cuts on this object's structure, when it keeps some of this one (its
  // kept atoms may be another structure's)
  const structure = on.map(structureOf).find((s) => !!s);
  if (cut.kept && cut.atoms && structure) {
    const atoms = cut.atoms.loci.find((l) => l.structure === structure.root);
    if (!atoms) return { ref, on: refs, atoms: StructureElement.Loci.none(structure.root) };
    // what its representations draw: their components' atoms (each once; components do not overlap)
    const drawnBy = new Set<Structure>();
    for (const c of on) {
      const s = structureOf(c);
      if (s) drawnBy.add(s);
    }
    let drawn = 0;
    for (const s of drawnBy) drawn += s.elementCount;
    if (StructureElement.Loci.size(atoms) < drawn) return { ref, on: refs, atoms };
  }
  return { ref, on: refs };
}

const refsOf = (cells: readonly StateObjectCell[]) => cells.map((c) => c.transform.ref);

/** The whole of a structure's root, as atoms */
const allAtoms = (s: Structure) => Structure.toStructureElementLoci(s.root);

/**
 * `nodes` (objects or parts) given to the clip tagged `tag` (`on`), or taken off it, as one step: Prism's
 * `clipping.apply` (an object's representations), `particles.look` (its cut of some particles), `clipping.keep` and
 * `release` (its atoms kept whole). A limit (16 objects a representation, 6 cuts of a part) is checked before the
 * first write; a run that fails fails the step, which puts the scene back.
 */
export async function useClip(
  ctx: ApiContext,
  lociOf: (node: NodeRef) => StructureElement.Loci | undefined,
  tag: string,
  nodes: readonly NodeRef[],
  on: boolean,
): Promise<ApiResult> {
  const cut = ctx.api.clipping?.cuts.value.find((c) => c.object.tag === tag);
  if (!cut) return ApiResult.fail('not-found', `There is no clip ${tag}.`);
  const name = `${CutNames[cut.object.type] ?? cut.object.type} ${cut.index}`;
  let changed = 0;
  // whole objects, cut all of or not at all already: one clipping.apply for all of them (one commit, not one each)
  const state = ctx.plugin.state.data;
  const each: NodeRef[] = [];
  const refs: string[] = [];
  for (const node of nodes) {
    if ('particles' in node || 'entity' in node) {
      each.push(node);
      continue;
    }
    const reps = clippableUnder(state, node.ref);
    const of = cutOfObject(state, cut, node.ref, reps);
    if (!on) {
      if (of) refs.push(...of.on);
    } else if (of && (of.particles || of.atoms)) {
      // cut in part: its record or its kept atoms change too
      each.push(node);
    } else {
      for (const c of reps) if (!of?.on.includes(c.transform.ref)) refs.push(c.transform.ref);
    }
  }
  if (refs.length) {
    const full = on
      ? refs.find(
          (r) =>
            (RepresentationClip.get(state.cells.get(r)?.transform.params)?.objects.length ?? 0) >= Clip.MaxObjectCount,
        )
      : undefined;
    if (full) return ApiResult.fail('blocked', `It has ${Clip.MaxObjectCount} clips already.`);
    const r = await ctx.api.run('clipping.apply', { tag, representations: refs, on });
    if (!r.ok) return r;
    if (!r.unchanged) changed++;
  }
  for (const node of each) {
    const r = await useOne(ctx, cut, lociOf, node, on);
    if (!r.ok) return r;
    if (!r.unchanged) changed++;
  }
  if (!changed) return ApiResult.already(on ? `${name} cuts it already.` : `${name} does not cut it.`);
  return ApiResult.ok(on ? `${name} cuts it too.` : `${name} no longer cuts it.`, {
    nodes: nodes.map((n) => n.ref),
  });
}

/** Prism's cut shapes, as the explorer names its clips */
const CutNames: Readonly<Record<string, string>> = {
  plane: 'Plane',
  sphere: 'Sphere',
  cube: 'Box',
  cylinder: 'Cylinder',
  infiniteCone: 'Cone',
};

const unchanged = ApiResult.already('');

async function useOne(
  ctx: ApiContext,
  first: Cut,
  lociOf: (node: NodeRef) => StructureElement.Loci | undefined,
  node: NodeRef,
  on: boolean,
): Promise<ApiResult> {
  const state = ctx.plugin.state.data;
  const tag = first.object.tag!;
  const reps = clippableUnder(state, node.ref);
  if (!reps.length) return ApiResult.fail('not-found', 'Nothing of it can be cut.');
  // the cut as it is now (an earlier node of the same run changed it)
  const cut = ctx.api.clipping!.cuts.value.find((c) => c.object.tag === tag) ?? first;
  const of = cutOfObject(state, cut, node.ref, reps);
  const apply = (refs: readonly string[], value: boolean) =>
    ctx.api.run('clipping.apply', { tag, representations: [...refs], on: value });
  const look = (refs: readonly string[], ids: Ids) =>
    ctx.api.run('particles.look', {
      node: refs.map((r) => `#${r}`).join(', '),
      cuts: {
        add: [{ tag, entities: [...ids.entities], compartments: [...ids.compartments], targets: [...ids.targets] }],
      },
    });
  const full = (cells: readonly StateObjectCell[], past: number) =>
    cells.find((c) => (RepresentationClip.get(c.transform.params)?.objects.length ?? 0) > past);
  const indexOf = (c: StateObjectCell) =>
    RepresentationClip.get(c.transform.params)?.objects.findIndex((o) => o.tag === tag) ?? -1;
  const onIt = (c: StateObjectCell) => !!of?.on.includes(c.transform.ref);
  const notOn = (cells: readonly StateObjectCell[]) => cells.filter((c) => !onIt(c));
  const blocked = (what: string) =>
    ApiResult.fail(
      'blocked',
      `Only the first ${MaxParticleCutIndex + 1} clips on it can cut ${what}.`,
      'Remove a clip from it first.',
    );

  // all of an object
  if (!('particles' in node) && !('entity' in node)) {
    if (!on) return of ? apply(of.on, false) : unchanged;
    const missing = notOn(reps);
    if (of && !of.particles && !of.atoms && !missing.length) return unchanged;
    if (full(missing, Clip.MaxObjectCount - 1))
      return ApiResult.fail('blocked', `It has ${Clip.MaxObjectCount} clips already.`);
    if (of?.particles) {
      const r = await ctx.api.run('particles.look', {
        node: refsOf(reps.filter((c) => onIt(c) && isParticles(c)))
          .map((r) => `#${r}`)
          .join(', '),
        cuts: { remove: [tag] },
      });
      if (!r.ok) return r;
    }
    if (of?.atoms) {
      // this structure's kept atoms only (another's stay kept)
      const structure = reps.map(structureOf).find((x) => !!x);
      const r = structure
        ? await ctx.api.run('clipping.release', { tag, target: { loci: allAtoms(structure) } })
        : ApiResult.ok('');
      if (!r.ok) return r;
    }
    return missing.length ? apply(refsOf(missing), true) : ApiResult.ok('');
  }

  // some particles of a model or a list (an entity's, a group's, a target's)
  if ('particles' in node) {
    const cells = reps.filter(isParticles);
    const kind = kindOf(node.particles);
    const part = node.particles[kind] ?? [];
    const has = new Set(of?.particles ? of.particles[kind] : []);
    const only = (ids: readonly number[]): Ids => ({ entities: [], compartments: [], targets: [], [kind]: ids });
    if (on) {
      if (of && !of.particles) return unchanged;
      const missing = part.filter((id) => !has.has(id));
      if (!missing.length) return unchanged;
      // a record of its own (Prism's cuts: a record a part), the plain cut; the clip's other parts keep theirs
      if (of) return look(refsOf(cells.filter(onIt)), only(missing));
      if (full(cells, MaxParticleCutIndex)) return blocked('some of its particles');
      const r = await look(refsOf(cells), only(part));
      return r.ok ? apply(refsOf(cells), true) : r;
    }
    if (!of) return unchanged;
    // each record without the part (all of it cut: a record of every particle, each its way kept)
    const drop = new Set(part);
    const records: readonly ParticleCutProps[] = of.records?.length
      ? of.records
      : [{ tag, entities: [], compartments: [], targets: [], mode: 'cut', band: 60, fuzziness: 0 }];
    const next: ParticleCutProps[] = [];
    for (const r of records) {
      const ids = isCover(r) ? allIds(cells[0], kind) : r[kind];
      if (!ids.some((id) => drop.has(id))) next.push(r);
      else {
        const rest = ids.filter((id) => !drop.has(id));
        if (rest.length) next.push({ ...r, [kind]: rest });
      }
    }
    if (next.length === records.length && next.every((r, i) => r === records[i])) return unchanged;
    // two records left of the same part: the last one only, in its place (Prism merges them into the first's place,
    // which would move the part's way before a record of another kind it was after)
    const last = new Map(next.map((r, i) => [partKey(r), i] as const));
    const kept = next.filter((r, i) => last.get(partKey(r)) === i);
    if (!next.length) return apply(of.on, false);
    const onCells = cells.filter(onIt);
    if (!of.particles && onCells.some((c) => indexOf(c) > MaxParticleCutIndex)) return blocked('some of its particles');
    return ctx.api.run('particles.look', {
      node: refsOf(onCells)
        .map((r) => `#${r}`)
        .join(', '),
      cuts: { remove: [tag], add: kept },
    });
  }

  // some atoms of a structure (an entity, a chain): the rest kept whole by the cut
  const part = lociOf(node);
  const cells = reps.filter((c) => !!structureOf(c));
  const structure = cells.length ? structureOf(cells[0]) : undefined;
  if (!part || !structure || StructureElement.Loci.isEmpty(part))
    return ApiResult.fail('not-found', 'No atoms of it are drawn.');
  const whole = allAtoms(structure);
  const keep = (loci: StructureElement.Loci) => ctx.api.run('clipping.keep', { tag, target: { loci } });
  if (on) {
    if (of && !of.atoms) return unchanged;
    if (of?.atoms && StructureElement.Loci.isSubset(of.atoms, part)) return unchanged;
    if (!of) {
      if (full(cells, MaxParticleCutIndex)) return blocked('a part of it');
      const r = await apply(refsOf(cells), true);
      if (!r.ok) return r;
      const rest = StructureElement.Loci.subtract(whole, part);
      return StructureElement.Loci.isEmpty(rest) ? r : keep(rest);
    }
    // the part cut again, on this structure only (another's kept atoms stay kept)
    return ctx.api.run('clipping.release', { tag, target: { loci: part } });
  }
  if (!of) return unchanged;
  const cutAtoms = of.atoms ?? whole;
  if (!StructureElement.Loci.areIntersecting(cutAtoms, part)) return unchanged;
  if (StructureElement.Loci.isEmpty(StructureElement.Loci.subtract(cutAtoms, part))) return apply(of.on, false);
  if (!of.atoms && reps.some((c) => of.on.includes(c.transform.ref) && indexOf(c) > MaxParticleCutIndex)) {
    return blocked('a part of it');
  }
  return keep(part);
}

/** A record's ids of a kind as a Set, made once a record (a list of what a clip cannot cut asks for each target) */
const IdSets = new WeakMap<Ids, Partial<Record<keyof Ids, ReadonlySet<number>>>>();
export function idSet(ids: Ids, kind: keyof Ids): ReadonlySet<number> {
  let sets = IdSets.get(ids);
  if (!sets) IdSets.set(ids, (sets = {}));
  return (sets[kind] ??= new Set(ids[kind]));
}

/** The kind of particle ids a node is by: a list's targets, a model's compartments, else its entities */
export function kindOf(p: {
  readonly entities?: readonly number[];
  readonly compartments?: readonly number[];
  readonly targets?: readonly number[];
}): keyof Ids {
  return p.targets?.length ? 'targets' : p.compartments?.length ? 'compartments' : 'entities';
}

/** Every id of a kind a particle representation's list has (its entities, compartments or targets) */
function allIds(cell: StateObjectCell | undefined, kind: keyof Ids): number[] {
  const list = cell?.obj && SO.Particle.Representation3D.is(cell.obj) ? cell.obj.data.sourceData : undefined;
  if (!list) return [];
  if (kind === 'entities') return [...(list.entityInfo?.keys() ?? [])];
  if (kind === 'compartments') return [...(list.compartmentInfo?.keys() ?? [])];
  return [...list.targetInfo.keys()];
}

/** How a clip cuts an object or part (cellVIEW's cut × ingredient, _spec/cellview.md §4.1): Prism's record's way */
export interface Way {
  readonly mode: 'cut' | 'keep' | 'wider';
  /** Å */
  readonly band: number;
  /** 0 to 1 */
  readonly fuzziness: number;
}

export const PlainCut: Way = { mode: 'cut', band: 60, fuzziness: 0 };
export const wayOfRecord = (r: Way): Way => ({ mode: r.mode, band: r.band, fuzziness: r.fuzziness });

/**
 * The way a clip cuts a node: an object, its last record of every particle; a part, the last record holding each of its
 * ids (Prism's: a later part wins), undefined when they differ (mixed); the plain cut without records
 */
export function wayOf(of: CutOfObject | undefined, node: NodeRef): Way | undefined {
  const records = of?.records;
  if (!records?.length) return PlainCut;
  if (!('particles' in node)) {
    for (let i = records.length - 1; i >= 0; --i) if (isCover(records[i])) return wayOfRecord(records[i]);
    return PlainCut;
  }
  const kind = kindOf(node.particles);
  let way: Way | undefined;
  for (const id of node.particles[kind] ?? []) {
    let r: ParticleCutProps | undefined;
    for (let i = records.length - 1; i >= 0 && !r; --i) {
      if (isCover(records[i]) || records[i][kind].includes(id)) r = records[i];
    }
    const w = r ? wayOfRecord(r) : PlainCut;
    if (way && !sameWay(way, w)) return undefined;
    way = w;
  }
  return way ?? PlainCut;
}

const sameWay = (a: Way, b: Way) => a.mode === b.mode && a.band === b.band && a.fuzziness === b.fuzziness;
const sorted = (ids: readonly number[]) => [...ids].sort((x, y) => x - y);

/**
 * A node's way in the clip tagged `tag` (Ludo, 2026-10-29). With a record of its own, that record changes in place: its
 * parts' records after it keep their ways (each its row in What it cuts). Without one, a record of its own goes last (so
 * it wins over a record of all the object, or of a group it is in), the records of its parts it holds gone; a part of a
 * clip of all the object gets a record of every particle, the plain cut, under it. A graded way (keeps a layer, cuts wider) is the instance clip's: the scene's cuts switch to instance in
 * the same step (`clipping.settings`: a representation's variant is the scene's at every cut written, so one
 * representation alone would not stay so); the plain cut leaves the variant as it is. One step (`explorer.clipWay`).
 */
export async function setWay(ctx: ApiContext, tag: string, node: NodeRef, way: Way): Promise<ApiResult> {
  const cut = ctx.api.clipping?.cuts.value.find((c) => c.object.tag === tag);
  if (!cut) return ApiResult.fail('not-found', `There is no clip ${tag}.`);
  const state = ctx.plugin.state.data;
  const of = cutOfObject(state, cut, node.ref);
  if (!of) return ApiResult.fail('not-found', 'The clip does not cut it.');
  const cells = of.on.map((r) => state.cells.get(r)!).filter((c) => c && isParticles(c));
  if (!cells.length || 'entity' in node) {
    return ApiResult.fail('invalid', 'Only particles are cut in graded ways.', 'Atoms and structures cut plainly.');
  }
  const none: Ids = { entities: [], compartments: [], targets: [] };
  const record = (ids: Ids, w: Way = way): ParticleCutProps => ({
    tag,
    entities: sorted(ids.entities),
    compartments: sorted(ids.compartments),
    targets: sorted(ids.targets),
    mode: w.mode,
    band: w.band,
    fuzziness: w.fuzziness,
  });
  const records = of.records ?? [];
  let own: Ids;
  let isOwn: (r: ParticleCutProps) => boolean;
  let isPart: (r: ParticleCutProps) => boolean;
  if (!('particles' in node)) {
    if (of.particles) return ApiResult.fail('invalid', 'The clip cuts some of it only: give its parts their way.');
    own = none;
    isOwn = isCover;
    isPart = () => true;
  } else {
    const kind = kindOf(node.particles);
    const part = sorted(node.particles[kind] ?? []);
    if (!holdsAll(of, kind, part)) return ApiResult.fail('invalid', 'The clip does not cut all of it.');
    const inPart = new Set(part);
    // a record of this kind only, of ids all in the part (the part's own: all of them)
    const only = (r: ParticleCutProps) =>
      (Object.keys(none) as (keyof Ids)[]).every((k) => k === kind || !r[k].length) &&
      r[kind].length > 0 &&
      r[kind].every((id) => inPart.has(id));
    own = { ...none, [kind]: part };
    isOwn = (r) => only(r) && r[kind].length === part.length;
    isPart = only;
  }
  let at = -1;
  for (let i = records.length - 1; i >= 0 && at < 0; --i) if (isOwn(records[i])) at = i;
  let next: ParticleCutProps[];
  if (at >= 0) {
    next = records.map((r, i) => (i === at ? record(own) : r));
  } else {
    // all of the object cut: a record of every particle, the plain cut, under the part's
    const base = records.length ? records : [record(none, PlainCut)];
    next = [...base.filter((r) => !isPart(r)), record(own)];
  }
  const same = next.length === records.length && next.every((r, i) => sameWay(r, records[i]) && sameIds(r, records[i]));
  let changed = false;
  if (way.mode !== 'cut') {
    const r = await ctx.api.run('clipping.settings', { variant: 'instance' });
    if (!r.ok) return r;
    changed = !r.unchanged;
  }
  if (!same) {
    const r = await ctx.api.run('particles.look', {
      node: cells.map((c) => `#${c.transform.ref}`).join(', '),
      cuts: { remove: [tag], add: next },
    });
    if (!r.ok) return r;
    changed ||= !r.unchanged;
  }
  if (!changed) return ApiResult.already('It is cut so already.');
  return ApiResult.ok(WayWords[way.mode], { nodes: [node.ref] });
}

const WayWords: Readonly<Record<Way['mode'], string>> = {
  cut: 'The clip cuts it.',
  keep: 'The clip keeps a layer of it.',
  wider: 'The clip cuts it wider.',
};

/** Whether what a clip cuts of an object holds all of a part's ids */
function holdsAll(of: CutOfObject, kind: keyof Ids, ids: readonly number[]): boolean {
  if (!of.particles) return true;
  const has = idSet(of.particles, kind);
  return ids.every((id) => has.has(id));
}

const sameIds = (a: Ids, b: Ids) =>
  (['entities', 'compartments', 'targets'] as const).every(
    (k) => a[k].length === b[k].length && a[k].every((id, i) => id === b[k][i]),
  );
