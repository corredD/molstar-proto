/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { DecorationsInfo } from '@molstar/cryoet-extension/operations';
import { Color } from '@molstar/core/util/color';
import { groupEntities, type MesoGroup, type MesoGroupBy } from '@molstar/mesoscale-extension/model';
import type { MesoscaleInfo } from '@molstar/mesoscale-extension/operations';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type { IconName } from '@molstar/prism-ui';
import type { DistanceInfo, LabelInfo } from '@molstar/stage-tools-extension/operations';
import { MeasureNames } from '@molstar/stage-tools-extension/distance';
import type { Category, ExplorerApi, NodeRef, SceneObject } from './operations.js';
import { type Ids, isCover, kindOf, PlainCut, type Way, wayOfRecord } from './clips.js';
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
  /** A category's objects (their refs): its eye and its ⋯ act on all of them */
  readonly objects?: readonly string[];
  /** A clip's row: its cut's tag (Prism's) */
  readonly clip?: string;
  /** The Clips category: its clips' tags (its eye draws them all in the scene, or none) */
  readonly clips?: readonly string[];
}

/** A clip (Prism's cut) as a row of the Clips category (ui.md §3) */
export interface ClipRow {
  readonly tag: string;
  /** Its shape and number: Plane 1 */
  readonly label: string;
  /** How many objects or parts it cuts (its What it cuts) */
  readonly count: number;
  /** Drawn in the scene (its eye) */
  readonly drawn: boolean;
}

/** An object or a part a clip cuts (its What it cuts), as its row: its key, its name, what it stands for */
export interface ClipUse {
  readonly key: string;
  /** Its name with its parent's (envelope › membrane), an object's alone */
  readonly label: string;
  readonly node: NodeRef;
  /** On particles: how the clip cuts it (graded ways, cellVIEW's; atoms and structures are cut plainly) */
  readonly way?: Way;
}

/** Prism's cut shapes, as the tree names them */
export const ClipShapes: Readonly<Record<string, string>> = {
  plane: 'Plane',
  sphere: 'Sphere',
  cube: 'Box',
  cylinder: 'Cylinder',
  infiniteCone: 'Cone',
};

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
    a.clip === b.clip &&
    sameRefs(a.objects, b.objects) &&
    sameRefs(a.clips, b.clips)
  );
}

/** A category's objects, the same refs in order (an object replaced by another keeps their number) */
function sameRefs(a: readonly string[] | undefined, b: readonly string[] | undefined) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// --- the rows ---------------------------------------------------------------------------------------------------------

export function rowsOf(
  objects: readonly SceneObject[],
  parts: Parts,
  open: ReadonlySet<string>,
  filter: string,
  labels: readonly LabelInfo[] = [],
  distances: readonly DistanceInfo[] = [],
  clips: readonly ClipRow[] = [],
  /** While filtering, the rows the person folded (the filter opens every other) */
  folded: ReadonlySet<string> = NoKeys,
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
      // told apart from the parts it is among (no icon on child rows, styling.md §4)
      count: 'label',
      kind: 'label',
      own: true,
      visible: l.visible,
      hasChildren: false,
      node: { ref: l.ref },
    });
  }
  for (const d of distances) {
    under(d.node, d.a.ref, {
      key: `d:${d.ref}`,
      label: `${MeasureNames[d.measure] ?? 'Distance'} ${d.label}`,
      kind: 'distance',
      own: true,
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
        // its eye sets every object under it, all of each; open when they all are (never "some shown")
        visible: items.every((o) => objectOpen(o, parts.get(o.ref))),
        objects: items.map((o) => o.ref),
        hasChildren: true,
      },
      () => {
        for (const o of items) objectRows(o, parts.get(o.ref), push);
      },
    );
  }
  // the clips, in a category of their own after the others (Ludo, 2026-10-28): every clip of the scene, none under an
  // object
  if (clips.length) {
    push(
      {
        key: ClipsKey,
        depth: 0,
        label: 'Clips',
        kind: 'category',
        category: true,
        count: String(clips.length),
        // its eye: every clip drawn in the scene, or none (open when all are)
        visible: clips.every((c) => c.drawn),
        clips: clips.map((c) => c.tag),
        hasChildren: true,
      },
      () => {
        for (const c of clips) {
          push(
            {
              key: `k:${c.tag}`,
              depth: 1,
              label: c.label,
              count: c.count === 1 ? '1 object' : `${c.count} objects`,
              kind: 'clip',
              visible: c.drawn,
              hasChildren: false,
              clip: c.tag,
            },
            () => {},
          );
        }
      },
    );
  }
  // a hit kept with the rows it is in; a category with no hit goes (as Prism's tree, scene-tree.tsx)
  return f ? foldedOut(filterRows(rows, f), folded) : rows;
}

