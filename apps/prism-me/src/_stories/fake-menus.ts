/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { ContextMenuItem } from '@molstar/prism-ui';
import { type MockNode, ObjectKinds } from './fake-scene.js';

// The explorer's menus as ui.md says them (§2 + Open, §5 the right-click, §7 a distance's), for the mocks: the same
// menu on the canvas and on a row, at the level of what is picked. Items run nothing (no viewer): they log.

const item = (id: string, label: string, disabled?: string): ContextMenuItem => ({
  id,
  label,
  ...(disabled ? { disabled } : {}),
  run: () => console.info(`[explorer mock] ${label}`),
});

/** + Open (ui.md §2) */
export const OpenItems: readonly ContextMenuItem[] = [
  item('files', 'Files…'),
  item('entry', 'PDB / PDB-IHM / EMDB id…'),
  item('examples', 'Examples…'),
  item('session', 'Session…'),
];

/** Add clip's shapes (ui.md §5: a plane, sphere or box) */
export const ClipShapes: readonly ContextMenuItem[] = [
  item('clip-plane', 'Plane'),
  item('clip-sphere', 'Sphere'),
  item('clip-box', 'Box'),
];

/** The brush's colors (ui.md §3 step 3b): swatches for all of it; a model's or group's Generate colors first */
export function colorItemsOf(node: MockNode): ContextMenuItem[] {
  const swatches = ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Purple', 'Gray', 'White'].map((c) =>
    item(`color-${c.toLowerCase()}`, c),
  );
  return node.kind === 'model' || node.kind === 'group' ? [item('generate', 'Generate colors'), ...swatches] : swatches;
}

/** Whether a row has the brush (a color for all of it), as the app's `colorable` */
export const colorable = (node: MockNode) =>
  ['structure', 'entity', 'chain', 'model', 'group', 'model entity', 'target', 'mesh'].includes(node.kind);

/** Whether a row has the scissors (a clip), as the app's `clippable`: an object all of it, a part only it */
export const clippable = (node: MockNode) =>
  ['structure', 'model', 'list', 'volume', 'entity', 'chain', 'group', 'model entity', 'target'].includes(node.kind);

/**
 * The right-click of a node (ui.md §5): Focus, Move and Rotate, Add label, Add clip; on a clip or a label its own; on a
 * distance its own (§7). A part's Move and Rotate are "[to decide]" in ui.md: greyed here, with why.
 */
export function menuOf(node: MockNode, openClipShapes?: () => void): ContextMenuItem[] {
  switch (node.kind) {
    case 'clip':
      return [
        item('move', 'Move'),
        item('rotate', 'Rotate'),
        item('size', 'Size'),
        item('flip', 'Flip'),
        item('hide', 'Hide'),
        item('remove', 'Remove'),
      ];
    case 'label':
      return [
        item('move', 'Move'),
        item('rotate', 'Rotate'),
        item('edit', 'Edit text'),
        item('hide', 'Hide'),
        item('remove', 'Remove'),
      ];
    case 'distance':
      return [item('focus', 'Focus'), item('hide', 'Hide'), item('remove', 'Remove')];
  }
  const part = !ObjectKinds.has(node.kind);
  const toDecide = part ? 'ui.md §5 [to decide]: the whole object it belongs to, or only this part' : undefined;
  return [
    item('focus', 'Focus'),
    item('move', 'Move', toDecide),
    item('rotate', 'Rotate', toDecide),
    item('label', 'Add label'),
    { ...item('clip', 'Add clip…'), run: () => openClipShapes?.() },
  ];
}
