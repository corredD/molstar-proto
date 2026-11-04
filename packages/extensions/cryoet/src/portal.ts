/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Box3D } from '@molstar/core/math/geometry/primitives/box3d';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import type { Structure } from '@molstar/model/model/structure';
import { Grid, type Volume } from '@molstar/model/model/volume';
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
import {
  getOmeZarrLevel,
  OmeZarrFromUrl,
  omeZarrLevelNeeds,
  VolumeFromOmeZarr,
} from '@molstar/plugin/state/formats/volume/ome-zarr';
import { CustomVolumeProperties, VolumeTransform } from '@molstar/plugin/state/transforms/volume/ops';
import { watchedState } from '@molstar/prism-viewer/sources/watched';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { particleListData } from './operations.js';
import {
  describePortalRun,
  entryBytes,
  levelLine,
  mb,
  type PortalEntry,
  type PortalFailure,
  type PortalRunInfo,
  type PortalTomogramView,
  portalAnnotationText,
  portalTiltSeriesOptions,
  portalTomogramOptions,
  type TiltSeriesPlace,
  TiltSeriesPlaces,
} from './portal-run.js';
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
  type PortalTiltSeries,
} from './portal-index.js';

export {
  describePortalRun,
  entryBytes,
  levelLine,
  mb,
  PortalCard,
  type PortalEntry,
  type PortalFailure,
  type PortalPanelArea,
  type PortalRunInfo,
  type PortalTomogramView,
  type TiltSeriesPlace,
  TiltSeriesPlaces,
} from './portal-run.js';

declare module '@molstar/prism-viewer/api' {
  // The `cryoetPortal` area: the CryoET Data Portal's datasets, from an index the app ships, loaded by their files.
  interface ExtensionApis {
    cryoetPortal: CryoetPortalApi;
  }
}

// The CryoET Data Portal, direct (_spec/portal.md): an index made offline (portal-index.ts) says what a dataset holds;
// a load is the viewer's own operations on the portal's file addresses (§2): `load.url` for a single file (ndjson,
// GLB, MRC), the format's transforms for an OME-Zarr, the points' pixel size by `particles.source` from the index (never
// the zarr's scale: they differ in the third decimal), their decoration by `cryoet.decorate`, the tomogram's slices by
// `cryoet.slices` and its direct volume by `volume.representation`, a tilt series' images by `cryoet.slice` along z. One
// operation, one history step.

/** Where the index comes from: the app's files (a catalog, a dataset by id) */
export interface PortalIndexSource {
  readonly catalog: () => Promise<PortalCatalog>;
  readonly dataset: (id: number) => Promise<PortalDataset>;
}

/**
 * The data formats `load.url` reads the portal's files with, by the file's format; a zarr opens by the plugin's
 * `OpenOmeZarr` (several files, not one); another format, or one the viewer lacks: "needs a reader"
 */
export const PortalReaders: Readonly<Record<string, string>> = {
  ndjson: 'cryoet_ndjson_particles',
  glb: 'gltf',
  mrc: 'ccp4',
};

/**
 * Above this many bytes decoded, a load asks first (`large: true` goes on): a browser tab holds about 2 GB, and a
 * level of a tomogram 8 times smaller is one step coarser (_spec/portal.md §3)
 */
export const PortalLargeBytes = 512e6;

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
const PlaceParam = () =>
  PD.Select<TiltSeriesPlace>('beside', TiltSeriesPlaces as [TiltSeriesPlace, string][], {
    description:
      'Where a tilt series goes by its tomogram: beside it as read, beside it turned by its tilt axis, under it turned',
  });

export class CryoetPortalApi extends ApiArea {
  readonly id = 'cryoetPortal';
  private readonly loaded = new Map<number, Promise<PortalDataset>>();
  private readonly known = new Map<number, PortalDataset>();
  /**
   * The tilt series of the datasets read and their runs, by their zarr's address: a slice's angles and its placement
   * found from its volume's download
   */
  private readonly tiltSeriesAt = new Map<string, { readonly series: PortalTiltSeries; readonly run: number }>();
  /** The runs of the tomograms of the datasets read, by their zarr's address: a tilt series' tomogram in the scene */
  private readonly tomogramRunAt = new Map<string, number>();
  /** The annotations of the datasets read, by their file's address: a point list's or mask's words, from its download */
  private readonly annotationAt = new Map<string, PortalAnnotation>();
  private catalogRead: Promise<PortalCatalog> | undefined;

