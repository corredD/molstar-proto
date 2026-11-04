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
  PortalTiltSeries,
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
 * lowest id flagged, as the portal's run page), else the first tomogram of its first spacing that has one
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
  // the first spacing with a tomogram: the card chooses a tomogram, not a spacing (§4)
  const s = spacings.find((x) => x.tomograms.length) ?? spacings[0];
  return { s, t: s.tomograms[0] };
}

const words = (s: string) => s.replace(/_/g, ' ');
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A tomogram as the portal's own list labels it, compact: '64007 · WBP Filtered · 10.403 Å · 886×630×246 · AreTomo3
 * v2.3.0' (the processing's software after the reconstruction's when it differs: '…, IsoNet2')
 */
export function portalTomogramLabel(t: PortalTomogram, spacing: number) {
  const kind = [t.method && words(t.method), t.processing && capital(t.processing)].filter((x) => x).join(' ');
  const software = [...new Set([t.reconstructionSoftware, t.processingSoftware].filter((x) => x))].join(', ');
  return [String(t.id), kind, `${spacing} Å`, t.size.join('×'), software].filter((x) => x).join(' · ');
}

/** Every tomogram of a run, across its spacings, by id: the card's choice of tomogram ([id, label]) */
export function portalTomogramOptions(run: PortalRun): [string, string][] {
  const all = run.spacings.flatMap((s) => s.tomograms.map((t) => ({ t, spacing: s.spacing })));
  all.sort((a, b) => a.t.id - b.t.id);
  return all.map(({ t, spacing }) => [String(t.id), portalTomogramLabel(t, spacing)]);
}

/** A signed whole degree, as the portal writes a tilt range: '−60°', '+60°' */
const degrees = (a: number) => {
  const r = Math.round(a);
  return `${r < 0 ? '−' : r > 0 ? '+' : ''}${Math.abs(r)}°`;
};

/**
 * A tilt series as the portal labels it: 'TS-17086 · 1.7005 Å · 3838×3710×41 · −60°…+60° step 3°' (its full size; the
 * range of its angles whatever their order in the stack, a dose-symmetric one's too)
 */
export function portalTiltSeriesLabel(ts: PortalTiltSeries) {
  const n = ts.angles.length;
  const [x, y] = ts.levels[0]?.size ?? [0, 0];
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of ts.angles) {
    if (a < lo) lo = a;
    if (a > hi) hi = a;
  }
  const range = n > 1 ? ` · ${degrees(lo)}…${degrees(hi)} step ${Math.round(((hi - lo) / (n - 1)) * 10) / 10}°` : '';
  return `TS-${ts.id} · ${ts.pixelSpacing} Å · ${x}×${y}×${n}${range}`;
}

/** A run's tilt series, the card's choice ([id, label]) */
export function portalTiltSeriesOptions(run: PortalRun): [string, string][] {
  return (run.tiltSeries ?? []).map((t) => [String(t.id), portalTiltSeriesLabel(t)]);
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
