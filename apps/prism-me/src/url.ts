/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { parseSearch } from '@molstar/prism-viewer/features/loaders';

// The URL of the Mesoscale Explorer (v5 `apps/mesoscale-explorer/src/index.html`) on Prism's loaders (app.md §4):
// its load parameters are renamed to the loaders' (`pdbihm` → `pdb-ihm`, `url` with `type` → `url`/`snapshot-url`),
// its own options (`example`, `graphics-mode`) are read by the mesoscale extension once the viewer is created.

/** The Mesoscale Explorer's own parameters, besides the viewer's and the loaders'. */
export const MesoscaleUrlParameters: readonly string[] = ['example', 'graphics-mode', 'type', 'pdbihm', 'pdbdev'];

/** The query string with the Mesoscale Explorer's load parameters renamed to the loaders' (unknown ones are kept). */
export function toLoaderSearch(search: string): string {
  const q = parseSearch(search);
  const out = new URLSearchParams();
  for (const [name, value] of q) {
    if (name === 'type' || name === 'pdbihm' || name === 'pdbdev') continue;
    if (name === 'url') continue;
    out.set(name, value);
  }
  const ihm = q.get('pdbihm') ?? q.get('pdbdev');
  if (ihm && !out.has('pdb-ihm')) out.set('pdb-ihm', ihm);
  const url = q.get('url');
  if (url) {
    // v5's types: a session (molx, molj) or mmCIF (cif, bcif); without one the format is read from the address.
    const type = q.get('type')?.toLowerCase();
    if (type === 'molx' || type === 'molj') {
      out.set('snapshot-url', url);
      out.set('snapshot-url-type', type);
    } else {
      out.set('url', url);
      if (type === 'cif' || type === 'bcif') out.set('url-format', 'mmcif');
      if (type === 'bcif') out.set('url-is-binary', '1');
    }
  }
  const s = out.toString();
  return s ? `?${s}` : '';
}
