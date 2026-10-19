/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { ViewerExtension } from '@molstar/prism-viewer/spec';
import { ExplorerApi } from './operations.js';
import { explorerUI } from './ui.js';

declare module '@molstar/prism-viewer/api' {
  // The `explorer` area: what the scene holds, as the explorer's tree shows it.
  interface ExtensionApis {
    explorer: ExplorerApi;
  }
}

// The explorer's panel (_spec/ui.md): the scene's tree above the properties of the row picked.

export const ExplorerExtension: ViewerExtension = {
  id: 'explorer',
  title: 'Explorer',
  api: { explorer: (ctx) => new ExplorerApi(ctx) },
  // not lazy: its tab is the one open at start
  ui: explorerUI,
};
