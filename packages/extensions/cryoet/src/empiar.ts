/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import {
  type ApiAreaContext,
  type ApiContext,
  ApiArea,
  type ApiFailure,
  ApiResult,
} from '@molstar/prism-viewer/api/area';
import { isFailure } from '@molstar/prism-viewer/api/scope';
import { operationCommand } from '@molstar/prism-viewer/commands/operations';
import type { ViewerExtension } from '@molstar/prism-viewer/spec';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { Ccp4Provider } from '@molstar/plugin/state/formats/volume/ccp4';
import { Download } from '@molstar/plugin/state/transforms/data/fetch';
import {
  defaultFiles,
  EmpiarApi,
  type EmpiarAsk,
  EmpiarCard,
  type EmpiarCondition,
  type EmpiarEntry,
  type EmpiarFile,
  EmpiarFiles,
  type EmpiarGrid,
  type EmpiarRun,
  type ListingRow,
  parseListing,
  readEmpiarEntry,
  sizeLabel,
  stemOf,
  totalLabel,
  walkCondition,
  walkGrid,
} from './empiar-entry.js';
import {
  added,
  besideTheTomogram,
  downloadUrlAbove,
  listRefs,
  PortalLargeBytes,
  showAverageVolume,
  sizePoints,
  volumeRefs,
} from './portal.js';

export { EmpiarCard, type EmpiarAsk, type EmpiarCondition, empiarIdOf } from './empiar-entry.js';

declare module '@molstar/prism-viewer/api' {
  // The `empiar` area: an EMPIAR entry walked live by its id, its runs' files loaded (_spec/empiar.md).
  interface ExtensionApis {
    empiar: EmpiarApiArea;
  }
}

// EMPIAR by id (_spec/empiar.md): the API's entry and the file host's listings, read live (both answer any origin), no
// index; a run's files loaded whole by the viewer's own operations, one history step. A read changes nothing in the
// scene; a listing is read once (a failed read is asked again next time).

const IdParam = () => PD.Numeric(12534, { min: 1, step: 1 }, { description: 'An EMPIAR entry by number (12534)' });
const RunParam = () =>
  PD.Text('', { description: 'A run by stem (YTC041_1_lam1_1_ts_003); its grid and condition are found from it' });

export class EmpiarApiArea extends ApiArea {
  readonly id = 'empiar';
  private readonly reads = new Map<string, Promise<unknown>>();
  /** A tilt series' angles by its file's address: the Slice row's readout */
  private readonly anglesAt = new Map<string, readonly number[]>();
  private readonly asking = observableState<EmpiarAsk | undefined>(undefined);
  /** What the card was last asked to show */
  readonly asked = this.asking.asReadonly;

  constructor(ctx: ApiAreaContext) {
    super(ctx);
  }

  /** A read made once; one that failed is asked again next time */
  private once<T>(key: string, read: () => Promise<T>): Promise<T> {
    let p = this.reads.get(key) as Promise<T> | undefined;
    if (!p) {
      p = read();
      p.catch(() => this.reads.delete(key));
      this.reads.set(key, p);
    }
    return p;
  }

  /** The entry as the API gives it */
  entry(id: number): Promise<EmpiarEntry> {
    return this.once(`entry ${id}`, async () =>
      readEmpiarEntry(id, JSON.parse(await text(`${EmpiarApi}EMPIAR-${id}/`))),
    );
  }

  /** A folder's rows, from the entry's folder (`data/EMPIAR_upload`) */
  listing(id: number, folder: string): Promise<ListingRow[]> {
    return this.once(`${id}/${folder}`, async () => {
      try {
        return parseListing(await text(`${EmpiarFiles}${id}/${folder}/`));
      } catch (e) {
        throw new Error(`Could not read the folder ${folder} of EMPIAR-${id}: ${(e as Error).message}`);
      }
    });
  }

  /** A condition's grids and shared files, read once */
  condition(id: number, root: string): Promise<EmpiarCondition> {
    return this.once(`condition ${id}/${root}`, async () =>
      walkCondition(await this.entry(id), root, (f) => this.listing(id, f)),
    );
  }

  /** A grid's runs: its folders' files grouped by stem, the condition's particle lists with each */
  async grid(id: number, root: string, grid: string): Promise<EmpiarGrid> {
    const [entry, c] = await Promise.all([this.entry(id), this.condition(id, root)]);
    return walkGrid(entry, c, grid, (f) => this.listing(id, f));
  }

