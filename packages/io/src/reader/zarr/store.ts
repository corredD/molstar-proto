/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { RuntimeContext } from '@molstar/core/task';
import { DownloadStatusError, fetchData } from '@molstar/core/util/data-source';

/** Where a Zarr hierarchy's keys are read (zarr.md §1). */
export interface ZarrStore {
  /** The bytes of `key` ('/'-separated, from the root), or `undefined` when the store does not hold it. */
  get(key: string, ctx: RuntimeContext): Promise<Uint8Array<ArrayBuffer> | undefined>;
}

export namespace ZarrStore {
  /** Reads a URL's bytes; a missing one throws `DownloadStatusError` 404. */
  export type Fetch = (url: string, ctx: RuntimeContext) => Promise<Uint8Array<ArrayBuffer>>;

  const plainGet: Fetch = (url, ctx) => fetchData({ url, type: 'binary' }).runInContext(ctx);

  /**
   * Keys under `url` (the hierarchy's root), read by `fetch` (default: `fetchData`, a plain GET). Only a 404 is a
   * missing key; any other failure throws. No header is sent: a `Range` would need a CORS preflight that hosts such
   * as the CryoET Data Portal's refuse (zarr.md §1).
   */
  export function fromUrl(url: string, fetch: Fetch = plainGet): ZarrStore {
    const root = url.replace(/\/+$/, '');
    return {
      async get(key, ctx) {
        try {
          return await fetch(`${root}/${key}`, ctx);
        } catch (e) {
          if (e instanceof DownloadStatusError && e.status === 404) return undefined;
          throw e;
        }
      },
    };
  }

  /** Keys from a map, e.g. the files of a picked folder by their path under the root. */
  export function fromMap(files: ReadonlyMap<string, Uint8Array<ArrayBuffer> | Blob>): ZarrStore {
    return {
      async get(key) {
        const f = files.get(key);
        return f instanceof Blob ? new Uint8Array(await f.arrayBuffer()) : f;
      },
    };
  }
}
