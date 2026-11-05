/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mat4, Quat, Tensor } from '@molstar/core/math/linear-algebra';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type { Grid } from '@molstar/model/model/volume';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { EmpiarExtension, readAngles } from '../empiar.js';
import {
  ebiSpeedWarning,
  ebiTime,
  EmpiarFiles,
  empiarIdOf,
  kindOf,
  type ListingRow,
  listingBytes,
  parseListing,
  readEmpiarEntry,
  stemOf,
  totalLabel,
  walkCondition,
} from '../empiar-entry.js';
import { particleListData } from '../operations.js';
import { CryoetExtension } from '../prism-viewer.js';

// EMPIAR by id (_spec/empiar.md) over EMPIAR-12534's API reply and folder listings, recorded once by curl (2026-11-04)
// in `empiar-12534/` (a listing's path, its slashes as `~`), served by a stubbed `fetch`: nothing reaches the network.
// The tomogram and the mask are 4³ maps; the STAR is the file's header and 7 of its rows (4 of YTC041_1_lam1_1_ts_003).

const dir = new URL('./empiar-12534/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, dir));
const Run = 'YTC041_1_lam1_1_ts_003';

/** A 4³ map: a tomogram, or a mask (0 outside, 1 in a 2³ block) */
function map(mask: boolean) {
  const values = new Float32Array(64).fill(mask ? 0 : 1);
  for (const i of [21, 22, 25, 26, 37, 38, 41, 42]) values[i] = mask ? 1 : -1;
  const grid: Grid = {
    transform: { kind: 'matrix', matrix: Mat4.fromScaling(Mat4(), [9.98, 9.98, 9.98]) },
    cells: Tensor.create(Tensor.Space([4, 4, 4], [2, 1, 0], Float32Array), Tensor.Data1(values)),
    stats: { min: Math.min(...values), max: Math.max(...values), mean: 0, sigma: 1 },
  };
  return CCP4Writer.writeMrc(grid, values);
}

/** The fixture a request names: the API's entry, a listing by its path, the STAR, the maps */
function body(url: string): BodyInit | null {
  if (url === 'https://www.ebi.ac.uk/empiar/api/entry/EMPIAR-12534/') return fixture('entry.json');
  if (!url.startsWith(`${EmpiarFiles}12534/`)) return null;
  const path = url.slice(`${EmpiarFiles}12534/`.length);
  if (path.endsWith('/')) {
    const name = `${
      path
        .slice(0, -1)
        .replace(/^data\/?/, '')
        .replace(/\//g, '~') || 'data'
    }.html`;
    return readdirSync(dir).includes(name) ? fixture(name) : null;
  }
  if (path.endsWith('co-translation_ribosome_CHX.star')) return fixture('co-translation_ribosome_CHX.star');
  if (path.endsWith('.star')) return fixture('80S_ribosome_CHX.star');
  if (path.endsWith('.rawtlt')) return fixture(`${Run}.mrc.rawtlt`);
  if (path.endsWith('_labels.mrc')) return map(true);
  if (path.endsWith('.mrc')) return map(false);
  return null;
}

function serve(own: (url: string) => BodyInit | null | undefined = () => undefined) {
  const stub = vi.fn(async (input: string | URL | Request) => {
    const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
    // a test's own answer first: undefined passes to the fixtures, null is a 404
    const o = own(url);
    const b = o === undefined ? body(url) : o;
    return b ? new Response(b, { status: 200 }) : new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', stub);
  return stub;
}

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), CryoetExtension, EmpiarExtension] },
  });
  viewers.push(v);
  return v;
}

