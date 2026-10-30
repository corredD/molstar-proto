/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { groupEntities, type MesoGroup, type MesoGroupBy } from '@molstar/mesoscale-extension/model';
import type { ContextMenuItem } from '@molstar/prism-ui';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type {} from '@molstar/prism-viewer/features/clipping';
import type {} from '@molstar/prism-viewer/features/structure-move';
import { startMoveDrag } from '@molstar/stage-tools-extension/drag';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ExplorerApi, NodeRef, PickedNode } from './operations.js';
import { clipName } from './rows.js';

// The explorer's menus (_spec/ui.md §3, §5), at the level of what is picked (an object, a group, an entity, a chain, a
// target): the right-click's, on the canvas and as a tree row's ⋯ (a label's: edit, remove; a distance's: focus,
// remove), with Color… (a color for all of it), Add clip… (a clip of it: several at each level, each listed in its
// Clips), Remove and Show only. No Hide: every row's eye is in view (Ludo, 2026-10-28).

/** Whole objects: their clips cut all of them (Prism's clipping) */
const WholeClips = new Set(['structure', 'mesoscale model', 'particle list', 'volume', 'mesh']);

/** Objects that move as a whole (their own transform) */
const Movable = new Set(['structure', 'mesoscale model', 'particle list', 'volume', 'mesh']);
/** A volume's representations: drawn in its frame, moved with it */
const VolumeParts = new Set(['slice', 'isosurface', 'volume representation']);

/** Whether a node moves as a whole object (by its handles) */
export function movable(kind: string) {
  return Movable.has(kind);
}

/** The app's root around the canvas (the drag's layer goes over it) */
function rootAround(el: Element | undefined): HTMLElement {
  return el?.closest<HTMLElement>('.msp-root') ?? document.body;
}

/**
 * Move by hand: Prism's handles (its gizmo library) on an object, to move and turn it in 3D, one step a release: a
 * structure's Prism's own (`api.move`), a particle list's, a volume's or a mesh's the stage's on the same library; a
 * label, a drag on the canvas. A part's: not yet (greyed, why)
 */
function moveItems(api: ViewerApi, area: ExplorerApi, picked: PickedNode): ContextMenuItem[] {
  const stage = api.stage;
  if (!stage) return [];
  const canvas = area.canvasElement();
  const { node, kind } = picked;
  if (kind === 'label') {
    const label = stage.labelsState().value.find((l) => l.ref === node.ref);
    if (!label) return [];
    return [
      {
        id: 'move',
        label: 'Move',
        icon: 'move-3d',
        run: () => startMoveDrag(stage, rootAround(canvas), canvas, node.ref, 'move', label),
      },
    ];
  }
  // an oblique slice: its own handle (moved anywhere, tilted), in its volume's frame
  if (kind === 'oblique slice' && api.cryoet && picked.representation) {
    const handles = api.cryoet.useObliqueHandles(api);
    const slice = picked.representation;
    if (handles.target.value?.slice === slice) {
      return [{ id: 'hide-handles', label: 'Hide the handle', icon: 'move-3d', run: () => handles.hide() }];
    }
    return [
      {
        id: 'move',
        label: 'Move and tilt it (handle)',
        icon: 'move-3d',
        run: () => {
          hideHandles(api);
          handles.show({ volume: node.ref, slice });
        },
      },
    ];
  }
  // a volume's slice or isosurface has no place of its own: its volume's handles move it (a slice moves through the
  // volume by its index)
  const of = VolumeParts.has(kind) ? 'volume' : kind;
  if (Movable.has(of)) {
    const on = handlesOn(api);
    if (on === node.ref) {
      return [{ id: 'hide-handles', label: 'Hide the handles', icon: 'move-3d', run: () => hideHandles(api) }];
    }
    return [
      {
        id: 'move',
        label: of === kind ? 'Move and turn (handles)' : 'Move and turn its volume (handles)',
        icon: 'move-3d',
        run: () => showHandles(api, node.ref, of),
      },
    ];
  }
  return [
    {
      id: 'move',
      label: 'Move',
      icon: 'move-3d',
      disabled: 'Moving a part (an entity, a chain, a group) is not there yet: move its object',
      run: () => {},
    },
  ];
}

/** The object the move handles are on, if shown */
export function handlesOn(api: ViewerApi): string | undefined {
  if (api.move?.gizmos.shown.value) return api.move.gizmos.target.value;
  if (api.stage?.moveGizmos.shown.value) return api.stage.moveGizmos.target.value;
  return undefined;
}