  /** The condition and grid of a run: the grid whose name starts its stem (`YTC041_1` of `YTC041_1_lam1_1_ts_003`) */
  async locate(id: number, run: string): Promise<{ condition: string; grid: string } | undefined> {
    const entry = await this.entry(id);
    for (const root of entry.conditions) {
      const c = await this.condition(id, root);
      const grid = c.grids.find((g) => run.startsWith(`${g}_`) || run === g);
      if (grid) return { condition: root, grid };
    }
    return undefined;
  }

  /** Keeps a tilt series' angles by its file's address (a load's) */
  keepAngles(url: string, angles: readonly number[]) {
    this.anglesAt.set(url, angles);
  }

  /** A tilt series' angles (°), one an image, by its volume's ref (synchronous: the Slice row's readout) */
  tiltAnglesOf(ref: string): readonly number[] | undefined {
    const url = downloadUrlAbove(this.ctx, ref);
    return url ? this.anglesAt.get(url) : undefined;
  }

  readonly open = this.operation({
    id: 'empiar.open',
    title: 'Open an EMPIAR entry',
    params: { id: IdParam(), run: RunParam() },
    history: false,
    async run({ id, run }, ctx) {
      ctx.api.empiar!.asking.set(run ? { id, run } : { id });
      return ctx.api.run('view.open', { card: EmpiarCard });
    },
  });

  readonly read = this.operation({
    id: 'empiar.entry',
    title: 'Describe an EMPIAR entry',
    params: {
      id: IdParam(),
      condition: PD.Text('', { description: 'A condition (data/EMPIAR_upload); empty: every one, with its grids' }),
      grid: PD.Text('', { description: 'A grid of the condition (YTC041_1): its runs and their files' }),
    },
    read: true,
    approval: 'network',
    addresses: () => [EmpiarApi, EmpiarFiles],
    async run({ id, condition, grid }, ctx) {
      const area = ctx.api.empiar!;
      try {
        const entry = await area.entry(id);
        if (condition && grid) {
          const g = await area.grid(id, condition, grid);
          const lines = g.runs.map((r) => `${r.stem}: ${r.files.map(fileLine).join('; ')}`);
          return ApiResult.ok<unknown>([`${condition}/${grid}`, ...lines].join('\n'), {}, { value: g });
        }
        const roots = condition ? [condition] : entry.conditions;
        const cs = await Promise.all(roots.map((r) => area.condition(id, r)));
        const lines = [
          `EMPIAR-${id}: ${entry.title}`,
          ...(entry.emdb.length ? [`EMDB: ${entry.emdb.join(', ')}`] : []),
          ...cs.map((c) => `${c.root}: grids ${c.grids.join(', ')}; ${c.shared.map(fileLine).join('; ')}`),
        ];
        return ApiResult.ok<unknown>(lines.join('\n'), {}, { value: { entry, conditions: cs } });
      } catch (e) {
        return ApiResult.fail('unavailable', (e as Error).message);
      }
    },
  });

  readonly load = this.operation({
    id: 'empiar.load',
    title: 'Load an EMPIAR run',
    params: {
      id: IdParam(),
      run: RunParam(),
      condition: PD.Text('', { description: 'Its condition (data/EMPIAR_upload); empty: found from the run' }),
      grid: PD.Text('', { description: 'Its grid (YTC041_1); empty: found from the run' }),
      files: PD.Text('', {
        description: 'File names, comma-separated; empty: what loads of the run but its tilt series (their size)',
      }),
      emdb: PD.Text('', {
        description:
          "An EMDB average (EMD-48752) beside the tomogram, decorating the particles; empty: the entry's first; 'none'",
      }),
      large: PD.Boolean(false, { description: `Load above ${PortalLargeBytes / 1e6} MB (asked first)` }),
    },
    modules: ['network'],
    approval: 'network',
    addresses: () => [EmpiarApi, EmpiarFiles],
    async run(v, ctx) {
      const area = ctx.api.empiar!;
      const found = await findRun(area, v.id, v.run, v.condition, v.grid);
      if (isFailure(found)) return found;
      const { entry, run } = found;
      const files = pickFiles(run, v.files);
      if (isFailure(files)) return files;
      const bytes = files.reduce((n, f) => n + (f.bytes ?? 0), 0);
      if (bytes > PortalLargeBytes && !v.large) {
        return ApiResult.fail(
          'confirm',
          `${run.stem}: ${totalLabel(bytes)} to read whole (${files.map((f) => `${f.kind} ${sizeLabel(f)}`).join(', ')}).`,
          'Pick fewer files, or call again with large: true.',
        );
      }
      const url = (f: EmpiarFile) => `${EmpiarFiles}${v.id}/${f.path}`;
      const warnings: string[] = [];
      const done: string[] = [];
      const order = ['tomogram', 'volume', 'mask', 'tilt-series', 'particles'];
      const sorted = [...files].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
      let average: string | undefined;
      const emdb = v.emdb.trim() === 'none' ? undefined : v.emdb.trim() || entry.emdb[0];
      for (const f of sorted) {
        if (f.kind === 'particles' && emdb && average === undefined) {
          average = (await loadAverage(ctx, emdb, warnings)) ?? '';
          if (average) done.push(emdb);
        }
        const r = await loadFile(ctx, f, url(f), run, average, warnings);
        if (isFailure(r)) return r;
        if (r) done.push(`${f.kind} ${f.name}`);
      }
      if (!done.length) {
        return ApiResult.fail('unavailable', `Nothing of ${run.stem} could be loaded.`, warnings.join(' '));
      }
      return ApiResult.ok(`Loaded EMPIAR-${v.id} ${run.stem}: ${done.join(', ')}.`, {}, { warnings });
    },
  });
}

