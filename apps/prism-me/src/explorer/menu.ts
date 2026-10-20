/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { ContextMenuItem } from '@molstar/prism-ui';
import type { ViewerApi } from '@molstar/prism-viewer/api';
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

/** Whole objects: their clips cut all of them (the stage's cuts) */
const WholeClips = new Set(['structure', 'mesoscale model', 'particle list', 'volume']);

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

/** The particles a part's clip or color acts on: an entity's or a group's entities, a target (lists by target) */
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

/** Whether a node can be clipped: an object (all of it) or a part of particles (a group, an entity, a target) */
export function clippable(kind: string, node: NodeRef | undefined): boolean {
  if (!node) return false;
  return WholeClips.has(kind) || ('particles' in node && ['group', 'entity', 'target'].includes(kind));
}

/** Whether a node's clips are the whole object's (the stage's), else its particles' (the mesoscale area's) */
export function clipsWhole(kind: string) {
  return WholeClips.has(kind);
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

/** The scissors' items: a clip of the node (added to its others), by shape */
export function clipItems(api: ViewerApi, picked: PickedNode): ContextMenuItem[] {
  const { node, kind } = picked;
  if (clipsWhole(kind)) {
    return (
      [
        ['plane', 'Plane'],
        ['sphere', 'Sphere'],
        ['box', 'Box'],
      ] as const
    ).map(([shape, label]) => ({
      id: `clip-${shape}`,
      label,
      icon: 'scissors',
      run: () => void api.run('stage.cut', { shape, add: true, target: node.ref }),
    }));
  }
  const part = partOf(node);
  if (!part) return [];
  return (
    [
      ['plane', 'Plane'],
      ['sphere', 'Sphere'],
      ['cube', 'Box'],
      ['cylinder', 'Cylinder'],
    ] as const
  ).map(([type, label]) => ({
    id: `clip-${type}`,
    label,
    icon: 'scissors',
    run: () => void api.run('mesoscale.clip', { ...part, type, add: true }),
  }));
}

/** What the menu asks of the panel: a sub-menu at the same place (Color…, Add a clip…), a row to pick (a new label) */
export interface MenuActions {
  open?(items: ContextMenuItem[]): void;
  reveal?(picked: PickedNode): void;
}

/** Adds a label in front of a node, named after it, and picks its row (its text is edited in the properties) */
export async function addLabel(
  api: ViewerApi,
  area: ExplorerApi,
  picked: PickedNode,
  reveal?: (p: PickedNode) => void,
) {
  const bounds = area.boundsOf(picked.node);
  // readable at the object's scale: half the node's size, at least a 15th of its object's, in half-Å steps
  const object = area.boundsOf({ ref: picked.node.ref }) ?? bounds;
  const size =
    bounds && object ? Math.round(Math.min(100, Math.max(2, bounds.radius / 2, object.radius / 15)) * 2) / 2 : 4;
  const r = await api.run('stage.label', {
    text: picked.label,
    target: picked.node.ref,
    node: picked.key,
    ...(bounds
      ? {
          x: bounds.center[0],
          y: bounds.center[1],
          z: bounds.center[2],
          depth: bounds.radius,
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
  const items: ContextMenuItem[] = [
    { id: 'focus', label: `Focus on ${label}`, icon: 'scan', run: () => area.focus(node) },
  ];
  if (kind === 'label') {
    if (actions.reveal) {
      const reveal = actions.reveal;
      items.push({ id: 'edit-label', label: 'Edit the text', icon: 'type', run: () => reveal(picked) });
    }
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
    items.push({ id: 'clip', label: 'Add a clip…', icon: 'scissors', run: () => open(clipItems(api, picked)) });
  }
  items.push({
    id: 'label',
    label: 'Add a label',
    icon: 'type',
    run: () => void addLabel(api, area, picked, actions.reveal),
  });
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