/** Shows the move handles on an object (one object at a time: the others' go) */
export function showHandles(api: ViewerApi, ref: string, kind: string) {
  hideHandles(api);
  if (kind === 'structure' && api.move) {
    api.move.gizmos.setTarget(ref);
    api.move.showGizmos(api);
    return;
  }
  const gizmos = api.stage?.moveGizmos;
  if (!gizmos) return;
  gizmos.setTarget(ref);
  gizmos.show();
}

export function hideHandles(api: ViewerApi) {
  api.move?.gizmos.hide();
  api.stage?.moveGizmos.hide();
  api.cryoet?.obliqueHandles?.hide();
}

/** The swatches of Color… */
export const Swatches: readonly [string, string][] = [
  ['tomato', 'Red'],
  ['orange', 'Orange'],
  ['gold', 'Yellow'],
  ['mediumseagreen', 'Green'],
  ['dodgerblue', 'Blue'],
  ['mediumpurple', 'Purple'],
  ['white', 'White'],
  ['gray', 'Gray'],
];

/** The particles a part's color acts on: an entity's or a group's entities, a target (lists by target) */
function partOf(node: NodeRef): { particles: string; entities: string } | undefined {
  if (!('particles' in node)) return undefined;
  const ids = node.particles.entities ?? node.particles.targets ?? [];
  return { particles: node.ref, entities: ids.join(',') };
}

/** Whether a node can be colored for all of it (a structure, its parts; a model, its parts; a target; a mesh) */
export function colorable(kind: string, node: NodeRef | undefined): boolean {
  if (!node) return false;
  return ['structure', 'entity', 'chain', 'mesoscale model', 'group', 'target', 'mesh'].includes(kind);
}

/**
 * Whether a node can be clipped (Prism's clipping): an object, all of it; a part, only it (a structure's entity or
 * chain; a model's or list's group, entity or target)
 */
export function clippable(kind: string, node: NodeRef | undefined): boolean {
  if (!node) return false;
  if (WholeClips.has(kind)) return true;
  if ('entity' in node) return kind === 'entity' || kind === 'chain';
  return 'particles' in node && ['group', 'entity', 'target'].includes(kind);
}

/** Whether a node is a loaded object (it can be removed from the scene, with all of it) */
export function removable(kind: string, node: NodeRef | undefined): boolean {
  return !!node && WholeClips.has(kind);
}

/**
 * Removes a loaded object from the scene, and its labels: its file with it (all it holds: a model's unit cell) unless
 * the file holds another listed object (then Prism's remove of the object alone)
 */
export async function removeObject(api: ViewerApi, area: ExplorerApi, kind: string, ref: string) {
  const labels = api.stage?.labelsState().value.filter((l) => l.target === ref || area.isUnder(l.target, ref)) ?? [];
  const entry = area.entryOf(ref);
  const shared = area.objectsState().value.some((o) => o.ref !== ref && area.entryOf(o.ref) === entry);
  // a cell by its ref alone (a `#ref` selector reaches only the kinds of nodes: not a download, an example's entry)
  const r = !shared
    ? await api.run('state.remove', { node: entry })
    : kind === 'structure'
      ? await api.run('structure.remove', { structure: ref })
      : kind === 'volume'
        ? await api.run('volume.remove', { volume: ref })
        : kind === 'mesh'
          ? await api.run('state.remove', { node: ref })
          : await api.run('particles.remove', { particles: ref });
  if (!r.ok) return r;
  for (const l of labels) await api.run('stage.editLabel', { label: l.ref, remove: true });
  return r;
}

/**
 * A particle list's representation color theme shown: the colors set in Look (the mesoscale area's, painted over the
 * theme) cleared, back to the theme. Whether there were some.
 */
export async function showTheme(api: ViewerApi, list: string): Promise<boolean> {
  const info = api.mesoscale?.infoState(list).value;
  if (!info?.entities.some((e) => e.color !== undefined)) return false;
  const r = await api.run('mesoscale.colors', { scheme: 'theme', particles: list });
  return r.ok;
}

/**
 * Color…'s items: a color for all of the node; a model's or group's generated colors, a hue per group as the tree
 * groups the model (`groupBy`: the explorer's grouping of a model, by ref)
 */
