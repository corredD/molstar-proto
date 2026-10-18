/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { PLUGIN_VERSION } from '@molstar/plugin/version';
import { assistant } from '@molstar/prism-assistant/spec';
import { LoadUrlParameters, parseSearch } from '@molstar/prism-viewer/features/loaders';
import { webStore } from '@molstar/prism-viewer/persist/stores';
import type { PrismViewerSpec } from '@molstar/prism-viewer/spec';
import { FullPrismViewerSpec } from '@molstar/prism-viewer-app/full-spec';
import { optionsFromUrl } from '@molstar/prism-viewer-app/url';
import { MesoscaleExplorerExtensions } from './extensions.js';

/**
 * The spec of the Mesoscale Explorer (viewer-spec.md §5): the Prism viewer with Mol*'s extensions, the explorer's
 * extensions, its look (a dark canvas, as v5's explorer) and the URL's options. `search` is the loaders' query string
 * (`toLoaderSearch`).
 */
export function createMesoscaleExplorerSpec(search: string): PrismViewerSpec {
  const base = FullPrismViewerSpec();
  const params = parseSearch(search);
  const loads = LoadUrlParameters.some((p) => params.has(p));
  const options = optionsFromUrl(search);
  return {
    ...base,
    extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions],
    options: {
      ...options,
      canvas: { background: '#101010', ...options.canvas },
      ui: { homeWhenEmpty: !loads, showRemoteStates: true, ...options.ui },
    },
    ui: { ...base.ui, theme: base.ui?.theme ?? 'dark' },
    persist: {
      key: 'prism-me',
      preferences: webStore('local', { prefix: 'prism-me', version: PLUGIN_VERSION, budget: 64 * 1024 }),
    },
    agent: { ...(base.agent || {}), assistant: assistant() },
  };
}
