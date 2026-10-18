/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import './favicon.ico';
import './index.html';
import { setDebugMode, setTimingMode } from '@molstar/core/util/debug';
import { LoadUrlParameters, parseSearch, runUrlLoads } from '@molstar/prism-viewer/features/loaders';
import { createPrismViewer } from '@molstar/prism-viewer/page';
import { modesFromUrl, unknownUrlParameters } from '@molstar/prism-viewer-app/url';
import { createMesoscaleExplorerSpec } from './spec.js';
import { MesoscaleUrlParameters, toLoaderSearch } from './url.js';

// The Mesoscale Explorer on Prism (_spec/README.md): the page, the spec and the viewer, exposed on `window.molstar`.
// The URL's loads run once the viewer is created, as the loaders feature's operations.

async function main() {
  const target = document.getElementById('app');
  if (!target) throw new Error('The page has no #app element.');
  const modes = modesFromUrl(location.search);
  if (modes.debug) setDebugMode(true);
  if (modes.timing) setTimingMode(true);
  const search = toLoaderSearch(location.search);
  const viewer = await createPrismViewer({ target, spec: createMesoscaleExplorerSpec(search) });
  (window as unknown as { molstar: unknown }).molstar = { viewer, api: viewer.api };

  const unknown = unknownUrlParameters(location.search, [...LoadUrlParameters, ...MesoscaleUrlParameters]);
  if (unknown.length) console.info(`Ignored URL parameters (not known to the explorer): ${unknown.join(', ')}`);
  const params = parseSearch(search);
  if (LoadUrlParameters.some((p) => params.has(p)) && viewer.api.describe('load.entry')) {
    runUrlLoads(viewer.api, search).catch((e: unknown) => console.error(e));
  }
  // The Mesoscale Explorer's own: `?example=petworld-hiv`, `?graphics-mode=performance`
  const own = parseSearch(location.search);
  const example = own.get('example');
  if (example) viewer.api.run('mesoscale.example', { id: example }).catch((e: unknown) => console.error(e));
  const graphics = own.get('graphics-mode');
  if (graphics) viewer.api.run('mesoscale.graphics', { mode: graphics }).catch((e: unknown) => console.error(e));
}

main().catch((e) => {
  console.error(e);
  const p = document.createElement('p');
  p.style.cssText = 'font: 14px system-ui; padding: 24px; color: #ddd';
  p.textContent = `The explorer could not start: ${e instanceof Error ? e.message : String(e)}`;
  document.body.appendChild(p);
});
