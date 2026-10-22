/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { openContextMenu } from '@molstar/prism-ui';
import { menuItems, rootOf } from './menu.js';
import type { ViewerExtensionUI, ViewerUIContext } from '@molstar/prism-viewer/spec';

// The stage tools' views (apps/prism-me/_spec/features.md, "Stage tools"; Stories Untold's stage menu): the canvas's
// right-click menu, on what was picked (a structure, a particle and its entity, a volume). Cuts are Prism's (its
// clipping feature). They act through the API as the person, so each choice is one step of the history.

export function stageToolsUI(ctx: ViewerUIContext): ViewerExtensionUI {
  const area = ctx.api.stage;
  if (!area) return {};
  // The menu follows the canvas's right-clicks for as long as the viewer lives.
  let close: (() => void) | undefined;
  area.setMenu(async (request) => {
    close?.();
    const items = await menuItems(ctx.api, area, request);
    if (!items.length) return;
    close = openContextMenu(rootOf(request), { x: request.x, y: request.y }, items);
  });
  return {};
}
