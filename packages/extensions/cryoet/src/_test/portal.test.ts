/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type { Structure } from '@molstar/model/model/structure';
import { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { getOmeZarrLevel, omeZarrLevelNeeds, VolumeFromOmeZarr } from '@molstar/plugin/state/formats/volume/ome-zarr';
import { particleListData } from '../operations.js';
import {
  CryoetPortalExtension,
  PortalLargeBytes,
  type PortalIndexSource,
  type PortalRunInfo,
  showAverageVolume,
  showTomogramVolume,
  tomogramControlPoints,
} from '../portal.js';
import { checkPortalIndex, type PortalCatalog, type PortalDataset, PortalFiles } from '../portal-index.js';
import { CryoetExtension } from '../prism-viewer.js';

// The `cryoetPortal` area on a headless viewer, over an index made in memory and a stubbed `fetch` that serves its
// files (nothing reaches the network): three oriented points in voxels of a 10 Å tomogram, decorated with 1CBS.

const examples = new URL('../../../../../data/examples/', import.meta.url);

const points = [
  { x: 1, y: 2, z: 3 },
  { x: 10, y: 0, z: 0 },
  { x: 0, y: 20, z: 0 },
]
  .map((location) =>
    JSON.stringify({
      type: 'orientedPoint',
      location,
      xyz_rotation_matrix: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    }),
  )
  .join('\n');

const level = (path: string, n: number, spacing: number) => ({
  path,
  size: [n, n, n] as [number, number, number],
  spacing,
  bytes: n * n * n * 4,
});

const dataset: PortalDataset = {
  version: 1,
  built: '2026-11-02',
  id: 1,
  title: 'Test ribosomes',
  runs: 2,
  dois: ['10.1038/test'],
  decorations: { ribosome: { pdb: '1CBS', center: [5, -7, 11] } },
  runList: [
    {
      id: 101,
      name: 'TS_01',
      spacings: [
        {
          spacing: 10,
          tomograms: [
            {
              id: 7,
              name: 'TS_01',
              size: [400, 400, 400],
              zarr: '1/TS_01/t.zarr',
              levels: [level('0', 520, 10), level('1', 260, 20), level('2', 130, 40)],
            },
          ],
          annotations: [
            {
              id: 5,
              object: 'ribosome',
              shape: 'OrientedPoint',
              format: 'ndjson',
              path: '1/TS_01/r.ndjson',
              default: true,
            },
            { id: 6, object: 'membrane', shape: 'InstanceSegmentation', format: 'ndjson', path: '1/TS_01/m.ndjson' },
            {
              id: 6,
              object: 'membrane',
              shape: 'SegmentationMask',
              format: 'zarr',
              path: '1/TS_01/m.zarr',
              levels: [level('0', 400, 10), level('2', 100, 40)],
              default: true,
            },
            { id: 8, object: 'lipid', shape: 'Mesh', format: 'tiff', path: '1/TS_01/l.tiff' },
            { id: 9, object: 'membrane', shape: 'Mesh', format: 'glb', path: '1/TS_01/s.glb' },
          ],
        },
      ],
    },
  ],
};

const catalog: PortalCatalog = { version: 1, datasets: [{ id: 1, title: dataset.title, runs: 2 }] };
const source: PortalIndexSource = { catalog: async () => catalog, dataset: async () => dataset };

/** An OME-Zarr of three levels, 4³ each, uncompressed: a blob in the middle (a tomogram's dense matter is dark) */
function zarr(dtype: '<f4' | '|i1') {
  const n = 4;
  const values = dtype === '<f4' ? new Float32Array(n ** 3).fill(1) : new Int8Array(n ** 3);
  for (const i of [21, 22, 25, 26, 37, 38, 41, 42]) values[i] = dtype === '<f4' ? -1 : 1;
  const zattrs = {
    multiscales: [
      {
        version: '0.4',
        axes: ['z', 'y', 'x'].map((name) => ({ name, type: 'space', unit: 'angstrom' })),
        datasets: ['0', '1', '2'].map((path, i) => ({
          path,
          coordinateTransformations: [{ type: 'scale', scale: [10 * 2 ** i, 10 * 2 ** i, 10 * 2 ** i] }],
        })),
      },
    ],
  };
  const zarray = {
    zarr_format: 2,
    shape: [n, n, n],
    chunks: [n, n, n],
    dtype,
    compressor: null,
    fill_value: 0,
    order: 'C',
    filters: null,
    dimension_separator: '/',
  };
  return { zattrs: JSON.stringify(zattrs), zarray: JSON.stringify(zarray), chunk: new Uint8Array(values.buffer) };
}

/** The files of a zarr at `root`, by key */
const zarrRoutes = (root: string, z: ReturnType<typeof zarr>): [RegExp, () => BodyInit][] => [
  [new RegExp(`${root}/\\.zattrs$`), () => z.zattrs],
  [new RegExp(`${root}/\\d/\\.zarray$`), () => z.zarray],
  [new RegExp(`${root}/\\d/0/0/0$`), () => z.chunk],
];

/** A route answering null: a 404 (a test's own, before the shared ones) */
type Route = [RegExp, () => BodyInit | null];

const routes: Route[] = [
  [/r\.ndjson$/, () => points],
  [/s\.glb$/, () => readFileSync(new URL('shapes/cryoet-10521-mesh.glb', examples))],
  [/1cbs/, () => readFileSync(new URL('1cbs_full.bcif', examples))],
  ...zarrRoutes('t\\.zarr', zarr('<f4')),
  ...zarrRoutes('m\\.zarr', zarr('|i1')),
];

function serve(own: Route[] = []) {
  const stub = vi.fn(async (input: string | URL | Request) => {
    const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
    const body = [...own, ...routes].find(([k]) => k.test(url))?.[1]();
    return body ? new Response(body, { status: 200 }) : new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', stub);
  return stub;
}

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

async function viewer(from: PortalIndexSource = source) {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), CryoetExtension, CryoetPortalExtension(from)] },
  });
  viewers.push(v);
  return v;
}

