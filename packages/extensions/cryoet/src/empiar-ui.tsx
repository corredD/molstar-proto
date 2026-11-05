/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { domView } from '@molstar/prism-ui';
import type { ViewerExtensionUI, ViewerUIContext } from '@molstar/prism-viewer/spec';
import { EmpiarCard } from './empiar.js';
import { EmpiarPanel } from './empiar-card.js';

// The EMPIAR card's registration (_spec/empiar.md §4): over the canvas, the panel of empiar-card.tsx.

export function empiarUI(ctx: ViewerUIContext): ViewerExtensionUI {
  const area = ctx.api.empiar;
  if (!area) return {};
  return {
    overlays: [{ id: EmpiarCard, title: 'EMPIAR', render: domView(() => <EmpiarPanel ctx={ctx} area={area} />) }],
  };
}
