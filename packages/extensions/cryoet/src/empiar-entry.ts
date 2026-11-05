/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { span } from './load-steps.js';

// An EMPIAR entry as the browser walks it (_spec/empiar.md §1): the API's entry, the file host's folder listings, a
// file's kind and its run. Plain functions of the replies, no viewer, no network: the area (empiar.ts) reads, these
// parse, the card (empiar-card.tsx) and its story show.

/** The EMPIAR REST API's entries (`Access-Control-Allow-Origin: *`) */
export const EmpiarApi = 'https://www.ebi.ac.uk/empiar/api/entry/';
/** The file host: a folder is an HTML listing, a file its bytes (`Access-Control-Allow-Origin: *`) */
export const EmpiarFiles = 'https://ftp.ebi.ac.uk/empiar/world_availability/';
/** An entry's page */
export const EmpiarPages = 'https://www.ebi.ac.uk/empiar/EMPIAR-';

/**
 * Above this many bytes a file is not offered: read whole, it does not fit in a tab (about 2 GB; a 3.3 GB tilt series
 * would end the tab after an hour's download). Ranged reads are step C (_spec/empiar.md §3).
 */
export const EmpiarWholeMaxBytes = 2e9;

/**
 * EBI's usual speed for EMPIAR's files, bytes a second, slowest and fastest (measured 2026-11-04 on 12534's tomogram:
 * 88 KB/s over HTTPS, 219 KB/s over HTTP, 0.15 MB/s a connection from the app; no mirror: PDBj has no EMPIAR files).
 * A pick's time is said from it (_spec/empiar.md §3).
 */
export const EmpiarEbiSpeed = { slow: 0.1e6, fast: 0.2e6 } as const;

/** Above this many bytes a pick's EBI time is said: under it the wait is about a minute or less */
export const EmpiarSlowBytes = 5e6;

/** The EMPIAR card (empiar-ui.tsx), opened by `empiar.open` (or `view.open({ card })`) */
export const EmpiarCard = 'cryoet-empiar.overlay.empiar';

/** What the card is asked to show: an entry, and a run of it to pick (`?empiar=12534&empiar-run=…`) */
export interface EmpiarAsk {
  readonly id: number;
  readonly run?: string;
}

/** A condition: a folder of the image sets (`data/EMPIAR_upload`), its grids and the files it shares (particle lists) */
export interface EmpiarCondition {
  readonly root: string;
  readonly grids: readonly string[];
  readonly shared: readonly EmpiarFile[];
  /** The folders holding each grid (`Reconstructed_tomograms`, …), frames left out */
  readonly holds: Readonly<Record<string, readonly string[]>>;
}

/** `EMPIAR-12534`, `empiar-12534` or `12534`: the number, or undefined */
export function empiarIdOf(text: string): number | undefined {
  const m = /^\s*(?:empiar-?)?(\d+)\s*$/i.exec(text);
  return m ? Number(m[1]) : undefined;
}

/** An image set: a folder the depositor described, its category (`reconstructed volumes`, `tilt series`, …) */
export interface EmpiarImageSet {
  readonly directory: string;
  readonly category: string;
  readonly name: string;
  readonly pixelSize: number;
}

export interface EmpiarEntry {
  readonly id: number;
  readonly title: string;
  /** EMDB cross-references, `EMD-48752`, in the API's order */
  readonly emdb: readonly string[];
  readonly imageSets: readonly EmpiarImageSet[];
  /** The folders the image sets' segmentations name (`data/EMPIAR_upload/Voxel_segmentations`) */
  readonly segmentations: readonly string[];
  /** The folders holding the image sets (`data/EMPIAR_upload`), each a condition of the experiment */
  readonly conditions: readonly string[];
}

const trimSlash = (p: string) => p.replace(/^\/+|\/+$/g, '');
const parentOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));

