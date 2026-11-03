/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { domView } from '@molstar/prism-ui';
import type { ViewerExtensionUI, ViewerUIContext } from '@molstar/prism-viewer/spec';
import { PortalCard } from './portal.js';
import { PortalPanel } from './portal-card.js';

// The CryoET Data Portal's views (_spec/portal.md §4): its card over the canvas, the panel of portal-card.tsx.

export function portalUI(ctx: ViewerUIContext): ViewerExtensionUI {
  const area = ctx.api.cryoetPortal;
  if (!area) return {};
  return {
    overlays: [
      {
        id: PortalCard,
        title: 'CryoET Data Portal',
        render: domView(() => <PortalPanel ctx={ctx} area={area} />),
      },
    ],
  };
}