async function until(check: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

describe('the EMPIAR entry, parsed', () => {
  it('reads the API: title, EMDB cross-references, image sets, the two conditions', () => {
    const e = readEmpiarEntry(12534, JSON.parse(fixture('entry.json').toString()));
    expect(e.title).toMatch(/^Cytoplasmic ribosomes on mitochondria/);
    expect(e.emdb).toEqual(['EMD-48752', 'EMD-48751']);
    expect(e.conditions).toEqual(['data/EMPIAR_upload', 'data/EMPIAR_upload_nonCHX']);
    expect(e.segmentations).toContain('data/EMPIAR_upload/Voxel_segmentations');
    expect(e.imageSets.find((s) => s.category === 'reconstructed volumes')?.pixelSize).toBe(9.98);
    expect(() => readEmpiarEntry(1, {})).toThrow(/no entry EMPIAR-1/);
  });

  it("reads a listing's rows and sizes (binary units), not the sort links or the parent; a page not a listing fails", () => {
    const rows = parseListing(fixture('EMPIAR_upload~Reconstructed_tomograms~YTC041_1.html').toString());
    expect(rows.length).toBe(24);
    expect(rows[0]).toEqual({
      name: `${Run}.mrc_9.98Apx.mrc`,
      folder: false,
      size: '834M',
      bytes: 834 * 1024 ** 2,
    });
    expect(parseListing(fixture('EMPIAR_upload.html').toString()).map((r) => r.name)).toEqual([
      'Frames',
      'PACE_mdocs',
      'Particle_lists',
      'Reconstructed_tomograms',
      'Surfaces',
      'Tilt_series',
      'Tilt_series_rawtlt',
      'Voxel_segmentations',
    ]);
    expect([listingBytes('3.3G'), listingBytes('493K'), listingBytes('165'), listingBytes('-')]).toEqual([
      Math.round(3.3 * 1024 ** 3),
      493 * 1024,
      165,
      undefined,
    ]);
    expect(() => parseListing('<html><title>Not found</title></html>')).toThrow(/Not a folder listing/);
  });

  // night review B3: the total was MiB written MB, the guard 512e6 bytes: 489 MiB read "489 MB" and was refused over "512 MB"
  it('says MB of 10^6 bytes as the guard counts them, the listing as the same unit', () => {
    expect(totalLabel(listingBytes('489M')!)).toBe('513 MB');
    expect(listingBytes('489M')!).toBeGreaterThan(512e6);
    expect(totalLabel(listingBytes('834M')!)).toBe('875 MB');
    expect(totalLabel(493 * 1024)).toBe('505 kB');
    expect(totalLabel(165)).toBe('165 B');
  });

  it("estimates EBI's time for a pick above a few MB, none below (Ludo: a warning on EMPIAR's speed)", () => {
    expect(ebiSpeedWarning(834 * 1024 ** 2)).toBe(
      "875 MB from EBI: about 1–2 h at its usual speed (EMPIAR's server is often slow, 0.1–0.2 MB/s).",
    );
    expect(ebiTime(60 * 1024 ** 2)).toBe('about 5–10 min');
    expect(ebiTime(500 * 1024 ** 2)).toBe('about 44 min–1 h');
    expect(ebiSpeedWarning(493 * 1024)).toBeUndefined();
    expect(ebiSpeedWarning(0)).toBeUndefined();
  });

  it('keys a run by its exact stem, a segmentation suffix off; reads an id and a .rawtlt', () => {
    expect(stemOf(`${Run}.mrc_9.98Apx.mrc`)).toBe(Run);
    expect(stemOf(`${Run}_labels.hff`)).toBe(Run);
    expect(stemOf(`${Run}.mrc.tomostar`)).toBe(Run);
    expect([empiarIdOf('EMPIAR-12534'), empiarIdOf('12534'), empiarIdOf(' empiar-7 '), empiarIdOf('x')]).toEqual([
      12534,
      12534,
      7,
      undefined,
    ]);
    const angles = readAngles(fixture(`${Run}.mrc.rawtlt`).toString());
    expect([angles.length, Math.min(...angles), Math.max(...angles)]).toEqual([38, -57, 54]);
  });
});

describe('kinds and folders by their own names (review S3, N7)', () => {
  const entry = readEmpiarEntry(1, {
    'EMPIAR-1': {
      title: 't',
      imagesets: [{ directory: 'data/Frameshift/unlabelled_tomos', category: 'reconstructed volumes', name: 'n' }],
    },
  });

  it("takes a tomogram by its image set before its folder's words", () => {
    expect(kindOf(entry, 'data/Frameshift/unlabelled_tomos/G1', 'TS_01.mrc')).toBe('tomogram');
    // words in the folder's own name only, not its parents'
    expect(kindOf(entry, 'data/Masked_lamellae/maps/G1', 'TS_01.mrc')).toBe('volume');
    expect(kindOf(entry, 'data/x/Voxel_labels', 'TS_01.mrc')).toBe('mask');
  });

  it('skips a frames folder by its own name, not a parent whose name holds the word', async () => {
    const rows: Record<string, ListingRow[]> = {
      'data/Frameshift': [
        { name: 'unlabelled_tomos', folder: true, size: '' },
        { name: 'Frames', folder: true, size: '' },
      ],
      'data/Frameshift/unlabelled_tomos': [{ name: 'G1', folder: true, size: '' }],
    };
    const c = await walkCondition(entry, 'data/Frameshift', async (f) => rows[f] ?? Promise.reject(new Error(f)));
    expect(c.grids).toEqual(['G1']);
  });
});

describe('empiar, walked', () => {
  it('lists the two conditions and their grids (CHX 5, vehicle 2), reading no frames folder and changing nothing', async () => {
    const fetch = serve();
    const v = await viewer();
    const r = await v.api.run('empiar.entry', { id: 12534 });
    expectOk(r);
    const { conditions } = r.value as { conditions: { root: string; grids: string[] }[] };
    expect(conditions.map((c) => [c.root, c.grids])).toEqual([
      ['data/EMPIAR_upload', ['YTC041_1', 'YTC041_2', 'YTC042_2', 'YTC043_1', 'YTC043_2']],
      ['data/EMPIAR_upload_nonCHX', ['YTC009_3', 'YTC025_2']],
    ]);
    expect(r.did).toContain('EMDB: EMD-48752, EMD-48751');
    expect(fetch.mock.calls.map((c) => String(c[0])).filter((u) => /Frames/.test(u))).toEqual([]);
    expect(v.plugin.state.data.cells.size).toBe(1);
  });

  it("groups a grid's files into runs, each file once: what loads checked by kind, the rest saying why", async () => {
    serve();
    const v = await viewer();
    const r = await v.api.run('empiar.entry', { id: 12534, condition: 'data/EMPIAR_upload', grid: 'YTC041_1' });
    expectOk(r);
    const g = r.value as { runs: { stem: string; files: { name: string; kind: string; why?: string }[] }[] };
    expect(g.runs.length).toBe(24);
    // the grid's 6 folders, 24 files each, and the condition's 2 particle lists with every run
    const own = g.runs.flatMap((x) => x.files.filter((f) => f.kind !== 'particles').map((f) => f.name));
    expect(own.length).toBe(144);
    expect(new Set(own).size).toBe(144);
    const run = g.runs.find((x) => x.stem === Run)!;
    expect(run.files.map((f) => [f.kind, f.why === undefined])).toEqual([
      ['metadata', false],
      ['tomogram', true],
      ['surfaces', false],
      ['tilt-series', false],
      ['angles', false],
      ['mask', true],
      ['particles', true],
      ['particles', true],
    ]);
    expect(run.files.find((f) => f.kind === 'surfaces')?.why).toMatch(/EMDB-SFF/);
    expect(run.files.find((f) => f.kind === 'tilt-series')?.why).toMatch(/^too large to read whole in a tab/);
  });
});

describe('empiar reads', () => {
  it('asks again for a read that failed (review S8): a failure is not kept', async () => {
    let failed = 0;
    serve((url) => (url.includes('/api/entry/') && !failed++ ? null : undefined));
    const v = await viewer();
    expect(await v.api.run('empiar.entry', { id: 12534 })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/404/),
    });
    expectOk(await v.api.run('empiar.entry', { id: 12534 }));
  });
});