const NoKeys: ReadonlySet<string> = new Set();

/** The Clips category's key: its rows are the clips' (`k:<tag>`) */
export const ClipsKey = 'c:clips';

/** The rows under a folded one left out (it stays, with its hits under it, closed) */
function foldedOut(rows: Row[], folded: ReadonlySet<string>): Row[] {
  if (!folded.size) return rows;
  const out: Row[] = [];
  let under = -1;
  for (const r of rows) {
    if (under >= 0 && r.depth > under) continue;
    under = -1;
    if (r.expanded && folded.has(r.key)) {
      under = r.depth;
      out.push({ ...r, expanded: false });
    } else out.push(r);
  }
  return out;
}

/** A row before its place in the tree is known (whether it shows its children) */
type Draft = Omit<Row, 'expanded'>;
type Push = (r: Draft, children: () => void) => void;

/**
 * An object's eye (Ludo, 2026-10-28): open when it is shown and every part of it too (a model's entities, a list's
 * targets), never "some shown"; a volume's representations are its own views, not parts (a tomogram's hidden slices
 * leave it open)
 */
export function objectOpen(o: SceneObject, part: MesoscaleInfo | DecorationsInfo | undefined): boolean {
  if (!o.visible || !part) return o.visible;
  if (o.kind === 'model') return (part as MesoscaleInfo).entities.every((e) => e.visible);
  if (o.kind === 'list') return (part as DecorationsInfo).targets.every((t) => t.visible !== false);
  return true;
}