  constructor(
    ctx: ApiAreaContext,
    private readonly source: PortalIndexSource,
  ) {
    super(ctx);
  }

  /** The catalog, read once */
  catalog(): Promise<PortalCatalog> {
    // a failed read is asked again next time (a chunk that did not load)
    this.catalogRead ??= this.source.catalog().then(
      (c) => checkPortalIndex(c, 'The portal catalog'),
      (e: unknown) => {
        this.catalogRead = undefined;
        throw e;
      },
    );
    return this.catalogRead;
  }

  /** A dataset, read once (a failed read is asked again next time) */
  dataset(id: number): Promise<PortalDataset> {
    let p = this.loaded.get(id);
    if (!p) {
      p = this.source.dataset(id).then((d) => {
        const checked = checkPortalIndex(d, `The portal index of dataset ${id}`);
        this.known.set(id, checked);
        for (const r of checked.runList) {
          for (const t of r.tiltSeries ?? []) this.tiltSeriesAt.set(PortalFiles + t.zarr, { series: t, run: r.id });
          for (const s of r.spacings) {
            for (const t of s.tomograms) this.tomogramRunAt.set(PortalFiles + t.zarr, r.id);
            for (const a of s.annotations) this.annotationAt.set(PortalFiles + a.path, a);
          }
        }
        return checked;
      });
      p.catch(() => this.loaded.delete(id));
      this.loaded.set(id, p);
    }
    return p;
  }

