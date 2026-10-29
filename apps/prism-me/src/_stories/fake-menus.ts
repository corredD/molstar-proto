/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { ContextMenuItem } from '@molstar/prism-ui';
import { CategoryThemes } from '../explorer/tree-view.js';
import { type ClipShape, clipBook, ShapeNames } from './clip-book.js';
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

/** Add clip's shapes with the proposed aperture cut (cellVIEW evaluation, item f) */
export const ProposedClipShapes: readonly ContextMenuItem[] = [
  ...ClipShapes,
  item('clip-aperture', 'Aperture: open the view onto this part'),
];

/** The proposed Show only (cellVIEW evaluation, item d): a part's right-click, one step each */
const showOnly = (node: MockNode): ContextMenuItem[] =>
  node.kind === 'model entity' || node.kind === 'group' || node.kind === 'target'
    ? [
        item('only', 'Show only this'),
        ...(node.kind === 'model entity'
          ? [item('only-group', 'Show only its group'), item('only-compartment', 'Show only its compartment')]
          : []),
        item('all', 'Show all again'),
      ]
    : [];

/** Color…'s colors (ui.md §3 step 3b): swatches for all of it; a model's or group's Generate colors first */
export function colorItemsOf(node: MockNode): ContextMenuItem[] {
  const swatches = ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Purple', 'Gray', 'White'].map((c) =>
    item(`color-${c.toLowerCase()}`, c),
  );
  if (node.kind === 'category')
    return (CategoryThemes[node.key] ?? []).map(([id, label]) => item(`theme-${id}`, label));
  return node.kind === 'model' || node.kind === 'group' ? [item('generate', 'Generate colors'), ...swatches] : swatches;
}

/** Whether a row's ⋯ has Color… (a color for all of it), as the app's `colorable` */
export const colorable = (node: MockNode) =>
  node.key !== 'c:clips' &&
  ['category', 'structure', 'entity', 'chain', 'model', 'group', 'model entity', 'target', 'mesh'].includes(node.kind);

/** Whether a row's ⋯ has Add clip… (a clip), as the app's `clippable`: an object all of it, a part only it */
export const clippable = (node: MockNode) =>
  node.key !== 'c:clips' &&
  ['category', 'structure', 'model', 'list', 'volume', 'entity', 'chain', 'group', 'model entity', 'target'].includes(
    node.kind,
  );

/**
 * The right-click of a node (ui.md §5), the same as its row's ⋯ (Ludo, 2026-10-28): Focus, Move and turn, Color…, Add
 * label, Add clip…, Remove (an object); on a clip, a label or a distance its own; on a category its
 * color theme and a clip of every object in it. No Hide: every row's eye is in view. A part's Move and turn is
 * "[to decide]" in ui.md: greyed here, with why. `proposed`: with the cellVIEW evaluation's items not built yet (a
 * clip's ghosts, the Clips category's New clip…, Show only).
 */
export function menuOf(
  node: MockNode,
  open: { clipShapes(): void; colors(): void },
  proposed = false,
): ContextMenuItem[] {
  const colors = { ...item('color', 'Color…'), run: open.colors };
  const clip = (label: string) => ({ ...item('clip', label), run: open.clipShapes });
  const remove = item('remove', 'Remove');
  switch (node.kind) {
    case 'clip':
      return [
        item('move', 'Move'),
        item('rotate', 'Rotate'),
        item('size', 'Size'),
        item('flip', 'Flip'),
        ...(proposed ? [item('ghosts', 'Outline what it cuts')] : []),
        remove,
      ];
    case 'label':
      return [item('move', 'Move'), item('rotate', 'Rotate'), item('edit', 'Edit text'), remove];
    case 'distance':
      return [item('focus', 'Focus'), remove];
    case 'category':
      return node.key === 'c:clips' ? [clip('New clip…')] : [colors, clip('Add clip… (every object in it)')];
  }
  const part = !ObjectKinds.has(node.kind);
  const toDecide = part ? 'ui.md §5 [to decide]: the whole object it belongs to, or only this part' : undefined;
  // one Move and turn: Prism's handles on it, move and turn together (Ludovic, 2026-10-25, as the app)
  return [
    item('focus', 'Focus'),
    item('move', 'Move and turn', toDecide),
    ...(colorable(node) ? [colors] : []),
    item('label', 'Add label'),
    ...(clippable(node) ? [clip('Add clip…')] : []),
    ...(proposed ? showOnly(node) : []),
    ...(ObjectKinds.has(node.kind) ? [remove] : []),
  ];
}

/**
 * The proposed Add clip… (Ludo, 2026-10-28): a new clip of a shape that cuts `node`, or a clip of the scene used on it
 * too (those already on it greyed)
 */
export function proposedClipItems(node: MockNode): ContextMenuItem[] {
  const shapes: ClipShape[] = ['plane', 'sphere', 'box', 'aperture'];
  const on = new Set(clipBook.uses.value.filter((u) => u.node === node.key).map((u) => u.clip));
  return [
    ...shapes.map((shape) => ({
      ...item(`new-${shape}`, `New ${ShapeNames[shape].toLowerCase()}`),
      run: () => clipBook.add(shape, node.key, node.label),
    })),
    ...clipBook.clips.value.map((c) => ({
      ...item(`use-${c.key}`, `Use ${c.label}`, on.has(c.key) ? 'Already on it' : undefined),
      run: () => clipBook.use(c.key, node.key, c.shape === 'aperture' ? 'focus' : 'cut', 60, 0, node.label),
    })),
  ];
}
