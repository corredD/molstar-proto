/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import type { MesoEntity, MesoGroup, MesoGroupBy } from '@molstar/mesoscale-extension/model';
import type { OwnedEdit, OwnedListInfo, OwnedLookChange, ParticleListOwner } from '@molstar/mesoscale-extension/owner';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format';
import type { PlacementSet } from '@molstar/meso-spec/ir';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import { ApiResult } from '@molstar/prism-viewer/api/area';
import type { LookChange, MesoDocumentModel } from './document-model.js';

// The open document's lists as the mesoscale extension sees them (prism.md §1.1, §5.1): the owner port's side of the
// document. A list's entities are its set's types (one a population), grouped by the document's compartments or by
// Kind (the entities' kind); an edit of their looks is a style patch of the shown view, committed as one step of the
// run that proposed it.

/** A group's path (`c.exosome.c.lumen`: the compartment ids from the root) and the compartment it names. */
type CompartmentPaths = ReadonlyMap<string, string>;

export class DocumentListOwner implements ParticleListOwner {
  /** Per drawn set (by object: a new IR, new sets): its entities, and its groups by grouping. */
  private readonly infos = new WeakMap<PlacementSet, Map<MesoGroupBy, OwnedListInfo & { paths: CompartmentPaths }>>();

  constructor(readonly model: MesoDocumentModel) {}

  owns(list: string): boolean {
    return !!this.model.doc && this.model.adapter.keyOf(list) !== undefined;
  }

  info(list: string, groupBy?: MesoGroupBy): OwnedListInfo | undefined {
    return this.infoOf(list, groupBy);
  }

  async propose(edit: OwnedEdit, api: ViewerApi): Promise<ApiResult> {
    const styles: { select: string; change: LookChange }[] = [];
    for (const { list, looks } of edit.lists) {
      const key = this.model.adapter.keyOf(list);
      const set = key !== undefined ? this.model.adapter.setOf(key) : undefined;
      if (!set) return ApiResult.fail('not-found', 'That list is not the document’s any more.');
      for (const look of looks) {
        const select = this.selectOf(list, set, look.entities, look.group);
        if (select) styles.push({ select, change: lookChange(look.change) });
      }
    }
    const patch = this.model.stylePatch(styles);
    if (!patch) return ApiResult.already('They already look so.');
    let step: Awaited<ReturnType<MesoDocumentModel['edit']>>;
    try {
      step = await this.model.edit(patch, api, edit.label);
    } catch (e) {
      return ApiResult.fail('failed', `Could not change the looks: ${(e as Error).message}`);
    }
    if (step.unchanged) return ApiResult.already('They already look so.');
    if (!step.record) {
      return ApiResult.fail('invalid', step.issues.map((i) => i.message).join('; ') || 'The looks were refused.');
    }
    return ApiResult.ok(`Changed the document's looks (${edit.label}).`, { nodes: edit.lists.map((l) => l.list) });
  }

  async themeChanged(lists: readonly string[], api: ViewerApi): Promise<void> {
    await this.model.adapter.redrawLooks(
      api,
      lists.filter((l) => this.owns(l)),
    );
  }

  /**
   * The address of some entities of a list: a compartment group picked whole, `(in c.x)`; else their populations,
   * `(population p.a p.b)` (sorted, so the same entities give the same address and so the same style look).
   */
  private selectOf(list: string, set: PlacementSet, entities: readonly number[], group?: string) {
    if (group !== undefined) {
      const compartment = this.infoOf(list, 'compartment')?.paths.get(group);
      if (compartment) return `(in ${compartment})`;
    }
    const populations = new Set<string>();
    for (const id of entities) {
      const t = set.typeTable[id];
      if (t) populations.add(t.population);
    }
    return populations.size ? `(population ${[...populations].sort().join(' ')})` : undefined;
  }

  private infoOf(list: string, asked?: MesoGroupBy) {
    const doc = this.model.doc;
    const key = this.model.adapter.keyOf(list);
    const set = key !== undefined ? this.model.adapter.setOf(key) : undefined;
    if (!doc || !set) return undefined;
    const groupBy = asked ?? 'compartment';
    let bySet = this.infos.get(set);
    if (!bySet) this.infos.set(set, (bySet = new Map()));
    let info = bySet.get(groupBy);
    if (!info) {
      const entities = setEntities(doc, set);
      const { groups, paths } = groupBy === 'compartment' ? byCompartment(doc, set, entities) : byKind(doc, set);
      // found by their population ids after their labels (prism.md §5.1: Import colors)
      const aliases = new Map<string, number>();
      for (const t of set.typeTable) if (!aliases.has(t.population)) aliases.set(t.population, t.index);
      info = { entities, groups, groupBy, hasCompartments: true, aliases, paths };
      bySet.set(groupBy, info);
    }
    return info;
  }
}

