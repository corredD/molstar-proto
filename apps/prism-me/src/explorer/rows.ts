/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { DecorationsInfo } from '@molstar/cryoet-extension/operations';
import { groupEntities, type MesoGroup } from '@molstar/mesoscale-extension/model';
import type { MesoscaleInfo } from '@molstar/mesoscale-extension/operations';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type { DistanceInfo, LabelInfo } from '@molstar/stage-tools-extension/operations';
import type { Category, NodeRef, SceneObject } from './operations.js';

// The rows of the explorer's tree (_spec/ui.md §3), flat, from the scene's objects and the parts the mesoscale and
// cryo-ET areas read; and what a row's eye runs.

/** The parts of a particle object: a model's entities and groups, a list's targets */
export type Parts = ReadonlyMap<string, MesoscaleInfo | DecorationsInfo | undefined>;

export const Categories: readonly { id: Category; label: string }[] = [
  { id: 'structures', label: 'Structures' },
  { id: 'particles', label: 'Particles' },
  { id: 'volumes', label: 'Volumes' },
  { id: 'meshes', label: 'Meshes' },
];

/** A row of the tree, flat (its depth says where it is) */
export interface Row {
  readonly key: string;
  readonly depth: number;
  readonly label: string;
  readonly kind: string;
  readonly count?: string;
  readonly color?: number;
  /** Its eye: whether shown; absent, no eye */
  readonly visible?: boolean;
  readonly hasChildren: boolean;
  /** What it stands for in 3D (none for a category) */
  readonly node?: NodeRef;
  /** A representation's row: its state ref */
  readonly representation?: string;
}

// --- the rows ---------------------------------------------------------------------------------------------------------

export function rowsOf(
  objects: readonly SceneObject[],
  parts: Parts,
  open: ReadonlySet<string>,
  filter: string,
  labels: readonly LabelInfo[] = [],
  distances: readonly DistanceInfo[] = [],
): Row[] {
  const f = filter.trim().toLowerCase();
  const rows: Row[] = [];
  // the labels and the distances under the row they were made at (after its own children; a distance at its first
  // point's); one made at a model's group the model's grouping does not show now: under the model (§3), back under its
  // group when that grouping is shown again
  const shownGroups = groupRowsOf(objects, parts);
  const byNode = new Map<string, Row[]>();
  const under = (key: string, row: Omit<Row, 'depth'>) => {
    const node = key.startsWith('g:') && !shownGroups.keys.has(key) ? modelOf(key, shownGroups.models) : key;
    const list = byNode.get(node);
    if (list) list.push(row as Row);
    else byNode.set(node, [row as Row]);
  };
  for (const l of labels) {
    under(l.node, {
      key: `l:${l.ref}`,
      label: l.text,
      kind: 'label',
      visible: l.visible,
      hasChildren: false,
      node: { ref: l.ref },
    });
  }
  for (const d of distances) {
    under(d.node, {
      key: `d:${d.ref}`,
      label: d.label,
      kind: 'distance',
      visible: d.visible,
      hasChildren: false,
      node: { ref: d.ref },
    });
  }
  const push = (r0: Row, children: () => void) => {
    const own = byNode.get(r0.key);
    const r = own && !r0.hasChildren ? { ...r0, hasChildren: true } : r0;
    rows.push(r);
    if (!r.hasChildren || !(open.has(r.key) || f)) return;
    // its own children (none when only its labels made it a parent)
    if (r0.hasChildren) children();
    for (const l of own ?? []) rows.push({ ...l, depth: r.depth + 1 });
  };
  for (const c of Categories) {
    const items = objects.filter((o) => o.category === c.id);
    if (!items.length) continue;
    push(
      { key: `c:${c.id}`, depth: 0, label: c.label, kind: 'category', count: String(items.length), hasChildren: true },
      () => {
        for (const o of items) objectRows(o, parts.get(o.ref), push, f);
      },
    );
  }
  return f ? rows.filter((r) => r.kind === 'category' || r.label.toLowerCase().includes(f)) : rows;
}

type Push = (r: Row, children: () => void) => void;

