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

/** The CryoET Data Portal's (_spec/portal.md §5): `?portal-dataset=10003&portal-run=TS_08`, then the others optional */
export const PortalUrlParameters: readonly string[] = [
  'portal-dataset',
  'portal-run',
  'portal-tomogram',
  'portal-spacing',
  'portal-annotations',
  'portal-level',
  'portal-tiltseries',
  'portal-tiltseries-level',
];

/** The `cryoetPortal.load` values the URL asks for, if it names a dataset */
export function portalLoadOf(search: string): Record<string, unknown> | undefined {
  const q = parseSearch(search);
  const dataset = Number(q.get('portal-dataset'));
  if (!Number.isInteger(dataset) || dataset <= 0) return;
  const level = q.get('portal-level');
  // a tomogram by id picks its spacing too (§5)
  const tomogram = q.get('portal-tomogram');
  const spacing = q.get('portal-spacing');
  // a tilt series by id, at a level of its own (the tomogram's is not its: 584 MB at level 1 against 146 at 2)
  const tiltSeries = q.get('portal-tiltseries');
  const tiltSeriesLevel = q.get('portal-tiltseries-level');
  const whole = (x: string | undefined) => x !== undefined && /^\d+$/.test(x);
  return {
    dataset,
    run: q.get('portal-run') ?? '',
    annotations: q.get('portal-annotations') ?? '',
    ...(tomogram !== undefined && /^\d+$/.test(tomogram) ? { tomogram: Number(tomogram) } : {}),
    ...(spacing !== undefined && /^\d+(\.\d+)?$/.test(spacing) ? { spacing: Number(spacing) } : {}),
    ...(level !== undefined && /^\d+$/.test(level) ? { level: Number(level) } : {}),
    ...(whole(tiltSeries) ? { tiltSeries: Number(tiltSeries) } : {}),
    ...(whole(tiltSeriesLevel) ? { tiltSeriesLevel: Number(tiltSeriesLevel) } : {}),
  };
}

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
