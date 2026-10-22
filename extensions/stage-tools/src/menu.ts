/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type ContextMenuItem, openContextMenu } from '@molstar/prism-ui';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type { StageApi, StageMenuRequest } from './operations.js';

// The stage's right-click menu (Stories Untold's stage menu): its items for what was picked, shared by the extension's
// own menu; a host (prism-me) opens its own instead.

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
