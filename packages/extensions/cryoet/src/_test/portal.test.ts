/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type { Structure } from '@molstar/model/model/structure';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Grid, type Volume } from '@molstar/model/model/volume';
import { ApiArea, type ApiAreaContext, ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { ViewerExtension } from '@molstar/prism-viewer/spec';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { getOmeZarrLevel, omeZarrLevelNeeds, VolumeFromOmeZarr } from '@molstar/plugin/state/formats/volume/ome-zarr';
import { VolumeTransform } from '@molstar/plugin/state/transforms/volume/ops';
import { particleListData } from '../operations.js';
import {
  CryoetPortalExtension,
  PortalLargeBytes,
  type PortalIndexSource,
  type PortalRunInfo,
  showAverageVolume,
  showTomogramVolume,
  tiltSeriesMatrix,
  tomogramControlPoints,
} from '../portal.js';
import { checkPortalIndex, type PortalCatalog, type PortalDataset, PortalFiles } from '../portal-index.js';
import { portalAnnotationText } from '../portal-run.js';
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
              description: 'Membrain-seg prediction',
              goId: 'GO:0016020',
            },
            { id: 8, object: 'lipid', shape: 'Mesh', format: 'tiff', path: '1/TS_01/l.tiff' },
            { id: 9, object: 'membrane', shape: 'Mesh', format: 'glb', path: '1/TS_01/s.glb' },
          ],
        },
      ],
      // four images (the zarr's z), their angles by z index
      tiltSeries: [
        {
          id: 17,
          zarr: '1/TS_01/ts.zarr',
          levels: [level('0', 520, 10), level('1', 260, 20), level('2', 130, 40)],
          pixelSpacing: 10.01,
          tiltAxis: -5,
          angles: [-60, -20, 20, 60],
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
  ...zarrRoutes('ts\\.zarr', zarr('<f4')),
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

/** The stage's move, recorded: a load places an object beside the tomogram by it */
class StageMoves extends ApiArea {
  readonly id = 'stage';
  static readonly calls: { target: string; matrix: number[] }[] = [];
  readonly move = this.operation({
    id: 'stage.move',
    title: 'Move',
    params: { target: PD.Text(''), matrix: PD.Value<number[]>([]) },
    async run(v) {
      StageMoves.calls.push(v);
      return ApiResult.ok('');
    },
  });
}
const Stage: ViewerExtension = {
  id: 'stage-moves',
  api: { stage: (ctx: ApiAreaContext) => new StageMoves(ctx) } as never,
};

/** A stage whose moves compose as stage-tools' `stage.move` does for a volume: its transform decorator, after where it is */
class ComposingStage extends ApiArea {
  readonly id = 'stage';
  readonly move = this.operation({
    id: 'stage.move',
    title: 'Move',
    params: { target: PD.Text(''), matrix: PD.Value<number[]>([]) },
    async run(v, ctx) {
      const { cells, tree } = ctx.plugin.state.data;
      const old = tree.children
        .get(v.target)
        .toArray()
        .map((c) => cells.get(c)!)
        .find((c) => c.transform.transformer === VolumeTransform);
      const prev = old ? (old.transform.params as any).transform.params.data : Mat4.identity();
      const data = Mat4.mul(Mat4(), Mat4.fromArray(Mat4(), v.matrix, 0), prev);
      const transform = { name: 'matrix' as const, params: { data, transpose: false } };
      const b = ctx.plugin.state.data.build();
      if (old) b.to(old).update({ transform });
      else b.to(v.target).insert(VolumeTransform, { transform });
      await b.commit();
      return ApiResult.ok('');
    },
  });
}
const Composing: ViewerExtension = {
  id: 'stage-composing',
  api: { stage: (ctx: ApiAreaContext) => new ComposingStage(ctx) } as never,
};

/** Where a volume is now, on top of where it was read */
const matrixOf = (v: PrismViewer, ref: string) => {
  const { cells, tree } = v.plugin.state.data;
  const t = tree.children
    .get(ref)
    .toArray()
    .map((c) => cells.get(c)!)
    .find((c) => c.transform.transformer === VolumeTransform);
  return t ? ((t.transform.params as any).transform.params.data as Mat4) : undefined;
};

async function viewer(from: PortalIndexSource = source, extra: ViewerExtension[] = []) {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: {
      ...base,
      extensions: [...(base.extensions ?? []), CryoetExtension, CryoetPortalExtension(from), ...extra],
    },
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
    // and its tilt series: the ids `load`'s `tiltSeries` takes
    expect(r.did).toContain('Tilt series: TS-17 · 10.01 Å · 520×520×4 · −60°…+60° step 40°');
  });

  it('loads a tilt series as its Z slice only, from the middle image, beside the tomogram loaded with it', async () => {
    const fetch = serve();
    StageMoves.calls.length = 0;
    const v = await viewer(source, [Stage]);
    const r = await v.api.run('cryoetPortal.load', {
      dataset: 1,
      run: 'TS_01',
      annotations: 'none',
      as: 'slices',
      tiltSeries: 17,
    });
    expectOk(r);
    expect(r.did).toContain('tilt series 17 (level 2, 4 images)');
    // the coarsest level when none is asked
    expect(fetch.mock.calls.map((c) => String(c[0]))).toContain(`${PortalFiles}1/TS_01/ts.zarr/2/0/0/0`);
    const [tomogram, ts] = v.plugin.managers.volume.hierarchy.current.volumes;
    expect(tomogram.representations.length).toBe(3);
    const params = ts.representations.map((x) => x.cell.transform.params as any);
    expect(params.map((p) => p.type.name)).toEqual(['slice']);
    expect(params[0].type.params.dimension).toEqual({ name: 'z', params: 2 });
    // moved beside the tomogram (only the tilt series: the tomogram stays where it is)
    expect(StageMoves.calls.map((c) => c.target)).toEqual([ts.cell.transform.ref]);
    expect(StageMoves.calls[0].matrix[12]).toBeLessThan(0);
    // its angles, found from the volume: the Slice row's readout
    expect(v.api.cryoetPortal!.tiltAnglesOf(ts.cell.transform.ref)).toEqual([-60, -20, 20, 60]);
    expect(v.api.cryoetPortal!.tiltAnglesOf(tomogram.cell.transform.ref)).toBeUndefined();
  });

  it("names each volume by its run, kind and id, no two alike (Ludo, 2026-11-04); the addresses are the files'", async () => {
    const fetch = serve();
    const v = await viewer();
    const r = await v.api.run('cryoetPortal.load', {
      dataset: 1,
      run: 'TS_01',
      annotations: '6/SegmentationMask',
      as: 'slices',
      tiltSeries: 17,
    });
    expectOk(r);
    const volumes = v.plugin.managers.volume.hierarchy.current.volumes;
    // the zarrs are all named t.zarr, m.zarr, ts.zarr: before, TS_08's tomogram and tilt series were both TS_08.zarr
    expect(volumes.map((x) => x.cell.obj?.label)).toEqual([
      'TS_01 tomogram 7',
      'TS_01 membrane 6',
      'TS_01 tilt series 17',
    ]);
    // only the name: the files read are the zarrs', and the angles are still found from the tilt series' address
    expect(fetch.mock.calls.map((c) => String(c[0]))).toContain(`${PortalFiles}1/TS_01/ts.zarr/2/0/0/0`);
    expect(v.api.cryoetPortal!.tiltAnglesOf(volumes[2].cell.transform.ref)).toEqual([-60, -20, 20, 60]);
  });

  it('places a tilt series by the tomogram: beside as read (as before), beside turned, or turned under it', async () => {
    serve();
    const v = await viewer(source, [Composing]);
    const r = await v.api.run('cryoetPortal.load', {
      dataset: 1,
      run: 'TS_01',
      annotations: 'none',
      as: 'slices',
      tiltSeries: 17,
    });
    expectOk(r);
    const [tomogram, ts] = v.plugin.managers.volume.hierarchy.current.volumes;
    const grid = (x: typeof ts) => (x.cell.obj!.data as Volume).grid;
    const ref = ts.cell.transform.ref;
    const at = () => matrixOf(v, ref)!;
    // beside, the default: today's move, along -x by 2.5 times its radius, nothing turned
    const { radius } = Grid.getBoundingSphere(grid(ts));
    expect(Array.from(at())).toEqual(Array.from(Mat4.fromTranslation(Mat4(), Vec3.create(-2.5 * radius, 0, 0))));
    expect(v.api.cryoetPortal!.placeOf(ref)).toBe('beside');
    // turned and back, each the place's own matrix, not one move on top of the other
    for (const place of ['overlay', 'turned', 'beside', 'overlay'] as const) {
      expectOk(await v.api.run('cryoetPortal.place', { volume: ref, place }));
      expect(Mat4.areEqual(at(), tiltSeriesMatrix(place, grid(ts), -5, grid(tomogram)), 1e-6)).toBe(true);
      expect(v.api.cryoetPortal!.placeOf(ref)).toBe(place);
    }
    // overlay: turned about z by -(tilt axis + 180°) = -175° (measured on 10003 TS_08: _spec/portal.md §2), its center
    // on the tomogram's in x, y, its top at the tomogram's bottom
    const m = at();
    expect(Math.atan2(m[1], m[0]) * (180 / Math.PI)).toBeCloseTo(-175, 6);
    const c = Grid.getBoundingSphere(grid(ts)).center;
    const moved = Vec3.transformMat4(Vec3(), c, m);
    const t = Grid.getBoundingSphere(grid(tomogram)).center;
    expect(moved[0]).toBeCloseTo(t[0], 3);
    expect(moved[1]).toBeCloseTo(t[1], 3);
    const zOf = (g: Grid, k: number) =>
      Vec3.transformMat4(Vec3(), Vec3.create(0, 0, k), Grid.getGridToCartesianTransform(g))[2];
    const half = (zOf(grid(ts), grid(ts).cells.space.dimensions[2]) - zOf(grid(ts), 0)) / 2;
    expect(moved[2] + half).toBeCloseTo(zOf(grid(tomogram), 0), 3);
    // the tomogram stays
    expect(matrixOf(v, tomogram.cell.transform.ref)).toBeUndefined();
  });

  it('loads a tilt series at the place asked; overlay needs its tomogram in the scene', async () => {
    serve();
    const v = await viewer(source, [Composing]);
    const r = await v.api.run('cryoetPortal.load', {
      dataset: 1,
      run: 'TS_01',
      annotations: 'none',
      as: 'slices',
      tiltSeries: 17,
      tiltSeriesPlace: 'turned',
    });
    expectOk(r);
    const [tomogram, ts] = v.plugin.managers.volume.hierarchy.current.volumes;
    expect(v.api.cryoetPortal!.placeOf(ts.cell.transform.ref)).toBe('turned');
    await v.plugin.build().delete(tomogram.cell.transform.ref).commit();
    const o = await v.api.run('cryoetPortal.place', { volume: ts.cell.transform.ref, place: 'overlay' });
    expect(o.ok).toBe(false);
    expect(v.api.cryoetPortal!.placeOf(ts.cell.transform.ref)).toBe('turned');
    // not a tilt series
    const n = await v.api.run('cryoetPortal.place', { volume: 'nothing', place: 'beside' });
    expect(n.ok).toBe(false);
  });

  it("gives a mask's and a point list's words by their ref (the properties'), none for a tomogram", async () => {
    serve();
    const v = await viewer();
    expectOk(await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_01', as: 'slices' }));
    const [tomogram, mask] = v.plugin.managers.volume.hierarchy.current.volumes;
    const [list] = v.plugin.managers.particles.hierarchy.current.lists;
    const portal = v.api.cryoetPortal!;
    expect(portal.annotationTextOf(mask.cell.transform.ref)).toBe(
      'membrane: Membrain-seg prediction\n\n[GO:0016020](https://amigo.geneontology.org/amigo/term/GO:0016020)',
    );
    // the ribosomes have none of the three words
    expect(portal.annotationTextOf(list.cell.transform.ref)).toBeUndefined();
    expect(portal.annotationTextOf(tomogram.cell.transform.ref)).toBeUndefined();
  });

  it("cuts a long method at a word on one line; the description alone, without its object's colon when none", () => {
    const method = `Template matching ${'and more filtering '.repeat(10)}`;
    const text = portalAnnotationText({ ...dataset.runList[0].spacings[0].annotations[0], method })!;
    const [first, second] = text.split('\n\n');
    expect(first).toBe('ribosome');
    expect(second.length).toBeLessThanOrEqual(91);
    expect(second.endsWith('…')).toBe(true);
    expect(method.startsWith(second.slice(0, -1))).toBe(true);
  });

  it('loads a tilt series alone where it lands, at the level asked', async () => {
    const fetch = serve();
    StageMoves.calls.length = 0;
    const v = await viewer(source, [Stage]);
    const r = await v.api.run('cryoetPortal.load', {
      dataset: 1,
      run: 'TS_01',
      annotations: 'none',
      as: 'none',
      tiltSeries: 17,
      tiltSeriesLevel: 1,
    });
    expectOk(r);
    expect(r.did).toBe('Loaded 1 TS_01: tilt series 17 (level 1, 4 images).');
    expect(fetch.mock.calls.map((c) => String(c[0]))).toContain(`${PortalFiles}1/TS_01/ts.zarr/1/0/0/0`);
    expect(v.plugin.managers.volume.hierarchy.current.volumes.length).toBe(1);
    expect(StageMoves.calls).toEqual([]);
  });

  it("counts the tilt series' level in the size guard, and names the tilt series it has", async () => {
    serve();
    const v = await viewer();
    // no tomogram, no annotation: the tilt series' level 0 alone is over
    const asked = await v.api.run('cryoetPortal.load', {
      dataset: 1,
      run: 'TS_01',
      annotations: 'none',
      as: 'none',
      tiltSeries: 17,
      tiltSeriesLevel: 0,
    });
    expect(asked).toMatchObject({ ok: false, code: 'confirm', message: 'TS_01 is 562 MB decoded at these levels.' });
    expect(await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_01', tiltSeries: 99 })).toMatchObject({
      code: 'not-found',
      message: 'TS_01 has no tilt series 99.',
      hint: 'It has 17.',
    });
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