export function colorItems(
  api: ViewerApi,
  area: ExplorerApi,
  picked: PickedNode,
  groupBy?: (model: string) => MesoGroupBy | undefined,
): ContextMenuItem[] {
  const { node, kind } = picked;
  const paint = (color: string) => {
    if (kind === 'mesh') return api.run('cryoet.mesh', { mesh: node.ref, color });
    const part = partOf(node);
    if (part || kind === 'mesoscale model') {
      return api.run('mesoscale.style', { particles: node.ref, ...(part ? { entities: part.entities } : {}), color });
    }
    return api.run('representation.color', { target: { loci: area.loci(node) }, structure: node.ref, color });
  };
  const items: ContextMenuItem[] = Swatches.map(([color, label]) => ({
    id: `color-${color}`,
    label,
    icon: 'palette',
    run: () => void paint(color),
  }));
  if (kind === 'mesoscale model' || kind === 'group') {
    const part = partOf(node);
    const by = groupBy?.(node.ref);
    items.unshift({
      id: 'generate',
      label: 'Generate colors',
      icon: 'sparkles',
      run: () =>
        void api.run('mesoscale.colors', {
          scheme: 'generate',
          particles: node.ref,
          ...(by ? { groupBy: by } : {}),
          ...(part ? { entities: part.entities } : {}),
        }),
    });
  }
  return items;
}

/**
 * Adds Prism's cut of a node, and shows its handles (to move, turn and size it in 3D): all of an object, or only a
 * part: a structure's entity or chain (the rest its representations draw kept whole), a model's or list's group,
 * entity or target (the other particles left whole)
 */
export async function addClip(api: ViewerApi, area: ExplorerApi, node: NodeRef, shape: string) {
  const r =
    'entity' in node
      ? await api.run('clipping.add', { shape, target: { loci: area.loci(node) }, only: true })
      : 'particles' in node
        ? await api.run('clipping.add', { shape, node: `#${node.ref}`, particles: node.particles })
        : await api.run('clipping.add', { shape, node: `#${node.ref}` });
  const cut = (r as { value?: { index: number } }).value;
  if (!r.ok || !cut || !api.clipping) return;
  showClipHandles(api, cut.index);
}

/** Prism's handles on one cut (its number), in the canvas */
export function showClipHandles(api: ViewerApi, index: number) {
  const clipping = api.clipping;
  if (!clipping) return;
  if (!clipping.gizmos.shown.value) clipping.showGizmos(api);
  clipping.gizmos.handleOnly(index);
}

/** Prism's cut shapes, in Add clip…'s order */
const NewClipShapes = [
  ['plane', 'Plane'],
  ['sphere', 'Sphere'],
  ['cube', 'Box'],
  ['cylinder', 'Cylinder'],
  ['infiniteCone', 'Cone'],
] as const;

/**
 * Add clip… (the ⋯, the right-click; Ludo, 2026-10-28): a new clip of each shape that cuts the node, then
 * every clip of the scene, used on it too (one step: `explorer.clipUse`); those on it already greyed
 */
export function clipItems(api: ViewerApi, area: ExplorerApi, picked: PickedNode): ContextMenuItem[] {
  const { node, kind } = picked;
  if (!clippable(kind, node)) return [];
  const cuts = api.clipping?.cuts.value ?? [];
  const on = new Set(area.cutsOf(cuts, node).map((c) => c.object.tag));
  return [
    ...NewClipShapes.map(([shape, label]) => ({
      id: `clip-${shape}`,
      label: `New ${label.toLowerCase()}`,
      run: () => void addClip(api, area, node, shape),
    })),
    ...useItems(api, cuts, [node], (tag) => on.has(tag)),
  ];
}

/** Every clip of the scene, used on `nodes` too (one step); greyed where `isOn` */
export function useItems(
  api: ViewerApi,
  cuts: readonly ClipCut[],
  nodes: readonly NodeRef[],
  isOn: (tag: string) => boolean,
): ContextMenuItem[] {
  return cuts
    .filter((c) => !!c.object.tag)
    .map((c) => {
      const tag = c.object.tag!;
      return {
        id: `use-${tag}`,
        label: `Use ${clipName(c)}`,
        ...(isOn(tag) ? { disabled: 'It cuts it already' } : {}),
        run: () => void api.run('explorer.clipUse', { tag, nodes: [...nodes], on: true }),
      };
    });
}

type ClipCut = ViewerApi['clipping']['cuts']['value'][number];

/**
 * What the menu asks of the panel: a sub-menu at the same place (Color…, Add clip…), a row to pick (a new label), a
 * text edited where the menu was (a label's); and where it was opened in 3D (a label goes there)
 */
export interface MenuActions {
  open?(items: ContextMenuItem[]): void;
  reveal?(picked: PickedNode): void;
  editText?(text: string, keep: (text: string) => void): void;
  /** The point clicked on what was picked (Å) */
  at?: readonly [number, number, number];
  /** A model's grouping in the tree (the explorer's), for its generated colors */
  groupBy?(model: string): MesoGroupBy | undefined;
}