  /** A run's spacing, tomogram and annotations as a load sees them: a read for views */
  describe(ds: PortalDataset, run: string, spacing?: number, tomogram?: number): PortalRunInfo | PortalFailure {
    return describePortalRun((f) => readable(this.ctx, f), ds, run, spacing, tomogram);
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

  /**
   * The tilt angle (°) of each image of a portal tilt series, the volume of a scene object, when its index is read
   * (synchronous: the Slice row's readout); undefined for anything else
   */
  tiltAnglesOf(ref: string): readonly number[] | undefined {
    return this.tiltSeriesOf(ref)?.series.angles;
  }

  /**
   * A portal annotation's words (its description, method and GO term: `portalAnnotationText`, Markdown), a point list's
   * or a mask's by its ref, when its index is read (synchronous: the properties)
   */
  annotationTextOf(ref: string): string | undefined {
    const url = downloadUrlAbove(this.ctx, ref);
    const a = url ? this.annotationAt.get(url.replace(/\/$/, '')) : undefined;
    return a && portalAnnotationText(a);
  }

  /** A portal tilt series by its volume's ref, and its run, when its index is read */
  private tiltSeriesOf(ref: string) {
    const url = downloadUrlAbove(this.ctx, ref);
    return url ? this.tiltSeriesAt.get(url.replace(/\/$/, '')) : undefined;
  }

  /** The volume of a run's tomogram in the scene, if one is */
  private tomogramOf(run: number): string | undefined {
    for (const v of this.ctx.plugin.managers.volume.hierarchy.current.volumes) {
      const url = downloadUrlAbove(this.ctx, v.cell.transform.ref);
      if (url && this.tomogramRunAt.get(url.replace(/\/$/, '')) === run) return v.cell.transform.ref;
    }
    return undefined;
  }

  /**
   * Where a portal tilt series is (by its volume's ref) of the places `place` puts it in; undefined when moved
   * elsewhere, or not a tilt series (synchronous: the Slice row's Placement)
   */
  placeOf(volume: string): TiltSeriesPlace | undefined {
    const at = this.placing(volume);
    if (!at) return undefined;
    return TiltSeriesPlaces.find(([p]) => Mat4.areEqual(at.current, at.matrix(p), 1e-3))?.[0];
  }

  /** `placeOf`, following the state tree while watched: a read for views */
  placeState(volume: string): ReadonlyState<TiltSeriesPlace | undefined> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => this.placeOf(volume),
      () => plugin.state.data.events.changed,
    );
  }

  /** A tilt series' matrix now (the stage's) and for each place, with its tomogram if in the scene */
  private placing(volume: string) {
    const ts = this.tiltSeriesOf(volume);
    const data = this.ctx.plugin.state.data.cells.get(volume)?.obj?.data as Volume | undefined;
    if (!ts || !data?.grid) return undefined;
    const tomogram = this.tomogramOf(ts.run);
    const tomogramGrid = tomogram
      ? (this.ctx.plugin.state.data.cells.get(tomogram)?.obj?.data as Volume | undefined)?.grid
      : undefined;
    // where the tomogram is now, not where it was read (review S3): a stage move is its transform decorator
    const tomogramAt = tomogram && tomogramGrid ? volumeMatrix(this.ctx, tomogram) : undefined;
    return {
      current: volumeMatrix(this.ctx, volume),
      tomogram: tomogramGrid,
      matrix: (p: TiltSeriesPlace) => tiltSeriesMatrix(p, data.grid, ts.series.tiltAxis, tomogramGrid, tomogramAt),
    };
  }

  readonly place = this.operation({
    id: 'cryoetPortal.place',
    title: 'Place a CryoET Data Portal tilt series by its tomogram',
    params: {
      volume: PD.Text('', { description: 'The tilt series, by state ref' }),
      place: PlaceParam(),
    },
    async run({ volume, place }, ctx) {
      if (!ctx.api.describe('stage.move')) return ApiResult.fail('unavailable', 'This viewer cannot move objects.');
      const at = ctx.api.cryoetPortal!.placing(volume);
      if (!at) return ApiResult.fail('not-found', `'${volume}' is not a CryoET Data Portal tilt series loaded here.`);
      if (place === 'overlay' && !at.tomogram) {
        return ApiResult.fail(
          'not-found',
          'Its tomogram is not in the scene.',
          'Load the run with its tomogram first.',
        );
      }
      const move = Mat4.mul(Mat4(), at.matrix(place), Mat4.invert(Mat4(), at.current));
      return ctx.api.run('stage.move', { target: volume, matrix: Array.from(move) });
    },
  });

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
      const info = describePortalRun((f) => readable(ctx, f), ds, run);
      if (isFailure(info)) return info;
      const t = info.tomogram;
      const lines = [
        `${ds.title}, ${info.run.name} at ${info.spacing.spacing} Å`,
        ...(t
          ? [`tomogram ${t.id}: ${t.levels.map(levelLine).join('; ')}${info.needs ? ` (${info.needs})` : ''}`]
          : []),
        // every tomogram of the run, any spacing: the ids `load`'s `tomogram` takes
        `Tomograms: ${portalTomogramOptions(info.run)
          .map(([, label]) => label)
          .join('; ')}`,
        // the ids `load`'s `tiltSeries` takes
        ...(info.run.tiltSeries?.length
          ? [
              `Tilt series: ${portalTiltSeriesOptions(info.run)
                .map(([, label]) => label)
                .join('; ')}`,
            ]
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
        PD.Numeric(0, { min: 0 }, { description: "A voxel spacing (Å); absent: the tomogram's, else the default's" }),
      ),
      tomogram: OptionalParam(
        PD.Numeric(
          0,
          { min: 0, step: 1 },
          { description: "A tomogram by id, of any spacing of the run; absent: the portal's default, else the first" },
        ),
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
      tiltSeries: OptionalParam(
        PD.Numeric(
          0,
          { min: 0, step: 1 },
          { description: 'A tilt series of the run by id (its images, stepped along z); absent: none' },
        ),
      ),
      tiltSeriesLevel: OptionalParam(
        PD.Numeric(2, { min: 0, step: 1 }, { description: "The tilt series' OME-Zarr level; absent: the coarsest" }),
      ),
      tiltSeriesPlace: PlaceParam(),
      large: PD.Boolean(false, { description: `Load above ${PortalLargeBytes / 1e6} MB decoded (asked first)` }),
    },
    modules: ['network'],
    approval: 'network',
    // the portal's files; the decorations' structures and maps from the known data services
    addresses: () => [PortalFiles],
    async run(values, ctx) {
      const v = values as typeof values & {
        spacing?: number;
        tomogram?: number;
        level?: number;
        tiltSeries?: number;
        tiltSeriesLevel?: number;
      };
      const ds = await readDataset(ctx, v.dataset);
      if (isFailure(ds)) return ds;
      const info = describePortalRun((f) => readable(ctx, f), ds, v.run, v.spacing, v.tomogram);
      if (isFailure(info)) return info;
      const entries = pickEntries(info, v.annotations);
      if (isFailure(entries)) return entries;
      const t = v.as === 'none' ? undefined : info.tomogram;
      const level = t ? pickLevel(t.levels, v.level) : undefined;
      if (isFailure(level)) return level;
      const ts = v.tiltSeries === undefined ? undefined : pickTiltSeries(info.run, v.tiltSeries);
      if (isFailure(ts)) return ts;
      const tsLevel = ts ? pickLevel(ts.levels, v.tiltSeriesLevel) : undefined;
      if (isFailure(tsLevel)) return tsLevel;

      const bytes =
        (level?.bytes ?? 0) + (tsLevel?.bytes ?? 0) + entries.reduce((n, e) => n + entryBytes(e, v.level), 0);
      if (bytes > PortalLargeBytes && !v.large) {
        return ApiResult.fail(
          'confirm',
          `${info.run.name} is ${mb(bytes)} decoded at these levels.`,
          'Choose a coarser level, or call again with large: true.',
        );
      }

      const warnings: string[] = [];
      const done: string[] = [];
      let tomogram = false;
      if (t && level) {
        if (info.needs) warnings.push(`The tomogram ${info.needs}.`);
        else {
          const r = await loadTomogram(
            ctx,
            PortalFiles + t.zarr,
            level,
            `${info.run.name} tomogram ${t.id}`,
            v.as,
            warnings,
          );
          if (!r.ok) return r;
          tomogram = true;
          done.push(`tomogram ${t.id} (level ${level.path}, ${level.spacing} Å)`);
        }
      }
      for (const e of entries) {
        if (e.needs) {
          warnings.push(`${e.object} (${e.shape}) ${e.needs}.`);
          continue;
        }
        const r = await loadEntry(ctx, ds, info.run.name, info.spacing, e, v.level, warnings);
        if (!r.ok) return r;
        done.push(`${e.object} (${e.shape})`);
      }
      if (ts && tsLevel) {
        // by the tomogram loaded with it, at the place asked; alone, where it lands
        const r = await loadTiltSeries(
          ctx,
          PortalFiles + ts.zarr,
          tsLevel,
          `${info.run.name} tilt series ${ts.id}`,
          tomogram ? v.tiltSeriesPlace : undefined,
          warnings,
        );
        if (!r.ok) return r;
        done.push(`tilt series ${ts.id} (level ${tsLevel.path}, ${ts.angles.length} images)`);
      }
      const emdb = new Set(entries.map((e) => ds.decorations?.[e.object]?.emdb).filter((x): x is string => !!x));
      for (const id of emdb) {
        const made = await added(ctx, volumeRefs, () => ctx.api.run('load.entry', { source: 'emdb', id }));
        if (isFailure(made)) warnings.push(`${id}: ${made.message}`);
        else {
          for (const ref of made) {
            await besideTheTomogram(ctx, ref);
            const d = await showAverageVolume(ctx, ref);
            if (!d.ok) warnings.push(`${id}: no direct volume: ${d.message}`);
          }
          done.push(id);
        }
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

/** Whether the viewer reads a portal file format */
const readable = (ctx: Pick<ApiContext, 'plugin'>, format: string) =>
  // the particle formats are a lazy feature of the viewer: always there to `load.url`
  format === 'ndjson' ||
  format === 'zarr' ||
  !!(PortalReaders[format] && ctx.plugin.dataFormats.has(PortalReaders[format]));

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

function pickTiltSeries(run: PortalRun, id: number): PortalTiltSeries | ApiFailure {
  const all = run.tiltSeries ?? [];
  const ts = all.find((x) => x.id === id);
  if (ts) return ts;
  return ApiResult.fail(
    'not-found',
    `${run.name} has no tilt series ${id}.`,
    all.length ? `It has ${all.map((x) => x.id).join(', ')}.` : 'It has none in the index.',
  );
}

function pickLevel(levels: readonly PortalLevel[], level: number | undefined): PortalLevel | ApiFailure {
  if (level === undefined) return levels[levels.length - 1];
  const l = levels.find((x) => x.path === String(level));
  return l ?? ApiResult.fail('not-found', `No level ${level}.`, `Levels: ${levels.map(levelLine).join('; ')}.`);
}

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

/**
 * An OME-Zarr at a level, by the plugin's own transforms (its metadata, the level as a volume), without the format's
 * default visual (an isosurface the slices would only hide): the volumes it made. The size was asked about before
 * (`large`), so the format's limit is what the level needs as the format counts it (its voxels and one decoded chunk,
 * `omeZarrLevelNeeds`), read from the file once opened: the index's bytes are the voxels only, and a limit set to them
 * refused the level asked for (Ludo, 2026-11-03: 685 MB against 618). Named `name` (the format's label, its volume's
 * with it: _spec/portal.md §2), the address untouched: the readout's angles and the links are found from it.
 */
async function loadZarr(ctx: ApiContext, url: string, level: PortalLevel, name: string) {
  const made = await added(ctx, volumeRefs, async () => {
    const opened = ctx.plugin
      .build()
      .toRoot()
      .apply(OmeZarrFromUrl, { url, label: name }, { state: { isGhost: true } });
    await opened.commit({ revertOnError: true });
    const file = ctx.plugin.state.data.cells.get(opened.ref)?.obj?.data as
      | Parameters<typeof getOmeZarrLevel>[0]
      | undefined;
    const needs = file ? omeZarrLevelNeeds(getOmeZarrLevel(file, level.path)) : level.bytes;
    const maxSizeMB = Math.max(512, Math.ceil(needs / 1e6));
    try {
      await ctx.plugin
        .build()
        .to(opened.ref)
        .apply(VolumeFromOmeZarr, { level: level.path, maxSizeMB, entryId: '' })
        .apply(CustomVolumeProperties)
        .commit({ revertOnError: true });
    } finally {
      // nothing left of a level that could not be read (the file's ghost, its only parent)
      if (!ctx.plugin.state.data.tree.children.get(opened.ref).size) {
        await ctx.plugin.build().delete(opened.ref).commit();
      }
    }
    return ApiResult.ok('');
  });
  if (!isFailure(made) && !made.length) {
    return ApiResult.fail('failed', `Could not open ${url} at level ${level.path}.`, 'The log says why.');
  }
  return made;
}

/**
 * The tomogram at a level: its three slices and, asked for, its direct volume; a direct volume the viewer cannot make
 * (no graphics, a context without it) is a warning, not a load undone
 */
async function loadTomogram(
  ctx: ApiContext,
  url: string,
  level: PortalLevel,
  name: string,
  as: PortalTomogramView,
  warnings: string[],
) {
  const made = await loadZarr(ctx, url, level, name);
  if (isFailure(made)) return made;
  for (const volume of made) {
    // whatever the format's own visuals: the slices (other representations hidden), as a dropped tomogram shows
    const r = await ctx.api.run('cryoet.slices', { volume });
    if (!r.ok) return r;
    if (as === 'both') {
      const d = await showTomogramVolume(ctx, volume);
      if (!d.ok) warnings.push(`No direct volume: ${d.message}`);
    }
  }
  return ApiResult.ok('');
}

/**
 * A tilt series at a level: its images, one at a time, as the Z slice (from the middle image, the least tilted): z is the
 * image index, not a distance (the stack is a few pixels thick), so no direct volume and no isosurface (_spec/portal.md §2)
 */
async function loadTiltSeries(
  ctx: ApiContext,
  url: string,
  level: PortalLevel,
  name: string,
  place: TiltSeriesPlace | undefined,
  warnings: string[],
) {
  const made = await loadZarr(ctx, url, level, name);
  if (isFailure(made)) return made;
  for (const volume of made) {
    const r = await ctx.api.run('cryoet.slice', { volume, axis: 'z' });
    if (!r.ok) return r;
    if (!place || !ctx.api.describe('stage.move')) continue;
    const p = await ctx.api.run('cryoetPortal.place', { volume, place });
    if (!p.ok) warnings.push(`The tilt series stays where it landed: ${p.message}`);
  }
  return ApiResult.ok('');
}

/**
 * The transfer function of a tomogram's direct volume: the direct volume's own Tomogram preset (dense matter is dark
 * in a tomogram, so the low values are opaque), if the volume has one (a signed or left-skewed map)
 */
export function tomogramControlPoints(plugin: ApiContext['plugin'], data: Volume): unknown | undefined {
  const provider = plugin.representation.volume.registry.get('direct-volume');
  const params = provider?.getParams(plugin.representation.volume.themes, data) as
    | { controlPoints?: { getPresets?: () => [unknown, string][] } }
    | undefined;
  return params?.controlPoints?.getPresets?.().find(([, label]) => /^Tomogram/.test(label))?.[0];
}

/**
 * An average's (EMDB map's) direct volume lit volumetric, its isosurface hidden: a dense map, where the volume's own
 * shadows show (a tomogram's are faint in its noise)
 */
export async function showAverageVolume(ctx: Pick<ApiContext, 'api'>, volume: string): Promise<ApiResult> {
  const r = await ctx.api.run('volume.representation', {
    volume,
    type: 'direct-volume',
    params: { lighting: 'volumetric' },
  });
  if (!r.ok) return r;
  return ctx.api.run('volume.visibility', { volume, representation: 'isosurface', visible: false });
}

/** A tomogram's direct volume (one function, so its other params, its lighting, are given in one place) */
export async function showTomogramVolume(ctx: ApiContext, volume: string): Promise<ApiResult> {
  const data = ctx.plugin.state.data.cells.get(volume)?.obj?.data as Volume | undefined;
  if (!data) return ApiResult.fail('not-found', 'The tomogram is not loaded.');
  const controlPoints = tomogramControlPoints(ctx.plugin, data);
  return ctx.api.run('volume.representation', {
    volume,
    type: 'direct-volume',
    // volumetric: the tomogram shadows itself (the graphics fall back to local where the device cannot)
    params: controlPoints ? { controlPoints, lighting: 'volumetric' } : { lighting: 'volumetric' },
  });
}

async function loadEntry(
  ctx: ApiContext,
  ds: PortalDataset,
  run: string,
  s: PortalSpacing,
  e: PortalEntry,
  level: number | undefined,
  warnings: string[],
): Promise<ApiResult> {
  const url = PortalFiles + e.path;
  if (e.format === 'zarr') {
    const l = e.levels?.find((x) => x.path === String(level)) ?? e.levels?.[e.levels.length - 1];
    if (!l) return ApiResult.fail('failed', `${e.object} has no levels in the index.`);
    const made = await loadZarr(ctx, url, l, `${run} ${e.object} ${e.id}`);
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
    if (!decoration?.pdb) {
      const p = await sizePoints(ctx, particles);
      if (!p.ok) return p;
      continue;
    }
    const d = await ctx.api.run('cryoet.decorate', { particles, with: 'pdb', id: decoration.pdb });
    if (!d.ok) return d;
    // a structure that could not be fetched leaves the decoration's transform without a target, and says nothing
    if (!particleListData(ctx, particles)?.targetMapping?.size) {
      warnings.push(`${decoration.pdb} could not be fetched: the ${e.object} points are not decorated.`);
      continue;
    }
    if (decoration.center) {
      const r = await centerOnAverage(ctx, particles, decoration.center);
      if (!r.ok) return r;
    }
  }
  return ApiResult.ok('');
}

/**
 * The radius (Å) of points the index has no decoration for (Ludo, 2026-11-03): the particle-size theme's own fallback, half
 * the typical distance between neighbors, is a sphere hundreds of Å across for a few sparse picks (10453's 4 V-ATPases:
 * about 900 Å)
 */
export const PortalPointRadius = 50;

/**
 * The list's spheres at `PortalPointRadius`: their size theme's, not the list's radii, so a shape that decorates the list
 * later is not scaled by them (a shape target scales by the particle's radius)
 */
async function sizePoints(ctx: ApiContext, particles: string): Promise<ApiResult> {
  const list = ctx.plugin.managers.particles.hierarchy.current.lists.find((l) => l.cell.transform.ref === particles);
  for (const r of list?.representations ?? []) {
    if (r.cell.transform.params?.type.name !== 'spacefill') continue;
    const u = await ctx.api.run('particles.update', {
      node: `#${r.cell.transform.ref}`,
      params: { sizeTheme: { name: 'particle-size', params: { scale: 1, defaultSize: PortalPointRadius } } },
    });
    if (!u.ok) return u;
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

/**
 * An average beside the tomogram (its own place is the origin, the tomogram's corner): moved along -x by its width and a
 * margin (`besideMatrix`), by the stage's move when the viewer has it
 */
async function besideTheTomogram(ctx: ApiContext, ref: string) {
  const data = ctx.plugin.state.data.cells.get(ref)?.obj?.data as Volume | undefined;
  if (!data || !ctx.api.describe('stage.move')) return;
  await ctx.api.run('stage.move', { target: ref, matrix: Array.from(besideMatrix(data.grid)) });
}

/** Beside the tomogram, from the origin: along -x by 2.5 times the volume's radius (its width and a margin) */
function besideMatrix(grid: Grid) {
  const { radius } = Grid.getBoundingSphere(grid);
  return Mat4.fromTranslation(Mat4(), Vec3.create(-2.5 * radius, 0, 0));
}

/**
 * A volume's matrix on top of where it was read: its transform decorator's, which `stage.move` writes (as stage-tools'
 * own read of it, an extension this one does not import: a matrix, or its parts about the origin); none: the identity
 */
function volumeMatrix(ctx: Pick<ApiContext, 'plugin'>, ref: string): Mat4 {
  const { cells, tree } = ctx.plugin.state.data;
  for (let at = ref; ; ) {
    const next = tree.children
      .get(at)
      .toArray()
      .map((c) => cells.get(c))
      .find((c) => c?.transform.transformer.definition.isDecorator);
    if (!next) return Mat4.identity();
    if (next.transform.transformer === VolumeTransform) {
      const t = (next.transform.params as { transform?: { name: string; params: any } }).transform;
      if (t?.name === 'matrix') {
        const m = Mat4.clone(t.params.data);
        return t.params.transpose ? Mat4.transpose(m, m) : m;
      }
      if (t?.name === 'components') {
        const { translation, axis, angle } = t.params;
        const r = Mat4.fromRotation(Mat4(), (angle * Math.PI) / 180, axis);
        return Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), translation), r);
      }
      return Mat4.identity();
    }
    at = next.transform.ref;
  }
}

/** A volume's box as read (its grid's corners in Å): the portal's zarrs are axis-aligned */
function gridBox(grid: Grid) {
  const box = Box3D.create(Vec3(), Vec3.ofArray(grid.cells.space.dimensions));
  return Box3D.transform(box, box, Grid.getGridToCartesianTransform(grid));
}

/**
 * A tilt series' matrix for a place (_spec/portal.md §2), on top of where it was read (its corner at the origin, as the
 * tomogram's). Turned: about z through its center by −(tilt axis + 180°): measured on 10003 TS_08 (tilt axis −5°), its
 * image at 0° matched the tomogram's top view at −175.5° (CC 0.66; every other angle and the mirrored image under 0.08),
 * so the tomogram's frame is the image's turned, not mirrored. Beside: then along −x as an average (`besideMatrix`).
 * Overlay: its center on the tomogram's in x, y, its top at the tomogram's bottom (without a tomogram: turned beside).
 * `tomogramAt` is the tomogram's transform (where it is now); absent, where it was read.
 */
export function tiltSeriesMatrix(
  place: TiltSeriesPlace,
  series: Grid,
  tiltAxis: number,
  tomogram?: Grid,
  tomogramAt?: Mat4,
): Mat4 {
  const s = gridBox(series);
  const c = Box3D.center(Vec3(), s);
  const turn =
    place === 'beside'
      ? Mat4.identity()
      : Mat4.mul3(
          Mat4(),
          Mat4.fromTranslation(Mat4(), c),
          Mat4.fromRotation(Mat4(), (-(tiltAxis + 180) * Math.PI) / 180, Vec3.unitZ),
          Mat4.fromTranslation(Mat4(), Vec3.negate(Vec3(), c)),
        );
  if (place !== 'overlay' || !tomogram) return Mat4.mul(Mat4(), besideMatrix(series), turn);
  const read = gridBox(tomogram);
  const t = tomogramAt ? Box3D.transform(Box3D(), read, tomogramAt) : read;
  const ct = Box3D.center(Vec3(), t);
  const shift = Vec3.create(ct[0] - c[0], ct[1] - c[1], t.min[2] - s.max[2]);
  return Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), shift), turn);
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
