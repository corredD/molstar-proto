/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import type { Structure } from '@molstar/model/model/structure';
import {
  type ApiAreaContext,
  type ApiContext,
  ApiArea,
  type ApiFailure,
  ApiResult,
} from '@molstar/prism-viewer/api/area';
import { OptionalParam } from '@molstar/prism-viewer/api/params';
import { isFailure } from '@molstar/prism-viewer/api/scope';
import { operationCommand } from '@molstar/prism-viewer/commands/operations';
import type { ViewerExtension } from '@molstar/prism-viewer/spec';
import { particleListData } from './operations.js';
import {
  checkPortalIndex,
  type PortalAnnotation,
  type PortalCatalog,
  type PortalDataset,
  PortalFiles,
  type PortalLevel,
  PortalPages,
  type PortalRun,
  type PortalSpacing,
  type PortalTomogram,
} from './portal-index.js';

declare module '@molstar/prism-viewer/api' {
  // The `cryoetPortal` area: the CryoET Data Portal's datasets, from an index the app ships, loaded by their files.
  interface ExtensionApis {
    cryoetPortal: CryoetPortalApi;
  }
}

// The CryoET Data Portal, direct (_spec/portal.md): an index made offline (portal-index.ts) says what a dataset holds;
// a load is the viewer's own operations on the portal's file addresses (§2): `load.url` for every file, the points'
// pixel size by `particles.source` from the index (never the zarr's scale: they differ in the third decimal), their
// decoration by `cryoet.decorate`, the tomogram's slices by its format and its direct volume by
// `volume.representation`. One operation, one history step.

/** Where the index comes from: the app's files (a catalog, a dataset by id) */
export interface PortalIndexSource {
  readonly catalog: () => Promise<PortalCatalog>;
  readonly dataset: (id: number) => Promise<PortalDataset>;
}

/** The portal's card (portal-ui.tsx), opened by `view.open({ card })` */
export const PortalCard = 'cryoet-portal.overlay.portal';

/** What a load does with a tomogram: its slices and its direct volume, its slices, or nothing */
export type PortalTomogramView = 'both' | 'slices' | 'none';

/** The data formats that read the portal's files, by the file's format; a format the viewer lacks: "needs reader" */
export const PortalReaders: Readonly<Record<string, string>> = {
  ndjson: 'cryoet_ndjson_particles',
  zarr: 'ome-zarr',
  glb: 'gltf',
};

/**
 * Above this many bytes decoded, a load asks first (`large: true` goes on): a browser tab holds about 2 GB, and a
 * level of a tomogram 8 times smaller is one step coarser (_spec/portal.md §3)
 */
export const PortalLargeBytes = 512 * 1024 * 1024;

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

/** Where a scene object came from on the portal (the right-click menu's links) */
export interface PortalOrigin {
  readonly dataset: number;
  readonly run: string;
  readonly page: string;
  readonly runPage?: string;
  readonly dois: readonly string[];
}

const DatasetParam = () => PD.Numeric(10003, { min: 0, step: 1 }, { description: 'A dataset of the index, by id' });
const RunParam = () => PD.Text('', { description: 'A run by name (TS_08) or id; empty: the first' });

export class CryoetPortalApi extends ApiArea {
  readonly id = 'cryoetPortal';
  private readonly loaded = new Map<number, Promise<PortalDataset>>();
  private readonly known = new Map<number, PortalDataset>();
  private catalogRead: Promise<PortalCatalog> | undefined;

  constructor(
    ctx: ApiAreaContext,
    private readonly source: PortalIndexSource,
  ) {
    super(ctx);
  }

  /** The catalog, read once */
  catalog(): Promise<PortalCatalog> {
    this.catalogRead ??= this.source.catalog().then((c) => checkPortalIndex(c, 'The portal catalog'));
    return this.catalogRead;
  }

  /** A dataset, read once (a failed read is asked again next time) */
  dataset(id: number): Promise<PortalDataset> {
    let p = this.loaded.get(id);
    if (!p) {
      p = this.source.dataset(id).then((d) => {
        const checked = checkPortalIndex(d, `The portal index of dataset ${id}`);
        this.known.set(id, checked);
        return checked;
      });
      p.catch(() => this.loaded.delete(id));
      this.loaded.set(id, p);
    }
    return p;
  }

  /** A run's spacing, tomogram and annotations as a load sees them: a read for views */
  describe(ds: PortalDataset, run: string, spacing?: number): PortalRunInfo | ApiFailure {
    return describeRun(this.ctx, ds, run, spacing);
  }

