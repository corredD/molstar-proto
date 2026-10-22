/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type ContextMenuItem, openContextMenu } from '@molstar/prism-ui';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type { DragMode } from './cuts.js';
import { startDrag } from './drag.js';
import type { StageApi, StageMenuRequest } from './operations.js';

// The stage's right-click menu (Stories Untold's stage menu): its items for what was picked, shared by the extension's
// own menu and a host's (prism-me's), which takes the cut guides' items from here.

/** The app's root around the canvas (its tokens and styles apply in it) */
export function rootOf(request: StageMenuRequest): HTMLElement {
  return request.anchor?.closest<HTMLElement>('.msp-root') ?? document.body;
}

const Swatches: [string, string][] = [
  ['tomato', 'Red'],
  ['orange', 'Orange'],
  ['gold', 'Yellow'],
  ['mediumseagreen', 'Green'],
  ['dodgerblue', 'Blue'],
  ['mediumpurple', 'Purple'],
  ['white', 'White'],
];

/**
 * The menu's items for what was picked. The other extensions' operations (mesoscale entities, cryo-ET decorations) are
 * run by id when the viewer has them, so the stage tools do not depend on those extensions.
 */
export async function menuItems(api: ViewerApi, area: StageApi, request: StageMenuRequest): Promise<ContextMenuItem[]> {
  const { pick } = request;
  const items: ContextMenuItem[] = [];
  const again = (sub: ContextMenuItem[]) => () => {
    openContextMenu(rootOf(request), { x: request.x, y: request.y }, sub);
  };
  const anyCut = area.guidesState();
  if (pick.kind === 'nothing') {
    items.push({
      id: 'reset-camera',
      label: 'Reset the camera',
      icon: 'scan',
      run: () => void api.run('camera.reset', {}),
    });
  } else {
    const t = pick.target;
    if (pick.kind === 'target') {
      items.push({
        id: 'focus',
        label: `Focus on ${pick.particle?.name ?? t.label}`,
        icon: 'scan',
        run: request.focus,
      });
      const p = pick.particle;
      if (p && api.describe('mesoscale.style')) {
        const style = (values: Record<string, unknown>) =>
          void api.run('mesoscale.style', { entities: String(p.entity), particles: t.ref, ...values });
        items.push({
          id: 'hide-entity',
          label: `Hide ${p.name}`,
          icon: 'eye-off',
          run: () => style({ visible: false }),
        });
        items.push({
          id: 'color-entity',
          label: `Color ${p.name}…`,
          icon: 'palette',
          run: again(Swatches.map(([c, label]) => ({ id: `color-${c}`, label, run: () => style({ color: c }) }))),
        });
      }
      if (p && api.describe('cryoet.decorate')) {
        const info = await api.run('cryoet.decorations', { particles: t.ref });
        const objects = info.ok ? ((info.value as { objects?: { ref: string; label: string }[] })?.objects ?? []) : [];
        const decorate = (values: Record<string, unknown>) =>
          void api.run('cryoet.decorate', { particles: t.ref, targets: String(p.target), ...values });
        items.push({
          id: 'decorate',
          label: 'Decorate with…',
          icon: 'shapes',
          run: again([
            ...objects.map((o) => ({
              id: `with-${o.ref}`,
              label: o.label,
              run: () => decorate({ with: 'object', object: o.ref }),
            })),
            { id: 'with-spheres', label: 'Spheres', run: () => decorate({ with: 'none' }) },
          ]),
        });
      }
    }
    if (pick.kind === 'guide') {
      // a cut's guide: move, turn or size it by dragging, flip or remove it
      const { index } = pick;
      const object = area.clipObject(t.ref, index);
      const partial = area.isPartialCut(t.ref, index);
      const drag = (mode: DragMode) => () => startDrag(area, rootOf(request), request.anchor, t.ref, index, mode);
      items.push({ id: 'move', label: 'Move the cut', icon: 'move-3d', run: drag('move') });
      items.push({ id: 'rotate', label: 'Turn the cut', icon: 'rotate-ccw', run: drag('rotate') });
      if (object && object.type !== 'plane') {
        items.push({ id: 'scale', label: 'Size the cut', icon: 'maximize-2', run: drag('scale') });
      }
      items.push({
        id: 'flip',
        label: object?.type === 'plane' ? 'Cut the other side' : 'Keep the inside',
        icon: 'refresh-cw',
        run: () => void area.object({ target: t.ref, index, invert: !object?.invert } as never),
      });
      items.push({
        id: 'uncut',
        label: 'Remove the cut',
        icon: 'x',
        run: () =>
          void (
            partial &&
            api.run('mesoscale.clip', { entities: partial.entities.join(','), type: 'none', particles: t.ref })
          ),
      });
    }
  }
  if (pick.kind === 'guide' || area.hasCuts()) {
    const shown = anyCut.value;
    items.push({
      id: 'guides',
      label: shown ? 'Hide the cuts' : 'Show the cuts',
      icon: shown ? 'eye-off' : 'eye',
      run: () => void area.guides({ visible: !shown }),
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
