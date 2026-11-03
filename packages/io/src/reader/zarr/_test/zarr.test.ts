/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SyncRuntimeContext } from '@molstar/core/task/execution/synchronous';
import { DownloadStatusError } from '@molstar/core/util/data-source';
import { readZarrArray } from '../array.js';
import { parseNgffMultiscales, parseZarrArray } from '../metadata.js';
import { openOmeZarr, readOmeZarrLevel } from '../ome-zarr.js';
import { ZarrStore } from '../store.js';

const Fixtures = path.join(import.meta.dirname, 'fixtures');
const json = (...p: string[]) => JSON.parse(fs.readFileSync(path.join(Fixtures, ...p), 'utf8'));

/** The files under a fixture folder, by their '/'-separated path. */
function fixtureStore(dir: string) {
  const root = path.join(Fixtures, dir);
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const f of fs.readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    const p = path.join(root, f);
    if (fs.statSync(p).isFile()) files.set(f.split(path.sep).join('/'), new Uint8Array(fs.readFileSync(p)));
  }
  return ZarrStore.fromMap(files);
}

const zarray = (o: object) => ({
  zarr_format: 2,
  shape: [2, 3, 4],
  chunks: [2, 3, 4],
  dtype: '<f4',
  compressor: null,
  fill_value: 0,
  filters: null,
  order: 'C',
  ...o,
});

describe('parseZarrArray', () => {
  it('reads the TS_08 level-2 arrays of the CryoET Data Portal', () => {
    const t = parseZarrArray(json('ts08', 'tomogram-2.zarray'));
    expect(t.shape).toEqual([113, 232, 232]);
    expect(t.chunks).toEqual([256, 256, 256]);
    expect([t.dtype.name, t.dtype.size, t.dtype.littleEndian, t.dtype.ctor]).toEqual(['<f4', 4, true, Float32Array]);
    expect(t.compressor).toEqual({ id: 'blosc' });
    expect([t.fillValue, t.separator]).toEqual([0, '/']);
    const m = parseZarrArray(json('ts08', 'mask-2.zarray'));
    expect([m.dtype.ctor, m.dtype.isInteger]).toEqual([Int8Array, true]);
  });

  it("takes '.' as the separator when none is given, and NaN as a fill value", () => {
    const a = parseZarrArray(zarray({ fill_value: 'NaN' }));
    expect(a.separator).toBe('.');
    expect(a.fillValue).toBeNaN();
    expect(parseZarrArray(zarray({ dtype: '>u2', fill_value: null })).dtype.littleEndian).toBe(false);
  });

  it.each([
    [{ zarr_format: 3 }, 'zarr_format 3 is not supported'],
    [{ order: 'F' }, 'order "F" is not supported'],
    [{ filters: [{ id: 'delta' }] }, 'filters are not supported'],
    [{ dtype: '<c8' }, 'dtype "<c8" is not supported'],
    [{ dtype: '|f4' }, "'|' is for one byte"],
    [{ compressor: { id: 'zstd' } }, 'the "zstd" compressor is not supported'],
    [{ chunks: [2, 3] }, 'chunks do not match the shape'],
    [{ dimension_separator: '-' }, 'dimension_separator "-"'],
  ])('refuses %o', (o, message) => {
    expect(() => parseZarrArray(zarray(o))).toThrow(message);
  });
});