/** A list's entities: its set's types, named by their label, counted, described by their entity's label. */
function setEntities(doc: MesoViewSpecDoc, set: PlacementSet): MesoEntity[] {
  const counts = new Int32Array(set.typeTable.length);
  for (let i = 0; i < set.count; i++) counts[set.types[i]]++;
  const labels = entityLabels(doc);
  return set.typeTable.map((t) => {
    const description = labels.get(t.entity);
    return {
      id: t.index,
      name: t.label,
      count: counts[t.index],
      compartment: -1,
      ...(description ? { description } : {}),
    };
  });
}

/** The groups by the document's compartments (a superstructure's too), by their parents: paths of ids from the root. */
function byCompartment(doc: MesoViewSpecDoc, set: PlacementSet, entities: readonly MesoEntity[]) {
  const all = [...(doc.superstructures ?? []).flatMap((s) => s.compartments), ...doc.compartments];
  const parent = new Map(all.map((c) => [c.id, c.parent]));
  const label = new Map(all.map((c) => [c.id, c.label]));
  const pathOf = (id: string): string[] => {
    const out: string[] = [];
    for (let c: string | undefined = id, n = 0; c && n < 64; c = parent.get(c), n++) out.unshift(c);
    return out;
  };
  interface Mutable {
    path: string;
    label: string;
    groups: Mutable[];
    entities: number[];
  }
  const root: Mutable = { path: '', label: doc.metadata?.title ?? 'Document', groups: [], entities: [] };
  const byPath = new Map<string, Mutable>([['', root]]);
  const paths = new Map<string, string>();
  const groupOf = (ids: readonly string[]): Mutable => {
    const path = ids.join('.');
    let g = byPath.get(path);
    if (g) return g;
    const up = groupOf(ids.slice(0, -1));
    const id = ids[ids.length - 1];
    g = { path, label: label.get(id) ?? id, groups: [], entities: [] };
    up.groups.push(g);
    byPath.set(path, g);
    paths.set(path, id);
    return g;
  };
  for (const e of entities) {
    const t = set.typeTable[e.id];
    (t?.compartment ? groupOf(pathOf(t.compartment)) : root).entities.push(e.id);
  }
  return { groups: root as MesoGroup, paths: paths as CompartmentPaths };
}

/** The groups by Kind (prism.md §4.2): the entities' kinds, in place of the Explorer's function. */
function byKind(doc: MesoViewSpecDoc, set: PlacementSet) {
  const kinds = new Map<string, string>();
  for (const e of [...(doc.superstructures ?? []).flatMap((s) => s.entities ?? []), ...doc.entities])
    kinds.set(e.id, e.kind);
  const groups = new Map<string, number[]>();
  for (const t of set.typeTable) {
    const k = kinds.get(t.entity) ?? 'other';
    groups.set(k, [...(groups.get(k) ?? []), t.index]);
  }
  const root: MesoGroup = {
    path: '',
    label: doc.metadata?.title ?? 'Document',
    entities: [],
    groups: [...groups].map(([k, ids]) => ({ path: k, label: k, entities: ids, groups: [] })),
  };
  return { groups: root, paths: new Map() as CompartmentPaths };
}

function entityLabels(doc: MesoViewSpecDoc) {
  const out = new Map<string, string>();
  for (const e of [...(doc.superstructures ?? []).flatMap((s) => s.entities ?? []), ...doc.entities])
    out.set(e.id, e.label);
  return out;
}

/** The port's change as a look's: a color as `#rrggbb`. */
function lookChange(c: OwnedLookChange): LookChange {
  return {
    ...(c.visible !== undefined ? { visible: c.visible } : {}),
    ...(c.color !== undefined ? { color: c.color === null ? null : Color.toHexStyle(c.color) } : {}),
    ...(c.transparency !== undefined ? { transparency: c.transparency } : {}),
    ...(c.emissive !== undefined ? { emissive: c.emissive } : {}),
    ...(c.reset ? { reset: true } : {}),
  };
}
