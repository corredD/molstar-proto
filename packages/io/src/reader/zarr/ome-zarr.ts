/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Task } from '@molstar/core/task';
import { utf8Read } from '@molstar/core/util/utf8';
import { ReaderResult as Result } from '../result.js';
import { readZarrArray } from './array.js';
import {
  type NgffLevel,
  type NgffMultiscale,
  parseNgffMultiscales,
  parseZarrArray,
  type ZarrArrayMeta,
  type ZarrTypedArray,
} from './metadata.js';
import type { ZarrStore } from './store.js';

/** One level of an OME-Zarr image: its NGFF placement and its array (zarr.md §4). */
export interface OmeZarrLevel extends NgffLevel {
  readonly array: ZarrArrayMeta;
  /** Voxels along x, y, z. */
  readonly size: readonly [number, number, number];
  /** Bytes of the level's voxels: the array reading it returns. */
  readonly bytes: number;
  /** Bytes of one decoded chunk: reading also holds one (zarr.md §5). */
  readonly chunkBytes: number;
}

/** An OME-Zarr image opened from a store: its metadata only; levels are read on demand (`readOmeZarrLevel`). */
export interface OmeZarrFile {
  readonly name: string;
  readonly store: ZarrStore;
  readonly multiscale: NgffMultiscale;
  /** Finest first. */
  readonly levels: readonly OmeZarrLevel[];
}

async function readJson(store: ZarrStore, key: string, ctx: Parameters<ZarrStore['get']>[1]) {
  const bytes = await store.get(key, ctx);
  if (!bytes) throw new Error(`Zarr: ${key} is missing`);
  try {
    return JSON.parse(utf8Read(bytes, 0, bytes.length));
  } catch {
    throw new Error(`Zarr: ${key} is not JSON`);
  }
}

function toResult<T>(e: unknown): Result<T> {
  if (Task.isAbort(e)) throw e;
  return Result.error(e instanceof Error ? e.message : String(e));
}

/**
 * Opens the OME-Zarr image at the root of `store`: its `.zattrs` (NGFF 0.4 `multiscales`) and each level's `.zarray`,
 * validated; no chunk is read.
 */
export function openOmeZarr(store: ZarrStore, name = ''): Task<Result<OmeZarrFile>> {
  return Task.create('Open OME-Zarr', async (ctx) => {
    try {
      await ctx.update('Reading OME-Zarr metadata...');
      const multiscale = parseNgffMultiscales(await readJson(store, '.zattrs', ctx));
      const arrays = await Promise.all(
        multiscale.levels.map(async (l) => parseZarrArray(await readJson(store, `${l.path}/.zarray`, ctx))),
      );
      const levels = multiscale.levels.map((l, i): OmeZarrLevel => {
        const array = arrays[i];
        if (array.shape.length !== multiscale.rank) {
          throw new Error(`Zarr: level ${l.path} has ${array.shape.length} axes, the multiscale ${multiscale.rank}`);
        }
        const [ax, ay, az] = multiscale.spaceAxes;
        const size = [array.shape[ax], array.shape[ay], array.shape[az]] as const;
        const chunkBytes = array.chunks.reduce((a, b) => a * b, 1) * array.dtype.size;
        return { ...l, array, size, bytes: size[0] * size[1] * size[2] * array.dtype.size, chunkBytes };
      });
      return Result.success({ name, store, multiscale, levels }, [...multiscale.warnings]);
    } catch (e) {
      return toResult(e);
    }
  });
}

/** Reads a level's voxels into one typed array, x fastest when the axes are z, y, x (zarr.md §5). */
export function readOmeZarrLevel(file: OmeZarrFile, level: OmeZarrLevel): Task<Result<ZarrTypedArray>> {
  return Task.create('Read OME-Zarr level', async (ctx) => {
    try {
      return Result.success(await readZarrArray(ctx, file.store, level.path, level.array));
    } catch (e) {
      return toResult(e);
    }
  });
}
