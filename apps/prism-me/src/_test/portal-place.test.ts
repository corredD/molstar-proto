/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { tiltSeriesMatrix } from '@molstar/cryoet-extension/portal';
import { Grid, type Volume } from '@molstar/model/model/volume';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MesoscaleExplorerExtensions } from '../extensions.js';

// A portal tilt series' Placement through the explorer's own stage (stage-tools' `stage.move`, review S5), on the
// shipped 10003 TS_08 index; every zarr served as one small OME-Zarr (4³ at 10, 20, 40 Å): nothing reaches the network.

const n = 4;
const zattrs = JSON.stringify({
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
});
const zarray = JSON.stringify({
  zarr_format: 2,
  shape: [n, n, n],
  chunks: [n, n, n],
  dtype: '<f4',
  compressor: null,
  fill_value: 0,
  order: 'C',
  filters: null,
  dimension_separator: '/',
});
const chunk = new Uint8Array(new Float32Array(n ** 3).map((_, i) => i % 7).buffer);

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

async function loaded() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
      const body = /\.zattrs$/.test(url)
        ? zattrs
        : /\/\d\/\.zarray$/.test(url)
          ? zarray
          : /\.zarr\/\d\/0\/0\/0$/.test(url)
            ? chunk
            : undefined;
      return body ? new Response(body, { status: 200 }) : new Response('not found', { status: 404 });
    }),
  );
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  const r = await v.api.run('cryoetPortal.load', {
    dataset: 10003,
    run: 'TS_08',
    annotations: 'none',
    as: 'slices',
    tiltSeries: 17086,
  });
  if (!r.ok) throw new Error(r.message);
  const [tomogram, ts] = v.plugin.managers.volume.hierarchy.current.volumes.map((x) => x.cell.transform.ref);
  const grid = (ref: string) => (v.plugin.state.data.cells.get(ref)!.obj!.data as Volume).grid;
  const at = (ref: string) => v.api.stage!.placementOf(ref)!.matrix;
  return { v, tomogram, ts, grid, at };
}

describe("a portal tilt series' Placement, by the explorer's stage", () => {
  it('switches beside, overlay, turned and back, each at its own matrix (the stage composes the moves)', async () => {
    const { v, tomogram, ts, grid, at } = await loaded();
    const portal = v.api.cryoetPortal!;
    // loaded under the tomogram: overlay is the default (Ludo, 2026-11-04)
    expect(portal.placeOf(ts)).toBe('overlay');
    expect(Mat4.areEqual(at(ts), tiltSeriesMatrix('overlay', grid(ts), -5, grid(tomogram)), 1e-6)).toBe(true);
    for (const place of ['beside', 'turned', 'overlay', 'beside', 'overlay'] as const) {
      const r = await v.api.run('cryoetPortal.place', { volume: ts, place });
      expect(r.ok).toBe(true);
      expect(Mat4.areEqual(at(ts), tiltSeriesMatrix(place, grid(ts), -5, grid(tomogram)), 1e-6)).toBe(true);
      expect(portal.placeOf(ts)).toBe(place);
    }
  });

  it('puts the overlay under the tomogram where it is, moved (review S3)', async () => {
    const { v, tomogram, ts, grid, at } = await loaded();
    const shift = Mat4.fromTranslation(Mat4(), Vec3.create(500, -300, 200));
    expect((await v.api.run('stage.move', { target: tomogram, matrix: Array.from(shift) })).ok).toBe(true);
    expect((await v.api.run('cryoetPortal.place', { volume: ts, place: 'overlay' })).ok).toBe(true);
    const center = (ref: string, m: Mat4) => Vec3.transformMat4(Vec3(), Grid.getBoundingSphere(grid(ref)).center, m);
    const s = center(ts, at(ts));
    const t = center(tomogram, at(tomogram));
    expect(s[0]).toBeCloseTo(t[0], 3);
    expect(s[1]).toBeCloseTo(t[1], 3);
    // its top at the moved tomogram's bottom (the tomogram's bottom was at 0)
    const half = (n * 40) / 2;
    expect(s[2] + half).toBeCloseTo(200, 3);
    expect(v.api.cryoetPortal!.placeOf(ts)).toBe('overlay');
  });

  it("follows a pixel size set on the tomogram, and on the series (each box as drawn, the series' kept)", async () => {
    const { v, tomogram, ts, grid, at } = await loaded();
    const center = (ref: string) => Vec3.transformMat4(Vec3(), Grid.getBoundingSphere(grid(ref)).center, at(ref));
    // the tomogram twice its pixel size: the overlay centered on it as drawn
    expect((await v.api.run('cryoet.volume', { volume: tomogram, pixelSize: 20 })).ok).toBe(true);
    expect((await v.api.run('cryoetPortal.place', { volume: ts, place: 'overlay' })).ok).toBe(true);
    expect(center(ts)[0]).toBeCloseTo(center(tomogram)[0], 3);
    expect(center(ts)[1]).toBeCloseTo(center(tomogram)[1], 3);
    // the series at 80 Å (8×): its top at the tomogram's bottom (0), its half height scaled by 8, its scale kept
    expect((await v.api.run('cryoet.volume', { volume: ts, pixelSize: 80 })).ok).toBe(true);
    expect((await v.api.run('cryoetPortal.place', { volume: ts, place: 'overlay' })).ok).toBe(true);
    // 80 Å over the series' finest voxel (10 Å)
    expect(v.api.stage!.scaleOf(ts)).toBe(8);
    expect(center(ts)[0]).toBeCloseTo(center(tomogram)[0], 3);
    expect(center(ts)[2] + (n * 40 * 8) / 2).toBeCloseTo(0, 3);
  });
});