  /** The portal dataset and run a scene object's file came from, when its index is read (synchronous: menus) */
  originOf(ref: string): PortalOrigin | undefined {
    const url = downloadUrlAbove(this.ctx, ref);
    const m = url && /^https:\/\/files\.cryoetdataportal\.cziscience\.com\/(\d+)\/([^/]+)\//.exec(url);
    if (!m) return;
    const dataset = Number(m[1]);
    const ds = this.known.get(dataset);
    const run = ds?.runList.find((r) => r.name === m[2]);
    return {
      dataset,
      run: m[2],
      page: `${PortalPages}datasets/${dataset}`,
      runPage: run ? `${PortalPages}runs/${run.id}` : undefined,
      dois: ds?.dois ?? [],
    };
  }

  readonly datasets = this.operation({
    id: 'cryoetPortal.datasets',
    title: 'List the CryoET Data Portal datasets',
    params: {},
    read: true,
    async run(_, ctx) {
      const area = ctx.api.cryoetPortal!;
      const catalog = await area.catalog().catch((e: unknown) => e as Error);
      if (catalog instanceof Error) return ApiResult.fail('unavailable', catalog.message);
      const lines = catalog.datasets.map(
        (d) => `${d.id}: ${d.title}${d.organism ? ` (${d.organism})` : ''}, ${d.runs} runs`,
      );
      return ApiResult.ok(lines.join('\n'), {}, { value: catalog.datasets });
    },
  });

  readonly run = this.operation({
    id: 'cryoetPortal.run',
    title: 'Describe a CryoET Data Portal run',
    params: { dataset: DatasetParam(), run: RunParam() },
    read: true,
    async run({ dataset, run }, ctx) {
      const ds = await readDataset(ctx, dataset);
      if (isFailure(ds)) return ds;
      const info = describeRun(ctx, ds, run);
      if (isFailure(info)) return info;
      const t = info.tomogram;
      const lines = [
        `${ds.title}, ${info.run.name} at ${info.spacing.spacing} Å`,
        ...(t
          ? [`tomogram ${t.id}: ${t.levels.map(levelLine).join('; ')}${info.needs ? ` (${info.needs})` : ''}`]
          : []),
        ...info.entries.map(
          (e) =>
            `${e.key}: ${e.object}, ${e.shape} (${e.format}${e.count ? `, ${e.count}` : ''})${e.default ? ', default' : ''}${e.needs ? ` (${e.needs})` : ''}`,
        ),
      ];
      return ApiResult.ok(lines.join('\n'), {}, { value: info });
    },
  });

  readonly load = this.operation({
    id: 'cryoetPortal.load',
    title: 'Load a CryoET Data Portal run',
    params: {
      dataset: DatasetParam(),
      run: RunParam(),
      spacing: OptionalParam(
        PD.Numeric(0, { min: 0 }, { description: "A voxel spacing (Å); absent: the run's first" }),
      ),
      tomogram: OptionalParam(
        PD.Numeric(0, { min: 0, step: 1 }, { description: "A tomogram by id; absent: the spacing's first" }),
      ),
      level: OptionalParam(
        PD.Numeric(2, { min: 0, step: 1 }, { description: 'The OME-Zarr level (0: full size); absent: the coarsest' }),
      ),
      annotations: PD.Text('', {
        description:
          "Annotations by id ('1212,2321') or id/shape ('2321/SegmentationMask'); 'none'; empty: the portal's defaults",
      }),
      as: PD.Select<PortalTomogramView>('both', [
        ['both', 'Slices and a direct volume'],
        ['slices', 'Slices'],
        ['none', 'No tomogram'],
      ]),
      large: PD.Boolean(false, { description: `Load above ${PortalLargeBytes / 2 ** 20} MB decoded (asked first)` }),
    },
    modules: ['network'],
    approval: 'network',
    // the portal's files; the decorations' structures and maps from the known data services
    addresses: () => [PortalFiles],
    async run(values, ctx) {
      const v = values as typeof values & { spacing?: number; tomogram?: number; level?: number };
      const ds = await readDataset(ctx, v.dataset);
      if (isFailure(ds)) return ds;
      const info = describeRun(ctx, ds, v.run, v.spacing, v.tomogram);
      if (isFailure(info)) return info;
      const entries = pickEntries(info, v.annotations);
      if (isFailure(entries)) return entries;
      const t = v.as === 'none' ? undefined : info.tomogram;
      const level = t ? pickLevel(t.levels, v.level) : undefined;
      if (isFailure(level)) return level;

      const bytes = (level?.bytes ?? 0) + entries.reduce((n, e) => n + entryBytes(e, v.level), 0);
      if (bytes > PortalLargeBytes && !v.large) {
        return ApiResult.fail(
          'confirm',
          `${info.run.name} is ${mb(bytes)} decoded at these levels.`,
          'Choose a coarser level, or call again with large: true.',
        );
      }

      const warnings: string[] = [];
      const done: string[] = [];
      if (t && level) {
        if (info.needs) warnings.push(`The tomogram ${info.needs}.`);
        else {
          const r = await loadTomogram(ctx, PortalFiles + t.zarr, level, v.as);
          if (!r.ok) return r;
          done.push(`tomogram ${t.id} (level ${level.path}, ${level.spacing} Å)`);
        }
      }
      for (const e of entries) {
        if (e.needs) {
          warnings.push(`${e.object} (${e.shape}) ${e.needs}.`);
          continue;
        }
        const r = await loadEntry(ctx, ds, info.spacing, e, v.level);
        if (!r.ok) return r;
        done.push(`${e.object} (${e.shape})`);
      }
      const emdb = new Set(entries.map((e) => ds.decorations?.[e.object]?.emdb).filter((x): x is string => !!x));
      for (const id of emdb) {
        const r = await ctx.api.run('load.entry', { source: 'emdb', id });
        if (!r.ok) warnings.push(`${id}: ${r.message}`);
        else done.push(id);
      }
      if (!done.length) {
        return ApiResult.fail('unavailable', `Nothing of ${info.run.name} could be loaded.`, warnings.join(' '));
      }
      return ApiResult.ok(`Loaded ${ds.id} ${info.run.name}: ${done.join(', ')}.`, {}, { warnings });
    },
  });
}