describe('empiar.load', () => {
  const load = { id: 12534, run: Run, files: `${Run}.mrc_9.98Apx.mrc,${Run}_labels.mrc,80S_ribosome_CHX.star` };

  it('asks first above the size threshold, by the listing sizes', async () => {
    serve();
    const v = await viewer();
    const r = await v.api.run('empiar.load', { ...load, emdb: 'none' });
    expect(r).toMatchObject({ ok: false, code: 'confirm' });
    expect((r as { message: string }).message).toBe(
      `${Run}: 1.3 GB to read whole (tomogram 875 MB, mask 437 MB, particles 13 MB). From EBI: about 2–4 h at its usual speed.`,
    );
    expect(v.plugin.state.data.cells.size).toBe(1);
  });

  it("loads the run's tomogram (slices), mask (a surface at 0.5) and particles (its rows only) in one step", async () => {
    serve();
    const v = await viewer();
    const steps = async () => ((await v.api.run('history.list', {})) as { value: unknown[] }).value.length;
    const before = await steps();
    const r = await v.api.run('empiar.load', { ...load, emdb: 'none', large: true });
    expectOk(r);
    expect(r.warnings ?? []).toEqual([]);
    const [tomogram, mask] = v.plugin.managers.volume.hierarchy.current.volumes;
    const types = (x: typeof tomogram) => x.representations.map((y) => (y.cell.transform.params as any).type.name);
    expect(types(tomogram)).toEqual(['slice', 'slice', 'slice']);
    expect(types(mask)).toEqual(['isosurface']);
    expect((mask.representations[0].cell.transform.params as any).type.params.isoValue).toEqual({
      kind: 'absolute',
      absoluteValue: 0.5,
    });
    const [list] = v.plugin.managers.particles.hierarchy.current.lists;
    const data = particleListData({ plugin: v.plugin }, list.cell.transform.ref) as ParticleList;
    expect(data.count).toBe(4);
    expect(await steps()).toBe(before + 1);
  });

  // Undone with its particles too, the scene's sync reads the removed list (prism-viewer `sources/scene.ts`,
  // `particleListData` on a stale hierarchy: an unhandled TypeError, the scene otherwise right); a library fix of its own
  it('is undone in one step', async () => {
    serve();
    const v = await viewer();
    const files = `${Run}.mrc_9.98Apx.mrc,${Run}_labels.mrc`;
    expectOk(await v.api.run('empiar.load', { ...load, files, emdb: 'none', large: true }));
    expect(v.plugin.managers.volume.hierarchy.current.volumes.length).toBe(2);
    expectOk(await v.api.run('history.undo', {}));
    expect(v.plugin.state.data.cells.size).toBe(1);
  });

  // The frame measured on the 834 MB tomogram (_spec/empiar.md §3): EMD-48752 placed at the run's 233 particles by the
  // reader's rotation correlates at 0.336 (its transpose 0.235, random rotations 0.226, mirrored 0.232; the points at
  // twice the scale, flipped in z or random: under 0.04). Particle 26 of the run (CC 0.55), its numbers from that check.
  it('puts a known particle where the tomogram has it: Å by rlnPixelSize (4.99), RELION ZYZ turned as measured', async () => {
    serve();
    const v = await viewer();
    expectOk(await v.api.run('empiar.load', { ...load, files: '80S_ribosome_CHX.star', emdb: 'none' }));
    const [list] = v.plugin.managers.particles.hierarchy.current.lists;
    const data = particleListData({ plugin: v.plugin }, list.cell.transform.ref) as ParticleList;
    const i = 3;
    const p = Array.from(data.coordinates.slice(3 * i, 3 * i + 3));
    [2379.28, 2552.93, 1558.01].forEach((x, k) => expect(p[k]).toBeCloseTo(x, 1));
    // in the tomogram's voxels of 9.98 Å: inside its 682×960×334
    expect(p.map((x) => Math.round(x / 9.98))).toEqual([238, 256, 156]);
    const m = Mat4.fromQuat(Mat4(), Quat.fromArray(Quat(), data.rotations!, 4 * i));
    // A = (Rz(rot) Ry(tilt) Rz(psi))ᵀ for 131.40691, 62.00625, 103.05999 (numpy), rows as rows
    const A = [
      [-0.66048, -0.72385, 0.19953],
      [0.4719, -0.19348, 0.86016],
      [-0.58402, 0.66228, 0.46938],
    ];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) expect(m[c * 4 + r]).toBeCloseTo(A[r][c], 4);
  });

  // review N1: the STAR is the condition's, shared by its runs; `load.url` found it loaded by its address and made no
  // list for the second run ("has no particles of" it, a false warning)
  it("loads a second run's particles from the condition's STAR already loaded for the first, in its own list", async () => {
    serve();
    const v = await viewer();
    const files = '80S_ribosome_CHX.star';
    expectOk(await v.api.run('empiar.load', { ...load, files, emdb: 'none' }));
    const steps = async () => ((await v.api.run('history.list', {})) as { value: unknown[] }).value.length;
    const before = await steps();
    const r = await v.api.run('empiar.load', { id: 12534, run: 'YTC041_1_lam1_2_ts_002', files, emdb: 'none' });
    expectOk(r);
    expect(r.warnings ?? []).toEqual([]);
    expect(await steps()).toBe(before + 1);
    const counts = v.plugin.managers.particles.hierarchy.current.lists.map(
      (l) => (particleListData({ plugin: v.plugin }, l.cell.transform.ref) as ParticleList).count,
    );
    expect(counts).toEqual([4, 1]);
  });

  it('says a run whose particles are in the scene already loaded, and adds no list', async () => {
    serve();
    const v = await viewer();
    const files = '80S_ribosome_CHX.star';
    expectOk(await v.api.run('empiar.load', { ...load, files, emdb: 'none' }));
    const r = await v.api.run('empiar.load', { ...load, files, emdb: 'none' });
    expect(r).toMatchObject({ ok: true, did: expect.stringMatching(/already loaded/) });
    expect(JSON.stringify(r)).not.toMatch(/has no particles/);
    expect(v.plugin.managers.particles.hierarchy.current.lists.length).toBe(1);
  });

  // review N2: a run loaded again added its tomogram again (a raw `Download`, no identity), read from EBI again first
  it('says a file of the run in the scene already loaded: not read again, not added again; the rest loads', async () => {
    const fetch = serve();
    const v = await viewer();
    const tomogram = `${Run}.mrc_9.98Apx.mrc`;
    expectOk(await v.api.run('empiar.load', { ...load, files: tomogram, emdb: 'none', large: true }));
    const r = await v.api.run('empiar.load', { ...load, files: tomogram, emdb: 'none', large: true });
    expect(r).toMatchObject({ ok: true, did: `${tomogram} is already loaded.` });
    expect(v.plugin.managers.volume.hierarchy.current.volumes.length).toBe(1);
    expect(fetch.mock.calls.filter((c) => String(c[0]).endsWith(tomogram)).length).toBe(1);
    // with a file not loaded yet: that one loads, the other said; the size guard counts only what is read
    const mask = `${Run}_labels.mrc`;
    const both = await v.api.run('empiar.load', { ...load, files: `${tomogram},${mask}`, emdb: 'none' });
    expectOk(both);
    expect(both.warnings).toEqual([`${tomogram} is already loaded.`]);
    expect(v.plugin.managers.volume.hierarchy.current.volumes.length).toBe(2);
  });

  it("says when a list has none of the run's particles, and leaves nothing of it", async () => {
    serve((url) =>
      url.endsWith('.star') ? fixture('80S_ribosome_CHX.star').toString().replaceAll(Run, 'other') : undefined,
    );
    const v = await viewer();
    const r = await v.api.run('empiar.load', {
      ...load,
      files: `${Run}.mrc_9.98Apx.mrc,80S_ribosome_CHX.star`,
      large: true,
      emdb: 'none',
    });
    expectOk(r);
    expect(r.warnings).toEqual([`80S_ribosome_CHX.star has no particles of ${Run}.`]);
    expect(v.plugin.managers.particles.hierarchy.current.lists.length).toBe(0);
    expect(v.plugin.managers.volume.hierarchy.current.volumes.length).toBe(1);
  });

  it("keeps the particles when the entry's first EMDB average cannot be fetched: a warning, spheres", async () => {
    const fetch = serve();
    const v = await viewer();
    const r = await v.api.run('empiar.load', { ...load, files: '80S_ribosome_CHX.star' });
    expectOk(r);
    expect(fetch.mock.calls.map((c) => String(c[0]))).toContain(
      'https://www.ebi.ac.uk/pdbe/densities/emd/emd-48752/cell?detail=3',
    );
    expect(r.warnings?.join(' ')).toMatch(/^EMD-48752: .*404/);
    const [list] = v.plugin.managers.particles.hierarchy.current.lists;
    const spheres = list.representations.filter((x) => x.cell.transform.params?.type.name === 'spacefill');
    expect(spheres.map((x) => (x.cell.transform.params?.sizeTheme.params as any).defaultSize)).toEqual([50]);
  });

  it("loads a small tilt series as its Z slice, its angles from the run's .rawtlt on the Slice row", async () => {
    // 12534's are 3.3 GB (greyed): the listing made small, the stack a 4³ map
    serve((url) =>
      url.endsWith('/Tilt_series/YTC041_1/')
        ? fixture('EMPIAR_upload~Tilt_series~YTC041_1.html').toString().replaceAll('3.3G', '9.9M')
        : url.endsWith('.mrc.st')
          ? map(false)
          : undefined,
    );
    const v = await viewer();
    const r = await v.api.run('empiar.load', { ...load, files: `${Run}.mrc.st`, emdb: 'none' });
    expectOk(r);
    const [ts] = v.plugin.managers.volume.hierarchy.current.volumes;
    const params = ts.representations.map((x) => x.cell.transform.params as any);
    expect(params.map((p) => p.type.name)).toEqual(['slice']);
    expect(params[0].type.params.dimension.name).toBe('z');
    const angles = v.api.empiar!.tiltAnglesOf(ts.cell.transform.ref)!;
    expect([angles.length, Math.min(...angles), Math.max(...angles)]).toEqual([38, -57, 54]);
  });

  it('says why a file could not be read, and leaves nothing (review S4)', async () => {
    serve((url) => (url.endsWith('_labels.mrc') ? null : undefined));
    const v = await viewer();
    const r = await v.api.run('empiar.load', { ...load, emdb: 'none', large: true });
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/_labels\.mrc.*404/) });
    expect(v.plugin.state.data.cells.size).toBe(1);
  });

  // RELION 3.1 (an optics block, rlnPixelSize 3.33, rlnOriginXAngst): its picks are 80S picks, so its Å must be theirs
  it("reads the co-translation STAR in its own pixels: a pick lands on the run's 80S pick (review S8)", async () => {
    serve();
    const v = await viewer();
    const files = 'co-translation_ribosome_CHX.star';
    expectOk(await v.api.run('empiar.load', { ...load, files, emdb: 'none' }));
    const [list] = v.plugin.managers.particles.hierarchy.current.lists;
    const data = particleListData({ plugin: v.plugin }, list.cell.transform.ref) as ParticleList;
    expect(data.count).toBe(2);
    // 1464.73438 × 3.33 less its origin shift (−0.905 Å); the 80S file's pick (977.47, 696.42, 293.66) × 4.99
    const p = Array.from(data.coordinates.slice(0, 3));
    [4877.57, 3475.15, 1465.34].forEach((x, k) => expect(Math.abs(p[k] - x)).toBeLessThan(1));
  });

  it("keeps a run's rows by rlnTomoName when the file names tomograms (review S8)", async () => {
    const star = [
      'data_particles',
      'loop_',
      '_rlnTomoName',
      '_rlnCoordinateX',
      '_rlnCoordinateY',
      '_rlnCoordinateZ',
      '_rlnPixelSize',
      `${Run} 1 2 3 4.99`,
      `${Run} 4 5 6 4.99`,
      'YTC041_1_lam1_2_ts_002 7 8 9 4.99',
      '',
    ].join('\n');
    serve((url) => (url.endsWith('80S_ribosome_CHX.star') ? star : undefined));
    const v = await viewer();
    expectOk(await v.api.run('empiar.load', { ...load, files: '80S_ribosome_CHX.star', emdb: 'none' }));
    const [list] = v.plugin.managers.particles.hierarchy.current.lists;
    const data = particleListData({ plugin: v.plugin }, list.cell.transform.ref) as ParticleList;
    expect(data.count).toBe(2);
    expect(Array.from(data.coordinates.slice(3, 6)).map((x) => Math.round(x * 100) / 100)).toEqual([
      19.96, 24.95, 29.94,
    ]);
  });

  // The history runs its steps one at a time: a download from EBI inside the step (hours for a tomogram) held every
  // other edit (night review B2). The files are fetched first, outside it; the step builds from memory.
  it('downloads outside the history step: another edit goes on while a file is read, with its progress', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const stub = serve();
    const plain = stub.getMockImplementation()!;
    stub.mockImplementation(async (input) => {
      if (String(input).endsWith('80S_ribosome_CHX.star')) await gate;
      return plain(input);
    });
    const v = await viewer();
    const slow = v.api.run('empiar.load', { ...load, files: '80S_ribosome_CHX.star', emdb: 'none' });
    await until(() => !!v.api.empiar!.fetching.value);
    expect(v.api.empiar!.fetching.value).toMatchObject({ name: 'particles 80S_ribosome_CHX.star', index: 0, count: 1 });
    expectOk(await v.api.run('empiar.load', { ...load, files: `${Run}.mrc_9.98Apx.mrc`, emdb: 'none', large: true }));
    expect(v.plugin.managers.particles.hierarchy.current.lists.length).toBe(0);
    release();
    expectOk(await slow);
    expect(v.plugin.managers.particles.hierarchy.current.lists.length).toBe(1);
    expect(v.api.empiar!.fetching.value).toBeUndefined();
  });

  it('stops a download when cancelled, even a stalled one: nothing changed, no step', async () => {
    const stub = serve();
    const plain = stub.getMockImplementation()!;
    stub.mockImplementation(async (input, init?: RequestInit) => {
      if (!String(input).endsWith('80S_ribosome_CHX.star')) return plain(input);
      // the server never answers: only the signal ends it
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true }),
      );
    });
    const v = await viewer();
    const steps = async () => ((await v.api.run('history.list', {})) as { value: unknown[] }).value.length;
    const before = await steps();
    const stop = new AbortController();
    const files = '80S_ribosome_CHX.star';
    const r = v.api.run('empiar.load', { ...load, files, emdb: 'none' }, { signal: stop.signal });
    await until(() => !!v.api.empiar!.fetching.value);
    stop.abort();
    expect(await r).toMatchObject({ ok: false, code: 'aborted' });
    expect(v.plugin.state.data.cells.size).toBe(1);
    expect(await steps()).toBe(before);
    expect(v.api.empiar!.fetching.value).toBeUndefined();
  });

  /** `name`'s answer held until `release`; its request's signal ends it */
  function gated(stub: ReturnType<typeof serve>, name: string) {
    const plain = stub.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    stub.mockImplementation(async (input, init?: RequestInit) => {
      if (!String(input).endsWith(name)) return plain(input);
      await new Promise<void>((res, rej) => {
        gate.then(res);
        init?.signal?.addEventListener('abort', () => rej(init.signal!.reason), { once: true });
      });
      return plain(input);
    });
    const urls = () => stub.mock.calls.map((c) => String(c[0])).filter((u) => u.endsWith(name));
    return { release, fetches: () => urls().length, url: () => urls()[0] };
  }

  // review F3c: the first load's `finally` let go of a large file another load shares, its step still queued: that
  // step's `Download` read it from the network again, inside the history step (night review B2 back)
  it('keeps a large file two loads share until the last one has built: one fetch, none inside a step', async () => {
    const stub = serve();
    const tomogram = `${Run}.mrc_9.98Apx.mrc`;
    const g = gated(stub, tomogram);
    const v = await viewer();
    const one = { ...load, files: tomogram, emdb: 'none', large: true };
    const a = v.api.run('empiar.load', one);
    await until(() => !!v.api.empiar!.fetching.value);
    const b = v.api.run('empiar.load', one);
    await new Promise((r) => setTimeout(r, 20));
    g.release();
    expectOk(await a);
    expect((await b).ok).toBe(true);
    expect(g.fetches()).toBe(1);
    // let go once the last load has built
    expect(v.plugin.managers.asset.tryFindUrl(g.url())).toBeUndefined();
  });

  // review F3a: the shared download was bound to the first load's signal: cancelling it failed the other load ("Could
  // not read … aborted"); cancelling the other did nothing until the first ended
  it('cancels only the load whose signal ends: a shared download goes on for the other', async () => {
    const stub = serve();
    const files = '80S_ribosome_CHX.star';
    const g = gated(stub, files);
    const v = await viewer();
    const two = { id: 12534, run: 'YTC041_1_lam1_2_ts_002', files, emdb: 'none' };
    const stopA = new AbortController();
    const a = v.api.run('empiar.load', { ...load, files, emdb: 'none' }, { signal: stopA.signal });
    await until(() => !!v.api.empiar!.fetching.value);
    const stopB = new AbortController();
    const b = v.api.run('empiar.load', two, { signal: stopB.signal });
    const stopC = new AbortController();
    let cDone = false;
    const c = v.api.run('empiar.load', two, { signal: stopC.signal }).finally(() => (cDone = true));
    await new Promise((r) => setTimeout(r, 20));
    stopA.abort();
    expect(await a).toMatchObject({ ok: false, code: 'aborted' });
    // C ends at its own cancel, the download still under way for B
    stopC.abort();
    await until(() => cDone);
    expect(await c).toMatchObject({ ok: false, code: 'aborted' });
    g.release();
    expectOk(await b);
    expect(g.fetches()).toBe(1);
    expect(v.plugin.managers.particles.hierarchy.current.lists.length).toBe(1);
  });

  // review F3b: one download's end cleared the progress while another was still under way
  it('shows the latest download under way until none is: one ending leaves the other', async () => {
    const stub = serve();
    const first = gated(stub, '80S_ribosome_CHX.star');
    const second = gated(stub, 'co-translation_ribosome_CHX.star');
    const v = await viewer();
    const fetching = () => v.api.empiar!.fetching.value;
    const a = v.api.run('empiar.load', { ...load, files: '80S_ribosome_CHX.star', emdb: 'none' });
    await until(() => !!fetching());
    const b = v.api.run('empiar.load', { ...load, files: 'co-translation_ribosome_CHX.star', emdb: 'none' });
    await until(() => fetching()?.name === 'particles co-translation_ribosome_CHX.star');
    first.release();
    expectOk(await a);
    expect(fetching()?.name).toBe('particles co-translation_ribosome_CHX.star');
    second.release();
    expectOk(await b);
    expect(fetching()).toBeUndefined();
  });

  // night review S3-like inconsistency: a named file that cannot load failed the whole load, where the portal warns
  it('warns of a named file that cannot load and loads the rest, as the portal does', async () => {
    serve();
    const v = await viewer();
    const r = await v.api.run('empiar.load', {
      ...load,
      files: `${Run}_labels.hff,80S_ribosome_CHX.star`,
      emdb: 'none',
    });
    expect(r).toMatchObject({ ok: true, warnings: [expect.stringMatching(/_labels\.hff cannot load: .*EMDB-SFF/)] });
    expect((r as { did: string }).did).toContain('80S_ribosome_CHX.star');
  });

  it('says why when the only file named cannot load', async () => {
    serve();
    const v = await viewer();
    const r = await v.api.run('empiar.load', { id: 12534, run: Run, files: `${Run}_labels.hff` });
    expect(r).toMatchObject({
      ok: false,
      message: `Nothing of ${Run} could be loaded.`,
      hint: expect.stringMatching(/EMDB-SFF/),
    });
  });
});