function objectRows(o: SceneObject, part: MesoscaleInfo | DecorationsInfo | undefined, push: Push, f: string) {
  const base = { depth: 1, label: o.label, count: o.count, visible: o.visible, node: { ref: o.ref } };
  if (o.kind === 'structure') {
    push({ ...base, key: `o:${o.ref}`, kind: 'structure', hasChildren: !!o.entities?.length }, () => {
      for (const e of o.entities ?? []) {
        push(
          {
            key: `e:${o.ref}:${e.id}`,
            depth: 2,
            label: e.label,
            kind: 'entity',
            count: e.chains.length > 1 ? `${e.chains.length} chains` : undefined,
            hasChildren: e.chains.length > 1,
            node: { ref: o.ref, entity: e.id },
          },
          () => {
            for (const ch of e.chains) {
              push(
                {
                  key: `ch:${o.ref}:${e.id}:${ch}`,
                  depth: 3,
                  label: `Chain ${ch}`,
                  kind: 'chain',
                  hasChildren: false,
                  node: { ref: o.ref, entity: e.id, chain: ch },
                },
                () => {},
              );
            }
          },
        );
      }
    });
    return;
  }
  if (o.kind === 'model') {
    const info = part as MesoscaleInfo | undefined;
    push({ ...base, key: `o:${o.ref}`, kind: 'mesoscale model', hasChildren: !!info?.entities.length }, () => {
      if (!info) return;
      const byId = new Map(info.entities.map((e) => [e.id, e]));
      const groupKey = (path: string) => groupKeyOf(o.ref, info, path);
      const walk = (g: MesoGroup, depth: number) => {
        for (const child of g.groups) {
          const members = groupEntities(child);
          const shown = members.some((id) => byId.get(id)?.visible);
          push(
            {
              key: groupKey(child.path),
              depth,
              label: child.label,
              kind: 'group',
              count: String(members.length),
              visible: shown,
              hasChildren: true,
              node: { ref: o.ref, particles: { entities: members } },
            },
            () => walk(child, depth + 1),
          );
        }
        for (const id of g.entities) {
          const e = byId.get(id);
          if (!e) continue;
          push(
            {
              key: `me:${o.ref}:${id}`,
              depth,
              label: e.name,
              kind: 'entity',
              count: e.count.toLocaleString('en'),
              visible: e.visible,
              ...(e.color !== undefined ? { color: e.color } : {}),
              hasChildren: false,
              node: { ref: o.ref, particles: { entities: [id] } },
            },
            () => {},
          );
        }
      };
      walk(info.groups, 2);
    });
    return;
  }
  if (o.kind === 'list') {
    const info = part as DecorationsInfo | undefined;
    push({ ...base, key: `o:${o.ref}`, kind: 'particle list', hasChildren: !!info?.targets.length }, () => {
      for (const t of info?.targets ?? []) {
        push(
          {
            key: `t:${o.ref}:${t.id}`,
            depth: 2,
            label: t.with ? `${t.name} · ${t.with}` : t.name,
            kind: 'target',
            count: t.count.toLocaleString('en'),
            hasChildren: false,
            node: { ref: o.ref, particles: { targets: [t.id] } },
          },
          () => {},
        );
      }
    });
    return;
  }
  if (o.kind === 'volume') {
    push({ ...base, key: `o:${o.ref}`, kind: 'volume', hasChildren: !!o.representations?.length }, () => {
      for (const r of o.representations ?? []) {
        push(
          {
            key: `r:${r.ref}`,
            depth: 2,
            label: r.label,
            kind: VolumeRowKinds.has(r.type) ? r.type : 'volume representation',
            visible: r.visible,
            hasChildren: false,
            node: { ref: o.ref },
            representation: r.ref,
          },
          () => {},
        );
      }
    });
    return;
  }
  push({ ...base, key: `o:${o.ref}`, kind: 'mesh', hasChildren: false }, () => {});
  void f;
}

/**
 * A model's group row's key: a function's keyed apart from a compartment of the same name (the grouping is the model's,
 * §3); a model without compartments has only functions: its keys stay those of sessions saved before (a label's row)
 */
function groupKeyOf(ref: string, info: MesoscaleInfo, path: string): string {
  return `g:${ref}:${info.groupBy === 'function' && info.hasCompartments ? 'fn:' : ''}${path}`;
}

/** The group rows the models' groupings make (their keys), and the models' refs */
function groupRowsOf(objects: readonly SceneObject[], parts: Parts) {
  const keys = new Set<string>();
  const models: string[] = [];
  for (const o of objects) {
    if (o.kind !== 'model') continue;
    models.push(o.ref);
    const info = parts.get(o.ref) as MesoscaleInfo | undefined;
    if (!info) continue;
    const walk = (g: MesoGroup) => {
      for (const child of g.groups) {
        keys.add(groupKeyOf(o.ref, info, child.path));
        walk(child);
      }
    };
    walk(info.groups);
  }
  return { keys, models };
}

/** The model row of a group row's key (`g:<ref>:<path>`), else the key itself */
function modelOf(key: string, models: readonly string[]): string {
  const ref = models.find((m) => key.startsWith(`g:${m}:`));
  return ref === undefined ? key : `o:${ref}`;
}

/** A volume's representations with rows of their own kind (others: 'volume representation') */
const VolumeRowKinds: ReadonlySet<string> = new Set(['slice', 'oblique slice', 'isosurface']);