function objectRows(o: SceneObject, part: MesoscaleInfo | DecorationsInfo | undefined, push: Push) {
  const base = {
    depth: 1,
    label: o.label,
    ...(o.count !== undefined ? { count: o.count } : {}),
    visible: objectOpen(o, part),
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
          // open when all its entities are (its own after: hide the model, then show one group alone)
          const shown = members.every((id) => byId.get(id)?.visible !== false);
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
            visible: t.visible !== false,
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
    keys.add(`c:${o.category}`);
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

/**
 * A category's color theme for every object under it, one step (`mesoscale.theme`, each kind by the theme it takes;
 * ui.md §3, Ludo 2026-10-27): its row's Color… and its Look. Generated colors by each model's grouping as the tree shows
 * it (as its row's Generate colors); Uniform in `color`.
 */
export function categoryTheme(
  api: ViewerApi,
  objects: readonly string[],
  theme: string,
  groupByOf: (model: string) => MesoGroupBy | undefined,
  color?: number,
) {
  if (theme === 'uniform') {
    return api.run('mesoscale.theme', {
      objects: [...objects],
      theme,
      color: Color.toHexStyle(Color(color ?? 0xffffff)),
    });
  }
  const groupBy: Record<string, MesoGroupBy> = {};
  for (const ref of objects) {
    const by = groupByOf(ref);
    if (by) groupBy[ref] = by;
  }
  return api.run('mesoscale.theme', { objects: [...objects], theme, groupBy });
}

/** What an eye sets: a row, as the scene knows it */
export type EyeRow = Pick<Row, 'kind' | 'node' | 'objects' | 'representation' | 'clip' | 'clips'>;

/**
 * Eyes set, one step (a click's row, or each row a drag passed; Ludo, 2026-10-28): each row's and every part under it
 * (a parent's: all the way down), the object drawn again when a part of it is shown (hide the model, then show one
 * group alone). The labels, distances and clips under a row keep their own. The parts a drag passed are gathered by
 * object: one write each (a model's entities, a list's targets), not one a row; an undrawn list's (no looks) skipped.
 */
export function setEyes(api: ViewerApi, area: ExplorerApi, rows: readonly EyeRow[], visible: boolean) {
  return api.group(visible ? 'Show' : 'Hide', async (g) => {
    const entities = new Map<string, number[]>();
    const targets = new Map<string, number[]>();
    for (const row of rows) {
      const node = row.node;
      if (node && 'particles' in node && PartKinds.has(row.kind)) {
        const [by, ids] =
          row.kind === 'target' ? [targets, node.particles.targets] : [entities, node.particles.entities];
        let list = by.get(node.ref);
        if (!list) by.set(node.ref, (list = []));
        for (const id of ids ?? []) list.push(id);
        continue;
      }
      const r = await setEye(g, area, row, visible);
      if (r && !r.ok) return r;
    }
    for (const ref of new Set([...entities.keys(), ...targets.keys()])) {
      if (!area.representationsState(ref).value.length) continue;
      // a part shown: its object drawn (its other parts as they are)
      if (visible) {
        const r = await g.run('particles.visibility', { particles: ref, visible });
        if (!r.ok) return r;
      }
      const e = entities.get(ref);
      if (e) {
        const r = await g.run('mesoscale.style', { particles: ref, entities: e.join(','), visible });
        if (!r.ok) return r;
      }
      const t = targets.get(ref);
      if (!t) continue;
      // a list's class: its targets' layers (Prism's one writer of the looks), not as entities
      const l = await g.run('particles.look', {
        particles: ref,
        layers: t.map((id) => ({ selector: { targets: [id] }, visible })),
      });
      if (!l.ok) return l;
    }
    return undefined;
  });
}

/** A part's rows: their eyes gathered by object (`setEyes`) */
const PartKinds: ReadonlySet<string> = new Set(['group', 'entity', 'target']);

/** The kinds of the tree's object rows, by the scene's */
const ObjectRowKinds: Readonly<Record<SceneObject['kind'], string>> = {
  structure: 'structure',
  model: 'mesoscale model',
  list: 'particle list',
  volume: 'volume',
  mesh: 'mesh',
};

async function setEye(api: ViewerApi, area: ExplorerApi, row: EyeRow, visible: boolean) {
  // a category's: every object under it (one write), then the parts of each
  if (row.kind === 'category' && row.objects?.length) {
    const r = await api.run('state.visibility', { node: row.objects.map((r) => `#${r}`).join(', '), visible });
    if (!r.ok) return r;
    const kinds = new Map(area.objectsState().value.map((o) => [o.ref, ObjectRowKinds[o.kind]] as const));
    for (const ref of row.objects) {
      const p = await setParts(api, area, kinds.get(ref), ref, visible);
      if (p && !p.ok) return p;
    }
    return r;
  }
  if (row.kind === 'clip' && row.clip) return api.run('clipping.show', { tag: row.clip, on: visible });
  // the Clips category's: every clip drawn, or none (in the one step)
  if (row.clips) {
    for (const tag of row.clips) {
      const r = await api.run('clipping.show', { tag, on: visible });
      if (!r.ok) return r;
    }
    return;
  }
  const node = row.node;
  if (!node) return;
  switch (row.kind) {
    case 'structure':
      return api.run('structure.visibility', { structure: node.ref, visible });
    case 'mesoscale model':
    case 'particle list': {
      const r = await api.run('particles.visibility', { particles: node.ref, visible });
      return r.ok ? ((await setParts(api, area, row.kind, node.ref, visible)) ?? r) : r;
    }
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

/**
 * Every part of an object set: a model's entities (one write, none named: all), a list's targets (one layer each, as
 * its rows' eyes), where it is drawn (its looks are its representations'); a volume's representations follow it already
 * (Mol*'s subtree), a structure has no part eyes
 */
async function setParts(api: ViewerApi, area: ExplorerApi, kind: string | undefined, ref: string, visible: boolean) {
  if (kind !== 'mesoscale model' && kind !== 'particle list') return;
  if (!area.representationsState(ref).value.length) return;
  if (kind === 'mesoscale model') return api.run('mesoscale.style', { particles: ref, visible });
  const targets = api.cryoet?.decorationsState(ref).value?.targets ?? [];
  if (!targets.length) return;
  return api.run('particles.look', {
    particles: ref,
    layers: targets.map((t) => ({ selector: { targets: [t.id] }, visible })),
  });
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
  // a clip's row: under the Clips category
  if (key.startsWith('k:')) return [ClipsKey];
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

type Cut = ViewerApi['clipping']['cuts']['value'][number];

/** Prism's cuts as the Clips category's rows, in Prism's order: each named by its shape and number, and its count */
export function clipRowsOf(area: ExplorerApi, cuts: readonly Cut[], objects: readonly SceneObject[], parts: Parts) {
  const out: ClipRow[] = [];
  for (const c of cuts) {
    if (!c.object.tag) continue;
    out.push({
      tag: c.object.tag,
      label: clipName(c),
      count: whatItCuts(area, c, objects, parts).length,
      drawn: !!c.drawing,
    });
  }
  return out;
}

/** A clip's name: its shape and number (Plane 1) */
export function clipName(c: Cut): string {
  return `${ClipShapes[c.object.type] ?? c.object.type} ${c.index}`;
}

/**
 * What a clip cuts, each object or part as its row (ui.md §4, a clip's What it cuts), in the tree's order: an object
 * cut all of it; of a model's particles, the largest groups it cuts all of (as the model's grouping shows them), then
 * entities; a list's targets; a structure's entities, or their chains, it cuts all of
 */
export function whatItCuts(area: ExplorerApi, cut: Cut, objects: readonly SceneObject[], parts: Parts): ClipUse[] {
  const out: ClipUse[] = [];
  for (const o of objects) {
    const of = area.cutOf(cut, o.ref);
    if (!of) continue;
    const whole: ClipUse = { key: `o:${o.ref}`, label: o.label, node: { ref: o.ref } };
    if (of.particled || of.particles) {
      // a row a record (Prism's, a part each), with its way; a later record's row over an earlier one's
      const rows = new Map<string, ClipUse>();
      const records: readonly (Ids & Way)[] = of.records?.length
        ? of.records
        : of.particles
          ? [{ ...of.particles, ...PlainCut }]
          : [];
      // the records of one way as one (the union of their ids), in the order of each way's last record: the model's
      // groups walked once a way, not once a record (a clip given many targets one at a time has a record each)
      const byWay = new Map<string, { way: Way; ids: Record<keyof Ids, Set<number>>; all: boolean; last: number }>();
      records.forEach((r, i) => {
        const key = `${r.mode}:${r.band}:${r.fuzziness}`;
        let g = byWay.get(key);
        if (!g) {
          g = {
            way: wayOfRecord(r),
            ids: { entities: new Set(), compartments: new Set(), targets: new Set() },
            all: false,
            last: i,
          };
          byWay.set(key, g);
        }
        g.last = i;
        if (isCover(r)) g.all = true;
        for (const k of ['entities', 'compartments', 'targets'] as const) for (const id of r[k]) g.ids[k].add(id);
      });
      for (const g of [...byWay.values()].sort((a, b) => a.last - b.last)) {
        const ids = {
          entities: [...g.ids.entities],
          compartments: [...g.ids.compartments],
          targets: [...g.ids.targets],
        };
        const some = g.all || isCover(ids) ? undefined : particleUses(o, parts.get(o.ref), ids);
        for (const u of some?.length ? some : [whole]) rows.set(u.key, { ...u, way: g.way });
      }
      out.push(...(rows.size ? rows.values() : [{ ...whole, way: PlainCut }]));
      continue;
    }
    const some = of.atoms ? atomUses(area, cut, o) : undefined;
    if (some?.length) out.push(...some);
    else out.push(whole);
  }
  return out;
}

/** The rows of a cut of some particles: a model's groups cut whole (the largest), then entities; a list's targets */
function particleUses(
  o: SceneObject,
  part: MesoscaleInfo | DecorationsInfo | undefined,
  ids: Ids,
): ClipUse[] | undefined {
  if (!part) return undefined;
  const ref = o.ref;
  const out: ClipUse[] = [];
  // a clip of some compartments (Prism's selector; from ⌘K or the agent): each compartment
  for (const c of ids.compartments) {
    out.push({
      key: `cp:${ref}:${c}`,
      label: `${o.label} › compartment ${c}`,
      node: { ref, particles: { compartments: [c] } },
    });
  }
  if (o.kind === 'list') {
    const targets = new Set(ids.targets);
    for (const t of (part as DecorationsInfo).targets) {
      if (!targets.has(t.id)) continue;
      out.push({
        key: `t:${ref}:${t.id}`,
        label: `${o.label} › ${t.name}`,
        node: { ref, particles: { targets: [t.id] } },
      });
    }
    return out;
  }
  const info = part as MesoscaleInfo;
  const cut = new Set(ids.entities);
  const names = new Map(info.entities.map((e) => [e.id, e.name]));
  const walk = (g: MesoGroup, parent: string) => {
    for (const child of g.groups) {
      const members = groupEntities(child);
      const n = members.reduce((k, id) => k + (cut.has(id) ? 1 : 0), 0);
      if (n && n === members.length) {
        out.push({
          key: groupKeyOf(ref, info, child.path),
          label: `${parent} › ${child.label}`,
          node: { ref, particles: { entities: members } },
        });
      } else if (n) walk(child, child.label);
    }
    for (const id of g.entities) {
      if (!cut.has(id)) continue;
      out.push({
        key: `me:${ref}:${id}`,
        label: `${parent} › ${names.get(id) ?? id}`,
        node: { ref, particles: { entities: [id] } },
      });
    }
  };
  walk(info.groups, o.label);
  return out;
}

/** What a cut keeps whole of a structure, found once a cut (a cut is the same object until the clipping changes) */
const AtomUses = new WeakMap<Cut, Map<string, ClipUse[]>>();

/** The rows of a cut of some atoms: the structure's entities it cuts all of, else their chains it cuts all of */
function atomUses(area: ExplorerApi, cut: Cut, o: SceneObject): ClipUse[] {
  let known = AtomUses.get(cut);
  if (!known) AtomUses.set(cut, (known = new Map()));
  const had = known.get(o.ref);
  if (had) return had;
  const of = area.cutOf(cut, o.ref);
  const out: ClipUse[] = [];
  for (const e of o.entities ?? []) {
    const entity = { ref: o.ref, entity: e.id };
    if (of && area.covers(of, entity)) {
      out.push({ key: `e:${o.ref}:${e.id}`, label: `${o.label} › ${e.label}`, node: entity });
      continue;
    }
    if (e.chains.length < 2) continue;
    for (const ch of e.chains) {
      const chain = { ref: o.ref, entity: e.id, chain: ch };
      if (of && area.covers(of, chain))
        out.push({ key: `ch:${o.ref}:${e.id}:${ch}`, label: `${e.label} › Chain ${ch}`, node: chain });
    }
  }
  known.set(o.ref, out);
  return out;
}

/**
 * What a clip can be given (its Cut also): every object, and its parts a clip is often of: a structure's entities, a
 * model's groups, a list's targets (a model's entities are many: from their own Clips), named as What it cuts names them
 */
export function clipTargetsOf(objects: readonly SceneObject[], parts: Parts): ClipUse[] {
  const out: ClipUse[] = [];
  for (const o of objects) {
    const ref = o.ref;
    out.push({ key: `o:${ref}`, label: o.label, node: { ref } });
    for (const e of o.entities ?? []) {
      out.push({ key: `e:${ref}:${e.id}`, label: `${o.label} › ${e.label}`, node: { ref, entity: e.id } });
    }
    const part = parts.get(ref);
    if (!part) continue;
    if (o.kind === 'list') {
      for (const t of (part as DecorationsInfo).targets) {
        out.push({
          key: `t:${ref}:${t.id}`,
          label: `${o.label} › ${t.name}`,
          node: { ref, particles: { targets: [t.id] } },
        });
      }
      continue;
    }
    if (o.kind !== 'model') continue;
    const info = part as MesoscaleInfo;
    const walk = (g: MesoGroup, parent: string) => {
      for (const child of g.groups) {
        out.push({
          key: groupKeyOf(ref, info, child.path),
          label: `${parent} › ${child.label}`,
          node: { ref, particles: { entities: groupEntities(child) } },
        });
        walk(child, child.label);
      }
    };
    walk(info.groups, o.label);
  }
  return out;
}

/** Whether a clip's uses are all in `node` (taking it off would leave the clip cutting nothing: no ×) */
export function allItCuts(uses: readonly ClipUse[], node: NodeRef): boolean {
  return uses.length > 0 && uses.every((u) => within(u.node, node));
}

/** Whether all of `part` is in `node` (the same object; its particles' or atoms' among the node's) */
function within(part: NodeRef, node: NodeRef): boolean {
  if (part.ref !== node.ref) return false;
  if ('particles' in node) {
    if (!('particles' in part)) return false;
    const kind = kindOf(part.particles);
    if (kindOf(node.particles) !== kind) return false;
    const ids = new Set(node.particles[kind]);
    return (part.particles[kind] ?? []).every((id) => ids.has(id));
  }
  if ('entity' in node) {
    return 'entity' in part && part.entity === node.entity && (!node.chain || part.chain === node.chain);
  }
  return true;
}