const fileLine = (f: EmpiarFile) => `${f.name} (${f.kind}, ${sizeLabel(f)}${f.why ? `; ${f.why}` : ''})`;

async function text(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText || 'error'} for ${url}`);
  return r.text();
}

async function findRun(area: EmpiarApiArea, id: number, stem: string, condition: string, grid: string) {
  try {
    const entry = await area.entry(id);
    const at = condition && grid ? { condition, grid } : await area.locate(id, stem.trim());
    if (!at) return ApiResult.fail('not-found', `EMPIAR-${id} has no grid for the run '${stem}'.`);
    const g = await area.grid(id, at.condition, at.grid);
    const run = g.runs.find((r) => r.stem === stem.trim());
    if (run) return { entry, run };
    return ApiResult.fail(
      'not-found',
      `${at.condition}/${at.grid} has no run '${stem}'.`,
      `Runs: ${g.runs.map((r) => r.stem).join(', ')}.`,
    );
  } catch (e) {
    return ApiResult.fail('unavailable', (e as Error).message);
  }
}

function pickFiles(run: EmpiarRun, names: string): readonly EmpiarFile[] | ApiFailure {
  const asked = names
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n);
  if (!asked.length) return defaultFiles(run);
  const picked: EmpiarFile[] = [];
  for (const name of asked) {
    const f = run.files.find((x) => x.name === name);
    if (!f)
      return ApiResult.fail(
        'not-found',
        `${run.stem} has no file '${name}'.`,
        `It has ${run.files.map((x) => x.name).join(', ')}.`,
      );
    if (f.why) return ApiResult.fail('unavailable', `${name} cannot load: ${f.why}.`);
    picked.push(f);
  }
  return picked;
}

/** The EMDB average beside the tomogram, as the portal's (its ref), or a warning */
async function loadAverage(ctx: ApiContext, emdb: string, warnings: string[]): Promise<string | undefined> {
  const made = await added(ctx, volumeRefs, () => ctx.api.run('load.entry', { source: 'emdb', id: emdb }));
  if (isFailure(made) || !made.length) {
    warnings.push(`${emdb}: ${isFailure(made) ? made.message : 'not loaded'}`);
    return undefined;
  }
  await besideTheTomogram(ctx, made[0]);
  const d = await showAverageVolume(ctx, made[0]);
  if (!d.ok) warnings.push(`${emdb}: no direct volume: ${d.message}`);
  return made[0];
}

/** One file by its kind (_spec/empiar.md §2): true loaded, false skipped (a warning), or why it failed */
async function loadFile(
  ctx: ApiContext,
  f: EmpiarFile,
  url: string,
  run: EmpiarRun,
  average: string | undefined,
  warnings: string[],
): Promise<ApiFailure | boolean> {
  if (f.kind === 'particles') return loadParticles(ctx, url, f.name, run.stem, average, warnings);
  const made = await loadMrc(ctx, url);
  if (isFailure(made)) return made;
  for (const volume of made) {
    const r =
      f.kind === 'tomogram'
        ? await ctx.api.run('cryoet.slices', { volume })
        : f.kind === 'tilt-series'
          ? await ctx.api.run('cryoet.slice', { volume, axis: 'z' })
          : await ctx.api.run('volume.representation', {
              volume,
              type: 'isosurface',
              // a mask: 0 outside, its labels (1, 2) inside
              params: f.kind === 'mask' ? { isoValue: { kind: 'absolute', absoluteValue: 0.5 } } : {},
            });
    if (isFailure(r)) return r;
  }
  if (f.kind === 'tilt-series') {
    // its angles from the run's .rawtlt, one a line: the Slice row's readout
    const tlt = run.files.find((x) => x.kind === 'angles');
    const angles = tlt && (await text(url.replace(f.path, tlt.path)).then(readAngles, () => undefined));
    if (angles?.length) ctx.api.empiar!.keepAngles(url, angles);
  }
  return true;
}

/**
 * An MRC read whole, without the format's own visual: an isosurface of a tomogram (218 M voxels here) costs seconds and
 * memory only to be hidden by its slices. What could not be read leaves nothing.
 */
async function loadMrc(ctx: ApiContext, url: string): Promise<string[] | ApiFailure> {
  const before = new Set(ctx.plugin.state.data.cells.keys());
  try {
    return await added(ctx, volumeRefs, async () => {
      // committed without reverting, so a failed download keeps its cause (a 404) to say (review S4)
      const data = await ctx.plugin.build().toRoot().apply(Download, { url, isBinary: true }).commit();
      if (data.cell?.status === 'error' || !data.isOk) throw new Error(data.cell?.errorText ?? 'the download failed');
      await Ccp4Provider.parse(ctx.plugin, data);
      return ApiResult.ok('');
    });
  } catch (e) {
    const left = [...ctx.plugin.state.data.cells.keys()].filter((k) => !before.has(k));
    if (left.length) await removeLoaded(ctx, left[0]);
    return ApiResult.fail('failed', `Could not read ${url}: ${(e as Error).message}`);
  }
}

/** A `.rawtlt`: one angle a line */
export const readAngles = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l)
    .map(Number)
    .filter((x) => Number.isFinite(x));

/**
 * A STAR's particles of one run (_spec/empiar.md §2): read whole, then kept to the rows naming the run
 * (`rlnMicrographName` or `rlnTomoName`, by stem: `<run>.mrc.tomostar`); in Å by the rows' own `rlnPixelSize` (4.99 Å
 * against the tomogram's 9.98: never the tomogram's). None of the run's: the list removed, a warning.
 */
async function loadParticles(
  ctx: ApiContext,
  url: string,
  name: string,
  stem: string,
  average: string | undefined,
  warnings: string[],
): Promise<ApiFailure | boolean> {
  const lists = await added(ctx, listRefs, () => ctx.api.run('load.url', { url, format: 'relion_star_particles' }));
  if (isFailure(lists)) return lists;
  for (const particles of lists) {
    const filter = runFilter(ctx, particles, stem);
    if (!filter) {
      warnings.push(`${name} has no particles of ${stem}.`);
      await removeLoaded(ctx, particles);
      return false;
    }
    const r = await ctx.api.run('particles.source', { particles, params: filter });
    if (isFailure(r)) return r;
    const d = average
      ? await ctx.api.run('cryoet.decorate', { particles, with: 'object', object: average })
      : await sizePoints(ctx, particles);
    if (isFailure(d)) return d;
  }
  return true;
}

/** The format's filter for a run's rows, by the names the file holds (the transform's options) */
function runFilter(ctx: ApiContext, list: string, stem: string): Record<string, string[]> | undefined {
  const { cells } = ctx.plugin.state.data;
  const cell = cells.get(list)!;
  const def = cell.transform.transformer.definition.params?.(
    cells.get(cell.transform.parent)?.obj as never,
    ctx.plugin,
  ) as Record<string, { options?: [string, string][] }> | undefined;
  for (const [key, other] of [
    ['micrographs', 'tomograms'],
    ['tomograms', 'micrographs'],
  ]) {
    const names = def?.[key]?.options?.map(([n]) => n).filter((n) => stemOf(n) === stem) ?? [];
    if (names.length) return { [key]: names, [other]: [] };
  }
  return undefined;
}

/** What a load added for a file, from its download down */
async function removeLoaded(ctx: ApiContext, ref: string) {
  const { cells, tree } = ctx.plugin.state.data;
  let top = ref;
  while (cells.get(top) && cells.get(top)!.transform.parent !== tree.root.ref) top = cells.get(top)!.transform.parent;
  await ctx.plugin.build().delete(top).commit();
}

/** EMPIAR by id, in an app (prism-me): the card, `?empiar=` */
export const EmpiarExtension: ViewerExtension = {
  id: 'cryoet-empiar',
  title: 'EMPIAR',
  api: { empiar: (ctx) => new EmpiarApiArea(ctx) },
  commands: (api) => {
    const a = api.empiar;
    if (!a) return [];
    const category = 'Cryo-ET';
    const alias = ['empiar', 'tomogram', 'run', 'ebi'];
    return [
      operationCommand(api, a.load, { category, icon: 'download', alias }),
      operationCommand(api, a.read, { category, icon: 'info', alias }),
    ];
  },
  ui: async (ctx) => (await import('./empiar-ui.js')).empiarUI(ctx),
};
