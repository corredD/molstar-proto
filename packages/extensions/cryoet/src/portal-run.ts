/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type {
  PortalAnnotation,
  PortalCatalog,
  PortalDataset,
  PortalLevel,
  PortalRun,
  PortalSpacing,
  PortalTomogram,
} from './portal-index.js';

// A portal run as a load takes it (_spec/portal.md §2), and the sizes the card shows: plain functions of the index,
// no viewer, so the card (portal-card.tsx) and its story depend on nothing of the viewer's API.

/** A failure as the viewer's API says one (`ApiFailure`'s shape), without depending on it */
export interface PortalFailure {
  readonly ok: false;
  readonly code: 'not-found';
  readonly message: string;
  readonly hint?: string;
}

const notFound = (message: string, hint?: string): PortalFailure =>
  hint ? { ok: false, code: 'not-found', message, hint } : { ok: false, code: 'not-found', message };

/** The portal's card (portal-ui.tsx), opened by `view.open({ card })` */
export const PortalCard = 'cryoet-portal.overlay.portal';

/** What a load does with a tomogram: its slices and its direct volume, its slices, or nothing */
export type PortalTomogramView = 'both' | 'slices' | 'none';

/** An annotation of a run, as `run` lists it and `load` takes it: `<id>` or `<id>/<shape>` */
export interface PortalEntry extends PortalAnnotation {
  readonly key: string;
  /** The format the viewer lacks to read it, if it does */
  readonly needs?: string;
}

/** A run as `run` describes it */
export interface PortalRunInfo {
  readonly dataset: number;
  readonly run: PortalRun;
  readonly spacing: PortalSpacing;
  readonly tomogram?: PortalTomogram;
  readonly entries: readonly PortalEntry[];
  /** The annotations a load takes when none are named: the portal's defaults */
  readonly defaults: readonly string[];
  readonly needs?: string;
}

/** What the card reads of the portal's area (a story gives a fake) */
export interface PortalPanelArea {
  catalog(): Promise<PortalCatalog>;
  dataset(id: number): Promise<PortalDataset>;
  describe(ds: PortalDataset, run: string, spacing?: number, tomogram?: number): PortalRunInfo | PortalFailure;
}

const needsReader = (reads: (format: string) => boolean, format: string) =>
  reads(format) ? undefined : `needs a reader for ${format}`;

/** A run of the index as a load takes it, given which formats the viewer reads (a view's story gives its own) */
export function describePortalRun(
  reads: (format: string) => boolean,
  ds: PortalDataset,
  name: string,
  spacing?: number,
  tomogram?: number,
): PortalRunInfo | PortalFailure {
  const key = name.trim();
  const run = key ? ds.runList.find((r) => r.name === key || String(r.id) === key) : ds.runList[0];
  if (!run) {
    const more = ds.runList.length < ds.runs ? ` (the index holds ${ds.runList.length} of ${ds.runs})` : '';
    return notFound(`Dataset ${ds.id} has no run '${key}'${more}.`, `Runs: ${runNames(ds)}.`);
  }
  const picked = pickTomogram(run, spacing, tomogram);
  if ('ok' in picked) return picked;
  const { s, t } = picked;
  const shapes = new Map<number, number>();
  for (const a of s.annotations) shapes.set(a.id, (shapes.get(a.id) ?? 0) + 1);
  const entries = s.annotations.map((a) => ({
    ...a,
    key: shapes.get(a.id)! > 1 ? `${a.id}/${a.shape}` : String(a.id),
    needs: needsReader(reads, a.format),
  }));
  return {
    dataset: ds.id,
    run,
    spacing: s,
    tomogram: t,
    entries,
    defaults: entries.filter((e) => e.default).map((e) => e.key),
    needs: t ? needsReader(reads, 'zarr') : undefined,
  };
}

/**
 * The spacing and tomogram a load takes (_spec/portal.md §2): a tomogram by id, from whichever spacing holds it; a
 * spacing's flagged tomogram (the portal's default), else its first; with neither, the run's default tomogram (the
 * lowest id flagged, as the portal's run page), else its first spacing's first
 */
function pickTomogram(
  run: PortalRun,
  spacing: number | undefined,
  tomogram: number | undefined,
): { s: PortalSpacing; t?: PortalTomogram } | PortalFailure {
  const spacings = spacing ? run.spacings.filter((x) => Math.abs(x.spacing - spacing) < 1e-3) : run.spacings;
  if (!spacings.length) {
    return notFound(
      `${run.name} has no voxel spacing ${spacing} Å.`,
      `It has ${run.spacings.map((x) => x.spacing).join(', ')} Å.`,
    );
  }
  let found: { s: PortalSpacing; t?: PortalTomogram } | undefined;
  for (const s of spacings) {
    for (const t of s.tomograms) {
      if (tomogram ? t.id === tomogram : t.default && (!found?.t || t.id < found.t.id)) found = { s, t };
    }
  }
  if (found) return found;
  if (tomogram) {
    const ids = run.spacings.flatMap((x) => x.tomograms.map((t) => t.id)).sort((a, b) => a - b);
    return spacing
      ? notFound(`${run.name} has no tomogram ${tomogram} at ${spacings[0].spacing} Å.`, `It has ${ids.join(', ')}.`)
      : notFound(`${run.name} has no tomogram ${tomogram}.`, `It has ${ids.join(', ')}.`);
  }
  return { s: spacings[0], t: spacings[0].tomograms[0] };
}

function runNames(ds: PortalDataset) {
  const names = ds.runList.map((r) => r.name);
  return names.length > 8 ? `${names.slice(0, 8).join(', ')}, …` : names.join(', ');
}

/** A zarr annotation at the level asked (its coarsest when absent or missing), a file its size */
export function entryBytes(e: PortalEntry, level: number | undefined) {
  if (!e.levels?.length) return e.bytes ?? 0;
  return (e.levels.find((l) => l.path === String(level)) ?? e.levels[e.levels.length - 1]).bytes;
}

/** MB as the OME-Zarr format counts them (1e6 bytes) */
export const mb = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 10e6 ? 1 : 0)} MB`;
export const levelLine = (l: PortalLevel) => `${l.path}: ${l.size.join('×')} at ${l.spacing} Å, ${mb(l.bytes)}`;