/** A row's eye: the visibility operation of what it stands for */
export function toggleVisible(api: ViewerApi, row: Row) {
  const visible = !row.visible;
  const node = row.node;
  if (!node) return;
  switch (row.kind) {
    case 'structure':
      return api.run('structure.visibility', { structure: node.ref, visible });
    case 'mesoscale model':
    case 'particle list':
      return api.run('particles.visibility', { particles: node.ref, visible });
    case 'target':
      if ('particles' in node) {
        return api.run('mesoscale.style', {
          particles: node.ref,
          entities: (node.particles.targets ?? []).join(','),
          visible,
        });
      }
      return;
    case 'group':
    case 'entity':
      if ('particles' in node) {
        return api.run('mesoscale.style', {
          particles: node.ref,
          entities: (node.particles.entities ?? []).join(','),
          visible,
        });
      }
      return;
    case 'volume':
      return api.run('volume.visibility', { volume: node.ref, visible });
    case 'slice':
    case 'oblique slice':
    case 'isosurface':
    case 'volume representation':
      return api.run('volume.visibility', { node: row.representation!, visible });
    case 'mesh':
      return api.run('cryoet.mesh', { mesh: node.ref, visible });
    case 'label':
      return api.run('stage.editLabel', { label: node.ref, visible });
    case 'distance':
      return api.run('stage.editDistance', { distance: node.ref, visible });
  }
}

/** Every row open: all of the tree */
const AllOpen: ReadonlySet<string> = { has: () => true } as unknown as ReadonlySet<string>;

/** The row of a key, all of the tree unfolded; none if absent */
export function rowOf(
  objects: readonly SceneObject[],
  parts: Parts,
  key: string,
  labels: readonly LabelInfo[] = [],
  distances: readonly DistanceInfo[] = [],
): Row | undefined {
  return rowsOf(objects, parts, AllOpen, '', labels, distances).find((r) => r.key === key);
}

/** The keys of the rows above `key` (its category, its object, its groups), to unfold the way to it; none if absent */
export function ancestorKeys(
  objects: readonly SceneObject[],
  parts: Parts,
  key: string,
  labels: readonly LabelInfo[] = [],
  distances: readonly DistanceInfo[] = [],
): string[] | undefined {
  const rows = rowsOf(objects, parts, AllOpen, '', labels, distances);
  const i = rows.findIndex((r) => r.key === key);
  if (i < 0) return undefined;
  const out: string[] = [];
  let depth = rows[i].depth;
  for (let j = i - 1; j >= 0 && depth > 0; j--) {
    if (rows[j].depth < depth) {
      out.push(rows[j].key);
      depth = rows[j].depth;
    }
  }
  return out;
}

/**
 * Keeps the rows that did not change as the same objects (the tree's `For` remakes a row whose object is new): a
 * change remakes only the rows it touched, an unfolded model's thousands of entities stay as they are.
 */
export function stableRows() {
  let last = new Map<string, { row: Row; json: string }>();
  return (rows: readonly Row[]): Row[] => {
    const next = new Map<string, { row: Row; json: string }>();
    const out = rows.map((row) => {
      const json = JSON.stringify(row);
      const old = last.get(row.key);
      const kept = old && old.json === json ? old : { row, json };
      next.set(row.key, kept);
      return kept.row;
    });
    last = next;
    return out;
  };
}

// --- keys ------------------------------------------------------------------------------------------------------------

/**
 * What a key does in the tree (a tree view's keys), over its rows as shown and the picked row: Up and Down pick the row
 * before or after (past the categories, which are not picked); Right opens a closed row, else picks its first child;
 * Left closes an open row, else picks its parent. Undefined: nothing to do (an end, another key).
 */
export function treeKey(
  rows: readonly Row[],
  open: ReadonlySet<string>,
  picked: string | undefined,
  key: string,
): { readonly pick: string } | { readonly toggle: string } | undefined {
  const pickable = (r: Row) => r.kind !== 'category';
  const at = picked === undefined ? -1 : rows.findIndex((r) => r.key === picked);
  if (key === 'ArrowDown') {
    const next = rows.slice(at + 1).find(pickable);
    return next ? { pick: next.key } : undefined;
  }
  if (key === 'ArrowUp') {
    if (at < 0) return undefined;
    const prev = rows.slice(0, at).reverse().find(pickable);
    return prev ? { pick: prev.key } : undefined;
  }
  if (at < 0) return undefined;
  const row = rows[at];
  const isOpen = row.hasChildren && open.has(row.key);
  if (key === 'ArrowRight') {
    if (row.hasChildren && !isOpen) return { toggle: row.key };
    const child = rows[at + 1];
    return isOpen && child && child.depth > row.depth ? { pick: child.key } : undefined;
  }
  if (key === 'ArrowLeft') {
    if (isOpen) return { toggle: row.key };
    const parent = rows
      .slice(0, at)
      .reverse()
      .find((r) => r.depth < row.depth);
    return parent && pickable(parent) ? { pick: parent.key } : undefined;
  }
  return undefined;
}
