/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { DecorationsInfo } from '@molstar/cryoet-extension/operations';
import { groupEntities, type MesoGroup } from '@molstar/mesoscale-extension/model';
import type { MesoscaleInfo } from '@molstar/mesoscale-extension/operations';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type { IconName } from '@molstar/prism-ui';
import type { DistanceInfo, LabelInfo } from '@molstar/stage-tools-extension/operations';
import type { Category, NodeRef, SceneObject } from './operations.js';
import { filterRows, type TreeRowView } from './tree-view.js';

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
export interface Row extends TreeRowView {
  readonly kind: string;
  /** What it stands for in 3D (none for a category) */
  readonly node?: NodeRef;
  /** A representation's row: its state ref */
  readonly representation?: string;
  /** A category's objects (their refs): its eye and its scissors act on all of them */
  readonly objects?: readonly string[];
}

/** The icon of an object's row (styling.md §4: top-level rows only) */
const ObjectIcons: Readonly<Record<SceneObject['kind'], IconName>> = {
  structure: 'structure',
  model: 'shapes',
  list: 'locate',
  volume: 'volume',
  mesh: 'box',
};

/** Whether two rows of one key draw the same (`keepRows`: a row the same keeps its DOM) */
export function sameRow(a: Row, b: Row): boolean {
  return (
    a.depth === b.depth &&
    a.label === b.label &&
    a.kind === b.kind &&
    a.count === b.count &&
    a.color === b.color &&
    a.visible === b.visible &&
    a.hasChildren === b.hasChildren &&
    a.expanded === b.expanded &&
    a.representation === b.representation &&
    a.objects?.length === b.objects?.length
  );
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
  // one whose row is not there (a part gone, a key from elsewhere): under its object's row
  const shownGroups = groupRowsOf(objects, parts);
  const known = rowKeysOf(objects, parts, shownGroups.keys);
  const byNode = new Map<string, Draft[]>();
  const under = (key: string, object: string, row: Omit<Draft, 'depth'>) => {
    const shown = key.startsWith('g:') && !shownGroups.keys.has(key) ? modelOf(key, shownGroups.models) : key;
    const node = known(shown) ? shown : `o:${object}`;
    const list = byNode.get(node);
    if (list) list.push(row as Draft);
    else byNode.set(node, [row as Draft]);
  };
  for (const l of labels) {
    under(l.node, l.target, {
      key: `l:${l.ref}`,
      label: l.text,
      kind: 'label',
      visible: l.visible,
      hasChildren: false,
      node: { ref: l.ref },
    });
  }
  for (const d of distances) {
    under(d.node, d.a.ref, {
      key: `d:${d.ref}`,
      label: d.label,
      kind: 'distance',
      visible: d.visible,
      hasChildren: false,
      node: { ref: d.ref },
    });
  }
  // a filter looks into every row, opened or not (ui.md §1)
  const push = (r0: Draft, children: () => void) => {
    const own = byNode.get(r0.key);
    const hasChildren = r0.hasChildren || !!own;
    const expanded = hasChildren && (!!f || open.has(r0.key));
    rows.push({ ...r0, hasChildren, expanded });
    if (!expanded) return;
    // its own children (none when only its labels made it a parent)
    if (r0.hasChildren) children();
    for (const l of own ?? []) rows.push({ ...l, depth: r0.depth + 1, expanded: false });
  };
  for (const c of Categories) {
    const items = objects.filter((o) => o.category === c.id);
    if (!items.length) continue;
    push(
      {
        key: `c:${c.id}`,
        depth: 0,
        label: c.label,
        kind: 'category',
        category: true,
        count: String(items.length),
        // its eye shows or hides every object under it (shown while any is)
        visible: items.some((o) => o.visible),
        objects: items.map((o) => o.ref),
        hasChildren: true,
      },
      () => {
        for (const o of items) objectRows(o, parts.get(o.ref), push);
      },
    );
  }
  // a hit kept with the rows it is in; a category with no hit goes (as Prism's tree, scene-tree.tsx)
  return f ? filterRows(rows, f) : rows;
}

/** A row before its place in the tree is known (whether it shows its children) */
type Draft = Omit<Row, 'expanded'>;
type Push = (r: Draft, children: () => void) => void;

function objectRows(o: SceneObject, part: MesoscaleInfo | DecorationsInfo | undefined, push: Push) {
  const base = {
    depth: 1,
    label: o.label,
    ...(o.count !== undefined ? { count: o.count } : {}),
    visible: o.visible,
    icon: ObjectIcons[o.kind],
    node: { ref: o.ref },
  };
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

/**
 * Whether a key is a row's of these objects, shown or folded: an object's, a structure's entity or chain, a model's
 * group shown or entity, a list's target, a volume's representation. A model whose parts are not read yet: any key of it.
 */
function rowKeysOf(objects: readonly SceneObject[], parts: Parts, groups: ReadonlySet<string>) {
  const keys = new Set<string>(groups);
  const unread: string[] = [];
  for (const o of objects) {
    keys.add(`o:${o.ref}`);
    for (const e of o.entities ?? []) {
      keys.add(`e:${o.ref}:${e.id}`);
      if (e.chains.length > 1) for (const ch of e.chains) keys.add(`ch:${o.ref}:${e.id}:${ch}`);
    }
    for (const r of o.representations ?? []) keys.add(`r:${r.ref}`);
    if (o.category !== 'particles') continue;
    const part = parts.get(o.ref);
    if (!part) unread.push(o.ref);
    else if (o.kind === 'model') for (const e of (part as MesoscaleInfo).entities) keys.add(`me:${o.ref}:${e.id}`);
    else for (const t of (part as DecorationsInfo).targets) keys.add(`t:${o.ref}:${t.id}`);
  }
  return (key: string) => keys.has(key) || unread.some((ref) => key.split(':')[1] === ref);
}

/** The model row of a group row's key (`g:<ref>:<path>`), else the key itself */
function modelOf(key: string, models: readonly string[]): string {
  const ref = models.find((m) => key.startsWith(`g:${m}:`));
  return ref === undefined ? key : `o:${ref}`;
}

/** A volume's representations with rows of their own kind (others: 'volume representation') */
const VolumeRowKinds: ReadonlySet<string> = new Set(['slice', 'oblique slice', 'isosurface']);

/** A row's eye: the visibility operation of what it stands for (whether it shows its children aside) */
export function toggleVisible(api: ViewerApi, row: Draft) {
  const visible = !row.visible;
  // a category's: every object under it, one step
  if (row.kind === 'category' && row.objects?.length) {
    return api.run('state.visibility', { node: row.objects.map((r) => `#${r}`).join(', '), visible });
  }
  const node = row.node;
  if (!node) return;
  switch (row.kind) {
    case 'structure':
      return api.run('structure.visibility', { structure: node.ref, visible });
    case 'mesoscale model':
    case 'particle list':
      return api.run('particles.visibility', { particles: node.ref, visible });
    case 'target':
      // a list's class: its targets' layer (Prism's one writer of the looks), not as entities
      if ('particles' in node) {
        return api.run('particles.look', {
          particles: node.ref,
          layers: [{ selector: { targets: node.particles.targets ?? [] }, visible }],
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