describe('parseNgffMultiscales', () => {
  it('reads the TS_08 tomogram: z, y, x in Å, three levels, no translation', () => {
    const ms = parseNgffMultiscales(json('ts08', 'tomogram.zattrs'));
    expect(ms.spaceAxes).toEqual([2, 1, 0]);
    expect(ms.levels.map((l) => [l.path, l.scale[0], l.translation])).toEqual([
      ['0', 6.802, [0, 0, 0]],
      ['1', 13.604, [0, 0, 0]],
      ['2', 27.208, [0, 0, 0]],
    ]);
    expect(ms.warnings).toEqual([]);
    expect(parseNgffMultiscales(json('ts08', 'mask.zattrs')).levels.length).toBe(3);
  });

  const attrs = (axes: unknown[], ds: object = {}, outer?: unknown[]) => ({
    multiscales: [
      {
        version: '0.4',
        axes,
        datasets: [
          {
            path: '0',
            coordinateTransformations: [
              { type: 'scale', scale: axes.map((_, i) => i + 1) },
              { type: 'translation', translation: axes.map((_, i) => 10 * (i + 1)) },
            ],
            ...ds,
          },
        ],
        coordinateTransformations: outer,
      },
    ],
  });
  const space = (name: string, unit?: string) => ({ name, type: 'space', unit });

  it('maps the axes to x, y, z, units to Å, and applies the multiscale transformations after the level', () => {
    const ms = parseNgffMultiscales(
      attrs(
        [{ name: 'c', type: 'channel' }, space('x', 'nanometer'), space('z', 'nanometer'), space('y', 'nanometer')],
        {},
        [
          { type: 'scale', scale: [1, 2, 2, 2] },
          { type: 'translation', translation: [0, 1, 1, 1] },
        ],
      ),
    );
    expect(ms.rank).toBe(4);
    expect(ms.spaceAxes).toEqual([1, 3, 2]);
    // x: (scale 2, translation 20) * 2 + 1, in nm, so 40 Å per voxel at 410 Å
    expect(ms.levels[0].scale).toEqual([40, 80, 60]);
    expect(ms.levels[0].translation).toEqual([410, 810, 610]);
  });

  it('warns of a missing unit, taken as Å', () => {
    const ms = parseNgffMultiscales(attrs([space('z'), space('y'), space('x')]));
    expect(ms.warnings).toEqual(['the space axes have no unit: taken as Å']);
    expect(ms.levels[0].scale).toEqual([3, 2, 1]);
  });

  it.each([
    [attrs([space('y'), space('x')]), '3 space axes'],
    [attrs([space('z'), space('y'), space('x'), { name: 't', type: 'time' }]), '3 space axes, the last of the array'],
    [attrs([space('z', 'parsec'), space('y', 'parsec'), space('x', 'parsec')]), 'unit "parsec" is not supported'],
    [attrs([space('z', 'nanometer'), space('y'), space('x')]), 'different units'],
    [attrs([space('z'), space('y'), space('w')]), 'space axis "w"'],
    [
      attrs([space('z'), space('y'), space('x')], { coordinateTransformations: [{ type: 'scale', path: 's.bin' }] }),
      "a 'path' to a file is not read",
    ],
    [{ multiscales: [] }, 'no NGFF multiscales'],
  ])('refuses %#', (a, message) => {
    expect(() => parseNgffMultiscales(a)).toThrow(message);
  });
});

/** The values of the `arrays/` fixtures: `(i % 50) - 7` over (3, 4, 5), unsigned + 7. */
function arrayValue(i: number, unsigned: boolean) {
  return (i % 50) - 7 + (unsigned ? 7 : 0);
}

