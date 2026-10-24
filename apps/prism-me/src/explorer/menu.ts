/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { ContextMenuItem } from '@molstar/prism-ui';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type {} from '@molstar/prism-viewer/features/clipping';
import type {} from '@molstar/prism-viewer/features/structure-move';
import { startMoveDrag } from '@molstar/stage-tools-extension/drag';
import type { ExplorerApi, NodeRef, PickedNode } from './operations.js';
import { toggleVisible } from './rows.js';

// The explorer's menus (_spec/ui.md §3, §5), at the level of what is picked (an object, a group, an entity, a chain, a
// target): the right-click's (on the canvas and on a tree row; a label's: edit, hide, remove), and the row tools' (Mesoscale Explorer's brush and
// scissors beside the eye): a color for all of it, a clip of it (several at each level, each listed in its Clips).

/** Kinds whose eye hides them (a structure's entities and chains have none: Prism hides representations) */
const Hideable = new Set([
  'structure',
  'mesoscale model',
  'particle list',
  'group',
  'target',
  'volume',
  'mesh',
  'label',
]);

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
}

/** The swatches of the brush */
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

/** The brush's items: a color for all of the node; a model's or group's generated colors */
export function colorItems(api: ViewerApi, area: ExplorerApi, picked: PickedNode): ContextMenuItem[] {
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
    items.unshift({
      id: 'generate',
      label: 'Generate colors',
      icon: 'sparkles',
      run: () =>
        void api.run('mesoscale.colors', {
          scheme: 'generate',
          particles: node.ref,
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

/** The scissors' items: a clip of the node (added to its others), by shape */
export function clipItems(api: ViewerApi, area: ExplorerApi, picked: PickedNode): ContextMenuItem[] {
  const { node, kind } = picked;
  if (!clippable(kind, node)) return [];
  // Prism's cut of all of it (its representations), or of only its atoms; its handles shown on it
  return (
    [
      ['plane', 'Plane'],
      ['sphere', 'Sphere'],
      ['cube', 'Box'],
      ['cylinder', 'Cylinder'],
      ['infiniteCone', 'Cone'],
    ] as const
  ).map(([shape, label]) => ({
    id: `clip-${shape}`,
    label,
    icon: 'scissors',
    run: () => void addClip(api, area, node, shape),
  }));
}

/**
 * What the menu asks of the panel: a sub-menu at the same place (Color…, Add a clip…), a row to pick (a new label), a
 * text edited where the menu was (a label's); and where it was opened in 3D (a label goes there)
 */
export interface MenuActions {
  open?(items: ContextMenuItem[]): void;
  reveal?(picked: PickedNode): void;
  editText?(text: string, keep: (text: string) => void): void;
  /** The point clicked on what was picked (Å) */
  at?: readonly [number, number, number];
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
  // readable at the object's scale: about the node's own size, at least a 15th of its object's, in half-Å steps
  const object = area.boundsOf({ ref: picked.node.ref });
  const own = anchor?.radius ?? object?.radius ?? 10;
  const size = Math.round(Math.max(2, own / 2, (object?.radius ?? own) / 15) * 2) / 2;
  const r = await api.run('stage.label', {
    text: picked.label,
    target: picked.node.ref,
    node: picked.key,
    ...(position
      ? {
          x: position[0],
          y: position[1],
          z: position[2],
          // in front of the surface clicked; else of the node's middle
          depth: at ? size : own,
          size,
        }
      : {}),
  });
  const ref = r.ok ? r.changed.nodes?.[0] : undefined;
  if (ref && reveal) reveal({ key: `l:${ref}`, label: picked.label, kind: 'label', node: { ref } });
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
  // an entity of a model hides as a group does (its style); a structure's entity or chain cannot yet
  const hideable = Hideable.has(kind) || (kind === 'entity' && 'particles' in node);
  if (hideable) {
    items.push({
      id: 'hide',
      label: `Hide ${label}`,
      icon: 'eye-off',
      run: () =>
        void toggleVisible(api, { key: picked.key, depth: 0, label, kind, hasChildren: false, visible: true, node }),
    });
  }
  if (kind === 'label') {
    items.push({
      id: 'remove-label',
      label: 'Remove the label',
      icon: 'x',
      run: () => void api.run('stage.editLabel', { label: node.ref, remove: true }),
    });
    return items;
  }
  const open = actions.open;
  if (open && colorable(kind, node)) {
    items.push({ id: 'color', label: 'Color…', icon: 'palette', run: () => open(colorItems(api, area, picked)) });
  }
  if (open && clippable(kind, node)) {
    items.push({ id: 'clip', label: 'Add a clip…', icon: 'scissors', run: () => open(clipItems(api, area, picked)) });
  }
  items.push({
    id: 'label',
    label: 'Add a label',
    icon: 'type',
    run: () => void addLabel(api, area, picked, actions.reveal, actions.at),
  });
  if (removable(kind, node)) {
    items.push({
      id: 'remove',
      label: `Remove ${label}`,
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