/** The API's reply for `EMPIAR-<id>` as the walk takes it; a reply without the entry fails, naming it */
export function readEmpiarEntry(id: number, reply: unknown): EmpiarEntry {
  const e = (reply as Record<string, any> | undefined)?.[`EMPIAR-${id}`];
  if (!e || typeof e !== 'object') throw new Error(`The EMPIAR API has no entry EMPIAR-${id}.`);
  const sets: any[] = Array.isArray(e.imagesets) ? e.imagesets : [];
  const imageSets = sets.map((s) => ({
    directory: trimSlash(String(s.directory ?? '')),
    category: String(s.category ?? ''),
    name: String(s.name ?? ''),
    pixelSize: Number(s.pixel_width) || 0,
  }));
  const segmentations = sets.flatMap((s) => (s.segmentations ?? []).map((x: any) => trimSlash(String(x.file ?? ''))));
  const conditions = [...new Set(imageSets.map((s) => parentOf(s.directory)).filter((d) => d))];
  return {
    id,
    title: String(e.title ?? ''),
    emdb: (Array.isArray(e.cross_references) ? e.cross_references : [])
      .map((x: any) => String(x?.name ?? x))
      .filter((x: string) => /^EMD-\d+$/.test(x)),
    imageSets,
    segmentations,
    conditions,
  };
}

/** A row of a folder listing: a folder (no size) or a file, its size as the listing writes it (`834M`) */
export interface ListingRow {
  readonly name: string;
  readonly folder: boolean;
  readonly size: string;
  readonly bytes?: number;
}

const Units: Readonly<Record<string, number>> = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };

/** The listing's size in bytes: Apache writes binary units (`834M` is 834 MiB, about 874.5 MB); `-` none */
export function listingBytes(size: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)([KMGT]?)$/.exec(size.trim());
  return m ? Math.round(Number(m[1]) * Units[m[2]]) : undefined;
}

