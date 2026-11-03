/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { particleListData } from '../operations.js';
import { CryoetPortalExtension, PortalLargeBytes, type PortalIndexSource, type PortalRunInfo } from '../portal.js';
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
  decorations: { ribosome: { pdb: '1CBS', center: [0, 0, 0] } },
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
          ],
        },
      ],
    },
  ],
};

const catalog: PortalCatalog = { version: 1, datasets: [{ id: 1, title: dataset.title, runs: 2 }] };
const source: PortalIndexSource = { catalog: async () => catalog, dataset: async () => dataset };

const routes: Record<string, () => BodyInit> = {
  'r.ndjson': () => points,
  '1cbs': () => readFileSync(new URL('1cbs_full.bcif', examples)),
};

function serve() {
  const stub = vi.fn(async (input: string | URL | Request) => {
    const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
    const hit = Object.keys(routes).find((k) => url.includes(k));
    return hit ? new Response(routes[hit](), { status: 200 }) : new Response('not found', { status: 404 });
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

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), CryoetExtension, CryoetPortalExtension(source)] },
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
    expect(info.entries.map((e) => e.key)).toEqual(['5', '6/InstanceSegmentation', '6/SegmentationMask']);
    expect(info.defaults).toEqual(['5', '6/SegmentationMask']);
    // no OME-Zarr reader in this viewer: the tomogram and the mask say so, the points do not
    expect(info.needs).toMatch(/needs a reader for zarr/);
    expect(info.entries.map((e) => !!e.needs)).toEqual([false, false, true]);
    expect(r.did).toContain('2: 130×130×130 at 40 Å, 8.4 MB');
  });

  it('loads the points at the index spacing, decorated, in one history step; what it cannot read, it says', async () => {
    const fetch = serve();
    const v = await viewer();
    const steps = async () => ((await v.api.run('history.list', {})) as { value: unknown[] }).value.length;
    const before = await steps();
    const r = await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_01' });
    expectOk(r);
    expect(r.warnings?.join(' ')).toMatch(/tomogram needs a reader.*membrane \(SegmentationMask\) needs a reader/);
    expect(fetch.mock.calls.map((c) => String(c[0]))).toContain(`${PortalFiles}1/TS_01/r.ndjson`);
    const [list] = v.plugin.managers.particles.hierarchy.current.lists;
    const data = particleListData({ plugin: v.plugin }, list.cell.transform.ref) as ParticleList;
    // voxels × the spacing of the index (10 Å)
    expect(Array.from(data.coordinates.slice(0, 6))).toEqual([10, 20, 30, 100, 0, 0]);
    expect(data.targetMapping?.get(0)?.kind).toBe('structure');
    const d = await v.api.cryoet!.decorations({});
    expectOk(d);
    expect((d.value as { targets: { with?: string }[] }).targets[0].with).toMatch(/1cbs/i);
    // the structure moved from its own center to the average's (0, 0, 0)
    const offset = v.api.cryoet!.offsetOf(list.cell.transform.ref, '');
    expect(offset && Math.hypot(...offset.translation)).toBeGreaterThan(1);
    expect(await steps()).toBe(before + 1);
  });

  it('asks before a load above the size guard', async () => {
    serve();
    const v = await viewer();
    expect(520 ** 3 * 4).toBeGreaterThan(PortalLargeBytes);
    const asked = await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_01', level: 0, annotations: 'none' });
    expect(asked).toMatchObject({ ok: false, code: 'confirm', message: 'TS_01 is 536 MB decoded at these levels.' });
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
    const r = await v.api.run('cryoetPortal.load', { dataset: 1, run: 'TS_01', annotations: '9' });
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
