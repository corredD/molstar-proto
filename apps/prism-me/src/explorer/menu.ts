/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { ContextMenuItem } from '@molstar/prism-ui';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type { ExplorerApi, PickedNode } from './operations.js';
import { toggleVisible } from './rows.js';

// The explorer's right-click menu (_spec/ui.md §5): the same on the canvas and on a tree row, at the level of what is
// picked (an object, a group, an entity, a chain, a target). Step 3a: Focus, Hide; the clips, labels and moves come next.

/** Kinds whose eye hides them (a structure's entities and chains have none: Prism hides representations) */
const Hideable = new Set(['structure', 'mesoscale model', 'particle list', 'group', 'target', 'volume', 'mesh']);

/** The items for a node; nothing picked: the camera's */
export function nodeMenuItems(api: ViewerApi, area: ExplorerApi, picked: PickedNode | undefined): ContextMenuItem[] {
  if (!picked) {
    return [
      { id: 'reset-camera', label: 'Reset the camera', icon: 'scan', run: () => void api.run('camera.reset', {}) },
    ];
  }
  const { node, kind, label } = picked;
  const items: ContextMenuItem[] = [
    { id: 'focus', label: `Focus on ${label}`, icon: 'scan', run: () => area.focus(node) },
  ];
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