const Row = /<a href="([^"?/][^"]*)">[^<]*<\/a><\/td><td[^>]*>[^<]*<\/td><td[^>]*>\s*([^<]*?)\s*<\/td>/g;

/**
 * A folder's rows from its listing (Apache's `Index of`): each anchor and the size after its date; the sort links (`?C=`)
 * and the parent (an absolute address) left out. A page that is not a listing fails, saying so (the format is not an
 * API: a change is said, not shown as an empty folder).
 */
export function parseListing(html: string): ListingRow[] {
  if (!/<title>Index of /.test(html)) throw new Error('Not a folder listing.');
  const rows: ListingRow[] = [];
  for (const [, href, size] of html.matchAll(Row)) {
    const folder = href.endsWith('/');
    const name = decodeURIComponent(folder ? href.slice(0, -1) : href);
    const bytes = folder ? undefined : listingBytes(size);
    rows.push(bytes === undefined ? { name, folder, size: folder ? '' : size } : { name, folder, size, bytes });
  }
  return rows;
}

/** What a file is to the explorer: its kind decides how it loads, or why it does not */
export type EmpiarKind =
  | 'tomogram'
  | 'tilt-series'
  | 'mask'
  | 'particles'
  | 'angles'
  | 'surfaces'
  | 'frames'
  | 'metadata'
  | 'volume'
  | 'other';

export interface EmpiarFile {
  /** From the entry's folder: `data/EMPIAR_upload/Reconstructed_tomograms/YTC041_1/<run>.mrc_9.98Apx.mrc` */
  readonly path: string;
  readonly name: string;
  readonly size: string;
  readonly bytes?: number;
  readonly kind: EmpiarKind;
  /** Why it cannot load, if it cannot */
  readonly why?: string;
}

const ext = (name: string) => /\.([^.]+)$/.exec(name)?.[1].toLowerCase() ?? '';
const Mrc = new Set(['mrc', 'map', 'rec', 'st', 'ali', 'mrcs']);

/** The kind of a file by its image set (its folder), else its folder's name and its extension (_spec/empiar.md §1) */
export function kindOf(entry: EmpiarEntry, folder: string, name: string): EmpiarKind {
  const e = ext(name);
  const set = entry.imageSets.find((s) => folder === s.directory || folder.startsWith(`${s.directory}/`));
  const segmented = entry.segmentations.some((s) => folder === s || folder.startsWith(`${s}/`));
  if (e === 'hff' || e === 'stl' || e === 'obj' || e === 'ply') return 'surfaces';
  if (e === 'star') return 'particles';
  if (e === 'rawtlt' || e === 'tlt') return 'angles';
  if (e === 'mdoc' || e === 'xf' || e === 'xml' || e === 'txt' || e === 'json') return 'metadata';
  if (e === 'tif' || e === 'tiff' || e === 'eer' || set?.category.startsWith('micrographs')) return 'frames';
  if (!Mrc.has(e)) return 'other';
  if (segmented) return 'mask';
  if (set?.category === 'reconstructed volumes') return 'tomogram';
  if (set?.category === 'tilt series' || e === 'st') return 'tilt-series';
  // the folder's own words: its name or its kind folder's above a grid, never a parent's (review S3, N7)
  if (/segment|label|mask/i.test(folder.split('/').slice(-2).join('/'))) return 'mask';
  return 'volume';
}

/** The kinds that load, and why the others do not */
const NotLoaded: Partial<Record<EmpiarKind, string>> = {
  surfaces: 'needs a reader for EMDB-SFF (HDF5) or its mesh format',
  frames: 'movie frames are never loaded',
  metadata: 'metadata, not loaded',
  angles: 'loads with its tilt series',
  other: 'no reader for its format',
};

/** A listing's file as the walk keeps it: its kind, and why it cannot load if it cannot */
export function empiarFile(entry: EmpiarEntry, folder: string, row: ListingRow): EmpiarFile {
  const kind = kindOf(entry, folder, row.name);
  const tooBig =
    row.bytes !== undefined && row.bytes > EmpiarWholeMaxBytes
      ? 'too large to read whole in a tab (ranged reads come later)'
      : undefined;
  const why = NotLoaded[kind] ?? tooBig;
  return {
    path: `${folder}/${row.name}`,
    name: row.name,
    size: row.size,
    ...(row.bytes !== undefined ? { bytes: row.bytes } : {}),
    kind,
    ...(why ? { why } : {}),
  };
}

/**
 * A file's run: its name up to the first dot, without a segmentation's suffix (`<run>_labels.mrc`); exact, never a
 * prefix (`ts_00` is not `ts_003`)
 */
export const stemOf = (name: string) => name.replace(/\..*$/, '').replace(/_(labels|seg|mask)$/i, '');

/** A run: the files sharing a stem across the folders of a grid, and the condition's files that name runs inside */
export interface EmpiarRun {
  readonly stem: string;
  readonly files: readonly EmpiarFile[];
}

/** A grid of a condition: its runs, and the files no run claims (listed, under their folder) */
export interface EmpiarGrid {
  readonly condition: string;
  readonly name: string;
  readonly runs: readonly EmpiarRun[];
  readonly other: readonly EmpiarFile[];
}

/**
 * Files into runs (_spec/empiar.md §1): the runs are the stems of the tomograms and tilt series (else of every file);
 * a file whose stem is a run's joins it, the rest are `other`; the condition's particle lists (`shared`, one for all
 * its runs) join every run, filtered by run on load. Each file lands once.
 */
export function groupRuns(
  condition: string,
  grid: string,
  files: readonly EmpiarFile[],
  shared: readonly EmpiarFile[],
) {
  const volumes = files.filter((f) => f.kind === 'tomogram' || f.kind === 'tilt-series');
  const stems = [...new Set((volumes.length ? volumes : files).map((f) => stemOf(f.name)))].sort();
  const byStem = new Map(stems.map((s) => [s, [] as EmpiarFile[]]));
  const other: EmpiarFile[] = [];
  for (const f of files) {
    const run = byStem.get(stemOf(f.name));
    if (run) run.push(f);
    else other.push(f);
  }
  const particles = shared.filter((f) => f.kind === 'particles');
  const runs = stems.map((stem) => ({ stem, files: [...byStem.get(stem)!, ...particles] }));
  return { condition, name: grid, runs, other: [...other, ...shared.filter((f) => f.kind !== 'particles')] };
}

/** Reads a folder's rows (the area's, cached; a test's or a story's, recorded) */
export type ListingReader = (folder: string) => Promise<readonly ListingRow[]>;

/**
 * A condition's grids: the subfolders of its folders, and the files it shares (its particle lists). A frames folder is
 * not read (1825 rows a grid here, never loaded).
 */
export async function walkCondition(entry: EmpiarEntry, root: string, read: ListingReader): Promise<EmpiarCondition> {
  const rows = await read(root);
  const shared = rows.filter((r) => !r.folder).map((r) => empiarFile(entry, root, r));
  const frames = (f: string) =>
    /frames/i.test(f.slice(f.lastIndexOf('/') + 1)) ||
    entry.imageSets.some((s) => s.directory === f && s.category.startsWith('micrographs'));
  const walked = rows
    .filter((r) => r.folder)
    .map((r) => `${root}/${r.name}`)
    .filter((f) => !frames(f));
  const holds: Record<string, string[]> = {};
  for (const [folder, list] of await Promise.all(walked.map(async (f) => [f, await read(f)] as const))) {
    for (const r of list) {
      if (r.folder) (holds[r.name] ??= []).push(folder);
      else shared.push(empiarFile(entry, folder, r));
    }
  }
  return { root, grids: Object.keys(holds).sort(), shared, holds };
}

/** A grid's runs: the files of its folders grouped by stem, the condition's particle lists with each */
export async function walkGrid(entry: EmpiarEntry, c: EmpiarCondition, grid: string, read: ListingReader) {
  const folders = c.holds[grid];
  if (!folders) throw new Error(`${c.root} has no grid ${grid}. It has ${c.grids.join(', ')}.`);
  const lists = await Promise.all(folders.map(async (f) => [`${f}/${grid}`, await read(`${f}/${grid}`)] as const));
  const files = lists.flatMap(([f, rows]) => rows.filter((r) => !r.folder).map((r) => empiarFile(entry, f, r)));
  return groupRuns(c.root, grid, files, c.shared);
}

/** The files a load takes when none are named: what loads, without the tilt series (their size) */
export const defaultFiles = (run: EmpiarRun) => run.files.filter((f) => !f.why && f.kind !== 'tilt-series');

/** A size as the listing writes it, with its unit: `834 MB`, `493 KB`, `165 B` */
export const sizeLabel = (f: Pick<EmpiarFile, 'size'>) =>
  /[KMGT]$/.test(f.size) ? `${f.size.slice(0, -1)} ${f.size.slice(-1)}B` : `${f.size} B`;

/** A total in the listing's units (MiB, written MB), so it is the sum of the sizes shown: 834 + 417 + 12 → `1263 MB` */
export const totalLabel = (bytes: number) => `${Math.round(bytes / 1024 ** 2)} MB`;

/** EBI's usual time for `bytes`, fastest to slowest: `about 1–2 h`, `about 5–10 min`, `about 44 min–1 h` */
export function ebiTime(bytes: number) {
  const [a, b] = [span(bytes / EmpiarEbiSpeed.fast), span(bytes / EmpiarEbiSpeed.slow)];
  const [na, ua] = a.split(' ');
  const [nb, ub] = b.split(' ');
  return ua === ub ? `about ${na}–${nb} ${ub}` : `about ${a}–${b}`;
}

/** The card's line for a pick above `EmpiarSlowBytes`: its size and EBI's usual time; undefined below */
export function ebiSpeedWarning(bytes: number): string | undefined {
  if (bytes <= EmpiarSlowBytes) return undefined;
  const mbs = (x: number) => x / 1e6;
  return `${totalLabel(bytes)} from EBI: ${ebiTime(bytes)} at its usual speed (EMPIAR's server is often slow, ${mbs(EmpiarEbiSpeed.slow)}–${mbs(EmpiarEbiSpeed.fast)} MB/s).`;
}