/**
 * Adds a label of a node, named after it, and picks its row (its text is edited in the properties): where it was
 * clicked, else on the node (a part of many particles: its particle nearest the camera), in front of it
 */
export async function addLabel(
  api: ViewerApi,
  area: ExplorerApi,
  picked: PickedNode,
  reveal?: (p: PickedNode) => void,
  at?: readonly [number, number, number],
) {
  const anchor = area.anchorOf(picked.node);
  const position = at ?? anchor?.position;
  // sized by the stage to the node's own radius (its part's) and to its object's
  const own = anchor?.radius ?? area.boundsOf({ ref: picked.node.ref })?.radius ?? 10;
  const r = await api.run('stage.label', {
    text: picked.label,
    target: picked.node.ref,
    node: picked.key,
    ...(position
      ? {
          x: position[0],
          y: position[1],
          z: position[2],
          radius: own,
          // in front of the node's middle by its radius; a point clicked on it: by the label's height (the stage's)
          ...(at ? {} : { depth: own }),
        }
      : {}),
  });
  const ref = r.ok ? r.changed.nodes?.[0] : undefined;
  if (ref && reveal) reveal({ key: `l:${ref}`, label: picked.label, kind: 'label', node: { ref } });
}

/** A distance's right-click: the camera on its two points, remove */
function distanceItems(api: ViewerApi, area: ExplorerApi, picked: PickedNode): ContextMenuItem[] {
  const { node, label } = picked;
  const name = api.stage?.distancesState().value.find((d) => d.ref === node.ref)?.label ?? label;
  return [
    { id: 'focus', label: `Focus on the distance ${name}`, icon: 'scan', run: () => area.focus(node) },
    {
      id: 'remove-distance',
      label: 'Remove',
      icon: 'x',
      run: () => void api.run('stage.editDistance', { distance: node.ref, remove: true }),
    },
  ];
}

/** The right-click's items for a node; nothing picked: the camera's */
export function nodeMenuItems(
  api: ViewerApi,
  area: ExplorerApi,
  picked: PickedNode | undefined,
  actions: MenuActions = {},
): ContextMenuItem[] {
  if (!picked) {
    return [
      { id: 'reset-camera', label: 'Reset the camera', icon: 'scan', run: () => void api.run('camera.reset', {}) },
    ];
  }
  const { node, kind, label } = picked;
  const items: ContextMenuItem[] = [];
  if (kind === 'distance') return distanceItems(api, area, picked);
  if (kind === 'label') {
    // a label's: its text, its place first
    const editText = actions.editText;
    const info = api.stage?.labelsState().value.find((l) => l.ref === node.ref);
    if (editText && info) {
      items.push({
        id: 'edit-label',
        label: 'Edit the text…',
        icon: 'type',
        run: () => editText(info.text, (text) => void api.run('stage.editLabel', { label: node.ref, text })),
      });
    } else if (actions.reveal) {
      const reveal = actions.reveal;
      items.push({ id: 'edit-label', label: 'Edit the text', icon: 'type', run: () => reveal(picked) });
    }
    items.push(...moveItems(api, area, picked));
    items.push({ id: 'focus', label: `Focus on ${info?.text ?? label}`, icon: 'scan', run: () => area.focus(node) });
  } else {
    items.push({ id: 'focus', label: `Focus on ${picked.label}`, icon: 'scan', run: () => area.focus(node) });
    items.push(...moveItems(api, area, picked));
  }
  if (kind === 'label') {
    items.push({
      id: 'remove-label',
      label: 'Remove',
      icon: 'x',
      run: () => void api.run('stage.editLabel', { label: node.ref, remove: true }),
    });
    return items;
  }
  const open = actions.open;
  if (open && colorable(kind, node)) {
    items.push({
      id: 'color',
      label: 'Color…',
      icon: 'palette',
      run: () => open(colorItems(api, area, picked, actions.groupBy)),
    });
  }
  items.push({
    id: 'label',
    label: 'Add a label',
    icon: 'type',
    run: () => void addLabel(api, area, picked, actions.reveal, actions.at),
  });
  if (open && clippable(kind, node)) {
    items.push({ id: 'clip', label: 'Add clip…', icon: 'scissors', run: () => open(clipItems(api, area, picked)) });
  }
  items.push(...showOnlyItems(api, picked, actions.groupBy));
  if (removable(kind, node)) {
    items.push({
      id: 'remove',
      label: 'Remove',
      icon: 'trash-2',
      run: () => void removeObject(api, area, kind, node.ref),
    });
  }
  if (api.describe('assistant.ask')) {
    items.push({
      id: 'ask',
      label: 'Ask the assistant…',
      icon: 'sparkles',
      run: () => void api.run('assistant.ask', {}),
    });
  }
  return items;
}