// --- the index's run, as a load takes it --------------------------------------------------------------------------

async function readDataset(ctx: ApiContext, id: number): Promise<PortalDataset | ApiFailure> {
  const area = ctx.api.cryoetPortal!;
  const catalog = await area.catalog().catch((e: unknown) => e as Error);
  if (catalog instanceof Error) return ApiResult.fail('unavailable', catalog.message);
  if (!catalog.datasets.some((d) => d.id === id)) {
    return ApiResult.fail(
      'not-found',
      `The portal index has no dataset ${id}.`,
      `It has ${catalog.datasets.map((d) => d.id).join(', ')}.`,
    );
  }
  return area.dataset(id).catch((e: unknown) => ApiResult.fail('unavailable', (e as Error).message));
}

const has = (ctx: Pick<ApiContext, 'plugin'>, format: string) =>
  // the particle formats are a lazy feature of the viewer: always there to `load.url`
  format === 'ndjson' || !!(PortalReaders[format] && ctx.plugin.dataFormats.has(PortalReaders[format]));

const needsReader = (ctx: Pick<ApiContext, 'plugin'>, format: string) =>
  has(ctx, format) ? undefined : `needs a reader for ${format} (not in this viewer yet)`;

function describeRun(
  ctx: Pick<ApiContext, 'plugin'>,
  ds: PortalDataset,
  name: string,
  spacing?: number,
  tomogram?: number,
): PortalRunInfo | ApiFailure {
  const key = name.trim();
  const run = key ? ds.runList.find((r) => r.name === key || String(r.id) === key) : ds.runList[0];
  if (!run) {
    const more = ds.runList.length < ds.runs ? ` (the index holds ${ds.runList.length} of ${ds.runs})` : '';
    return ApiResult.fail('not-found', `Dataset ${ds.id} has no run '${key}'${more}.`, `Runs: ${runNames(ds)}.`);
  }
  const s = spacing ? run.spacings.find((x) => Math.abs(x.spacing - spacing) < 1e-3) : run.spacings[0];
  if (!s) {
    return ApiResult.fail(
      'not-found',
      `${run.name} has no voxel spacing ${spacing} Å.`,
      `It has ${run.spacings.map((x) => x.spacing).join(', ')} Å.`,
    );
  }
  const t = tomogram ? s.tomograms.find((x) => x.id === tomogram) : s.tomograms[0];
  if (tomogram && !t) {
    return ApiResult.fail('not-found', `${run.name} has no tomogram ${tomogram} at ${s.spacing} Å.`);
  }
  const shapes = new Map<number, number>();
  for (const a of s.annotations) shapes.set(a.id, (shapes.get(a.id) ?? 0) + 1);
  const entries = s.annotations.map((a) => ({
    ...a,
    key: shapes.get(a.id)! > 1 ? `${a.id}/${a.shape}` : String(a.id),
    needs: needsReader(ctx, a.format),
  }));
  return {
    dataset: ds.id,
    run,
    spacing: s,
    tomogram: t,
    entries,
    defaults: entries.filter((e) => e.default).map((e) => e.key),
    needs: t ? needsReader(ctx, 'zarr') : undefined,
  };
}

