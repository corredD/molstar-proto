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

/** The particles a cut tagged `tag` cuts on a particle representation, when of some only (its layers' record) */
function particleCut(state: State, rep: string, tag: string): ParticleCutProps | undefined {
  const layers = state.select(StateSelection.Generators.ofTransformer(ParticleRepresentation3DLayers, rep))[0];
  const cuts = (layers?.transform.params as { cuts?: readonly ParticleCutProps[] } | undefined)?.cuts;
  return cuts?.find((c) => c.tag === tag);
}

/** What `cut` cuts of the object `ref`; undefined when it is on none of its representations */
export function cutOfObject(
  state: State,
  cut: Cut,
  ref: string,
  reps = clippableUnder(state, ref),
): CutOfObject | undefined {
  const targets = new Set(cut.targets.map((t) => t.ref));
  const on = reps.filter((c) => targets.has(c.transform.ref));
  if (!on.length) return undefined;
  const refs = on.map((c) => c.transform.ref);
  const tag = cut.object.tag;
  const first = tag ? on.find(isParticles) : undefined;
  const some = first && tag ? particleCut(state, first.transform.ref, tag) : undefined;
  if (some) return { ref, on: refs, particles: some };
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
  for (const node of nodes) {
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
    // the record's other kinds kept (a clip of a compartment given an entity cuts both)
    const ids = (next: readonly number[]): Ids => ({
      ...(of?.particles ?? { entities: [], compartments: [], targets: [] }),
      [kind]: next,
    });
    if (on) {
      if (of && !of.particles) return unchanged;
      if (part.every((id) => has.has(id))) return unchanged;
      const next = [...has, ...part.filter((id) => !has.has(id))];
      if (of) return look(refsOf(cells.filter(onIt)), ids(next));
      if (full(cells, MaxParticleCutIndex)) return blocked('some of its particles');
      const r = await look(refsOf(cells), ids(next));
      return r.ok ? apply(refsOf(cells), true) : r;
    }
    if (!of) return unchanged;
    // all of it cut: every id of the list but the part's
    const all = of.particles ? [...has] : allIds(cells[0], kind);
    const drop = new Set(part);
    if (!all.some((id) => drop.has(id))) return unchanged;
    const next = all.filter((id) => !drop.has(id));
    const left = ids(next);
    if (!left.entities.length && !left.compartments.length && !left.targets.length) return apply(of.on, false);
    const onCells = cells.filter(onIt);
    if (!of.particles && onCells.some((c) => indexOf(c) > MaxParticleCutIndex)) return blocked('some of its particles');
    return look(refsOf(onCells), left);
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