// --- Show only (cellVIEW's, _spec/cellview.md §2; Ludo, 2026-10-28) -------------------------------------------------

/**
 * A part's Show only: this, its group, its compartment (a model's entity), Show all again; each one step, the object
 * drawn again if hidden. A model's entities by `mesoscale.style` (`particles.look`'s entity layers, as their eyes read
 * them), a list's targets by `particles.look`.
 */
function showOnlyItems(
  api: ViewerApi,
  picked: PickedNode,
  groupBy?: (model: string) => MesoGroupBy | undefined,
): ContextMenuItem[] {
  const { node, kind } = picked;
  if (!('particles' in node) || !['entity', 'group', 'target'].includes(kind)) return [];
  const ref = node.ref;
  const item = (id: string, label: string, only: () => readonly number[] | undefined): ContextMenuItem => ({
    id,
    label,
    icon: 'eye',
    run: () => void showOnly(api, ref, kind === 'target' ? 'targets' : 'entities', only()),
  });
  if (kind !== 'entity') {
    const ids = node.particles.entities ?? node.particles.targets ?? [];
    return [item('show-only', 'Show only this', () => ids), item('show-all', 'Show all again', () => undefined)];
  }
  const id = node.particles.entities?.[0];
  if (id === undefined) return [];
  const items = [item('show-only', 'Show only this', () => [id])];
  // its group as the tree groups the model; its compartment from the compartments, whatever the tree's grouping
  const shown = api.mesoscale?.infoState(ref, observableState(groupBy?.(ref)).asReadonly).value;
  const group = shown && parentOf(shown.groups, id);
  if (group?.path) items.push(item('show-group', 'Show only its group', () => groupEntities(group)));
  const byCompartment = shown?.hasCompartments
    ? api.mesoscale?.infoState(ref, observableState<MesoGroupBy | undefined>('compartment').asReadonly).value
    : undefined;
  const home = byCompartment && parentOf(byCompartment.groups, id);
  if (byCompartment && home?.path) {
    const key = compartmentOf(home.path);
    items.push(item('show-compartment', 'Show only its compartment', () => inCompartment(byCompartment.groups, key)));
  }
  items.push(item('show-all', 'Show all again', () => undefined));
  return items;
}

/**
 * Shows only some of a list's entities or targets, the others hidden, the list drawn again; none given: every one shown
 * (Show all again). One step: the list's visibility (when hidden) and its looks.
 */
export function showOnly(api: ViewerApi, ref: string, by: 'entities' | 'targets', only: readonly number[] | undefined) {
  return api.group(only ? 'Show only' : 'Show all again', async (g) => {
    const drawn = await g.run('particles.visibility', { particles: ref, visible: true });
    if (!drawn.ok) return drawn;
    if (by === 'entities') {
      // all of them hidden or shown (one write, none named), then the ones kept
      const all = await g.run('mesoscale.style', { particles: ref, visible: !only });
      if (!all.ok || !only) return all;
      return g.run('mesoscale.style', { particles: ref, entities: only.join(','), visible: true });
    }
    const targets = g.cryoet?.decorationsState(ref).value?.targets ?? [];
    const kept = new Set(only);
    return g.run('particles.look', {
      particles: ref,
      layers: targets.map((t) => ({ selector: { targets: [t.id] }, visible: !only || kept.has(t.id) })),
    });
  });
}

/** The group an entity is directly in, if not the model's root */
function parentOf(root: MesoGroup, id: number): MesoGroup | undefined {
  if (root.path && root.entities.includes(id)) return root;
  for (const g of root.groups) {
    const found = parentOf(g, id);
    if (found) return found;
  }
  return undefined;
}

/**
 * A compartment's key from a compartment path (cellPACK's `root.<compartment>.(surface|interior).<group>`): the path
 * before its last surface or interior; none: the path's parent (a membrane beside its compartment's surface)
 */
export function compartmentOf(path: string): string {
  const parts = path.split('.');
  for (let i = parts.length - 1; i > 0; i--)
    if (parts[i] === 'surface' || parts[i] === 'interior') return parts.slice(0, i).join('.');
  return parts.length > 1 ? parts.slice(0, -1).join('.') : path;
}

/** The entities whose compartment (a group path's key) is `key` */
function inCompartment(root: MesoGroup, key: string): number[] {
  const out: number[] = [];
  const walk = (g: MesoGroup) => {
    if (g.path && g.entities.length && compartmentOf(g.path) === key) out.push(...g.entities);
    for (const c of g.groups) walk(c);
  };
  walk(root);
  return out;
}