function runNames(ds: PortalDataset) {
  const names = ds.runList.map((r) => r.name);
  return names.length > 8 ? `${names.slice(0, 8).join(', ')}, …` : names.join(', ');
}

/** The entries named ('1212', '2321/SegmentationMask'; an id alone: each of its shapes), 'none', or the defaults */
function pickEntries(info: PortalRunInfo, names: string): readonly PortalEntry[] | ApiFailure {
  const text = names.trim();
  if (text === 'none') return [];
  if (!text) return info.entries.filter((e) => e.default);
  const picked = new Set<PortalEntry>();
  for (const name of text
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n)) {
    const hits = info.entries.filter((e) => e.key === name || String(e.id) === name);
    if (!hits.length) {
      return ApiResult.fail(
        'not-found',
        `${info.run.name} has no annotation '${name}'.`,
        `It has ${info.entries.map((e) => `${e.key} (${e.object}, ${e.shape})`).join(', ')}.`,
      );
    }
    for (const h of hits) picked.add(h);
  }
  return [...picked];
}

function pickLevel(levels: readonly PortalLevel[], level: number | undefined): PortalLevel | ApiFailure {
  if (level === undefined) return levels[levels.length - 1];
  const l = levels.find((x) => x.path === String(level));
  return l ?? ApiResult.fail('not-found', `No level ${level}.`, `Levels: ${levels.map(levelLine).join('; ')}.`);
}

/** A zarr annotation at the level asked (its coarsest when absent or missing), a file its size */
export function entryBytes(e: PortalEntry, level: number | undefined) {
  if (!e.levels?.length) return e.bytes ?? 0;
  return (e.levels.find((l) => l.path === String(level)) ?? e.levels[e.levels.length - 1]).bytes;
}

export const mb = (bytes: number) => `${(bytes / 2 ** 20).toFixed(bytes < 10 * 2 ** 20 ? 1 : 0)} MB`;
export const levelLine = (l: PortalLevel) => `${l.path}: ${l.size.join('×')} at ${l.spacing} Å, ${mb(l.bytes)}`;

// --- the loads, by the viewer's operations ------------------------------------------------------------------------

const listRefs = (ctx: ApiContext) =>
  new Set(ctx.plugin.managers.particles.hierarchy.current.lists.map((l) => l.cell.transform.ref));
const volumeRefs = (ctx: ApiContext) =>
  new Set(ctx.plugin.managers.volume.hierarchy.current.volumes.map((v) => v.cell.transform.ref));

/** What a run of `work` added, of a kind */
async function added(
  ctx: ApiContext,
  refs: (ctx: ApiContext) => Set<string>,
  work: () => Promise<ApiResult>,
): Promise<string[] | ApiFailure> {
  const before = refs(ctx);
  const r = await work();
  if (!r.ok) return r;
  return [...refs(ctx)].filter((x) => !before.has(x));
}

/** A zarr by `load.url` at a level: the volumes it made */
function loadZarr(ctx: ApiContext, url: string, level: PortalLevel) {
  return added(ctx, volumeRefs, () =>
    ctx.api.run('load.url', { url: `${url}/${level.path}`, format: PortalReaders.zarr, binary: true }),
  );
}

/** The tomogram at a level: its three slices and, asked for, its direct volume */
async function loadTomogram(ctx: ApiContext, url: string, level: PortalLevel, as: PortalTomogramView) {
  const made = await loadZarr(ctx, url, level);
  if (isFailure(made)) return made;
  for (const volume of made) {
    // whatever the format's own visuals: the slices (other representations hidden), as a dropped tomogram shows
    const r = await ctx.api.run('cryoet.slices', { volume });
    if (!r.ok) return r;
    if (as === 'both') {
      const d = await showTomogramVolume(ctx, volume);
      if (!d.ok) return d;
    }
  }
  return ApiResult.ok('');
}

/**
 * A tomogram's direct volume, its transfer function the direct volume's own Tomogram preset: dense matter is dark in
 * a tomogram, so the low values are opaque. One function, so its other params (lighting) are given in one place.
 */
export async function showTomogramVolume(ctx: ApiContext, volume: string): Promise<ApiResult> {
  const cell = ctx.plugin.state.data.cells.get(volume);
  const data = cell?.obj?.data;
  const provider = ctx.plugin.representation.volume.registry.get('direct-volume');
  if (!data || !provider) return ApiResult.fail('unavailable', 'This viewer has no direct volume.');
  const params = provider.getParams(ctx.plugin.representation.volume.themes, data) as {
    controlPoints?: PD.Any & { getPresets?: () => [unknown, string][] };
  };
  const preset = params.controlPoints?.getPresets?.().find(([, label]) => /^Tomogram/.test(label));
  return ctx.api.run('volume.representation', {
    volume,
    type: 'direct-volume',
    params: preset ? { controlPoints: preset[0] } : {},
  });
}