describe('cryoetPortal', () => {
  it('describes a run: its levels, its annotations by key (an id with two shapes keyed by shape), the defaults', async () => {
    const v = await viewer();
    const r = await v.api.run('cryoetPortal.run', { dataset: 1, run: 'TS_01' });
    expectOk(r);
    const info = r.value as PortalRunInfo;
    expect(info.entries.map((e) => e.key)).toEqual(['5', '6/InstanceSegmentation', '6/SegmentationMask', '8', '9']);
    expect(info.defaults).toEqual(['5', '6/SegmentationMask']);
    // the viewer reads ndjson and OME-Zarr; a format it has no reader for says so
    expect(info.needs).toBeUndefined();
    expect(info.entries.map((e) => e.needs)).toEqual([
      undefined,
      undefined,
      undefined,
      expect.stringMatching(/tiff/),
      undefined,
    ]);
    expect(r.did).toContain('2: 130×130×130 at 40 Å, 8.8 MB');
    // every tomogram of the run, as the card lists them: the ids `load`'s `tomogram` takes (review S3)
    expect(r.did).toContain('Tomograms: 7 · 10 Å · 400×400×400');
  });

  // a direct volume needs graphics, which a headless viewer has not: its transfer function is tested below
  it('loads the tomogram (its slices), the mask (a surface at 0.5), the points at the index spacing, decorated: one history step', async () => {
    const fetch = serve();
    const v = await viewer();
    const steps = async () => ((await v.api.run('history.list', {})) as { value: unknown[] }).value.length;
    const before = await steps();
    const r = await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_01', as: 'slices' });
    expectOk(r);
    expect(r.warnings ?? []).toEqual([]);
    const [tomogram, mask] = v.plugin.managers.volume.hierarchy.current.volumes;
    const shown = (vol: typeof tomogram) =>
      vol.representations
        .filter((x) => !x.cell.state.isHidden)
        .map((x) => (x.cell.transform.params as { type: { name: string } }).type.name)
        .sort();
    // the coarsest level, as the index says: '2'
    expect(fetch.mock.calls.map((c) => String(c[0]))).toContain(`${PortalFiles}1/TS_01/t.zarr/2/0/0/0`);
    expect(shown(tomogram)).toEqual(['slice', 'slice', 'slice']);
    // nothing made to be hidden: no isosurface of the tomogram behind its slices
    expect(tomogram.representations.length).toBe(3);
    expect(mask.representations.length).toBe(1);
    expect(shown(mask)).toEqual(['isosurface']);
    const iso = (mask.representations[0].cell.transform.params as any).type.params.isoValue;
    expect(iso).toEqual({ kind: 'absolute', absoluteValue: 0.5 });
    expect(fetch.mock.calls.map((c) => String(c[0]))).toContain(`${PortalFiles}1/TS_01/r.ndjson`);
    const [list] = v.plugin.managers.particles.hierarchy.current.lists;
    const data = particleListData({ plugin: v.plugin }, list.cell.transform.ref) as ParticleList;
    // voxels × the spacing of the index (10 Å)
    expect(Array.from(data.coordinates.slice(0, 6))).toEqual([10, 20, 30, 100, 0, 0]);
    expect(data.targetMapping?.get(0)?.kind).toBe('structure');
    const d = await v.api.cryoet!.decorations({});
    expectOk(d);
    expect((d.value as { targets: { with?: string }[] }).targets[0].with).toMatch(/1cbs/i);
    // the structure moved from its own center (its boundary's, drawn at the point) to the average's: the shift, in the
    // particle's frame, is its center less the average's
    const target = data.targetMapping!.get(0) as { structure: Structure };
    const c = target.structure.boundary.sphere.center;
    const offset = v.api.cryoet!.offsetOf(list.cell.transform.ref, '')!;
    expect(offset.translation[0]).toBeCloseTo(c[0] - 5, 3);
    expect(offset.translation[1]).toBeCloseTo(c[1] + 7, 3);
    expect(offset.translation[2]).toBeCloseTo(c[2] - 11, 3);
    expect(await steps()).toBe(before + 1);
  });

  it('keeps what it loaded when the direct volume cannot be made (no graphics here): a warning', async () => {
    serve();
    const v = await viewer();
    const r = await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_01' });
    expectOk(r);
    expect(r.warnings?.join(' ')).toMatch(/direct volume/i);
    expect(v.plugin.managers.volume.hierarchy.current.volumes.length).toBe(2);
    expect(v.plugin.managers.particles.hierarchy.current.lists.length).toBe(1);
  });

  it('draws points without a decoration as spheres of 50 Å, not half the distance between them (Ludo, 2026-11-03)', async () => {
    serve();
    const v = await viewer({ ...source, dataset: async () => ({ ...dataset, decorations: undefined }) });
    expectOk(await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_01', annotations: '5', as: 'none' }));
    const [list] = v.plugin.managers.particles.hierarchy.current.lists;
    const spheres = list.representations.filter((r) => r.cell.transform.params?.type.name === 'spacefill');
    expect(spheres.length).toBeGreaterThan(0);
    for (const r of spheres) {
      expect(r.cell.transform.params?.sizeTheme).toMatchObject({ name: 'particle-size', params: { defaultSize: 50 } });
    }
    // the size is the spheres' own: the list has no radii, so a shape decorating it later is not scaled by them
    expect(particleListData(v, list.cell.transform.ref)?.radii).toBeUndefined();
  });

  it('says so when the decoration cannot be fetched, the points loaded', async () => {
    serve([[/1cbs/, () => null]]);
    const v = await viewer();
    const r = await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_01', annotations: '5', as: 'none' });
    expectOk(r);
    expect(r.warnings?.join(' ')).toMatch(/1CBS/);
    expect(v.plugin.managers.particles.hierarchy.current.lists.length).toBe(1);
  });

  it('leaves nothing when a file fails midway (the tomogram opened before it)', async () => {
    serve([[/r\.ndjson$/, () => null]]);
    const v = await viewer();
    const r = await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_01', as: 'slices' });
    expect(r.ok).toBe(false);
    expect(v.plugin.managers.volume.hierarchy.current.volumes.length).toBe(0);
    expect(v.plugin.managers.particles.hierarchy.current.lists.length).toBe(0);
  });

  it('loads a GLB mesh annotation as a mesh of the scene', async () => {
    serve();
    const v = await viewer();
    expectOk(await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_01', annotations: '9', as: 'none' }));
    const meshes = await v.api.run('cryoet.meshes', {});
    expectOk(meshes);
    expect((meshes.value as unknown[]).length).toBe(1);
  });

  it("gives a tomogram's direct volume the Tomogram preset: its dense (low) values opaque, its bright ones clear", async () => {
    serve();
    const v = await viewer();
    expectOk(await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_01', annotations: 'none', as: 'slices' }));
    const [tomogram] = v.plugin.managers.volume.hierarchy.current.volumes;
    const points = tomogramControlPoints(v.plugin, tomogram.cell.obj!.data) as { 0: number; 1: number }[];
    expect(points.length).toBeGreaterThan(1);
    const alphaAt = (x: number) =>
      points.reduce((best, p) => (Math.abs(p[0] - x) < Math.abs(best[0] - x) ? p : best))[1];
    // x: the value from the volume's min (0) to its max (1)
    expect(alphaAt(0)).toBeGreaterThan(alphaAt(1));
  });

  it("lights a tomogram's direct volume volumetric (its own shadows; local where the device cannot)", async () => {
    serve();
    const v = await viewer();
    expectOk(await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_01', annotations: 'none', as: 'slices' }));
    const [tomogram] = v.plugin.managers.volume.hierarchy.current.volumes;
    // the headless viewer draws no direct volume: what the load asks for is the check
    const calls: unknown[] = [];
    const api = { run: async (_name: string, args: unknown) => (calls.push(args), ApiResult.ok('')) };
    expectOk(await showTomogramVolume({ plugin: v.plugin, api } as never, tomogram.cell.transform.ref));
    expect(calls).toMatchObject([{ type: 'direct-volume', params: { lighting: 'volumetric' } }]);
  });

  it('shows an average (EMDB) as a direct volume lit volumetric, its isosurface hidden', async () => {
    const calls: [string, unknown][] = [];
    const api = { run: async (name: string, args: unknown) => (calls.push([name, args]), ApiResult.ok('')) };
    expectOk(await showAverageVolume({ api } as never, 'emd'));
    expect(calls).toMatchObject([
      ['volume.representation', { volume: 'emd', type: 'direct-volume', params: { lighting: 'volumetric' } }],
      ['volume.visibility', { volume: 'emd', representation: 'isosurface', visible: false }],
    ]);
  });

  it('asks before a load above the size guard', async () => {
    serve();
    const v = await viewer();
    expect(520 ** 3 * 4).toBeGreaterThan(PortalLargeBytes);
    const asked = await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_01', level: 0, annotations: 'none' });
    expect(asked).toMatchObject({ ok: false, code: 'confirm', message: 'TS_01 is 562 MB decoded at these levels.' });
  });

  it("sets the format's guard from the file's own need (its voxels and one decoded chunk), not the index's voxels", async () => {
    // Ludo, 2026-11-03: a confirmed level 1 of 618 MB was refused, the guard set to its voxels (618 MB) and the format
    // counting a decoded chunk too (685 MB). The index's level 0 says 562 MB here; the file's is 4³.
    serve();
    const v = await viewer();
    expectOk(
      await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_01', level: 0, annotations: 'none', large: true }),
    );
    const cells = Array.from(v.plugin.state.data.cells.values());
    const cell = cells.find((c) => c.transform.transformer === VolumeFromOmeZarr)!;
    const { maxSizeMB } = cell.transform.params as { maxSizeMB: number };
    const file = v.plugin.state.data.cells.get(cell.transform.parent)!.obj!.data as Parameters<
      typeof getOmeZarrLevel
    >[0];
    const needs = omeZarrLevelNeeds(getOmeZarrLevel(file, '0'));
    expect(maxSizeMB * 1e6).toBeGreaterThanOrEqual(needs);
    expect(maxSizeMB).toBe(Math.max(512, Math.ceil(needs / 1e6)));
  });

  it('names what it has when asked for what it has not', async () => {
    const v = await viewer();
    expect(await v.api.run('cryoetPortal.load', { dataset: 2 })).toMatchObject({
      code: 'not-found',
      hint: 'It has 1.',
    });
    expect(await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_09' })).toMatchObject({
      code: 'not-found',
      message: "Dataset 1 has no run 'TS_09' (the index holds 1 of 2).",
    });
    const r = await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_01', annotations: '99' });
    expect(r).toMatchObject({ code: 'not-found' });
  });

  it("tells where a loaded object came from: its run's page and its DOIs", async () => {
    serve();
    const v = await viewer();
    expectOk(await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_01', annotations: '5', as: 'none' }));
    const [list] = v.plugin.managers.particles.hierarchy.current.lists;
    expect(v.api.cryoetPortal!.originOf(list.cell.transform.ref)).toEqual({
      dataset: 1,
      run: 'TS_01',
      page: 'https://cryoetdataportal.czscience.com/datasets/1',
      runPage: 'https://cryoetdataportal.czscience.com/runs/101',
      dois: ['10.1038/test'],
    });
  });

  it('refuses an index of another version', () => {
    expect(() => checkPortalIndex({ version: 2 }, 'x.json')).toThrow('x.json is a portal index of version 2');
  });
});