describe('readZarrArray', () => {
  const store = fixtureStore('arrays');
  const read = async (name: string) => {
    const meta = parseZarrArray(json('arrays', name, '.zarray'));
    return readZarrArray(SyncRuntimeContext, store, name, meta);
  };

  it.each([
    ['f4-dot', Float32Array],
    ['be-f4', Float32Array],
    ['u2', Uint16Array],
    ['u1-raw', Uint8Array],
    ['i2-zlib', Int16Array],
    ['f4-gzip', Float32Array],
  ])('reads %s in C order, edge chunks cropped', async (name, ctor) => {
    const a = await read(name);
    expect(a).toBeInstanceOf(ctor);
    const unsigned = name.startsWith('u');
    expect(Array.from(a)).toEqual(Array.from({ length: 60 }, (_, i) => arrayValue(i, unsigned)));
  });

  it('gives the fill value where a chunk is missing', async () => {
    const a = await read('i2-fill');
    // chunk 0/0/0 holds z 0-1, y 0-2, x 0-3
    for (let i = 0; i < 60; i++) {
      const [z, y, x] = [Math.floor(i / 20), Math.floor(i / 5) % 4, i % 5];
      expect(a[i]).toBe(z < 2 && y < 3 && x < 4 ? -3 : arrayValue(i, false));
    }
  });

  it('refuses what it does not read before any chunk', () => {
    expect(() => parseZarrArray(json('arrays', 'fortran', '.zarray'))).toThrow('order "F"');
    expect(() => parseZarrArray(json('arrays', 'filters', '.zarray'))).toThrow('filters are not supported');
    expect(() => parseZarrArray(json('arrays', 'zstd', '.zarray'))).toThrow('"zstd" compressor');
  });

  it('reads whole rows of a chunk as one copy per plane, and refuses a shape that is not a volume', async () => {
    // 2 x 3 x 4, chunks 1 x 2 x 4 (rows whole), raw bytes, in memory
    const files = new Map<string, Uint8Array<ArrayBuffer>>();
    files.set('.zarray', new TextEncoder().encode(JSON.stringify(zarray({ chunks: [1, 2, 4], dtype: '|u1' }))));
    for (let cz = 0; cz < 2; cz++) {
      for (let cy = 0; cy < 2; cy++) {
        // a padded edge chunk: y 2-3 of which only y 2 is in the array
        const chunk = new Uint8Array(8).map((_, k) => cz * 12 + (cy * 2 + Math.floor(k / 4)) * 4 + (k % 4));
        files.set(`${cz}.${cy}.0`, chunk);
      }
    }
    const meta = parseZarrArray(zarray({ chunks: [1, 2, 4], dtype: '|u1' }));
    const a = await readZarrArray(SyncRuntimeContext, ZarrStore.fromMap(files), '', meta);
    expect(Array.from(a)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    await expect(
      readZarrArray(
        SyncRuntimeContext,
        ZarrStore.fromMap(files),
        '',
        parseZarrArray(zarray({ shape: [3, 4], chunks: [3, 4] })),
      ),
    ).rejects.toThrow('is not a volume');
  });
});

describe('ZarrStore.fromUrl', () => {
  const failing = (status: number) =>
    ZarrStore.fromUrl('https://example.org/a.zarr/', async (url) => {
      throw Object.assign(new DownloadStatusError(status), { url });
    });

  it('takes a 404 as a missing key, and nothing else', async () => {
    expect(await failing(404).get('0/0/0', SyncRuntimeContext)).toBeUndefined();
    await expect(failing(403).get('0/0/0', SyncRuntimeContext)).rejects.toThrow('status code 403');
  });

  it('reads a key under the root, with no trailing slash doubled', async () => {
    const urls: string[] = [];
    const store = ZarrStore.fromUrl('https://example.org/a.zarr/', async (url) => {
      urls.push(url);
      return new Uint8Array(1);
    });
    await store.get('2/.zarray', SyncRuntimeContext);
    expect(urls).toEqual(['https://example.org/a.zarr/2/.zarray']);
  });
});

/** The voxel values of `multiscale.zarr` (make-fixtures.py `level_values`). */
function levelValue(level: number, z: number, y: number, x: number) {
  if (level === 0 && z < 4 && y < 5 && x >= 6 && x < 12) return 0;
  return 100 * z + 10 * y + x + level * 1000;
}

describe('openOmeZarr', () => {
  it('opens the levels of a multiscale, in Å, and reads each with its missing chunk as fill', async () => {
    const r = await openOmeZarr(fixtureStore('multiscale.zarr'), 'synthetic').run();
    if (r.isError) throw new Error(r.message);
    const file = r.result;
    expect(file.levels.map((l) => [l.path, l.size, l.scale, l.translation, l.bytes])).toEqual([
      ['0', [14, 11, 9], [25, 25, 25], [300, 200, 100], 14 * 11 * 9 * 4],
      ['1', [7, 6, 5], [50, 50, 50], [312.5, 212.5, 112.5], 7 * 6 * 5 * 4],
      ['2', [4, 3, 3], [100, 100, 100], [337.5, 237.5, 137.5], 4 * 3 * 3 * 4],
    ]);
    for (const [li, level] of file.levels.entries()) {
      const data = await readOmeZarrLevel(file, level).run();
      if (data.isError) throw new Error(data.message);
      const [X, Y, Z] = level.size;
      const want = new Float32Array(X * Y * Z);
      for (let z = 0; z < Z; z++)
        for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) want[(z * Y + y) * X + x] = levelValue(li, z, y, x);
      expect(data.result).toEqual(want);
    }
  });

  it('gives what is wrong as an error result', async () => {
    const r = await openOmeZarr(fixtureStore('arrays'), 'x').run();
    expect(r.isError && r.message).toBe('Zarr: .zattrs is missing');
  });
});