async function loadEntry(
  ctx: ApiContext,
  ds: PortalDataset,
  s: PortalSpacing,
  e: PortalEntry,
  level: number | undefined,
): Promise<ApiResult> {
  const url = PortalFiles + e.path;
  if (e.format === 'zarr') {
    const l = e.levels?.find((x) => x.path === String(level)) ?? e.levels?.[e.levels.length - 1];
    if (!l) return ApiResult.fail('failed', `${e.object} has no levels in the index.`);
    const made = await loadZarr(ctx, url, l);
    if (isFailure(made)) return made;
    // a mask: 0 outside, 1 (an instance's id) inside; its surface at 0.5
    for (const volume of made) {
      const r = await ctx.api.run('volume.representation', {
        volume,
        type: 'isosurface',
        params: { isoValue: { kind: 'absolute', absoluteValue: 0.5 } },
      });
      if (!r.ok) return r;
    }
    return ApiResult.ok('');
  }
  if (e.format !== 'ndjson') return ctx.api.run('load.url', { url, format: PortalReaders[e.format] ?? 'auto' });
  const lists = await added(ctx, listRefs, () => ctx.api.run('load.url', { url, format: PortalReaders.ndjson }));
  if (isFailure(lists)) return lists;
  const decoration = ds.decorations?.[e.object];
  for (const particles of lists) {
    // voxels of the annotation's tomogram: its spacing from the index
    const r = await ctx.api.run('particles.source', { particles, params: { pixelSize: s.spacing } });
    if (!r.ok) return r;
    if (!decoration?.pdb) continue;
    const d = await ctx.api.run('cryoet.decorate', { particles, with: 'pdb', id: decoration.pdb });
    if (!d.ok) return d;
    if (decoration.center) {
      const r = await centerOnAverage(ctx, particles, decoration.center);
      if (!r.ok) return r;
    }
  }
  return ApiResult.ok('');
}

/**
 * A structure target is drawn about its own center (its boundary's); its point is the average's box center, given in
 * the structure's frame: the shift between them, in the particle's frame, puts the structure where the average is.
 */
async function centerOnAverage(ctx: ApiContext, particles: string, center: readonly number[]): Promise<ApiResult> {
  const target = particleListData(ctx, particles)?.targetMapping?.get(0);
  if (target?.kind !== 'structure') return ApiResult.ok('');
  const c = (target.structure as Structure).boundary.sphere.center;
  const [x, y, z] = [c[0] - center[0], c[1] - center[1], c[2] - center[2]];
  if (Math.hypot(x, y, z) < 1) return ApiResult.ok('');
  return ctx.api.run('cryoet.offset', { particles, x, y, z });
}

/** The address of the download a cell's data came from, the first above it */
function downloadUrlAbove(ctx: Pick<ApiContext, 'plugin'>, ref: string): string | undefined {
  const { cells } = ctx.plugin.state.data;
  for (let cell = cells.get(ref); cell; cell = cells.get(cell.transform.parent)) {
    const url = (cell.transform.params as { url?: unknown } | undefined)?.url;
    if (typeof url === 'string') return url;
    if (url && typeof (url as { url?: unknown }).url === 'string') return (url as { url: string }).url;
    if (cell.transform.ref === cell.transform.parent) break;
  }
  return undefined;
}

// --- the extension --------------------------------------------------------------------------------------------------

/** The CryoET Data Portal for an app that ships an index (apps/prism-me/portal) */
export function CryoetPortalExtension(source: PortalIndexSource): ViewerExtension {
  return {
    id: 'cryoet-portal',
    title: 'CryoET Data Portal',
    api: { cryoetPortal: (ctx) => new CryoetPortalApi(ctx, source) },
    commands: (api) => {
      const p = api.cryoetPortal;
      if (!p) return [];
      const category = 'Cryo-ET';
      const alias = ['cryoet data portal', 'portal', 'czi', 'tomogram', 'run'];
      return [
        operationCommand(api, p.load, { category, icon: 'download', alias }),
        operationCommand(api, p.run, { category, icon: 'info', alias }),
        operationCommand(api, p.datasets, { category, icon: 'list', alias }),
      ];
    },
    ui: async (ctx) => (await import('./portal-ui.js')).portalUI(ctx),
  };
}
